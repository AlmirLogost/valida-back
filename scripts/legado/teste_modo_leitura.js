// Teste manual da sub-etapa 1.6, item 1: modo somente leitura de verdade.
//
// Confirma que, pra conta com TRIAL VENCIDO, SUSPENSA ou CANCELADA:
//  - login funciona
//  - leitura (GET) funciona
//  - "Meu plano" (GET /subscription/status) funciona
//  - POST, PUT, PATCH e DELETE em rotas de dados são recusados (403, mensagem clara)
// E que uma conta ATIVA normal não é afetada (grupo de controle).
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_modo_leitura.js

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

const PREFIXO = '__teste_leitura__'
const PORTA = 3990
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM checklists WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE email LIKE ?', [`${PREFIXO}%`])
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

// Testa uma conta num estado específico (trial vencido / suspenso / cancelado):
// login funciona, leitura funciona, "Meu plano" funciona, e PUT/DELETE numa
// tarefa já existente são recusados com mensagem clara.
async function testarEstado(nomeEstado, email, lojaId, checklistId) {
  console.log(`-- ${nomeEstado}: lê e vê o plano, mas não edita/apaga --`)

  const login = await chamar('POST', '/login', null, { email, senha: 'teste123' })
  if (login.status === 200 && login.body?.token) ok(`[${nomeEstado}] login funciona`)
  else { falhou(`[${nomeEstado}] login funciona`, JSON.stringify(login)); return }
  const token = login.body.token

  const leitura = await chamar('GET', '/checklists', token)
  if (leitura.status === 200) ok(`[${nomeEstado}] GET /checklists funciona`)
  else falhou(`[${nomeEstado}] GET /checklists funciona`, JSON.stringify(leitura))

  const meuPlano = await chamar('GET', '/subscription/status', token)
  if (meuPlano.status === 200) ok(`[${nomeEstado}] "Meu plano" (GET /subscription/status) funciona`)
  else falhou(`[${nomeEstado}] "Meu plano" (GET /subscription/status) funciona`, JSON.stringify(meuPlano))

  const editaChecklist = await chamar('PUT', `/checklists/${checklistId}`, token, { titulo: 'alterado', recorrencia: 'diario' })
  if (editaChecklist.status === 403 && /modo somente leitura/.test(editaChecklist.body?.erro || '')) {
    ok(`[${nomeEstado}] PUT /checklists/:id recusado com mensagem clara`)
  } else {
    falhou(`[${nomeEstado}] PUT /checklists/:id recusado com mensagem clara`, JSON.stringify(editaChecklist))
  }

  const pausaChecklist = await chamar('PATCH', `/checklists/${checklistId}/pausar`, token, {})
  if (pausaChecklist.status === 403 && /modo somente leitura/.test(pausaChecklist.body?.erro || '')) {
    ok(`[${nomeEstado}] PATCH /checklists/:id/pausar recusado com mensagem clara`)
  } else {
    falhou(`[${nomeEstado}] PATCH /checklists/:id/pausar recusado com mensagem clara`, JSON.stringify(pausaChecklist))
  }

  const apagaChecklist = await chamar('DELETE', `/checklists/${checklistId}`, token)
  if (apagaChecklist.status === 403 && /modo somente leitura/.test(apagaChecklist.body?.erro || '')) {
    ok(`[${nomeEstado}] DELETE /checklists/:id recusado com mensagem clara`)
  } else {
    falhou(`[${nomeEstado}] DELETE /checklists/:id recusado com mensagem clara`, JSON.stringify(apagaChecklist))
  }

  const criaLoja = await chamar('POST', '/lojas', token, { nome: `${PREFIXO}Nova` })
  if (criaLoja.status === 403 && /modo somente leitura/.test(criaLoja.body?.erro || '')) {
    ok(`[${nomeEstado}] POST /lojas recusado com mensagem clara`)
  } else {
    falhou(`[${nomeEstado}] POST /lojas recusado com mensagem clara`, JSON.stringify(criaLoja))
  }

  // Confirma que a tarefa realmente não foi alterada/apagada por nenhuma das tentativas
  const aindaIntacta = await query('SELECT titulo, ativo, pausado FROM checklists WHERE id = ?', [checklistId])
  if (aindaIntacta[0]?.titulo === `${PREFIXO}Tarefa ${nomeEstado}` && aindaIntacta[0]?.ativo === 1 && !aindaIntacta[0]?.pausado) {
    ok(`[${nomeEstado}] a tarefa continua intacta (não editada, não pausada, não apagada)`)
  } else {
    falhou(`[${nomeEstado}] a tarefa continua intacta`, JSON.stringify(aindaIntacta[0]))
  }
}

async function main() {
  let child
  try {
    await limpar()
    const hash = await bcrypt.hash('teste123', 10)
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")

    async function criarConta(sufixo, statusAssinatura, trialFim) {
      const dono = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
        [`${PREFIXO}Dono ${sufixo}`, `${PREFIXO}${sufixo}@teste.local`, hash])
      const loja = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja ${sufixo}`, dono.lastID])
      const checklist = await run(`INSERT INTO checklists (titulo, loja_id, criado_por, recorrencia) VALUES (?, ?, ?, 'diario')`,
        [`${PREFIXO}Tarefa ${sufixo}`, loja.lastID, dono.lastID])
      await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)',
        [dono.lastID, planoProf.id, statusAssinatura, trialFim || null])
      return { dono, loja, checklist }
    }

    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const emUmMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const trialVencido = await criarConta('trial vencido', 'trial', ontem)
    const suspensa = await criarConta('suspenso', 'suspenso', null)
    const cancelada = await criarConta('cancelado', 'cancelado', null)
    const ativa = await criarConta('ativa', 'trial', emUmMes) // grupo de controle: trial em dia

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    console.log('\nTestando modo somente leitura de verdade...\n')

    await testarEstado('trial vencido', `${PREFIXO}trial vencido@teste.local`, trialVencido.loja.lastID, trialVencido.checklist.lastID)
    await testarEstado('suspenso', `${PREFIXO}suspenso@teste.local`, suspensa.loja.lastID, suspensa.checklist.lastID)
    await testarEstado('cancelado', `${PREFIXO}cancelado@teste.local`, cancelada.loja.lastID, cancelada.checklist.lastID)

    console.log('-- conta ATIVA (controle): continua editando normalmente --')
    const loginAtiva = await chamar('POST', '/login', null, { email: `${PREFIXO}ativa@teste.local`, senha: 'teste123' })
    const tokenAtiva = loginAtiva.body?.token
    const editaAtiva = await chamar('PUT', `/checklists/${ativa.checklist.lastID}`, tokenAtiva, { titulo: `${PREFIXO}Tarefa ativa editada`, recorrencia: 'diario' })
    if (editaAtiva.status === 200) ok('[ativa] PUT /checklists/:id funciona normalmente (não afetada pelo modo somente leitura)')
    else falhou('[ativa] PUT /checklists/:id funciona normalmente', JSON.stringify(editaAtiva))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — modo somente leitura funciona de verdade (POST/PUT/PATCH/DELETE).')
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
