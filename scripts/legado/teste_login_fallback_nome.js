// Teste manual da sub-etapa 1.4, ponto 3: fallback de login por NOME pra
// colaboradores que ainda não têm celular cadastrado.
//
// Confirma:
//  - nome que bate com colaboradores de DUAS contas diferentes é recusado
//    (nunca entra na conta errada)
//  - funciona com PIN em hash E com PIN ainda em texto puro (antes da
//    migração rodar nesse colaborador)
//  - limite de tentativas (5/15min) vale no fallback também
//  - o log do servidor registra o uso do fallback (usuario_id + data, sem PIN)
//  - LOGIN_POR_NOME=false desliga o fallback completamente
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_login_fallback_nome.js

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

const PREFIXO = '__teste_fallback__'
const PORTA = 3994
const PORTA_DESLIGADO = 3993

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE email LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
}

function esperarServidor(child) {
  return new Promise((resolve, reject) => {
    let saida = ''
    const timeout = setTimeout(() => reject(new Error('servidor não respondeu a tempo')), 8000)
    child.stdout.on('data', (d) => {
      saida += d.toString()
      if (saida.includes('VALIDA na porta')) { clearTimeout(timeout); resolve() }
    })
    child.stderr.on('data', (d) => { saida += d.toString() })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`servidor encerrou antes de subir (código ${code}). Saída: ${saida}`))
    })
  })
}

function subirServidor(porta, envExtra = {}) {
  const child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(porta), ...envExtra }
  })
  let logs = ''
  child.stdout.on('data', (d) => { logs += d.toString() })
  child.getLogs = () => logs
  return child
}

async function loginPin(porta, celular, pin) {
  const r = await fetch(`http://127.0.0.1:${porta}/api/login-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ celular, pin })
  })
  let json = null
  try { json = await r.json() } catch { /* corpo vazio */ }
  return { status: r.status, body: json }
}

async function main() {
  let child, childDesligado
  try {
    await limpar()
    const hashSenha = await bcrypt.hash('teste123', 10)
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")
    const trialFim = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

    // Conta A
    const donoA = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono A`, `${PREFIXO}donoa@teste.local`, hashSenha])
    const lojaA = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A`, donoA.lastID])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)', [donoA.lastID, planoProf.id, 'trial', trialFim])

    // Conta B
    const donoB = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono B`, `${PREFIXO}donob@teste.local`, hashSenha])
    const lojaB = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja B`, donoB.lastID])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)', [donoB.lastID, planoProf.id, 'trial', trialFim])

    // Nome repetido, SEM celular, em contas diferentes (ambiguidade proposital)
    const nomeRepetido = `${PREFIXO}Carlos Teste`
    await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin) VALUES (?, ?, ?, 'operador', ?, ?)`,
      [nomeRepetido, `${PREFIXO}carlosa@teste.local`, hashSenha, lojaA.lastID, await bcrypt.hash('1111', 10)])
    await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin) VALUES (?, ?, ?, 'operador', ?, ?)`,
      [nomeRepetido, `${PREFIXO}carlosb@teste.local`, hashSenha, lojaB.lastID, await bcrypt.hash('2222', 10)])

    // Sem celular, nome único, PIN ainda em TEXTO PURO (simula antes da migração)
    const nomeTextoPuro = `${PREFIXO}Mariana Teste`
    const marianaIns = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin) VALUES (?, ?, ?, 'operador', ?, ?)`,
      [nomeTextoPuro, `${PREFIXO}mariana@teste.local`, hashSenha, lojaA.lastID, '3333'])

    // Sem celular, nome único, PIN já em HASH
    const nomeHash = `${PREFIXO}Roberto Teste`
    const robertoIns = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin) VALUES (?, ?, ?, 'operador', ?, ?)`,
      [nomeHash, `${PREFIXO}roberto@teste.local`, hashSenha, lojaB.lastID, await bcrypt.hash('4444', 10)])

    child = subirServidor(PORTA)
    await esperarServidor(child)

    console.log('\nTestando o fallback de login por nome...\n')

    console.log('-- nome repetido entre contas: nunca entra na conta errada --')
    const tentaAmbiguo1 = await loginPin(PORTA, nomeRepetido, '1111')
    if (tentaAmbiguo1.status === 401 && /mais de um colaborador/.test(tentaAmbiguo1.body?.erro || '')) {
      ok('nome ambíguo recusado mesmo com o PIN certo de uma das contas (1111 é da conta A)')
    } else {
      falhou('nome ambíguo recusado mesmo com o PIN certo de uma das contas', JSON.stringify(tentaAmbiguo1))
    }
    const tentaAmbiguo2 = await loginPin(PORTA, nomeRepetido, '2222')
    if (tentaAmbiguo2.status === 401 && /mais de um colaborador/.test(tentaAmbiguo2.body?.erro || '')) {
      ok('nome ambíguo recusado também com o PIN certo da outra conta (2222 é da conta B)')
    } else {
      falhou('nome ambíguo recusado também com o PIN certo da outra conta', JSON.stringify(tentaAmbiguo2))
    }

    console.log('-- funciona com PIN em texto puro (antes da migração) --')
    const loginTextoPuro = await loginPin(PORTA, nomeTextoPuro, '3333')
    if (loginTextoPuro.status === 200 && loginTextoPuro.body?.user?.loja_id === lojaA.lastID) {
      ok('login por nome funciona com PIN ainda em texto puro, cai na conta certa (Loja A)')
    } else {
      falhou('login por nome funciona com PIN ainda em texto puro', JSON.stringify(loginTextoPuro))
    }

    console.log('-- funciona com PIN já em hash --')
    const loginComHash = await loginPin(PORTA, nomeHash, '4444')
    if (loginComHash.status === 200 && loginComHash.body?.user?.loja_id === lojaB.lastID) {
      ok('login por nome funciona com PIN em hash, cai na conta certa (Loja B)')
    } else {
      falhou('login por nome funciona com PIN em hash', JSON.stringify(loginComHash))
    }

    console.log('-- log do servidor registra o uso do fallback (sem PIN) --')
    const logs = child.getLogs()
    const linhaEsperada = `usuario_id=${robertoIns.lastID}`
    if (logs.includes('[login-pin] login via fallback de nome') && logs.includes(linhaEsperada)) {
      ok('log do fallback aparece com o usuario_id certo')
    } else {
      falhou('log do fallback aparece com o usuario_id certo', 'não encontrado nos logs do processo')
    }
    if (!logs.includes('4444') && !logs.includes('3333')) {
      ok('o log não expõe o PIN em nenhum lugar')
    } else {
      falhou('o log não expõe o PIN em nenhum lugar', 'PIN apareceu no log!')
    }

    console.log('-- limite de tentativas vale no fallback também --')
    const nomeBloqueio = `${PREFIXO}Patricia Teste`
    const patriciaIns = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin) VALUES (?, ?, ?, 'operador', ?, ?)`,
      [nomeBloqueio, `${PREFIXO}patricia@teste.local`, hashSenha, lojaA.lastID, await bcrypt.hash('5555', 10)])
    let ultimaResp
    for (let i = 0; i < 5; i++) {
      ultimaResp = await loginPin(PORTA, nomeBloqueio, '0000')
    }
    if (ultimaResp.status === 401) ok('5 tentativas erradas por nome ainda respondem 401')
    else falhou('5 tentativas erradas por nome ainda respondem 401', JSON.stringify(ultimaResp))

    const tentativaCertaBloqueada = await loginPin(PORTA, nomeBloqueio, '5555')
    if (tentativaCertaBloqueada.status === 429) ok('6ª tentativa por nome bloqueada (429) mesmo com o PIN certo')
    else falhou('6ª tentativa por nome bloqueada (429) mesmo com o PIN certo', JSON.stringify(tentativaCertaBloqueada))
    void patriciaIns

    child.kill()
    child = null

    console.log('-- LOGIN_POR_NOME=false desliga o fallback completamente --')
    childDesligado = subirServidor(PORTA_DESLIGADO, { LOGIN_POR_NOME: 'false' })
    await esperarServidor(childDesligado)

    const loginComFallbackDesligado = await loginPin(PORTA_DESLIGADO, nomeHash, '4444')
    if (loginComFallbackDesligado.status === 401 && loginComFallbackDesligado.body?.erro === 'Celular não encontrado') {
      ok('com LOGIN_POR_NOME=false, nome que antes funcionava agora é recusado')
    } else {
      falhou('com LOGIN_POR_NOME=false, nome que antes funcionava agora é recusado', JSON.stringify(loginComFallbackDesligado))
    }

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — fallback de login por nome está seguro.')
    else console.log(`❌ ${falhas} teste(s) falharam.`)
  } catch (e) {
    falhas++
    console.error('\n❌ Erro ao rodar o teste:', e.message)
  } finally {
    if (child) child.kill()
    if (childDesligado) childDesligado.kill()
    await limpar()
    await pool.end()
  }
  process.exit(falhas > 0 ? 1 : 0)
}

main()
