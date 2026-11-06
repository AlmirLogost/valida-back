// Teste manual da sub-etapa 1.3: cadastro do dono cria conta + loja + trial
// de 14 dias numa única transação, valida senha mínima e e-mail duplicado.
//
// SEGURANÇA: só roda contra o banco LOCAL (mesma trava das sub-etapas
// anteriores) e sobe o servidor numa porta separada da que você já usa.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_cadastro_dono.js

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

const PREFIXO = '__teste_cadastro__'
const PORTA = 3996
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

async function registrar(body) {
  const r = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

    const emailBase = `${PREFIXO}dono@teste.local`

    console.log('\nTestando o cadastro do dono...\n')

    // Validações
    const semEmpresa = await registrar({ nome: 'Fulano', email: emailBase, senha: 'senha1234' })
    if (semEmpresa.status === 400) ok('rejeita cadastro sem nome da empresa')
    else falhou('rejeita cadastro sem nome da empresa', `status ${semEmpresa.status}`)

    const senhaCurta = await registrar({ nome: 'Fulano', empresa: 'Empresa Teste', email: emailBase, senha: '1234567' })
    if (senhaCurta.status === 400 && /8/.test(senhaCurta.body?.erro || '')) ok('rejeita senha com menos de 8 caracteres')
    else falhou('rejeita senha com menos de 8 caracteres', JSON.stringify(senhaCurta))

    // Cadastro válido
    const cadastro = await registrar({
      nome: 'Fulano da Silva',
      empresa: `${PREFIXO}Empresa`,
      email: emailBase,
      senha: 'senha1234'
    })
    if (cadastro.status === 200 && cadastro.body?.token) ok('cadastro válido cria conta e devolve token')
    else falhou('cadastro válido cria conta e devolve token', JSON.stringify(cadastro))

    const userId = cadastro.body?.user?.id

    // Confirma no banco: usuário + loja + subscription criados juntos
    const usuarioRow = await query('SELECT * FROM usuarios WHERE id = ?', [userId])
    if (usuarioRow[0]?.razao_social === `${PREFIXO}Empresa` && usuarioRow[0]?.perfil === 'super_admin') {
      ok('usuário criado com razao_social e perfil super_admin')
    } else {
      falhou('usuário criado com razao_social e perfil super_admin', JSON.stringify(usuarioRow[0]))
    }

    const lojaRow = await query('SELECT * FROM lojas WHERE admin_id = ?', [userId])
    if (lojaRow.length === 1 && lojaRow[0].nome === `${PREFIXO}Empresa`) ok('primeira loja criada com o nome da empresa')
    else falhou('primeira loja criada com o nome da empresa', JSON.stringify(lojaRow))

    const subRow = await query('SELECT * FROM subscriptions WHERE admin_id = ?', [userId])
    if (subRow.length === 1 && subRow[0].status === 'trial') {
      const diasRestantes = Math.round((new Date(subRow[0].trial_fim) - new Date()) / (1000 * 60 * 60 * 24))
      if (diasRestantes >= 13 && diasRestantes <= 14) ok('trial de 14 dias criado')
      else falhou('trial de 14 dias criado', `trial_fim em ${diasRestantes} dias`)
    } else {
      falhou('trial de 14 dias criado', JSON.stringify(subRow))
    }

    // E-mail duplicado
    const duplicado = await registrar({
      nome: 'Outra Pessoa',
      empresa: 'Outra Empresa',
      email: emailBase,
      senha: 'outrasenha123'
    })
    if (duplicado.status === 400 && /já está cadastrado/.test(duplicado.body?.erro || '')) {
      ok('e-mail duplicado dá mensagem clara em português')
    } else {
      falhou('e-mail duplicado dá mensagem clara em português', JSON.stringify(duplicado))
    }

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — cadastro do dono funciona de ponta a ponta.')
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
