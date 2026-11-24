// Teste da Experiência do Cliente, bloco 3: "Reenviar convite" gera um
// PIN novo pro colaborador e o PIN antigo deixa de funcionar na mesma
// hora (não ficam os dois valendo juntos).
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta
// separada da que você já usa.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_reenviar_convite_gera_pin.js

require('dotenv').config()

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  process.exit(1)
}

const { spawn } = require('child_process')
const path = require('path')
const { query, run, pool } = require('../src/config/database')

const PREFIXO = '__teste_convite__'
const PORTA = 3992
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM usuario_lojas WHERE usuario_id IN (SELECT id FROM usuarios WHERE nome LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE nome LIKE ? OR email LIKE ?', [`${PREFIXO}%`, `${PREFIXO}%`])
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

async function chamar(metodo, caminho, body, token) {
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

    child = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORTA) }
    })
    await esperarServidor(child)

    console.log('\nTestando "Reenviar convite" (gerar PIN novo)...\n')

    const cadastro = await chamar('POST', '/auth/register', {
      nome: 'Dono Teste', empresa: `${PREFIXO}Empresa`, email: `${PREFIXO}dono@teste.local`, senha: 'senha1234'
    })
    const tokenDono = cadastro.body?.token
    if (!tokenDono) { falhou('cadastro pro teste de convite', JSON.stringify(cadastro)); throw new Error('parar') }

    const lojasResp = await chamar('GET', '/lojas', null, tokenDono)
    const lojaId = lojasResp.body?.[0]?.id

    const celular = '11988880002'
    const pessoa = await chamar('POST', '/usuarios', {
      nome: `${PREFIXO}Colaborador`, perfil: 'operador', loja_id: lojaId, celular, pin: '1111'
    }, tokenDono)
    const usuarioId = pessoa.body?.id
    if (pessoa.status !== 200 || !usuarioId) { falhou('criar colaborador com PIN inicial', JSON.stringify(pessoa)); throw new Error('parar') }
    ok('criar colaborador com PIN inicial')

    const loginAntigo = await chamar('POST', '/login-pin', { celular, pin: '1111' })
    if (loginAntigo.status === 200 && loginAntigo.body?.token) ok('PIN inicial funciona pra entrar')
    else falhou('PIN inicial funciona pra entrar', JSON.stringify(loginAntigo))

    const semCelular = await chamar('POST', `/usuarios/${usuarioId}/novo-pin`, {}, tokenDono)
    // (sanity extra, não é o foco do teste — só confirma que o endpoint exige celular cadastrado)
    if (semCelular.status !== 200) falhou('endpoint novo-pin responde pra colaborador com celular', JSON.stringify(semCelular))

    const novoPin = semCelular.body?.pin
    if (semCelular.status === 200 && /^\d{4}$/.test(novoPin || '')) ok('reenviar convite devolve um PIN novo de 4 dígitos')
    else falhou('reenviar convite devolve um PIN novo de 4 dígitos', JSON.stringify(semCelular))

    const loginComPinAntigo = await chamar('POST', '/login-pin', { celular, pin: '1111' })
    if (loginComPinAntigo.status === 401) ok('o PIN antigo deixa de funcionar na hora')
    else falhou('o PIN antigo deixa de funcionar na hora', JSON.stringify(loginComPinAntigo))

    const loginComPinNovo = await chamar('POST', '/login-pin', { celular, pin: novoPin })
    if (loginComPinNovo.status === 200 && loginComPinNovo.body?.token) ok('o PIN novo já funciona pra entrar')
    else falhou('o PIN novo já funciona pra entrar', JSON.stringify(loginComPinNovo))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — reenviar convite gera PIN novo e invalida o anterior.')
    else console.log(`❌ ${falhas} teste(s) falharam.`)
  } catch (e) {
    if (e.message !== 'parar') {
      falhas++
      console.error('\n❌ Erro ao rodar o teste:', e.message)
    }
  } finally {
    if (child) child.kill()
    await limpar()
    await pool.end()
  }
  process.exit(falhas > 0 ? 1 : 0)
}

main()
