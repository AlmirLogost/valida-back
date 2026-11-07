// Teste manual da sub-etapa 1.5: limite de tentativas no login de dono,
// renovação de token, e modo somente leitura quando o trial vence.
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_sessao_login.js

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

const PREFIXO = '__teste_sessao__'
const PORTA = 3992
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
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

async function main() {
  let child
  try {
    await limpar()
    const hash = await bcrypt.hash('teste123', 10)
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")

    // ---------- Dono com trial VENCIDO ----------
    const donoTrialVencido = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono Trial Vencido`, `${PREFIXO}trialvencido@teste.local`, hash])
    const lojaTrialVencido = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja TV`, donoTrialVencido.lastID])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)',
      [donoTrialVencido.lastID, planoProf.id, 'trial', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]) // venceu ontem

    // ---------- Dono SUSPENSO ----------
    const donoSuspenso = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono Suspenso`, `${PREFIXO}suspenso@teste.local`, hash])
    await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja Susp`, donoSuspenso.lastID])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [donoSuspenso.lastID, planoProf.id, 'suspenso'])

    // ---------- Dono comum (login com senha errada pro teste de limite) ----------
    const donoComum = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono Comum`, `${PREFIXO}comum@teste.local`, hash])

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    console.log('\nTestando sessão, renovação e modo somente leitura...\n')

    console.log('-- limite de tentativas no login de dono --')
    let ultima
    for (let i = 0; i < 5; i++) {
      ultima = await chamar('POST', '/login', null, { email: `${PREFIXO}comum@teste.local`, senha: 'senhaerrada' })
    }
    if (ultima.status === 401) ok('5 tentativas com senha errada ainda respondem 401')
    else falhou('5 tentativas com senha errada ainda respondem 401', JSON.stringify(ultima))

    const tentativaCertaBloqueada = await chamar('POST', '/login', null, { email: `${PREFIXO}comum@teste.local`, senha: 'teste123' })
    if (tentativaCertaBloqueada.status === 429) ok('6ª tentativa bloqueada (429) mesmo com a senha certa')
    else falhou('6ª tentativa bloqueada (429) mesmo com a senha certa', JSON.stringify(tentativaCertaBloqueada))

    console.log('-- renovação de token --')
    const loginNormal = await chamar('POST', '/login', null, { email: `${PREFIXO}trialvencido@teste.local`, senha: 'teste123' })
    const tokenOriginal = loginNormal.body?.token
    if (loginNormal.status === 200 && tokenOriginal) ok('login normal (dono com trial vencido) funciona e devolve token')
    else falhou('login normal (dono com trial vencido) funciona e devolve token', JSON.stringify(loginNormal))

    // Espera 1.1s pra garantir "iat" diferente do token original (o JWT tem
    // precisão de segundos — sem isso os dois tokens poderiam ficar idênticos
    // só porque foram emitidos no mesmo segundo, o que não seria um bug real).
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const renovado = await chamar('POST', '/token/renovar', tokenOriginal)
    if (renovado.status === 200 && renovado.body?.token && renovado.body.token !== tokenOriginal) {
      ok('renovar token devolve um token novo e válido')
    } else {
      falhou('renovar token devolve um token novo e válido', JSON.stringify(renovado))
    }
    // O token novo deve funcionar numa chamada autenticada normal
    const usaTokenNovo = await chamar('GET', '/lojas', renovado.body?.token)
    if (usaTokenNovo.status === 200) ok('o token renovado funciona em chamadas normais')
    else falhou('o token renovado funciona em chamadas normais', JSON.stringify(usaTokenNovo))

    console.log('-- trial vencido: lê dados, mas não cria --')
    const lstExec = await chamar('GET', '/execucoes', tokenOriginal)
    if (lstExec.status === 200) ok('GET /execucoes funciona com trial vencido (somente leitura)')
    else falhou('GET /execucoes funciona com trial vencido (somente leitura)', JSON.stringify(lstExec))

    const criaLoja = await chamar('POST', '/lojas', tokenOriginal, { nome: `${PREFIXO}Loja Nova` })
    if (criaLoja.status === 403 && /período de teste acabou/.test(criaLoja.body?.erro || '')) {
      ok('POST /lojas bloqueado com mensagem clara (trial vencido)')
    } else {
      falhou('POST /lojas bloqueado com mensagem clara (trial vencido)', JSON.stringify(criaLoja))
    }

    const criaChecklist = await chamar('POST', '/checklists', tokenOriginal, { titulo: 'x', loja_id: lojaTrialVencido.lastID, recorrencia: 'diario' })
    if (criaChecklist.status === 403 && /período de teste acabou/.test(criaChecklist.body?.erro || '')) {
      ok('POST /checklists bloqueado com mensagem clara (trial vencido)')
    } else {
      falhou('POST /checklists bloqueado com mensagem clara (trial vencido)', JSON.stringify(criaChecklist))
    }

    console.log('-- suspenso: continua bloqueado em tudo (sem mudança de comportamento) --')
    const loginSuspenso = await chamar('POST', '/login', null, { email: `${PREFIXO}suspenso@teste.local`, senha: 'teste123' })
    const tokenSuspenso = loginSuspenso.body?.token
    const lstExecSuspenso = await chamar('GET', '/execucoes', tokenSuspenso)
    if (lstExecSuspenso.status === 402) ok('GET /execucoes bloqueado (402) pra conta suspensa, como antes')
    else falhou('GET /execucoes bloqueado (402) pra conta suspensa, como antes', JSON.stringify(lstExecSuspenso))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — sessão, renovação e modo somente leitura funcionam.')
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
