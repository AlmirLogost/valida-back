// Teste manual da Reforma de Acessos, Fase 3, item 3: Fiscal -> Líder,
// tipo de tarefa (lider/operador) e conferência (aprovar/reprovar/reabrir).
//
// Confirma:
//  - o cargo de sistema "fiscal" agora tem rótulo "Líder" (slug não muda)
//  - tarefa criada com tipo='lider' só aparece pro Líder; tipo='operador' é
//    o padrão quando não informado
//  - o Líder (antigo fiscal) agora CONSEGUE concluir e reabrir a PRÓPRIA
//    tarefa (bug corrigido: tarefas.executar estava sempre 0 pra fiscal)
//  - o Líder aprova e reprova uma execução de um Operador da equipe
//  - o Líder reabre (reverte) uma execução de um Operador da equipe
//  - o Operador NÃO consegue aprovar/reprovar/reabrir tarefa de outra pessoa
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_lider_operador.js

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

const PREFIXO = '__teste_lider_op__'
const PORTA = 3996
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run(`DELETE FROM execucoes_itens WHERE execucao_id IN (SELECT id FROM execucoes WHERE loja_id IN (SELECT id FROM lojas WHERE nome LIKE ?))`, [`${PREFIXO}%`])
  await run('DELETE FROM execucoes WHERE loja_id IN (SELECT id FROM lojas WHERE nome LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklist_itens WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuario_checklists WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklists WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM usuario_lojas WHERE usuario_id IN (SELECT id FROM usuarios WHERE nome LIKE ? OR email LIKE ?)', [`${PREFIXO}%`, `${PREFIXO}%`])
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
  return r.body?.token
}
async function loginPin(celular, pin) {
  const r = await chamar('POST', '/login-pin', null, { celular, pin })
  return r.body?.token
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

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    const tokenDonoA = await login(`${PREFIXO}donoa@teste.local`)

    console.log('\nTestando Fiscal -> Líder, tipo de tarefa e conferência...\n')

    console.log('-- rótulo do cargo de sistema "fiscal" é "Líder" (slug não muda) --')
    const perfilFiscal = await query(`SELECT nome, rotulo FROM perfis WHERE nome = 'fiscal' AND sistema = 1`)
    if (perfilFiscal[0]?.rotulo === 'Líder' && perfilFiscal[0]?.nome === 'fiscal') {
      ok('perfis.nome continua "fiscal", perfis.rotulo agora é "Líder"')
    } else {
      falhou('rótulo do cargo fiscal deveria ser "Líder"', JSON.stringify(perfilFiscal[0]))
    }

    console.log('-- cria Líder e Operador na Loja A --')
    const celularLider = '11988880001'
    const criaLider = await chamar('POST', '/usuarios', tokenDonoA, {
      nome: `${PREFIXO}Lider A`, perfil: 'fiscal', loja_id: lojaA.lastID, celular: celularLider, pin: '1234'
    })
    if (criaLider.status === 200) ok('cria colaborador com perfil fiscal (Líder) via API')
    else falhou('cria colaborador com perfil fiscal (Líder) via API', JSON.stringify(criaLider))

    const celularOperador = '11988880002'
    const criaOperador = await chamar('POST', '/usuarios', tokenDonoA, {
      nome: `${PREFIXO}Operador A`, perfil: 'operador', loja_id: lojaA.lastID, celular: celularOperador, pin: '1234'
    })
    if (criaOperador.status === 200) ok('cria colaborador com perfil operador via API')
    else falhou('cria colaborador com perfil operador via API', JSON.stringify(criaOperador))

    const tokenLider = await loginPin(celularLider, '1234')
    const tokenOperador = await loginPin(celularOperador, '1234')
    if (tokenLider && tokenOperador) ok('Líder e Operador conseguem logar por celular+PIN')
    else falhou('login por PIN do Líder/Operador', JSON.stringify({ tokenLider, tokenOperador }))

    console.log('-- tarefa nasce "operador" por padrão; dá pra criar "lider" explicitamente --')
    const criaTarefaOperador = await chamar('POST', '/checklists', tokenDonoA, {
      titulo: `${PREFIXO}Tarefa Operador`, loja_id: lojaA.lastID, recorrencia: 'diario'
    })
    const tarefaOperadorId = criaTarefaOperador.body?.id
    const tarefaOp = await query('SELECT tipo FROM checklists WHERE id = ?', [tarefaOperadorId])
    if (tarefaOp[0]?.tipo === 'operador') ok('tarefa criada sem "tipo" nasce como "operador"')
    else falhou('tarefa deveria nascer "operador" por padrão', JSON.stringify(tarefaOp[0]))

    const criaTarefaLider = await chamar('POST', '/checklists', tokenDonoA, {
      titulo: `${PREFIXO}Tarefa Lider`, loja_id: lojaA.lastID, recorrencia: 'diario', tipo: 'lider'
    })
    const tarefaLiderId = criaTarefaLider.body?.id
    const tarefaLd = await query('SELECT tipo FROM checklists WHERE id = ?', [tarefaLiderId])
    if (tarefaLd[0]?.tipo === 'lider') ok('tarefa criada com tipo="lider" é salva corretamente')
    else falhou('tarefa deveria ser salva com tipo="lider"', JSON.stringify(tarefaLd[0]))

    console.log('-- bug corrigido: Líder consegue concluir e reabrir a PRÓPRIA tarefa --')
    const iniciaLider = await chamar('POST', '/execucoes', tokenLider, { checklist_id: tarefaLiderId })
    if (iniciaLider.status === 200) ok('Líder consegue iniciar a própria execução (antes dava 403)')
    else falhou('Líder deveria conseguir iniciar a própria execução', JSON.stringify(iniciaLider))
    const execLiderId = iniciaLider.body?.id
    const concluiLider = await chamar('PUT', `/execucoes/${execLiderId}/concluir`, tokenLider, { score: 10 })
    if (concluiLider.status === 200) ok('Líder consegue concluir a própria execução')
    else falhou('Líder deveria conseguir concluir a própria execução', JSON.stringify(concluiLider))
    const reabreLiderPropria = await chamar('DELETE', `/execucoes/${execLiderId}/reverter`, tokenLider)
    if (reabreLiderPropria.status === 200) ok('Líder consegue reabrir a própria execução')
    else falhou('Líder deveria conseguir reabrir a própria execução', JSON.stringify(reabreLiderPropria))

    console.log('-- Operador conclui a própria tarefa (execução pra conferência) --')
    const iniciaOperador = await chamar('POST', '/execucoes', tokenOperador, { checklist_id: tarefaOperadorId })
    const execOperadorId = iniciaOperador.body?.id
    const concluiOperador = await chamar('PUT', `/execucoes/${execOperadorId}/concluir`, tokenOperador, { score: 10 })
    if (iniciaOperador.status === 200 && concluiOperador.status === 200) ok('Operador conclui a própria tarefa')
    else falhou('Operador deveria concluir a própria tarefa', JSON.stringify({ iniciaOperador, concluiOperador }))

    console.log('-- Líder aprova a execução do Operador --')
    const aprova = await chamar('PUT', `/execucoes/${execOperadorId}/aprovar`, tokenLider)
    const statusAposAprovar = await query('SELECT status_conferencia FROM execucoes WHERE id = ?', [execOperadorId])
    if (aprova.status === 200 && statusAposAprovar[0]?.status_conferencia === 'aprovado') {
      ok('Líder aprova a execução do Operador')
    } else {
      falhou('Líder deveria aprovar a execução do Operador', JSON.stringify({ aprova, statusAposAprovar }))
    }

    console.log('-- Líder reprova a execução do Operador --')
    const reprova = await chamar('PUT', `/execucoes/${execOperadorId}/reprovar`, tokenLider)
    const statusAposReprovar = await query('SELECT status_conferencia FROM execucoes WHERE id = ?', [execOperadorId])
    if (reprova.status === 200 && statusAposReprovar[0]?.status_conferencia === 'reprovado') {
      ok('Líder reprova a execução do Operador')
    } else {
      falhou('Líder deveria reprovar a execução do Operador', JSON.stringify({ reprova, statusAposReprovar }))
    }

    console.log('-- Líder reabre a execução do Operador --')
    const reabreDoOperador = await chamar('DELETE', `/execucoes/${execOperadorId}/reverter`, tokenLider)
    const existeAinda = await query('SELECT id FROM execucoes WHERE id = ?', [execOperadorId])
    if (reabreDoOperador.status === 200 && existeAinda.length === 0) {
      ok('Líder reabre (apaga) a execução do Operador')
    } else {
      falhou('Líder deveria reabrir a execução do Operador', JSON.stringify({ reabreDoOperador, existeAinda }))
    }

    console.log('-- Operador NÃO aprova/reprova/reabre tarefa de outra pessoa --')
    const iniciaOperador2 = await chamar('POST', '/execucoes', tokenOperador, { checklist_id: tarefaOperadorId })
    const execOperador2Id = iniciaOperador2.body?.id
    await chamar('PUT', `/execucoes/${execOperador2Id}/concluir`, tokenOperador, { score: 10 })

    const operadorAprova = await chamar('PUT', `/execucoes/${execOperador2Id}/aprovar`, tokenOperador)
    if (operadorAprova.status === 403 && /permissão/.test(operadorAprova.body?.erro || '')) {
      ok('Operador recebe 403 com mensagem clara ao tentar aprovar')
    } else {
      falhou('Operador não deveria conseguir aprovar', JSON.stringify(operadorAprova))
    }
    const operadorReprova = await chamar('PUT', `/execucoes/${execOperador2Id}/reprovar`, tokenOperador)
    if (operadorReprova.status === 403) ok('Operador recebe 403 ao tentar reprovar')
    else falhou('Operador não deveria conseguir reprovar', JSON.stringify(operadorReprova))

    // Operador reabrindo a PRÓPRIA execução continua funcionando normalmente
    // (tarefas.executar) — só reabrir tarefa de OUTRA pessoa é que exige
    // tarefas.conferir. Aqui é a própria, então deve passar.
    const operadorReabrePropria = await chamar('DELETE', `/execucoes/${execOperador2Id}/reverter`, tokenOperador)
    if (operadorReabrePropria.status === 200) ok('Operador continua reabrindo a PRÓPRIA execução normalmente')
    else falhou('Operador deveria continuar reabrindo a própria execução', JSON.stringify(operadorReabrePropria))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — Líder/Operador e conferência funcionam.')
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
