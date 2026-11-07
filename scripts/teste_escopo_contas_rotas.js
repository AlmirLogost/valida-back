// Teste manual da sub-etapa 1.1b: prova, batendo nas ROTAS reais da API
// (não só nas funções internas), que a conta A não consegue ler nem alterar
// nada da conta B em:
//   - checklist-itens (sub-itens de tarefa)
//   - checklist-datas
//   - templates/aplicar (loja de destino)
//   - perfis (sem loja_id na URL)
//   - usuario-checklists: vincular, mover, desvincular, overrides
//
// SEGURANÇA: só roda contra o banco LOCAL (mesma trava da 1.1) e sobe o
// servidor numa porta separada (não usa a porta do seu back já rodando).
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_escopo_contas_rotas.js
//
// Cria dados de teste prefixados, testa pelas rotas HTTP reais, e remove
// tudo no final (mesmo se algum teste falhar no meio).

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

const PREFIXO = '__teste_rotas__'
const PORTA = 3998
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM execucoes_itens WHERE execucao_id IN (SELECT id FROM execucoes WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?))', [`${PREFIXO}%`])
  await run('DELETE FROM execucoes WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuario_checklists WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklist_datas WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklist_itens WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklists WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM template_itens WHERE template_id IN (SELECT id FROM templates WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM templates WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE rotulo LIKE ?', [`${PREFIXO}%`])
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
      if (saida.includes('VALIDA na porta')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.stderr.on('data', (d) => { saida += d.toString() })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`servidor encerrou antes de subir (código ${code}). Saída: ${saida}`))
    })
  })
}

async function login(email, senha) {
  const r = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha })
  })
  const data = await r.json()
  return data.token
}

async function chamar(metodo, caminho, token, body) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await r.json() } catch { /* corpo vazio */ }
  return { status: r.status, body: json }
}

function esperarStatus(nome, resultado, esperado) {
  if (resultado.status === esperado) ok(nome)
  else falhou(nome, `esperado status ${esperado}, recebido ${resultado.status} (${JSON.stringify(resultado.body)})`)
}

async function main() {
  let child
  try {
    await limpar()

    const hash = await bcrypt.hash('teste123', 10)

    // ---------- Conta A ----------
    const donoA = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono A`, `${PREFIXO}donoa@teste.local`, hash])
    const lojaA = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A`, donoA.lastID])
    const funcA = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, 'operador', ?)`,
      [`${PREFIXO}Func A`, `${PREFIXO}funca@teste.local`, hash, lojaA.lastID])
    const checkA = await run(`INSERT INTO checklists (titulo, loja_id, criado_por, recorrencia) VALUES (?, ?, ?, 'diario')`,
      [`${PREFIXO}Tarefa A`, lojaA.lastID, donoA.lastID])
    const itemA = await run(`INSERT INTO checklist_itens (checklist_id, titulo) VALUES (?, ?)`, [checkA.lastID, `${PREFIXO}Item A`])
    const dataA = await run(`INSERT INTO checklist_datas (checklist_id, data, tipo) VALUES (?, '2026-01-01', 'pontual')`, [checkA.lastID])
    const vinculoA = await run(`INSERT INTO usuario_checklists (usuario_id, checklist_id, ativo) VALUES (?, ?, 1)`, [funcA.lastID, checkA.lastID])

    // ---------- Conta B (empresa totalmente diferente) ----------
    const donoB = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono B`, `${PREFIXO}donob@teste.local`, hash])
    const lojaB = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja B`, donoB.lastID])
    const funcB = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin) VALUES (?, ?, ?, 'operador', ?, '1234')`,
      [`${PREFIXO}Func B`, `${PREFIXO}funcb@teste.local`, hash, lojaB.lastID])
    const checkB = await run(`INSERT INTO checklists (titulo, loja_id, criado_por, recorrencia) VALUES (?, ?, ?, 'diario')`,
      [`${PREFIXO}Tarefa B`, lojaB.lastID, donoB.lastID])
    const itemB = await run(`INSERT INTO checklist_itens (checklist_id, titulo) VALUES (?, ?)`, [checkB.lastID, `${PREFIXO}Item B`])
    const dataB = await run(`INSERT INTO checklist_datas (checklist_id, data, tipo) VALUES (?, '2026-01-01', 'pontual')`, [checkB.lastID])
    const vinculoB = await run(`INSERT INTO usuario_checklists (usuario_id, checklist_id, ativo) VALUES (?, ?, 1)`, [funcB.lastID, checkB.lastID])
    const perfilB = await run(`INSERT INTO perfis (nome, rotulo, loja_id, sistema) VALUES (?, ?, ?, 0)`,
      [`${PREFIXO.toLowerCase()}cargo_b`, `${PREFIXO}Cargo B`, lojaB.lastID])

    // Template é global (não pertence a conta nenhuma)
    const template = await run(`INSERT INTO templates (titulo) VALUES (?)`, [`${PREFIXO}Template`])

    // Desde a 1.6, várias rotas de escrita passaram a exigir requirePlanoAtivo
    // (pra saber se a conta está em modo somente leitura) — sem uma
    // subscription, essas rotas dão 402 "Sem assinatura ativa", mascarando
    // os testes de isolamento entre contas. Dá uma assinatura ativa pra A e B.
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")
    const trialEmDia = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)', [donoA.lastID, planoProf.id, 'trial', trialEmDia])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)', [donoB.lastID, planoProf.id, 'trial', trialEmDia])

    // Execução da Tarefa B, para testar as rotas de execução (1.1c)
    const execB = await run(
      `INSERT INTO execucoes (checklist_id, usuario_id, loja_id, status) VALUES (?, ?, ?, 'em_andamento')`,
      [checkB.lastID, funcB.lastID, lojaB.lastID]
    )

    // ---------- Sobe o servidor numa porta isolada ----------
    child = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORTA) }
    })
    await esperarServidor(child)

    const tokenA = await login(`${PREFIXO}donoa@teste.local`, 'teste123')
    if (!tokenA) throw new Error('login da conta A falhou — não deu pra continuar o teste')

    console.log('\nTestando pelas rotas HTTP reais...\n')

    console.log('-- checklist-itens --')
    esperarStatus('A NÃO lê itens da Tarefa B', await chamar('GET', `/checklists/${checkB.lastID}/itens`, tokenA), 404)
    esperarStatus('A NÃO cria item na Tarefa B', await chamar('POST', `/checklists/${checkB.lastID}/itens`, tokenA, { titulo: 'x' }), 404)
    esperarStatus('A NÃO edita o Item B', await chamar('PUT', `/checklist-itens/${itemB.lastID}`, tokenA, { titulo: 'x' }), 404)
    esperarStatus('A NÃO apaga o Item B', await chamar('DELETE', `/checklist-itens/${itemB.lastID}`, tokenA), 404)
    esperarStatus('A lê os próprios itens (Tarefa A)', await chamar('GET', `/checklists/${checkA.lastID}/itens`, tokenA), 200)

    console.log('-- checklist-datas --')
    const listaDatas = await chamar('GET', `/checklist-datas?checklist_id=${checkB.lastID}`, tokenA)
    if (listaDatas.status === 200 && Array.isArray(listaDatas.body) && listaDatas.body.length === 0) ok('A lista checklist-datas da Tarefa B e vem vazio')
    else falhou('A lista checklist-datas da Tarefa B e vem vazio', `recebido status ${listaDatas.status} body ${JSON.stringify(listaDatas.body)}`)
    esperarStatus('A NÃO cria data na Tarefa B', await chamar('POST', '/checklist-datas', tokenA, { checklist_id: checkB.lastID, data: '2026-02-02', tipo: 'pontual' }), 404)
    esperarStatus('A NÃO apaga a Data B', await chamar('DELETE', `/checklist-datas/${dataB.lastID}`, tokenA), 404)
    esperarStatus('A NÃO apaga datas da Tarefa B em lote', await chamar('DELETE', `/checklist-datas/checklist/${checkB.lastID}`, tokenA), 404)

    console.log('-- templates/aplicar --')
    esperarStatus('A NÃO aplica template na Loja B', await chamar('POST', '/templates/aplicar', tokenA, { template_id: template.lastID, loja_id: lojaB.lastID }), 404)
    esperarStatus('A aplica template na própria loja', await chamar('POST', '/templates/aplicar', tokenA, { template_id: template.lastID, loja_id: lojaA.lastID }), 200)

    console.log('-- perfis --')
    const perfisA = await chamar('GET', '/perfis', tokenA)
    if (perfisA.status === 200 && !perfisA.body.some(p => p.id === perfilB.lastID)) ok('A NÃO vê o cargo customizado da conta B na lista de perfis')
    else falhou('A NÃO vê o cargo customizado da conta B na lista de perfis', `cargo B apareceu! status ${perfisA.status}`)

    console.log('-- perfis: atualizar / deletar (1.1c, item 2) --')
    esperarStatus('A NÃO edita o cargo customizado da conta B', await chamar('PUT', `/perfis/${perfilB.lastID}`, tokenA, { rotulo: 'Hackeado' }), 404)
    esperarStatus('A NÃO apaga o cargo customizado da conta B', await chamar('DELETE', `/perfis/${perfilB.lastID}`, tokenA), 404)

    console.log('-- perfis: criar com loja de outra conta (auditoria pré-1.4) --')
    esperarStatus('A NÃO cria cargo vinculado à Loja B', await chamar('POST', '/perfis', tokenA, { rotulo: `${PREFIXO}Cargo invasor`, loja_id: lojaB.lastID }), 404)
    esperarStatus('A cria cargo vinculado à própria Loja A', await chamar('POST', '/perfis', tokenA, { rotulo: `${PREFIXO}Cargo A`, loja_id: lojaA.lastID }), 200)

    console.log('-- usuario-checklists: listarChecklists / listarDisponiveis (1.1c, item 1) --')
    esperarStatus('A NÃO lê os checklists do Func B', await chamar('GET', `/usuarios/${funcB.lastID}/checklists`, tokenA), 404)
    esperarStatus('A NÃO lê os checklists disponíveis do Func B', await chamar('GET', `/usuarios/${funcB.lastID}/checklists-disponiveis`, tokenA), 404)
    esperarStatus('A lê os checklists do próprio Func A', await chamar('GET', `/usuarios/${funcA.lastID}/checklists`, tokenA), 200)

    console.log('-- usuario-checklists (vincular / mover / desvincular / overrides) --')
    esperarStatus('A NÃO vincula o Func B à Tarefa B', await chamar('POST', '/usuario-checklists', tokenA, { usuario_id: funcB.lastID, checklist_id: checkB.lastID }), 404)
    esperarStatus('A NÃO move tarefa para o Func B', await chamar('POST', '/usuario-checklists/mover', tokenA, { from_usuario_id: funcA.lastID, to_usuario_id: funcB.lastID, checklist_id: checkA.lastID }), 404)
    esperarStatus('A NÃO desvincula o vínculo da conta B', await chamar('DELETE', `/usuario-checklists/${vinculoB.lastID}`, tokenA), 404)
    esperarStatus('A NÃO altera overrides do vínculo da conta B', await chamar('PUT', '/usuario-checklists/overrides', tokenA, { overrides: [{ id: vinculoB.lastID, bonus_override: 999 }] }), 404)
    esperarStatus('A vincula o próprio Func A à própria Tarefa A', await chamar('POST', '/usuario-checklists', tokenA, { usuario_id: funcA.lastID, checklist_id: checkA.lastID }), 200)

    console.log('-- 404 (não 403) nas rotas de loja/tarefa/usuário/execução (1.1c) --')
    esperarStatus('A NÃO vê a Loja B por id', await chamar('GET', `/lojas/${lojaB.lastID}`, tokenA), 404)
    esperarStatus('A NÃO edita a Loja B', await chamar('PUT', `/lojas/${lojaB.lastID}`, tokenA, { nome: 'x' }), 404)
    esperarStatus('A NÃO apaga a Loja B', await chamar('DELETE', `/lojas/${lojaB.lastID}`, tokenA), 404)
    esperarStatus('A NÃO edita a Tarefa B', await chamar('PUT', `/checklists/${checkB.lastID}`, tokenA, { titulo: 'x', recorrencia: 'diario' }), 404)
    esperarStatus('A NÃO apaga a Tarefa B', await chamar('DELETE', `/checklists/${checkB.lastID}`, tokenA), 404)
    esperarStatus('A NÃO pausa/retoma a Tarefa B', await chamar('PATCH', `/checklists/${checkB.lastID}/pausar`, tokenA, {}), 404)
    esperarStatus('A NÃO edita o Func B', await chamar('PUT', `/usuarios/${funcB.lastID}`, tokenA, { nome: 'x', perfil: 'operador' }), 404)
    esperarStatus('A NÃO apaga o Func B', await chamar('DELETE', `/usuarios/${funcB.lastID}`, tokenA), 404)
    esperarStatus('A NÃO lê a execução da conta B', await chamar('GET', `/execucoes/${execB.lastID}`, tokenA), 404)
    esperarStatus('A NÃO conclui a execução da conta B', await chamar('PUT', `/execucoes/${execB.lastID}/concluir`, tokenA, { score: 10 }), 404)
    esperarStatus('A NÃO reverte (apaga) a execução da conta B', await chamar('DELETE', `/execucoes/${execB.lastID}/reverter`, tokenA), 404)

    console.log('-- login-pin/alterar: só o próprio usuário (auditoria pré-1.4) --')
    // Dono A tenta, usando o próprio token, trocar o PIN informando o usuario_id
    // do Func B (de outra conta) — a rota deve ignorar esse usuario_id do body
    // e nunca tocar no PIN do Func B.
    await chamar('PUT', '/login-pin/alterar', tokenA, { usuario_id: funcB.lastID, pin_atual: '1234', pin_novo: '9999' })

    console.log('\n-- confirma que nada da conta B foi alterado --')
    const lojaBAinda = await query('SELECT ativo FROM lojas WHERE id = ?', [lojaB.lastID])
    if (lojaBAinda[0]?.ativo === 1) ok('Loja B continua ativa (não foi apagada)')
    else falhou('Loja B continua ativa (não foi apagada)', JSON.stringify(lojaBAinda[0]))

    const checkBAinda = await query('SELECT ativo FROM checklists WHERE id = ?', [checkB.lastID])
    if (checkBAinda[0]?.ativo === 1) ok('Tarefa B continua ativa (não foi apagada)')
    else falhou('Tarefa B continua ativa (não foi apagada)', JSON.stringify(checkBAinda[0]))

    const execBAinda = await query('SELECT status FROM execucoes WHERE id = ?', [execB.lastID])
    if (execBAinda[0]?.status === 'em_andamento') ok('Execução B continua em andamento (não foi concluída nem revertida/apagada)')
    else falhou('Execução B continua em andamento (não foi concluída nem revertida/apagada)', JSON.stringify(execBAinda[0]))

    const funcBPinAinda = await query('SELECT pin FROM usuarios WHERE id = ?', [funcB.lastID])
    if (funcBPinAinda[0]?.pin === '1234') ok('PIN do Func B continua o mesmo (dono A não conseguiu trocar)')
    else falhou('PIN do Func B continua o mesmo (dono A não conseguiu trocar)', JSON.stringify(funcBPinAinda[0]))

    const perfilBAinda = await query('SELECT ativo, rotulo FROM perfis WHERE id = ?', [perfilB.lastID])
    if (perfilBAinda[0]?.ativo === 1 && perfilBAinda[0]?.rotulo === `${PREFIXO}Cargo B`) ok('Cargo B continua ativo e sem alteração')
    else falhou('Cargo B continua ativo e sem alteração', JSON.stringify(perfilBAinda[0]))

    const itemBAinda = await query('SELECT * FROM checklist_itens WHERE id = ?', [itemB.lastID])
    if (itemBAinda.length) ok('Item B ainda existe (não foi apagado)')
    else falhou('Item B ainda existe (não foi apagado)', 'o item desapareceu!')

    const vinculoBAinda = await query('SELECT ativo, bonus_override FROM usuario_checklists WHERE id = ?', [vinculoB.lastID])
    if (vinculoBAinda[0]?.ativo === 1 && vinculoBAinda[0]?.bonus_override == null) ok('Vínculo B continua ativo e sem override')
    else falhou('Vínculo B continua ativo e sem override', JSON.stringify(vinculoBAinda[0]))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — as rotas protegem corretamente os dados entre contas.')
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
