// Teste manual da Reforma de Acessos, Fase 5, bloco E5: tarefa atribuída a
// um CARGO inteiro (não só a pessoas), com herança — quem entra no cargo
// depois passa a receber a tarefa, quem sai deixa de receber.
//
// Confirma:
//  - POST /checklist-cargos vincula uma tarefa a um cargo
//  - alguém com aquele cargo passa a ver a tarefa em
//    GET /usuarios/:id/checklists com origem='cargo'
//  - a mesma tarefa some de GET /usuarios/:id/checklists-disponiveis (já
//    não faz sentido oferecer pra vincular de novo)
//  - trocar o cargo da pessoa (sair do cargo) faz a tarefa por cargo
//    desaparecer da lista dela
//  - uma pessoa NOVA que entra no cargo (via POST /usuarios) já nasce
//    vendo a tarefa, sem precisar vincular nada manualmente
//  - vínculo direto (usuario_checklists) nunca duplica com o vínculo por
//    cargo quando os dois existem pra mesma pessoa/tarefa — o direto
//    aparece como origem='pessoa'
//  - isolamento entre contas: conta A não vincula cargo numa tarefa da
//    conta B, nem vice-versa
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_tarefas_por_cargo.js

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

const PREFIXO = '__teste_tarefa_cargo__'
const PORTA = 3995
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run(`DELETE FROM execucoes_itens WHERE execucao_id IN (SELECT id FROM execucoes WHERE loja_id IN (SELECT id FROM lojas WHERE nome LIKE ?))`, [`${PREFIXO}%`])
  await run('DELETE FROM execucoes WHERE loja_id IN (SELECT id FROM lojas WHERE nome LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklist_cargos WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklist_itens WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuario_checklists WHERE checklist_id IN (SELECT id FROM checklists WHERE titulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklists WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM perfil_permissoes WHERE perfil_id IN (SELECT id FROM perfis WHERE nome LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE nome LIKE ?', [`${PREFIXO}%`])
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

async function login(email) { return (await chamar('POST', '/login', null, { email, senha: 'teste123' })).body?.token }
async function loginPin(celular, pin) { return (await chamar('POST', '/login-pin', null, { celular, pin })).body?.token }

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

    const donoB = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono B`, `${PREFIXO}donob@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [donoB.lastID, planoProf.id, 'ativo'])
    const lojaB = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja B`, donoB.lastID])

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    const tokenDonoA = await login(`${PREFIXO}donoa@teste.local`)
    const tokenDonoB = await login(`${PREFIXO}donob@teste.local`)

    console.log('\nTestando tarefas atribuídas a um cargo inteiro (Fase 5, bloco E5)...\n')

    console.log('-- cria cargo personalizado "Caixa" (perfil Operador) na conta A --')
    const criaCargo = await chamar('POST', '/perfis', tokenDonoA, {
      rotulo: `${PREFIXO}Caixa`, perfil_acesso: 'operador'
    })
    const cargoNome = criaCargo.body?.nome
    if (criaCargo.status === 200 && cargoNome) ok('cargo "Caixa" criado')
    else { falhou('cargo "Caixa" criado', JSON.stringify(criaCargo)); throw new Error('sem cargo não dá pra continuar') }

    console.log('-- cria colaborador A1 com o cargo "Caixa" --')
    const celularA1 = '11977770001'
    const criaA1 = await chamar('POST', '/usuarios', tokenDonoA, {
      nome: `${PREFIXO}Colab A1`, perfil: cargoNome, loja_id: lojaA.lastID, celular: celularA1, pin: '1234'
    })
    const a1Id = criaA1.body?.id
    if (criaA1.status === 200 && a1Id) ok('colaborador A1 criado com o cargo Caixa')
    else falhou('colaborador A1 criado com o cargo Caixa', JSON.stringify(criaA1))

    console.log('-- cria a tarefa e vincula ao CARGO (não à pessoa) --')
    const criaTarefa = await chamar('POST', '/checklists', tokenDonoA, {
      titulo: `${PREFIXO}Fechar caixa`, loja_id: lojaA.lastID, recorrencia: 'diario'
    })
    const tarefaId = criaTarefa.body?.id
    const vinculaCargo = await chamar('POST', '/checklist-cargos', tokenDonoA, { checklist_id: tarefaId, perfil_nome: cargoNome })
    if (vinculaCargo.status === 200) ok('tarefa vinculada ao cargo Caixa')
    else falhou('tarefa vinculada ao cargo Caixa', JSON.stringify(vinculaCargo))

    console.log('-- A1 (tem o cargo) já vê a tarefa, com origem "cargo" --')
    const checklistsA1 = await chamar('GET', `/usuarios/${a1Id}/checklists`, tokenDonoA)
    const temTarefaCargo = (checklistsA1.body || []).find(c => c.id === tarefaId)
    if (temTarefaCargo?.origem === 'cargo') ok('A1 vê a tarefa do cargo, com origem="cargo"')
    else falhou('A1 deveria ver a tarefa do cargo com origem="cargo"', JSON.stringify(checklistsA1.body))

    console.log('-- a tarefa não aparece mais como "disponível pra vincular" pra A1 --')
    const disponiveisA1 = await chamar('GET', `/usuarios/${a1Id}/checklists-disponiveis`, tokenDonoA)
    const apareceDisponivel = (disponiveisA1.body || []).some(c => c.id === tarefaId)
    if (!apareceDisponivel) ok('tarefa do cargo não aparece mais em "disponíveis" pra A1')
    else falhou('tarefa do cargo não deveria aparecer em "disponíveis"', JSON.stringify(disponiveisA1.body))

    console.log('-- A1 sai do cargo (muda de perfil) — a tarefa por cargo desaparece --')
    const tiraA1DoCargo = await chamar('PUT', `/usuarios/${a1Id}`, tokenDonoA, { nome: `${PREFIXO}Colab A1`, perfil: 'operador', loja_id: lojaA.lastID })
    if (tiraA1DoCargo.status === 200) ok('A1 mudou de cargo (Caixa -> Operador)')
    else falhou('A1 mudou de cargo', JSON.stringify(tiraA1DoCargo))
    const checklistsA1Depois = await chamar('GET', `/usuarios/${a1Id}/checklists`, tokenDonoA)
    const aindaTemTarefa = (checklistsA1Depois.body || []).some(c => c.id === tarefaId)
    if (!aindaTemTarefa) ok('depois de sair do cargo, A1 não vê mais a tarefa do cargo')
    else falhou('A1 não deveria mais ver a tarefa do cargo depois de trocar de cargo', JSON.stringify(checklistsA1Depois.body))

    console.log('-- colaborador NOVO (A2) que entra no cargo Caixa já nasce vendo a tarefa --')
    const celularA2 = '11977770002'
    const criaA2 = await chamar('POST', '/usuarios', tokenDonoA, {
      nome: `${PREFIXO}Colab A2`, perfil: cargoNome, loja_id: lojaA.lastID, celular: celularA2, pin: '1234'
    })
    const a2Id = criaA2.body?.id
    const checklistsA2 = await chamar('GET', `/usuarios/${a2Id}/checklists`, tokenDonoA)
    const a2TemTarefa = (checklistsA2.body || []).find(c => c.id === tarefaId)
    if (a2TemTarefa?.origem === 'cargo') ok('A2 (novo no cargo) já nasce vendo a tarefa do cargo, sem vincular nada')
    else falhou('A2 deveria já ver a tarefa do cargo', JSON.stringify(checklistsA2.body))

    console.log('-- vínculo direto não duplica com o vínculo por cargo (origem="pessoa" ganha) --')
    const vinculaDireto = await chamar('POST', '/usuario-checklists', tokenDonoA, { usuario_id: a2Id, checklist_id: tarefaId })
    if (vinculaDireto.status === 200) ok('vínculo direto de A2 na mesma tarefa criado')
    else falhou('vínculo direto de A2 criado', JSON.stringify(vinculaDireto))
    const checklistsA2Depois = await chamar('GET', `/usuarios/${a2Id}/checklists`, tokenDonoA)
    const ocorrencias = (checklistsA2Depois.body || []).filter(c => c.id === tarefaId)
    if (ocorrencias.length === 1 && ocorrencias[0].origem === 'pessoa') {
      ok('a tarefa aparece só UMA vez pra A2, com origem="pessoa" (vínculo direto prevalece)')
    } else {
      falhou('a tarefa deveria aparecer só uma vez, com origem="pessoa"', JSON.stringify(ocorrencias))
    }

    console.log('-- isolamento entre contas: Dono B não vincula cargo numa tarefa da conta A --')
    const cargoBResp = await chamar('POST', '/perfis', tokenDonoB, { rotulo: `${PREFIXO}CargoB`, perfil_acesso: 'operador' })
    const cargoBNome = cargoBResp.body?.nome
    const vinculaCruzado = await chamar('POST', '/checklist-cargos', tokenDonoB, { checklist_id: tarefaId, perfil_nome: cargoBNome })
    if (vinculaCruzado.status === 404) ok('Dono B recebe 404 ao tentar vincular um cargo a uma tarefa da conta A')
    else falhou('Dono B não deveria conseguir vincular cargo numa tarefa de outra conta', JSON.stringify(vinculaCruzado))

    console.log('-- Dono A não vincula o cargo da conta B à própria tarefa --')
    const vinculaCruzado2 = await chamar('POST', '/checklist-cargos', tokenDonoA, { checklist_id: tarefaId, perfil_nome: cargoBNome })
    if (vinculaCruzado2.status === 404) ok('Dono A recebe 404 ao tentar usar um cargo de outra conta')
    else falhou('Dono A não deveria conseguir usar um cargo de outra conta', JSON.stringify(vinculaCruzado2))

    console.log('-- não dá pra atribuir tarefa ao cargo Proprietário --')
    const vinculaSuperAdmin = await chamar('POST', '/checklist-cargos', tokenDonoA, { checklist_id: tarefaId, perfil_nome: 'super_admin' })
    if (vinculaSuperAdmin.status === 400) ok('vincular ao cargo Proprietário é recusado com mensagem clara')
    else falhou('vincular ao cargo Proprietário deveria ser recusado', JSON.stringify(vinculaSuperAdmin))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — tarefas por cargo funcionam.')
    else console.log(`❌ ${falhas} teste(s) falharam.`)
  } catch (e) {
    falhas++
    console.error('\n❌ Erro ao rodar o teste:', e.message)
  } finally {
    if (child) child.kill()
    await limpar()
    await pool.end()
    process.exit(falhas > 0 ? 1 : 0)
  }
}

main()
