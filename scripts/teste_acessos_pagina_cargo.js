// Teste manual da Reforma de Acessos, Fase 4, bloco E: página do cargo
// (permissões/pessoas/detalhes) e as regras novas de segurança.
//
// Confirma:
//  - "descricao" do cargo salva e volta certo (aba Detalhes)
//  - um Gerente SEM "comissoes.ver_todas" não consegue conceder essa
//    permissão a um cargo personalizado (ninguém dá mais do que tem)
//  - o Dono consegue conceder qualquer permissão normalmente
//  - o Dono da conta não pode ser rebaixado de perfil nem arquivado
//  - cargos arquivados (duplicados/órfãos da migration 015) não aparecem
//    mais em GET /perfis
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_acessos_pagina_cargo.js

require('dotenv').config()

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  process.exit(1)
}

const { spawn } = require('child_process')
const path = require('path')
const bcrypt = require('bcrypt')
const { query, run, pool } = require('../src/config/database')

const PREFIXO = '__teste_pagina_cargo__'
const PORTA = 3994
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM usuario_lojas WHERE usuario_id IN (SELECT id FROM usuarios WHERE nome LIKE ? OR email LIKE ?)', [`${PREFIXO}%`, `${PREFIXO}%`])
  await run('DELETE FROM perfil_permissoes WHERE perfil_id IN (SELECT id FROM perfis WHERE rotulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE rotulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE nome LIKE ? OR email LIKE ?)', [`${PREFIXO}%`, `${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE nome LIKE ? OR email LIKE ?', [`${PREFIXO}%`, `${PREFIXO}%`])
  await run('DELETE FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
}

function esperarServidor(child) {
  return new Promise((resolve, reject) => {
    let saida = ''
    const timeout = setTimeout(() => reject(new Error('servidor não respondeu a tempo')), 8000)
    child.stdout.on('data', (d) => { saida += d.toString(); if (saida.includes('VALIDA na porta')) { clearTimeout(timeout); resolve() } })
    child.stderr.on('data', (d) => { saida += d.toString() })
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`servidor encerrou (código ${code}). Saída: ${saida}`)) })
  })
}

async function chamar(metodo, caminho, token, body) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await r.json() } catch { /* corpo vazio */ }
  return { status: r.status, body: json }
}
async function login(email) {
  const r = await chamar('POST', '/login', null, { email, senha: 'teste123' })
  return r.body?.token
}

async function main() {
  let child
  try {
    await limpar()
    const hash = await bcrypt.hash('teste123', 10)
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")

    const donoA = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono A`, `${PREFIXO}donoa@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [donoA.lastID, planoProf.id, 'ativo'])
    const lojaA = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A`, donoA.lastID])

    // Gerente SEM "comissoes.ver_todas" — cargo personalizado com só
    // "acessos.editar" e "acessos.criar" (pra poder criar/editar outro cargo).
    const cargoGerenteLimitado = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'email_senha', 0, 50)`,
      [`${PREFIXO.toLowerCase()}gerente_lim`, `${PREFIXO}Gerente Limitado`, donoA.lastID]
    )
    for (const [modulo, acao] of [['acessos', 'editar'], ['acessos', 'criar'], ['acessos', 'ver']]) {
      await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)', [cargoGerenteLimitado.lastID, modulo, acao])
    }
    const gerenteLimitado = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`,
      [`${PREFIXO}Gerente Limitado`, `${PREFIXO}gerentelim@teste.local`, hash, `${PREFIXO.toLowerCase()}gerente_lim`, lojaA.lastID]
    )
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [gerenteLimitado.lastID, lojaA.lastID])

    // Cargo alvo (personalizado, em branco) que o Gerente Limitado vai tentar editar.
    const cargoAlvo = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'email_senha', 0, 51)`,
      [`${PREFIXO.toLowerCase()}alvo`, `${PREFIXO}Alvo`, donoA.lastID]
    )

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    const tokenDono = await login(`${PREFIXO}donoa@teste.local`)
    const tokenGerenteLim = await login(`${PREFIXO}gerentelim@teste.local`)

    console.log('\nTestando a página do cargo (Fase 4, bloco E)...\n')

    console.log('-- aba Detalhes: descricao salva e volta --')
    const salvaDetalhes = await chamar('PUT', `/perfis/${cargoAlvo.lastID}`, tokenDono, {
      rotulo: `${PREFIXO}Alvo`, cor: '#8e24aa', descricao: 'Cargo de teste pra conferência'
    })
    const perfisAposDetalhes = await chamar('GET', '/perfis', tokenDono)
    const alvoAtualizado = (perfisAposDetalhes.body || []).find(p => p.id === cargoAlvo.lastID)
    if (salvaDetalhes.status === 200 && alvoAtualizado?.descricao === 'Cargo de teste pra conferência') {
      ok('descricao do cargo salva e volta certo')
    } else {
      falhou('descricao do cargo deveria salvar', JSON.stringify({ salvaDetalhes, alvoAtualizado }))
    }

    console.log('-- ninguém dá a outro mais permissão do que tem --')
    const tentaConceder = await chamar('PUT', `/perfis/${cargoAlvo.lastID}/permissoes`, tokenGerenteLim, {
      permissoes: [{ modulo: 'comissoes', acao: 'ver_todas', permitido: true }]
    })
    if (tentaConceder.status === 403 && /não tem essa permissão/.test(tentaConceder.body?.erro || '')) {
      ok('Gerente sem "comissoes.ver_todas" não consegue conceder essa permissão a outro cargo')
    } else {
      falhou('Gerente sem a permissão não deveria conseguir concedê-la', JSON.stringify(tentaConceder))
    }
    const matrizAlvo = await chamar('GET', `/perfis/${cargoAlvo.lastID}/permissoes`, tokenDono)
    const temComissaoTodas = (matrizAlvo.body?.permissoes || []).some(p => p.modulo === 'comissoes' && p.acao === 'ver_todas' && p.permitido)
    if (!temComissaoTodas) ok('a permissão realmente NÃO foi concedida (confirmado lendo a matriz)')
    else falhou('a permissão não deveria ter sido gravada', JSON.stringify(matrizAlvo.body))

    console.log('-- o Dono consegue conceder qualquer permissão normalmente --')
    const donoConcede = await chamar('PUT', `/perfis/${cargoAlvo.lastID}/permissoes`, tokenDono, {
      permissoes: [{ modulo: 'comissoes', acao: 'ver_todas', permitido: true }]
    })
    if (donoConcede.status === 200) ok('Dono concede a permissão sem problema')
    else falhou('Dono deveria conseguir conceder qualquer permissão', JSON.stringify(donoConcede))

    console.log('-- o Dono da conta não pode ser rebaixado de perfil --')
    const rebaixaDono = await chamar('PUT', `/usuarios/${donoA.lastID}`, tokenDono, {
      nome: `${PREFIXO}Dono A`, email: `${PREFIXO}donoa@teste.local`, perfil: 'gerente'
    })
    if (rebaixaDono.status === 403 && /não pode ser rebaixado/.test(rebaixaDono.body?.erro || '')) {
      ok('rebaixar o Dono é recusado com mensagem clara')
    } else {
      falhou('rebaixar o Dono deveria ser recusado', JSON.stringify(rebaixaDono))
    }

    console.log('-- o Dono da conta não pode ser arquivado --')
    const arquivaDono = await chamar('DELETE', `/usuarios/${donoA.lastID}`, tokenDono)
    if (arquivaDono.status === 403 && /não pode ser arquivado/.test(arquivaDono.body?.erro || '')) {
      ok('arquivar o Dono é recusado com mensagem clara')
    } else {
      falhou('arquivar o Dono deveria ser recusado', JSON.stringify(arquivaDono))
    }

    console.log('-- cargos arquivados pela migration 015 não aparecem mais na lista --')
    const listaPerfis = await chamar('GET', '/perfis', tokenDono)
    const nomesESistema = (listaPerfis.body || []).map(p => `${p.nome}:${p.sistema}`)
    if (!nomesESistema.includes('funcionario:1')) ok('cargo de sistema "funcionario" (legado) não aparece mais na lista')
    else falhou('"funcionario" deveria estar arquivado', JSON.stringify(nomesESistema))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — página do cargo e regras de segurança funcionam.')
    else console.log(`❌ ${falhas} teste(s) falharam.`)
  } catch (e) {
    falhas++
    console.error('\n❌ Erro ao rodar o teste:', e.message)
  } finally {
    if (child) child.kill()
    await limpar()
    await pool.end()
  }
  process.exit(falhas > 0 ? 1 : 0)
}

main()
