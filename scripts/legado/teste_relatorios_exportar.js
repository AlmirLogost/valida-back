// Teste manual da Reforma de Acessos, Fase 3, item 6: nova ação
// "relatorios.exportar" na matriz de permissões (controla o botão
// "Exportar CSV" da tela de Relatórios no front).
//
// Confirma:
//  - Dono e Gerente têm relatorios.exportar = true no login
//  - Líder (fiscal) também tem relatorios.exportar = true (perm_relatorios=1)
//  - Operador NÃO tem relatorios.ver nem relatorios.exportar (não acessa a tela)
//  - um cargo personalizado sem permissão explícita nasce SEM relatorios.exportar
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_relatorios_exportar.js

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

const PREFIXO = '__teste_relat_export__'
const PORTA = 3995
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM usuario_lojas WHERE usuario_id IN (SELECT id FROM usuarios WHERE nome LIKE ? OR email LIKE ?)', [`${PREFIXO}%`, `${PREFIXO}%`])
  await run('DELETE FROM perfil_permissoes WHERE perfil_id IN (SELECT id FROM perfis WHERE rotulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE rotulo LIKE ?', [`${PREFIXO}%`])
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

async function login(email) {
  const r = await chamar('POST', '/login', null, { email, senha: 'teste123' })
  return r.body
}
async function loginPin(celular, pin) {
  const r = await chamar('POST', '/login-pin', null, { celular, pin })
  return r.body
}

async function main() {
  let child
  try {
    await limpar()
    const hash = await bcrypt.hash('teste123', 10)
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")

    const donoA = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono A`, `${PREFIXO}donoa@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [donoA.lastID, planoProf.id, 'ativo'])
    const lojaA = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A`, donoA.lastID])

    const gerenteA = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, 'gerente', ?)`,
      [`${PREFIXO}Gerente A`, `${PREFIXO}gerentea@teste.local`, hash, lojaA.lastID])
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [gerenteA.lastID, lojaA.lastID])

    const cargoCustom = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'email_senha', 0, 60)`,
      [`${PREFIXO.toLowerCase()}custom`, `${PREFIXO}Custom`, donoA.lastID]
    )
    await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)',
      [cargoCustom.lastID, 'relatorios', 'ver'])
    const usuarioCustom = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`,
      [`${PREFIXO}Custom`, `${PREFIXO}custom@teste.local`, hash, `${PREFIXO.toLowerCase()}custom`, lojaA.lastID]
    )
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [usuarioCustom.lastID, lojaA.lastID])

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    console.log('\nTestando a permissão "relatorios.exportar"...\n')

    const celularLider = '11988880011'
    await chamar('POST', '/usuarios', (await login(`${PREFIXO}donoa@teste.local`)).token, {
      nome: `${PREFIXO}Lider A`, perfil: 'fiscal', loja_id: lojaA.lastID, celular: celularLider, pin: '1234'
    })
    const celularOperador = '11988880012'
    await chamar('POST', '/usuarios', (await login(`${PREFIXO}donoa@teste.local`)).token, {
      nome: `${PREFIXO}Operador A`, perfil: 'operador', loja_id: lojaA.lastID, celular: celularOperador, pin: '1234'
    })

    const dono = await login(`${PREFIXO}donoa@teste.local`)
    if (dono.user?.matriz?.relatorios?.exportar === true) ok('Dono tem relatorios.exportar = true')
    else falhou('Dono deveria ter relatorios.exportar = true', JSON.stringify(dono.user?.matriz?.relatorios))

    const gerente = await login(`${PREFIXO}gerentea@teste.local`)
    if (gerente.user?.matriz?.relatorios?.exportar === true) ok('Gerente tem relatorios.exportar = true')
    else falhou('Gerente deveria ter relatorios.exportar = true', JSON.stringify(gerente.user?.matriz?.relatorios))

    const lider = await loginPin(celularLider, '1234')
    if (lider.user?.matriz?.relatorios?.exportar === true) ok('Líder tem relatorios.exportar = true')
    else falhou('Líder deveria ter relatorios.exportar = true', JSON.stringify(lider.user?.matriz?.relatorios))

    const operador = await loginPin(celularOperador, '1234')
    if (!operador.user?.matriz?.relatorios?.ver && !operador.user?.matriz?.relatorios?.exportar) {
      ok('Operador não tem relatorios.ver nem relatorios.exportar')
    } else {
      falhou('Operador não deveria ter acesso a relatórios', JSON.stringify(operador.user?.matriz?.relatorios))
    }

    const custom = await login(`${PREFIXO}custom@teste.local`)
    if (custom.user?.matriz?.relatorios?.ver === true && !custom.user?.matriz?.relatorios?.exportar) {
      ok('cargo personalizado com só "ver" não ganha "exportar" por padrão')
    } else {
      falhou('cargo personalizado não deveria ganhar "exportar" sem permissão explícita', JSON.stringify(custom.user?.matriz?.relatorios))
    }

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — relatorios.exportar funciona.')
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
