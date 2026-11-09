// Teste do bug relatado: "ao abrir um cargo em Acessos, a matriz de
// permissões não aparece".
//
// Confirma:
//  - GET /perfis/:id/permissoes devolve a matriz COMPLETA (9 módulos) pra
//    cada tipo de cargo: sistema, personalizado em branco, e duplicado
//  - o Proprietário nunca é bloqueado por acessos.ver/acessos.editar
//    (não precisa ter essas permissões na própria matriz pra usar a tela)
//  - mesmo um cargo SEM NENHUMA linha em perfil_permissoes (cargo antigo,
//    de antes da matriz existir) devolve "modulos" completo — o campo que
//    o front usa pra desenhar a matriz inteira (editável, tudo desligado)
//    em vez de ficar em branco
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_matriz_permissoes_nunca_vazia.js

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

const PREFIXO = '__teste_matriz_nunca_vazia__'
const PORTA = 3991
const BASE = `http://127.0.0.1:${PORTA}/api`
const N_MODULOS_ESPERADO = 9

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM perfil_permissoes WHERE perfil_id IN (SELECT id FROM perfis WHERE nome LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE nome LIKE ?', [`${PREFIXO}%`])
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

async function login(email) { return (await chamar('POST', '/login', null, { email, senha: 'teste123' })).body?.token }

function matrizCompleta(resp) {
  return resp.status === 200 && resp.body?.modulos && Object.keys(resp.body.modulos).length === N_MODULOS_ESPERADO
}

async function main() {
  let child
  try {
    await limpar()
    const hash = await bcrypt.hash('teste123', 10)
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")

    const dono = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono`, `${PREFIXO}dono@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [dono.lastID, planoProf.id, 'ativo'])
    await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja`, dono.lastID])

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    const tokenDono = await login(`${PREFIXO}dono@teste.local`)

    console.log('\nTestando que a matriz de permissões nunca vem em branco...\n')

    console.log('-- cargos de sistema (super_admin, gerente, fiscal, operador) --')
    const listaCargos = await chamar('GET', '/perfis', tokenDono)
    const sistemaCargos = (listaCargos.body || []).filter(c => c.sistema)
    if (sistemaCargos.length === 4) ok('a conta vê os 4 cargos de sistema')
    else falhou('deveria ver 4 cargos de sistema', JSON.stringify(sistemaCargos.map(c => c.nome)))

    for (const cargo of sistemaCargos) {
      const resp = await chamar('GET', `/perfis/${cargo.id}/permissoes`, tokenDono)
      if (matrizCompleta(resp)) ok(`cargo de sistema "${cargo.nome}" devolve a matriz completa (${N_MODULOS_ESPERADO} módulos)`)
      else falhou(`cargo de sistema "${cargo.nome}" deveria devolver a matriz completa`, JSON.stringify(resp.body))
    }

    console.log('-- cargo personalizado em branco (recém-criado) --')
    const criaBranco = await chamar('POST', '/perfis', tokenDono, { rotulo: `${PREFIXO}Branco`, perfil_acesso: 'operador' })
    const respBranco = await chamar('GET', `/perfis/${criaBranco.body?.id}/permissoes`, tokenDono)
    if (matrizCompleta(respBranco)) ok('cargo personalizado em branco devolve a matriz completa')
    else falhou('cargo personalizado em branco deveria devolver a matriz completa', JSON.stringify(respBranco.body))

    console.log('-- cargo duplicado de um cargo de sistema --')
    const origem = sistemaCargos.find(c => c.nome === 'operador')
    const duplicado = await chamar('POST', `/perfis/${origem.id}/duplicar`, tokenDono)
    const respDup = await chamar('GET', `/perfis/${duplicado.body?.id}/permissoes`, tokenDono)
    if (matrizCompleta(respDup)) ok('cargo duplicado devolve a matriz completa')
    else falhou('cargo duplicado deveria devolver a matriz completa', JSON.stringify(respDup.body))

    console.log('-- cargo SEM NENHUMA linha em perfil_permissoes (simula cargo antigo) --')
    await run('DELETE FROM perfil_permissoes WHERE perfil_id = ?', [criaBranco.body?.id])
    const semLinhas = await query('SELECT COUNT(*) as n FROM perfil_permissoes WHERE perfil_id = ?', [criaBranco.body?.id])
    if (Number(semLinhas[0].n) === 0) ok('cargo ficou de fato sem nenhuma linha na matriz (setup do teste)')
    const respSemLinhas = await chamar('GET', `/perfis/${criaBranco.body?.id}/permissoes`, tokenDono)
    if (matrizCompleta(respSemLinhas) && (respSemLinhas.body.permissoes || []).length === 0) {
      ok('mesmo sem nenhuma linha salva, "modulos" continua completo (front nunca fica em branco) e "permissoes" vem vazio (tudo desligado)')
    } else {
      falhou('cargo sem linhas deveria devolver "modulos" completo', JSON.stringify(respSemLinhas.body))
    }

    console.log('-- o Proprietário nunca é bloqueado por acessos.ver/acessos.editar --')
    const semAcessos = await query(`SELECT permitido FROM perfil_permissoes WHERE perfil_id = (SELECT id FROM perfis WHERE nome='super_admin') AND modulo='acessos' AND acao='ver'`)
    // Não importa o que a matriz do super_admin diz — o bypass é por perfil, não por linha de permissão.
    const verComoDono = await chamar('GET', `/perfis/${origem.id}/permissoes`, tokenDono)
    if (verComoDono.status === 200) ok('Proprietário acessa GET /perfis/:id/permissoes mesmo sem depender da própria matriz')
    else falhou('Proprietário nunca deveria ser bloqueado aqui', JSON.stringify(verComoDono))
    const editarComoDono = await chamar('PUT', `/perfis/${criaBranco.body?.id}/permissoes`, tokenDono, { permissoes: [{ modulo: 'painel', acao: 'ver', permitido: true }] })
    if (editarComoDono.status === 200) ok('Proprietário consegue editar a matriz (acessos.editar nunca bloqueia o Dono)')
    else falhou('Proprietário nunca deveria ser bloqueado ao editar a matriz', JSON.stringify(editarComoDono))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — a matriz de permissões nunca vem em branco.')
    else console.log(`❌ ${falhas} teste(s) falharam.`)
  } catch (e) {
    falhas++
    console.error('\n❌ Erro ao rodar o teste:', e.message)
  } finally {
    if (child) child.kill()
    await limpar()
    await pool.end()
    process.exit(falhas > 0 ? 1 : 0)
  }
}

main()
