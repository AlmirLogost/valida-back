// Teste manual da sub-etapa 1.6, itens 2 e 3: bug do /api/me e troca de senha
// dentro do sistema.
//
// Confirma que:
//  - GET /me funciona (sem o bug req.user.id) e devolve os campos certos
//  - PUT /me com só um campo (ex.: nome) não apaga os outros (update parcial)
//  - PUT /me com senha nova exige senhaAtual
//  - PUT /me recusa senha atual errada
//  - PUT /me recusa senha nova com menos de 8 caracteres
//  - PUT /me com senha atual certa troca a senha de verdade (login com a
//    senha antiga passa a falhar, login com a nova funciona)
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_minha_conta.js

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

const PREFIXO = '__teste_minhaconta__'
const PORTA = 3993
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
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
    const email = `${PREFIXO}dono@teste.local`
    const hash = await bcrypt.hash('senhaAntiga123', 10)
    await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, documento, cidade) VALUES (?, ?, ?, 'super_admin', ?, ?)`,
      [`${PREFIXO}Dono`, email, hash, '12345678900', 'São Paulo']
    )

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    console.log('\nTestando /api/me e troca de senha...\n')

    const login = await chamar('POST', '/login', null, { email, senha: 'senhaAntiga123' })
    if (login.status === 200 && login.body?.token) ok('login inicial funciona')
    else { falhou('login inicial funciona', JSON.stringify(login)); throw new Error('não deu pra continuar sem login') }
    const token = login.body.token

    const meGet = await chamar('GET', '/me', token)
    if (meGet.status === 200 && meGet.body?.email === email && meGet.body?.documento === '12345678900') {
      ok('GET /me funciona e devolve os dados certos (sem o bug req.user.id)')
    } else {
      falhou('GET /me funciona e devolve os dados certos', JSON.stringify(meGet))
    }

    console.log('-- update parcial não apaga outros campos --')
    const soNome = await chamar('PUT', '/me', token, { nome: `${PREFIXO}Dono Renomeado` })
    if (soNome.status === 200) ok('PUT /me só com nome funciona')
    else falhou('PUT /me só com nome funciona', JSON.stringify(soNome))

    const meDepoisDoNome = await chamar('GET', '/me', token)
    if (meDepoisDoNome.body?.nome === `${PREFIXO}Dono Renomeado` && meDepoisDoNome.body?.documento === '12345678900' && meDepoisDoNome.body?.cidade === 'São Paulo') {
      ok('update parcial manteve documento e cidade intactos')
    } else {
      falhou('update parcial manteve documento e cidade intactos', JSON.stringify(meDepoisDoNome))
    }

    console.log('-- troca de senha exige senha atual --')
    const semSenhaAtual = await chamar('PUT', '/me', token, { senha: 'senhaNova12345' })
    if (semSenhaAtual.status === 400 && /senha atual/.test(semSenhaAtual.body?.erro || '')) {
      ok('PUT /me com senha nova sem senhaAtual é recusado com mensagem clara')
    } else {
      falhou('PUT /me com senha nova sem senhaAtual é recusado', JSON.stringify(semSenhaAtual))
    }

    console.log('-- troca de senha recusa senha atual errada --')
    const senhaAtualErrada = await chamar('PUT', '/me', token, { senha: 'senhaNova12345', senhaAtual: 'errada123' })
    if (senhaAtualErrada.status === 400 && /senha atual/i.test(senhaAtualErrada.body?.erro || '')) {
      ok('PUT /me recusa senha atual incorreta')
    } else {
      falhou('PUT /me recusa senha atual incorreta', JSON.stringify(senhaAtualErrada))
    }

    console.log('-- troca de senha recusa senha nova curta --')
    const senhaCurta = await chamar('PUT', '/me', token, { senha: '1234567', senhaAtual: 'senhaAntiga123' })
    if (senhaCurta.status === 400 && /8 caracteres/.test(senhaCurta.body?.erro || '')) {
      ok('PUT /me recusa senha nova com menos de 8 caracteres')
    } else {
      falhou('PUT /me recusa senha nova com menos de 8 caracteres', JSON.stringify(senhaCurta))
    }

    console.log('-- troca de senha de verdade --')
    const trocaOk = await chamar('PUT', '/me', token, { senha: 'senhaNova12345', senhaAtual: 'senhaAntiga123' })
    if (trocaOk.status === 200) ok('PUT /me com senha atual certa troca a senha')
    else falhou('PUT /me com senha atual certa troca a senha', JSON.stringify(trocaOk))

    const loginSenhaAntiga = await chamar('POST', '/login', null, { email, senha: 'senhaAntiga123' })
    if (loginSenhaAntiga.status === 401) ok('login com a senha antiga deixou de funcionar')
    else falhou('login com a senha antiga deixou de funcionar', JSON.stringify(loginSenhaAntiga))

    const loginSenhaNova = await chamar('POST', '/login', null, { email, senha: 'senhaNova12345' })
    if (loginSenhaNova.status === 200 && loginSenhaNova.body?.token) ok('login com a senha nova funciona')
    else falhou('login com a senha nova funciona', JSON.stringify(loginSenhaNova))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — /api/me e troca de senha funcionam.')
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
