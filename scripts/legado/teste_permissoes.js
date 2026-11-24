// Teste manual da Reforma de Acessos, Passo 3: middleware requirePermissao.
//
// Confirma:
//  - operador NÃO cria unidade (403, mensagem clara)
//  - gerente da unidade A NÃO vê a unidade B (mesma conta, outra unidade)
//  - conta A nunca vê conta B (checagem de permissão não abre brecha nova)
//  - perfil personalizado COM "unidades.editar" consegue editar; outro
//    perfil personalizado SEM essa permissão não consegue
//  - uma ação importante (criar loja) fica registrada na auditoria
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_permissoes.js

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

const PREFIXO = '__teste_permissoes__'
const PORTA = 3997
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM auditoria WHERE detalhes::text LIKE ?', [`%${PREFIXO}%`])
  await run('DELETE FROM checklists WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM usuario_lojas WHERE usuario_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfil_permissoes WHERE perfil_id IN (SELECT id FROM perfis WHERE rotulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE rotulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE email LIKE ?', [`${PREFIXO}%`])
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

    // ---------- Conta A: dono, gerente (unidade A), operador ----------
    const donoA = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono A`, `${PREFIXO}donoa@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [donoA.lastID, planoProf.id, 'ativo'])

    const lojaA = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A`, donoA.lastID])
    const lojaA2 = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A-2`, donoA.lastID])
    // Tarefa na Loja A-2, pra testar acesso direto por ID (item 5 da Fase 2)
    const checklistA2 = await run(`INSERT INTO checklists (titulo, loja_id, criado_por, recorrencia) VALUES (?, ?, ?, 'diario')`,
      [`${PREFIXO}Tarefa A-2`, lojaA2.lastID, donoA.lastID])

    const gerenteA = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, 'gerente', ?)`,
      [`${PREFIXO}Gerente A`, `${PREFIXO}gerentea@teste.local`, hash, lojaA.lastID])
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [gerenteA.lastID, lojaA.lastID])

    const operadorA = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, 'operador', ?)`,
      [`${PREFIXO}Operador A`, `${PREFIXO}operadora@teste.local`, hash, lojaA.lastID])
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [operadorA.lastID, lojaA.lastID])

    // ---------- Conta B: dono + sua própria loja (pra provar que a conta A nunca a vê) ----------
    const donoB = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono B`, `${PREFIXO}donob@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [donoB.lastID, planoProf.id, 'ativo'])
    const lojaB = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja B`, donoB.lastID])

    // ---------- Dois perfis personalizados na conta A: um COM "unidades.editar", outro SEM ----------
    const cargoComEditarUnidades = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'email_senha', 0, 50)`,
      [`${PREFIXO.toLowerCase()}com_editar`, `${PREFIXO}Com Editar Unidades`, donoA.lastID]
    )
    await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)',
      [cargoComEditarUnidades.lastID, 'unidades', 'editar'])
    await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)',
      [cargoComEditarUnidades.lastID, 'unidades', 'ver'])

    const cargoSemEditarUnidades = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'email_senha', 0, 51)`,
      [`${PREFIXO.toLowerCase()}sem_editar`, `${PREFIXO}Sem Editar Unidades`, donoA.lastID]
    )
    await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)',
      [cargoSemEditarUnidades.lastID, 'unidades', 'ver'])
    await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 0)',
      [cargoSemEditarUnidades.lastID, 'unidades', 'editar'])

    const usuarioComPermissao = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`,
      [`${PREFIXO}Com Permissao`, `${PREFIXO}compermissao@teste.local`, hash, `${PREFIXO.toLowerCase()}com_editar`, lojaA.lastID]
    )
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [usuarioComPermissao.lastID, lojaA.lastID])

    const usuarioSemPermissao = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`,
      [`${PREFIXO}Sem Permissao`, `${PREFIXO}sempermissao@teste.local`, hash, `${PREFIXO.toLowerCase()}sem_editar`, lojaA.lastID]
    )
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [usuarioSemPermissao.lastID, lojaA.lastID])

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    console.log('\nTestando o middleware requirePermissao...\n')

    console.log('-- operador não cria unidade --')
    const tokenOperador = await login(`${PREFIXO}operadora@teste.local`)
    const criaLoja = await chamar('POST', '/lojas', tokenOperador, { nome: `${PREFIXO}Loja Invasora` })
    if (criaLoja.status === 403 && /permissão/.test(criaLoja.body?.erro || '')) {
      ok('operador recebe 403 com mensagem clara ao tentar criar unidade')
    } else {
      falhou('operador recebe 403 ao tentar criar unidade', JSON.stringify(criaLoja))
    }

    console.log('-- gerente da unidade A não vê a unidade B (mesma conta) --')
    const tokenGerente = await login(`${PREFIXO}gerentea@teste.local`)
    const listaLojasGerente = await chamar('GET', '/lojas', tokenGerente)
    const nomesVistos = (listaLojasGerente.body || []).map(l => l.nome)
    if (listaLojasGerente.status === 200 && nomesVistos.includes(`${PREFIXO}Loja A`) && !nomesVistos.includes(`${PREFIXO}Loja A-2`)) {
      ok('gerente vê a própria unidade (Loja A) e NÃO vê a Loja A-2 (mesma conta, outra unidade)')
    } else {
      falhou('gerente vê só a própria unidade', JSON.stringify(nomesVistos))
    }

    console.log('-- segunda camada: acesso direto por ID também respeita a unidade (Fase 2, item 5) --')
    const vePorIdLojaA2 = await chamar('GET', `/lojas/${lojaA2.lastID}`, tokenGerente)
    if (vePorIdLojaA2.status === 404) {
      ok('gerente NÃO consegue abrir a Loja A-2 direto por ID (mesma conta, outra unidade)')
    } else {
      falhou('gerente não deveria abrir a Loja A-2 por ID', JSON.stringify(vePorIdLojaA2))
    }
    const itensTarefaA2 = await chamar('GET', `/checklists/${checklistA2.lastID}/itens`, tokenGerente)
    if (itensTarefaA2.status === 404) {
      ok('gerente NÃO consegue ver os itens da Tarefa A-2 direto por ID (outra unidade)')
    } else {
      falhou('gerente não deveria ver itens da Tarefa A-2', JSON.stringify(itensTarefaA2))
    }
    const editaTarefaA2 = await chamar('PUT', `/checklists/${checklistA2.lastID}`, tokenGerente, { titulo: 'invadido', recorrencia: 'diario' })
    if (editaTarefaA2.status === 404) {
      ok('gerente NÃO consegue editar a Tarefa A-2 direto por ID (outra unidade)')
    } else {
      falhou('gerente não deveria editar a Tarefa A-2', JSON.stringify(editaTarefaA2))
    }
    // Mas o Dono, que vê a conta toda, continua acessando a Loja A-2 sem problema
    const donoVeLojaA2 = await chamar('GET', `/lojas/${lojaA2.lastID}`, await login(`${PREFIXO}donoa@teste.local`))
    if (donoVeLojaA2.status === 200) {
      ok('Dono continua acessando a Loja A-2 por ID normalmente (não é afetado pela restrição por unidade)')
    } else {
      falhou('Dono deveria continuar acessando qualquer unidade da própria conta', JSON.stringify(donoVeLojaA2))
    }

    console.log('-- conta A nunca vê a conta B --')
    const tokenDonoA = await login(`${PREFIXO}donoa@teste.local`)
    const listaLojasDonoA = await chamar('GET', '/lojas', tokenDonoA)
    const nomesDonoA = (listaLojasDonoA.body || []).map(l => l.nome)
    if (!nomesDonoA.includes(`${PREFIXO}Loja B`)) {
      ok('dono A não vê a Loja B (de outra conta) na lista de unidades')
    } else {
      falhou('dono A não vê a Loja B', JSON.stringify(nomesDonoA))
    }

    console.log('-- perfil personalizado com "editar unidades" consegue; sem ela, não --')
    const tokenCom = await login(`${PREFIXO}compermissao@teste.local`)
    const editaComPermissao = await chamar('PUT', `/lojas/${lojaA.lastID}`, tokenCom, { nome: `${PREFIXO}Loja A editada` })
    if (editaComPermissao.status === 200) ok('usuário com "unidades.editar" consegue editar a unidade')
    else falhou('usuário com "unidades.editar" consegue editar a unidade', JSON.stringify(editaComPermissao))

    const tokenSem = await login(`${PREFIXO}sempermissao@teste.local`)
    const editaSemPermissao = await chamar('PUT', `/lojas/${lojaA.lastID}`, tokenSem, { nome: `${PREFIXO}Loja A hackeada` })
    if (editaSemPermissao.status === 403 && /permissão/.test(editaSemPermissao.body?.erro || '')) {
      ok('usuário SEM "unidades.editar" recebe 403 com mensagem clara ao tentar editar')
    } else {
      falhou('usuário sem "unidades.editar" é recusado', JSON.stringify(editaSemPermissao))
    }
    // mas ele continua vendo (tem "unidades.ver")
    const vePermitido = await chamar('GET', '/lojas', tokenSem)
    if (vePermitido.status === 200) ok('usuário sem "unidades.editar" ainda consegue VER as unidades (tem "unidades.ver")')
    else falhou('usuário sem "unidades.editar" ainda consegue ver', JSON.stringify(vePermitido))

    console.log('-- regra geral: Dono nunca fica travado, mesmo num cargo com dados órfãos --')
    // Simula um cargo criado por um código antigo (sem admin_id) — não
    // deveria acontecer com o código atual, mas um servidor rodando
    // versão antiga pode ter deixado algum assim.
    const cargoOrfao = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, loja_id, metodo_login, sistema, ordem) VALUES (?, ?, NULL, NULL, 'pin', 0, 90)`,
      [`${PREFIXO.toLowerCase()}orfao`, `${PREFIXO}Orfao`]
    )
    const abreOrfaoAntes = await chamar('GET', `/perfis/${cargoOrfao.lastID}/permissoes`, tokenDonoA)
    if (abreOrfaoAntes.status === 200) {
      ok('Dono consegue abrir um cargo órfão (sem admin_id) na primeira tentativa — e ele se corrige')
    } else {
      falhou('Dono deveria conseguir abrir cargo órfão (regra geral: nunca travado)', JSON.stringify(abreOrfaoAntes))
    }
    const orfaoCorrigido = await query('SELECT admin_id FROM perfis WHERE id = ?', [cargoOrfao.lastID])
    if (orfaoCorrigido[0]?.admin_id === donoA.lastID) {
      ok('o cargo órfão foi adotado pela conta do Dono que o abriu (corrigido de vez)')
    } else {
      falhou('cargo órfão deveria ter sido corrigido com o admin_id do Dono', JSON.stringify(orfaoCorrigido))
    }

    console.log('-- ação importante (criar loja) fica registrada na auditoria --')
    const criaLojaDono = await chamar('POST', '/lojas', tokenDonoA, { nome: `${PREFIXO}Loja Auditada` })
    const auditoria = await query(
      `SELECT * FROM auditoria WHERE admin_id = ? AND entidade = 'loja' AND acao = 'criar' ORDER BY id DESC LIMIT 1`,
      [donoA.lastID]
    )
    if (auditoria.length > 0 && auditoria[0].entidade_id === criaLojaDono.body?.id) {
      ok('criar uma loja gera uma linha de auditoria com a conta e a ação certas')
    } else {
      falhou('auditoria registrada ao criar loja', JSON.stringify(auditoria))
    }
    const auditoriaTexto = JSON.stringify(auditoria)
    if (!/senha|teste123|pin|token/i.test(auditoriaTexto.replace(/criar|editar|arquivar/g, ''))) {
      ok('a linha de auditoria não expõe senha/PIN/token')
    } else {
      falhou('auditoria não expõe segredo', auditoriaTexto)
    }

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — requirePermissao funciona.')
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
