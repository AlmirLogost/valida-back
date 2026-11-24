// Teste manual da Reforma de Acessos, Fase 5, bloco B: teto de permissões
// por perfil de acesso e as proteções de segurança que vêm junto.
//
// Confirma:
//  - cargo Operador não recebe tarefas.conferir nem equipe.criar (o back
//    recusa, mesmo que quem está salvando tenha essas permissões)
//  - o Proprietário CONSEGUE abrir uma exceção pontual além do teto
//  - trocar o perfil_acesso de um cargo remove da matriz o que ficar fora
//    do novo teto e informa quantas pessoas são afetadas
//  - ninguém confere a própria execução, mesmo tendo tarefas.conferir
//  - ninguém se torna Proprietário criando ou editando um colaborador
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_teto_perfil_acesso.js

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

const PREFIXO = '__teste_teto_pa__'
const PORTA = 3994
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

    const dono = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono`, `${PREFIXO}dono@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [dono.lastID, planoProf.id, 'ativo'])
    const loja = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja`, dono.lastID])

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    const tokenDono = await login(`${PREFIXO}dono@teste.local`)

    console.log('\nTestando o teto de permissões por perfil de acesso (Fase 5, bloco B)...\n')

    const criaCargoOp = await chamar('POST', '/perfis', tokenDono, { rotulo: `${PREFIXO}Caixa`, perfil_acesso: 'operador' })
    const cargoOpId = criaCargoOp.body?.id

    console.log('-- o Proprietário PODE abrir uma exceção além do teto (ele é a excessão combinada no desenho) --')
    const donoExcecao = await chamar('PUT', `/perfis/${cargoOpId}/permissoes`, tokenDono, {
      permissoes: [{ modulo: 'tarefas', acao: 'conferir', permitido: true }]
    })
    if (donoExcecao.status === 200) ok('o Proprietário consegue dar "tarefas.conferir" a um cargo Operador (exceção pontual)')
    else falhou('o Proprietário deveria conseguir abrir essa exceção', JSON.stringify(donoExcecao))
    // desfaz a exceção pra não interferir no teste de teto abaixo
    await chamar('PUT', `/perfis/${cargoOpId}/permissoes`, tokenDono, {
      permissoes: [{ modulo: 'tarefas', acao: 'conferir', permitido: false }]
    })

    console.log('-- quem NÃO é Proprietário não passa do teto do perfil, mesmo tendo a permissão --')
    const criaCargoChefe = await chamar('POST', '/perfis', tokenDono, { rotulo: `${PREFIXO}Chefe`, perfil_acesso: 'coordenador' })
    const cargoChefeId = criaCargoChefe.body?.id
    await chamar('PUT', `/perfis/${cargoChefeId}/permissoes`, tokenDono, {
      permissoes: [
        { modulo: 'tarefas', acao: 'conferir', permitido: true },
        { modulo: 'tarefas', acao: 'executar', permitido: true },
        { modulo: 'equipe', acao: 'criar', permitido: true },
        { modulo: 'acessos', acao: 'editar', permitido: true },
        { modulo: 'acessos', acao: 'ver', permitido: true }
      ]
    })
    const celularChefe = '11966660009'
    await chamar('POST', '/usuarios', tokenDono, {
      nome: `${PREFIXO}Chefe A`, perfil: criaCargoChefe.body?.nome, loja_id: loja.lastID, celular: celularChefe, pin: '1234'
    })
    const tokenChefe = await loginPin(celularChefe, '1234')

    const tentaConferir = await chamar('PUT', `/perfis/${cargoOpId}/permissoes`, tokenChefe, {
      permissoes: [{ modulo: 'tarefas', acao: 'conferir', permitido: true }]
    })
    if (tentaConferir.status === 403) ok('Chefe (Coordenador, tem tarefas.conferir) não consegue dar "tarefas.conferir" a um cargo Operador — fora do teto')
    else falhou('deveria recusar "tarefas.conferir" pra um cargo Operador quando quem salva não é o Proprietário', JSON.stringify(tentaConferir))

    const tentaEquipeCriar = await chamar('PUT', `/perfis/${cargoOpId}/permissoes`, tokenChefe, {
      permissoes: [{ modulo: 'equipe', acao: 'criar', permitido: true }]
    })
    if (tentaEquipeCriar.status === 403) ok('Chefe não consegue dar "equipe.criar" a um cargo Operador — fora do teto')
    else falhou('deveria recusar "equipe.criar" pra um cargo Operador quando quem salva não é o Proprietário', JSON.stringify(tentaEquipeCriar))

    console.log('-- dentro do teto, o Chefe consegue conceder normalmente --')
    const tentaExecutar = await chamar('PUT', `/perfis/${cargoOpId}/permissoes`, tokenChefe, {
      permissoes: [{ modulo: 'tarefas', acao: 'executar', permitido: true }]
    })
    if (tentaExecutar.status === 200) ok('Chefe consegue dar "tarefas.executar" a um cargo Operador (dentro do teto)')
    else falhou('deveria aceitar "tarefas.executar" pra um cargo Operador', JSON.stringify(tentaExecutar))

    console.log('-- trocar o perfil pra Coordenador remove o que já estava fora do teto antigo, aceita o resto --')
    const criaCargoFlex = await chamar('POST', '/perfis', tokenDono, { rotulo: `${PREFIXO}Flex`, perfil_acesso: 'coordenador' })
    const cargoFlexId = criaCargoFlex.body?.id
    await chamar('PUT', `/perfis/${cargoFlexId}/permissoes`, tokenDono, {
      permissoes: [{ modulo: 'tarefas', acao: 'conferir', permitido: true }, { modulo: 'equipe', acao: 'criar', permitido: true }]
    })
    const celularFlex = '11966660001'
    const pessoaFlex = await chamar('POST', '/usuarios', tokenDono, {
      nome: `${PREFIXO}Pessoa Flex`, perfil: criaCargoFlex.body?.nome, loja_id: loja.lastID, celular: celularFlex, pin: '1234'
    })
    const trocaPerfil = await chamar('PUT', `/perfis/${cargoFlexId}`, tokenDono, { perfil_acesso: 'operador' })
    if (trocaPerfil.status === 200 && trocaPerfil.body?.pessoas_afetadas === 1) {
      ok('trocar o perfil pra Operador funciona e informa 1 pessoa afetada')
    } else {
      falhou('trocar o perfil deveria informar 1 pessoa afetada', JSON.stringify(trocaPerfil))
    }
    const matrizDepois = await chamar('GET', `/perfis/${cargoFlexId}/permissoes`, tokenDono)
    const conferirAindaAtivo = (matrizDepois.body?.permissoes || []).some(p => p.modulo === 'tarefas' && p.acao === 'conferir' && p.permitido)
    if (!conferirAindaAtivo) ok('depois de trocar pra Operador, "tarefas.conferir" foi removido da matriz')
    else falhou('"tarefas.conferir" deveria ter sido removido depois de trocar pra Operador', JSON.stringify(matrizDepois.body))

    console.log('-- ninguém confere a própria execução, mesmo tendo tarefas.conferir --')
    const criaCargoConfere = await chamar('POST', '/perfis', tokenDono, { rotulo: `${PREFIXO}Supervisor`, perfil_acesso: 'coordenador' })
    const cargoConfereNome = criaCargoConfere.body?.nome
    await chamar('PUT', `/perfis/${criaCargoConfere.body?.id}/permissoes`, tokenDono, {
      permissoes: [{ modulo: 'tarefas', acao: 'conferir', permitido: true }, { modulo: 'tarefas', acao: 'executar', permitido: true }]
    })
    const celularSup = '11966660002'
    const criaSup = await chamar('POST', '/usuarios', tokenDono, {
      nome: `${PREFIXO}Supervisor A`, perfil: cargoConfereNome, loja_id: loja.lastID, celular: celularSup, pin: '1234'
    })
    const tokenSup = await loginPin(celularSup, '1234')
    const criaTarefa = await chamar('POST', '/checklists', tokenDono, { titulo: `${PREFIXO}Tarefa`, loja_id: loja.lastID, recorrencia: 'diario' })
    const execPropria = await chamar('POST', '/execucoes', tokenSup, { checklist_id: criaTarefa.body?.id })
    await chamar('PUT', `/execucoes/${execPropria.body?.id}/concluir`, tokenSup, { score: 10 })
    const aprovaPropria = await chamar('PUT', `/execucoes/${execPropria.body?.id}/aprovar`, tokenSup)
    if (aprovaPropria.status === 403) ok('aprovar a própria execução é recusado, mesmo tendo tarefas.conferir')
    else falhou('aprovar a própria execução deveria ser recusado', JSON.stringify(aprovaPropria))
    const reprovaPropria = await chamar('PUT', `/execucoes/${execPropria.body?.id}/reprovar`, tokenSup)
    if (reprovaPropria.status === 403) ok('reprovar a própria execução é recusado, mesmo tendo tarefas.conferir')
    else falhou('reprovar a própria execução deveria ser recusado', JSON.stringify(reprovaPropria))

    console.log('-- ninguém se torna Proprietário criando ou editando um colaborador --')
    const criaComoSuperAdmin = await chamar('POST', '/usuarios', tokenDono, {
      nome: `${PREFIXO}Tentativa`, perfil: 'super_admin', loja_id: loja.lastID, celular: '11966660003', pin: '1234'
    })
    if (criaComoSuperAdmin.status === 403) ok('criar um colaborador já como Proprietário é recusado')
    else falhou('criar um colaborador como Proprietário deveria ser recusado', JSON.stringify(criaComoSuperAdmin))

    const promoveExistente = await chamar('PUT', `/usuarios/${criaSup.body?.id}`, tokenDono, {
      nome: `${PREFIXO}Supervisor A`, perfil: 'super_admin', loja_id: loja.lastID
    })
    if (promoveExistente.status === 403) ok('promover um colaborador existente a Proprietário é recusado')
    else falhou('promover a Proprietário deveria ser recusado', JSON.stringify(promoveExistente))

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — teto de permissões e proteções de segurança funcionam.')
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
