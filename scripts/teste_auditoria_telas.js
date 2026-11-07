// Fase 2 da Reforma de Acessos, item 1: auditoria de todas as telas do front.
//
// Em vez de só ler o código, cria um cenário real (dono + loja + tarefa +
// colaborador + execução + template + cargo personalizado) e chama, como
// Dono, TODOS os endereços de API que algum arquivo em front/src/pages usa
// — a lista foi extraída com grep em todas as telas. Confirma que nenhum dá
// 404 (endereço não existe) nem 403 (Dono sem permissão, o que nunca
// deveria acontecer) nem 500.
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_auditoria_telas.js

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

const PREFIXO = '__teste_auditoria__'
const PORTA = 3989
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
const resultados = []
function ok(nome, detalhe) { resultados.push({ nome, ok: true, detalhe }); console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; resultados.push({ nome, ok: false, detalhe }); console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM usuario_lojas WHERE usuario_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM execucoes WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuario_checklists WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklist_itens WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklists WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM template_itens WHERE template_id IN (SELECT id FROM templates WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM templates WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM perfil_permissoes WHERE perfil_id IN (SELECT id FROM perfis WHERE rotulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE rotulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM loja_fechamentos WHERE loja_id IN (SELECT id FROM lojas WHERE nome LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM loja_horarios WHERE loja_id IN (SELECT id FROM lojas WHERE nome LIKE ?)', [`${PREFIXO}%`])
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

async function chamar(metodo, caminho, token) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  })
  let json = null
  try { json = await r.json() } catch { /* corpo vazio */ }
  return { status: r.status, body: json }
}

// Testa um GET esperando 200 — é o que toda tela faz pra carregar dados.
async function testarGet(nomeTela, caminho, token) {
  const r = await chamar('GET', caminho, token)
  if (r.status === 200) ok(`[${nomeTela}] GET ${caminho}`, r.status)
  else falhou(`[${nomeTela}] GET ${caminho}`, `status ${r.status} — ${JSON.stringify(r.body)}`)
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

    const loja = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja`, dono.lastID])
    const func = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin) VALUES (?, ?, ?, 'operador', ?, ?)`,
      [`${PREFIXO}Func`, `${PREFIXO}func@teste.local`, hash, loja.lastID, await bcrypt.hash('1234', 10)])
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [func.lastID, loja.lastID])

    const checklist = await run(`INSERT INTO checklists (titulo, loja_id, criado_por, recorrencia) VALUES (?, ?, ?, 'diario')`,
      [`${PREFIXO}Tarefa`, loja.lastID, dono.lastID])
    const item = await run('INSERT INTO checklist_itens (checklist_id, titulo) VALUES (?, ?)', [checklist.lastID, `${PREFIXO}Item`])
    await run('INSERT INTO usuario_checklists (usuario_id, checklist_id) VALUES (?, ?)', [func.lastID, checklist.lastID])
    const execucao = await run(`INSERT INTO execucoes (checklist_id, usuario_id, loja_id, status) VALUES (?, ?, ?, 'em_andamento')`,
      [checklist.lastID, func.lastID, loja.lastID])

    const template = await run(`INSERT INTO templates (titulo) VALUES (?)`, [`${PREFIXO}Template`])
    await run('INSERT INTO loja_fechamentos (loja_id, data, motivo) VALUES (?, ?, ?)', [loja.lastID, '2026-01-01', 'Teste'])

    const cargo = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'pin', 0, 70)`,
      [`${PREFIXO.toLowerCase()}cargo`, `${PREFIXO}Cargo`, dono.lastID]
    )

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    const loginReal = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${PREFIXO}dono@teste.local`, senha: 'teste123' }) })
    const loginBody = await loginReal.json()
    const token = loginBody.token
    if (!token) { falhou('[login] Dono consegue entrar', JSON.stringify(loginBody)); throw new Error('sem token, não dá pra continuar') }
    ok('[login] Dono consegue entrar e recebe token', 200)

    console.log('\nVarrendo todos os endereços que as telas usam, como Dono...\n')

    // --- Dashboard.vue ---
    await testarGet('Dashboard', '/execucoes', token)
    await testarGet('Dashboard', '/checklists', token)
    await testarGet('Dashboard', '/lojas', token)
    await testarGet('Dashboard', '/usuarios', token)
    await testarGet('Dashboard', '/usuario-checklists', token)

    // --- Lojas.vue ---
    await testarGet('Lojas', `/perfis?loja_id=${loja.lastID}`, token)
    await testarGet('Lojas', `/lojas/${loja.lastID}/horarios`, token)
    await testarGet('Lojas', `/lojas/${loja.lastID}/impacto-arquivamento`, token)
    await testarGet('Lojas', '/lojas?arquivadas=1', token)
    await testarGet('Lojas', `/lojas/${loja.lastID}/fechamentos`, token)
    await testarGet('Lojas', `/lojas/${loja.lastID}`, token)

    // --- Equipe.vue ---
    await testarGet('Equipe', '/usuarios', token)
    await testarGet('Equipe', '/lojas', token)
    await testarGet('Equipe', '/execucoes', token)
    await testarGet('Equipe', '/usuario-checklists', token)
    await testarGet('Equipe', `/lojas/${loja.lastID}/fechamentos`, token)
    await testarGet('Equipe', '/usuarios?arquivados=1', token)

    // --- Tarefas.vue ---
    await testarGet('Tarefas', '/lojas', token)
    await testarGet('Tarefas', '/checklists', token)
    await testarGet('Tarefas', '/usuarios', token)
    await testarGet('Tarefas', '/usuario-checklists', token)
    await testarGet('Tarefas', '/checklist-datas', token)
    await testarGet('Tarefas', `/execucoes?loja_id=${loja.lastID}&data_inicio=2026-01-01&data_fim=2026-12-31`, token)
    await testarGet('Tarefas', `/checklists/${checklist.lastID}/itens`, token)
    await testarGet('Tarefas', '/templates', token)
    await testarGet('Tarefas', `/templates/${template.lastID}`, token)

    // --- Execucoes.vue (Relatórios) ---
    await testarGet('Execucoes', '/lojas', token)
    await testarGet('Execucoes', '/usuarios', token)
    await testarGet('Execucoes', '/checklists', token)
    await testarGet('Execucoes', `/execucoes?loja_id=${loja.lastID}&data_inicio=2026-01-01&data_fim=2026-12-31`, token)
    await testarGet('Execucoes', '/usuario-checklists', token)

    // --- Conferencia.vue ---
    await testarGet('Conferencia', '/lojas', token)
    await testarGet('Conferencia', '/usuarios', token)
    await testarGet('Conferencia', `/usuarios/${func.lastID}/checklists`, token)
    await testarGet('Conferencia', `/execucoes?usuario_id=${func.lastID}`, token)
    await testarGet('Conferencia', `/execucoes/${execucao.lastID}`, token)

    // --- MinhasTarefas.vue (o próprio Dono também pode acessar, mas o uso real é do operador) ---
    await testarGet('MinhasTarefas', `/usuarios/${func.lastID}/checklists`, token)
    await testarGet('MinhasTarefas', `/usuarios/${func.lastID}/checklists-disponiveis`, token)
    await testarGet('MinhasTarefas', `/execucoes?usuario_id=${func.lastID}`, token)
    await testarGet('MinhasTarefas', `/loja/${loja.lastID}/visao-fiscal`, token)

    // --- Configuracoes.vue ---
    await testarGet('Configuracoes', '/me', token)
    await testarGet('Configuracoes', '/lojas?todas=1', token)

    // --- Acessos.vue ---
    await testarGet('Acessos', '/perfis', token)
    await testarGet('Acessos', `/perfis/${cargo.lastID}/permissoes`, token)

    // --- Assinatura.vue ---
    await testarGet('Assinatura', '/subscription/status', token)

    // --- relatório de comissão (usado em Equipe/MinhasTarefas) ---
    await testarGet('relatorio-comissao', `/usuarios/${func.lastID}/relatorio-comissao`, token)

    console.log('')
    if (falhas === 0) console.log(`✅ Todos os ${resultados.length} endereços testados responderam certo pro Dono.`)
    else console.log(`❌ ${falhas} de ${resultados.length} endereços falharam.`)
  } catch (e) {
    falhas++
    console.error('\n❌ Erro ao rodar a auditoria:', e.message)
  } finally {
    if (child) child.kill()
    await limpar()
    await pool.end()
  }
  process.exit(falhas > 0 ? 1 : 0)
}

main()
