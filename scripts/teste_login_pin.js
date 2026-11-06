// Teste manual da sub-etapa 1.4: login do funcionário por celular + PIN.
//
// Confirma:
//  - PIN fica salvo com hash no banco (nunca em texto puro) ao criar via API
//  - login com celular+PIN corretos funciona
//  - celular errado e PIN errado dão mensagens diferentes e claras
//  - limite de tentativas: 5 erros bloqueiam a 6ª tentativa (mesmo com PIN certo)
//  - o PIN só vale dentro da própria conta: dois colaboradores de empresas
//    diferentes podem ter o MESMO PIN (com celulares diferentes) sem conflito,
//    e cada um só consegue entrar na própria conta
//  - alterarPin troca o hash corretamente
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_login_pin.js

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

const PREFIXO = '__teste_pin__'
const PORTA = 3995
const BASE = `http://127.0.0.1:${PORTA}/api`

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

async function loginAdmin(email, senha) {
  const r = await chamar('POST', '/login', null, { email, senha })
  return r.body?.token
}

async function loginPin(celular, pin) {
  return chamar('POST', '/login-pin', null, { celular, pin })
}

async function main() {
  let child
  try {
    await limpar()
    const hashSenha = await bcrypt.hash('teste123', 10)

    // ---------- Conta A: dono + loja + funcionário (celular X, pin 1234) ----------
    const donoA = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono A`, `${PREFIXO}donoa@teste.local`, hashSenha])
    const lojaA = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A`, donoA.lastID])

    // ---------- Conta B: dono + loja + funcionário (celular Y, MESMO pin 1234) ----------
    const donoB = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono B`, `${PREFIXO}donob@teste.local`, hashSenha])
    const lojaB = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja B`, donoB.lastID])

    // POST /usuarios exige assinatura ativa (requirePlanoAtivo) — cria um
    // trial válido pros dois donos de teste, senão a criação de colaborador
    // dá 402 "Sem assinatura ativa".
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")
    const trialFim = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)', [donoA.lastID, planoProf.id, 'trial', trialFim])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)', [donoB.lastID, planoProf.id, 'trial', trialFim])

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    const tokenDonoA = await loginAdmin(`${PREFIXO}donoa@teste.local`, 'teste123')
    const tokenDonoB = await loginAdmin(`${PREFIXO}donob@teste.local`, 'teste123')
    if (!tokenDonoA || !tokenDonoB) throw new Error('login dos donos de teste falhou — não deu pra continuar')

    console.log('\nTestando login do funcionário por celular + PIN...\n')

    console.log('-- criação via API e hash no banco --')
    const celularX = '11999990001'
    const criaFuncA = await chamar('POST', '/usuarios', tokenDonoA, {
      nome: `${PREFIXO}Func A`, perfil: 'operador', loja_id: lojaA.lastID, celular: celularX, pin: '1234'
    })
    if (criaFuncA.status === 200) ok('cria colaborador A (celular X, pin 1234) via API')
    else falhou('cria colaborador A (celular X, pin 1234) via API', JSON.stringify(criaFuncA))
    const funcAId = criaFuncA.body?.id

    const pinSalvoA = await query('SELECT pin, whatsapp FROM usuarios WHERE id = ?', [funcAId])
    if (pinSalvoA[0]?.pin && pinSalvoA[0].pin.startsWith('$2')) ok('PIN do colaborador A está salvo como hash (não em texto puro)')
    else falhou('PIN do colaborador A está salvo como hash (não em texto puro)', JSON.stringify(pinSalvoA[0]))
    if (pinSalvoA[0]?.whatsapp === celularX) ok('celular do colaborador A salvo corretamente (normalizado)')
    else falhou('celular do colaborador A salvo corretamente (normalizado)', JSON.stringify(pinSalvoA[0]))

    // Colaborador B: celular diferente, MESMO pin 1234, conta diferente
    const celularY = '21988880002'
    const criaFuncB = await chamar('POST', '/usuarios', tokenDonoB, {
      nome: `${PREFIXO}Func B`, perfil: 'operador', loja_id: lojaB.lastID, celular: celularY, pin: '1234'
    })
    if (criaFuncB.status === 200) ok('cria colaborador B (celular Y, MESMO pin 1234, outra conta) via API')
    else falhou('cria colaborador B (celular Y, MESMO pin 1234, outra conta) via API', JSON.stringify(criaFuncB))

    console.log('-- login por celular + PIN --')
    const loginA = await loginPin(celularX, '1234')
    if (loginA.status === 200 && loginA.body?.user?.loja_id === lojaA.lastID) ok('Func A loga com celular X + pin 1234 e cai na Loja A')
    else falhou('Func A loga com celular X + pin 1234 e cai na Loja A', JSON.stringify(loginA))

    const loginB = await loginPin(celularY, '1234')
    if (loginB.status === 200 && loginB.body?.user?.loja_id === lojaB.lastID) ok('Func B loga com celular Y + MESMO pin 1234 e cai na Loja B (sem conflito com A)')
    else falhou('Func B loga com celular Y + MESMO pin 1234 e cai na Loja B (sem conflito com A)', JSON.stringify(loginB))

    const loginCelularErrado = await loginPin('00000000000', '1234')
    if (loginCelularErrado.status === 401 && /elular/.test(loginCelularErrado.body?.erro || '')) ok('celular desconhecido dá mensagem clara ("celular não encontrado")')
    else falhou('celular desconhecido dá mensagem clara', JSON.stringify(loginCelularErrado))

    const loginPinErrado = await loginPin(celularX, '0000')
    if (loginPinErrado.status === 401 && /incorreto/.test(loginPinErrado.body?.erro || '')) ok('PIN errado dá mensagem clara ("PIN incorreto")')
    else falhou('PIN errado dá mensagem clara', JSON.stringify(loginPinErrado))

    console.log('-- o PIN de uma conta não entra na outra --')
    const loginCruzado = await loginPin(celularX, '9999') // celular do Func A, pin bateria com Func B se não fosse escopado por celular
    if (loginCruzado.status === 401) ok('celular do Func A + pin aleatório não loga em lugar nenhum')
    else falhou('celular do Func A + pin aleatório não loga em lugar nenhum', JSON.stringify(loginCruzado))

    console.log('-- limite de tentativas (5 erros = bloqueio) --')
    const celularBloqueio = '11977776666'
    await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, whatsapp, pin) VALUES (?, ?, ?, 'operador', ?, ?, ?)`,
      [`${PREFIXO}Func Bloqueio`, `${PREFIXO}funcbloqueio@teste.local`, hashSenha, lojaA.lastID, celularBloqueio, await bcrypt.hash('5555', 10)])

    let ultimaResposta
    for (let i = 0; i < 5; i++) {
      ultimaResposta = await loginPin(celularBloqueio, '0000') // sempre errado, de propósito
    }
    if (ultimaResposta.status === 401) ok('5 tentativas erradas ainda respondem 401 (PIN incorreto)')
    else falhou('5 tentativas erradas ainda respondem 401 (PIN incorreto)', JSON.stringify(ultimaResposta))

    const tentativaComPinCerto = await loginPin(celularBloqueio, '5555') // PIN CERTO, mas já passou do limite
    if (tentativaComPinCerto.status === 429) ok('6ª tentativa bloqueada (429) mesmo com o PIN certo')
    else falhou('6ª tentativa bloqueada (429) mesmo com o PIN certo', JSON.stringify(tentativaComPinCerto))

    console.log('-- alterarPin (self-service) --')
    const tokenFuncA = loginA.body?.token
    const alterou = await chamar('PUT', '/login-pin/alterar', tokenFuncA, { pin_atual: '1234', pin_novo: '4321' })
    if (alterou.status === 200) ok('Func A troca o próprio PIN')
    else falhou('Func A troca o próprio PIN', JSON.stringify(alterou))

    const loginComPinAntigo = await loginPin(celularX, '1234')
    if (loginComPinAntigo.status === 401) ok('PIN antigo do Func A não funciona mais depois da troca')
    else falhou('PIN antigo do Func A não funciona mais depois da troca', JSON.stringify(loginComPinAntigo))

    const loginComPinNovo = await loginPin(celularX, '4321')
    if (loginComPinNovo.status === 200) ok('PIN novo do Func A funciona depois da troca')
    else falhou('PIN novo do Func A funciona depois da troca', JSON.stringify(loginComPinNovo))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — login por PIN funciona e está seguro.')
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
