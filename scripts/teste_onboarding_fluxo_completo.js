// Teste da Experiência do Cliente, bloco 1 (onboarding): confirma que uma
// conta nova passa pelos 4 passos (unidade+horários, tarefa, pessoa,
// primeira execução concluída) e que uma conta já existente nunca vê o
// onboarding (sempre concluído).
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta
// separada da que você já usa.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_onboarding_fluxo_completo.js

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

const PREFIXO = '__teste_onboarding__'
const PORTA = 3995
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  const admins = await query('SELECT id FROM usuarios WHERE email LIKE ?', [`${PREFIXO}%`])
  const adminIds = admins.map(a => a.id)
  if (adminIds.length) {
    await run('DELETE FROM onboarding_progresso WHERE admin_id = ANY(?)', [adminIds])
  }
  const lojas = await query('SELECT id FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
  const lojaIds = lojas.map(l => l.id)
  if (lojaIds.length) {
    await run('DELETE FROM execucoes_itens WHERE execucao_id IN (SELECT id FROM execucoes WHERE loja_id = ANY(?))', [lojaIds])
    await run('DELETE FROM execucoes WHERE loja_id = ANY(?)', [lojaIds])
    await run('DELETE FROM checklist_itens WHERE checklist_id IN (SELECT id FROM checklists WHERE loja_id = ANY(?))', [lojaIds])
    await run('DELETE FROM checklists WHERE loja_id = ANY(?)', [lojaIds])
    await run('DELETE FROM usuario_lojas WHERE loja_id = ANY(?)', [lojaIds])
    await run('DELETE FROM loja_horarios WHERE loja_id = ANY(?)', [lojaIds])
  }
  await run('DELETE FROM usuarios WHERE whatsapp LIKE ? OR nome LIKE ?', [`${PREFIXO}%`, `${PREFIXO}%`])
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM template_itens WHERE template_id IN (SELECT id FROM templates WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM templates WHERE titulo LIKE ?', [`${PREFIXO}%`])
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

    console.log('\nTestando o fluxo completo de onboarding...\n')

    // === Conta nova: onboarding começa do zero ===
    const email = `${PREFIXO}dono@teste.local`
    const cadastro = await chamar('POST', '/auth/register', {
      nome: 'Dona Maria', empresa: `${PREFIXO}Empresa`, email, senha: 'senha1234'
    })
    if (cadastro.status !== 200 || !cadastro.body?.token) {
      falhou('cadastro cria conta nova', JSON.stringify(cadastro)); throw new Error('parar')
    }
    ok('cadastro cria conta nova')
    const tokenDono = cadastro.body.token
    const adminId = cadastro.body.user.id

    const onb0 = await chamar('GET', '/onboarding', null, tokenDono)
    if (!onb0.body?.concluido && !onb0.body.passo_unidade && !onb0.body.passo_tarefa && !onb0.body.passo_pessoa && !onb0.body.passo_execucao) {
      ok('conta nova começa com onboarding zerado (não concluído)')
    } else {
      falhou('conta nova começa com onboarding zerado', JSON.stringify(onb0.body))
    }

    const lojasResp = await chamar('GET', '/lojas', null, tokenDono)
    const lojaId = lojasResp.body?.[0]?.id
    if (!lojaId) { falhou('primeira loja existe', JSON.stringify(lojasResp.body)); throw new Error('parar') }

    // Passo 1: unidade + horários
    const horariosResp = await chamar('PUT', `/lojas/${lojaId}/horarios`, {
      horarios: [{ dia_semana: 1, hora_abertura: '08:00', hora_fechamento: '18:00' }]
    }, tokenDono)
    if (horariosResp.status !== 200) falhou('salvar horários', JSON.stringify(horariosResp))
    const onb1 = await chamar('GET', '/onboarding', null, tokenDono)
    if (onb1.body?.passo_unidade === 1) ok('passo 1 (unidade+horários) marcado automaticamente')
    else falhou('passo 1 (unidade+horários) marcado automaticamente', JSON.stringify(onb1.body))

    // Passo 2: criar uma tarefa (sem depender da biblioteca de modelos)
    const checklist = await chamar('POST', '/checklists', {
      titulo: `${PREFIXO}Abertura`, loja_id: lojaId, recorrencia: 'diario', tipo: 'operador'
    }, tokenDono)
    if (checklist.status !== 200 || !checklist.body?.id) falhou('criar tarefa', JSON.stringify(checklist))
    const checklistId = checklist.body?.id
    const onb2 = await chamar('GET', '/onboarding', null, tokenDono)
    if (onb2.body?.passo_tarefa === 1) ok('passo 2 (primeira tarefa) marcado automaticamente')
    else falhou('passo 2 (primeira tarefa) marcado automaticamente', JSON.stringify(onb2.body))

    // Passo 3: adicionar a primeira pessoa (Operador, login por PIN)
    const celular = '11999990001'
    const pessoa = await chamar('POST', '/usuarios', {
      nome: `${PREFIXO}Colaborador`, perfil: 'operador', loja_id: lojaId, celular, pin: '1234'
    }, tokenDono)
    if (pessoa.status !== 200) falhou('adicionar primeira pessoa', JSON.stringify(pessoa))
    const onb3 = await chamar('GET', '/onboarding', null, tokenDono)
    if (onb3.body?.passo_pessoa === 1) ok('passo 3 (primeira pessoa) marcado automaticamente')
    else falhou('passo 3 (primeira pessoa) marcado automaticamente', JSON.stringify(onb3.body))

    // A pessoa convidada entra pelo celular (PIN) e conclui a tarefa
    const loginColab = await chamar('POST', '/login-pin', { celular, pin: '1234' })
    if (loginColab.status !== 200 || !loginColab.body?.token) {
      falhou('colaborador convidado entra com celular+PIN', JSON.stringify(loginColab)); throw new Error('parar')
    }
    ok('colaborador convidado entra com celular+PIN')
    const tokenColab = loginColab.body.token

    const execucao = await chamar('POST', '/execucoes', { checklist_id: checklistId }, tokenColab)
    if (execucao.status !== 200 || !execucao.body?.id) falhou('iniciar execução', JSON.stringify(execucao))
    const execucaoId = execucao.body?.id
    const conclusao = await chamar('PUT', `/execucoes/${execucaoId}/concluir`, { score: 10 }, tokenColab)
    if (conclusao.status !== 200) falhou('concluir a primeira tarefa', JSON.stringify(conclusao))
    else ok('colaborador conclui a primeira tarefa')

    const onbFinal = await chamar('GET', '/onboarding', null, tokenDono)
    if (onbFinal.body?.passo_execucao === 1 && onbFinal.body?.concluido === 1) {
      ok('onboarding fica concluído depois dos 4 passos')
    } else {
      falhou('onboarding fica concluído depois dos 4 passos', JSON.stringify(onbFinal.body))
    }

    // === Conta já existente (de antes desta reforma): nunca vê onboarding ===
    const emailAntiga = `${PREFIXO}antiga@teste.local`
    const hash = await bcrypt.hash('senha1234', 10)
    const antigaResult = await run(
      'INSERT INTO usuarios (nome, email, senha, perfil, ativo, razao_social) VALUES (?, ?, ?, ?, ?, ?)',
      [`${PREFIXO}Dono Antigo`, emailAntiga, hash, 'super_admin', 1, `${PREFIXO}Empresa Antiga`]
    )
    // Loja própria, sem nunca passar por onboarding_progresso — simula uma
    // conta de antes desta funcionalidade existir, sem a migration 019 ter
    // rodado "ao vivo" com ela presente (aqui ela já rodou, mas a conta
    // nunca ganhou uma linha explícita, igual teria acontecido na prática).
    await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja Antiga`, antigaResult.lastID])

    const loginAntiga = await chamar('POST', '/login', { email: emailAntiga, senha: 'senha1234' })
    if (loginAntiga.status !== 200 || !loginAntiga.body?.token) {
      falhou('login da conta antiga', JSON.stringify(loginAntiga))
    } else {
      const onbAntiga = await chamar('GET', '/onboarding', null, loginAntiga.body.token)
      if (onbAntiga.body?.concluido === 1 || onbAntiga.body?.concluido === true) {
        ok('conta já existente nunca vê o onboarding (começa concluída)')
      } else {
        falhou('conta já existente nunca vê o onboarding', JSON.stringify(onbAntiga.body))
      }
    }

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — onboarding funciona de ponta a ponta.')
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
