// Teste manual da Reforma de Acessos, Passo 4: API de perfis e unidades.
//
// Confirma:
//  - duplicar um cargo (de sistema ou personalizado) cria um cargo novo,
//    personalizado, com a mesma matriz
//  - editar a matriz de um cargo personalizado funciona; de um cargo de
//    sistema é recusado (precisa duplicar)
//  - arquivar um cargo em uso é recusado sem substituto, e funciona (com
//    reatribuição) quando um substituto é indicado
//  - resumo de impacto de uma unidade (tarefas e pessoas) antes de arquivar
//  - arquivar e restaurar uma unidade
//  - arquivar e restaurar uma pessoa
//  - criar colaborador com várias unidades (loja_ids) funciona
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta isolada.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_acessos_unidades.js

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

const PREFIXO = '__teste_acessosunidades__'
const PORTA = 3996
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  await run('DELETE FROM usuario_lojas WHERE usuario_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM perfil_permissoes WHERE perfil_id IN (SELECT id FROM perfis WHERE rotulo LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM checklists WHERE titulo LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM perfis WHERE rotulo LIKE ?', [`${PREFIXO}%`])
  // subscriptions referencia usuarios (admin_id) — precisa ser apagado
  // ANTES dos usuarios, senão a FK recusa o delete dos donos de teste.
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE perfil LIKE ? OR email LIKE ?', [`${PREFIXO.toLowerCase()}%`, `${PREFIXO}%`])
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

async function main() {
  let child
  // Cargos criados por "duplicar" não têm um rótulo com o PREFIXO (o nome
  // vem do cargo original + " (cópia)") — guardamos o(s) ID(s) aqui pra
  // apagar explicitamente no final, sem depender de LIKE no rótulo.
  const idsCargosExtras = []
  try {
    await limpar()
    const hash = await bcrypt.hash('teste123', 10)
    const [planoProf] = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")

    const dono = await run(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, 'super_admin')`,
      [`${PREFIXO}Dono`, `${PREFIXO}dono@teste.local`, hash])
    await run('INSERT INTO subscriptions (admin_id, plano_id, status) VALUES (?, ?, ?)', [dono.lastID, planoProf.id, 'ativo'])

    const lojaA = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja A`, dono.lastID])
    const lojaB = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja B`, dono.lastID])
    const lojaVazia = await run('INSERT INTO lojas (nome, admin_id) VALUES (?, ?)', [`${PREFIXO}Loja Vazia`, dono.lastID])
    await run(`INSERT INTO checklists (titulo, loja_id, criado_por, recorrencia) VALUES (?, ?, ?, 'diario')`,
      [`${PREFIXO}Tarefa A`, lojaA.lastID, dono.lastID])
    const funcA = await run(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, 'operador', ?)`,
      [`${PREFIXO}Func A`, `${PREFIXO}funca@teste.local`, hash, lojaA.lastID])
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [funcA.lastID, lojaA.lastID])

    // cargo personalizado usado por alguém, pra testar "arquivar em uso"
    const cargoEmUso = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'pin', 0, 60)`,
      [`${PREFIXO.toLowerCase()}em_uso`, `${PREFIXO}Em Uso`, dono.lastID]
    )
    await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)', [cargoEmUso.lastID, 'tarefas', 'ver'])
    const cargoSubstituto = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'pin', 0, 61)`,
      [`${PREFIXO.toLowerCase()}substituto`, `${PREFIXO}Substituto`, dono.lastID]
    )
    const pessoaComCargoEmUso = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`,
      [`${PREFIXO}Pessoa Cargo`, `${PREFIXO}pessoacargo@teste.local`, hash, `${PREFIXO.toLowerCase()}em_uso`, lojaA.lastID]
    )

    child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTA) } })
    await esperarServidor(child)

    console.log('\nTestando API de Acessos e Unidades (Passo 4)...\n')

    const tokenDono = await login(`${PREFIXO}dono@teste.local`)

    console.log('-- duplicar um cargo de sistema --')
    const perfis = await chamar('GET', '/perfis', tokenDono)
    const operadorSistema = perfis.body.find(p => p.nome === 'operador' && p.sistema === 1)
    const duplicado = await chamar('POST', `/perfis/${operadorSistema.id}/duplicar`, tokenDono)
    if (duplicado.body?.id) idsCargosExtras.push(duplicado.body.id)
    if (duplicado.status === 200 && duplicado.body?.id) {
      ok('duplicar o cargo "Operador" (sistema) cria um cargo novo e personalizado')
    } else {
      falhou('duplicar cargo de sistema', JSON.stringify(duplicado))
    }
    const matrizDuplicado = await query('SELECT COUNT(*) AS total FROM perfil_permissoes WHERE perfil_id = ?', [duplicado.body?.id])
    if (Number(matrizDuplicado[0]?.total) > 0) ok('o cargo duplicado já nasce com a matriz de permissões copiada')
    else falhou('matriz copiada ao duplicar', JSON.stringify(matrizDuplicado))

    console.log('-- editar matriz: funciona em personalizado, recusado em sistema --')
    const editaMatrizPersonalizado = await chamar('PUT', `/perfis/${duplicado.body.id}/permissoes`, tokenDono, {
      permissoes: [{ modulo: 'unidades', acao: 'editar', permitido: true }]
    })
    if (editaMatrizPersonalizado.status === 200) ok('editar a matriz de um cargo personalizado funciona')
    else falhou('editar matriz de cargo personalizado', JSON.stringify(editaMatrizPersonalizado))

    const editaMatrizSistema = await chamar('PUT', `/perfis/${operadorSistema.id}/permissoes`, tokenDono, {
      permissoes: [{ modulo: 'unidades', acao: 'editar', permitido: true }]
    })
    if (editaMatrizSistema.status === 403) ok('editar a matriz de um cargo de sistema é recusado (precisa duplicar)')
    else falhou('editar matriz de cargo de sistema recusado', JSON.stringify(editaMatrizSistema))

    console.log('-- GET da matriz devolve o que foi salvo --')
    const matrizLida = await chamar('GET', `/perfis/${duplicado.body.id}/permissoes`, tokenDono)
    const linhaUnidadesEditar = matrizLida.body?.permissoes?.find(p => p.modulo === 'unidades' && p.acao === 'editar')
    if (matrizLida.status === 200 && linhaUnidadesEditar?.permitido === true) {
      ok('GET /perfis/:id/permissoes devolve a permissão recém-salva')
    } else {
      falhou('GET da matriz devolve o salvo', JSON.stringify(matrizLida))
    }

    console.log('-- login de alguém com o cargo personalizado traz a matriz certa (é isso que o menu do front usa) --')
    const pessoaCargoPersonalizado = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`,
      [`${PREFIXO}Pessoa Matriz`, `${PREFIXO}pessoamatriz@teste.local`, hash, duplicado.body.nome, lojaA.lastID]
    )
    const loginPersonalizado = await chamar('POST', '/login', null, { email: `${PREFIXO}pessoamatriz@teste.local`, senha: 'teste123' })
    const matrizDoLogin = loginPersonalizado.body?.user?.matriz
    if (loginPersonalizado.status === 200 && matrizDoLogin?.unidades?.editar === true) {
      ok('o login dessa pessoa já traz "unidades.editar: true" na matriz')
    } else {
      falhou('login traz a matriz certa', JSON.stringify(loginPersonalizado.body?.user?.matriz))
    }
    if (matrizDoLogin?.acessos?.ver === false || matrizDoLogin?.acessos?.ver === undefined) {
      ok('a mesma pessoa NÃO tem acesso a "acessos" (não foi dado explicitamente)')
    } else {
      falhou('pessoa não deveria ter acesso a "acessos"', JSON.stringify(matrizDoLogin?.acessos))
    }
    await run('DELETE FROM usuarios WHERE id = ?', [pessoaCargoPersonalizado.lastID])

    console.log('-- arquivar cargo em uso: recusado sem substituto, funciona com substituto --')
    const perfisDeNovo = await chamar('GET', '/perfis', tokenDono)
    const cargoEmUsoApi = perfisDeNovo.body.find(p => p.rotulo === `${PREFIXO}Em Uso`)
    const cargoSubstitutoApi = perfisDeNovo.body.find(p => p.rotulo === `${PREFIXO}Substituto`)
    const semSubstituto = await chamar('DELETE', `/perfis/${cargoEmUsoApi.id}`, tokenDono)
    if (semSubstituto.status === 400 && semSubstituto.body?.usuarios_afetados === 1) {
      ok('arquivar cargo em uso sem indicar substituto é recusado, avisando quantas pessoas são afetadas')
    } else {
      falhou('arquivar cargo em uso sem substituto recusado', JSON.stringify(semSubstituto))
    }
    const comSubstituto = await chamar('DELETE', `/perfis/${cargoEmUsoApi.id}`, tokenDono, { substituto_id: cargoSubstitutoApi.id })
    if (comSubstituto.status === 200) ok('arquivar cargo em uso COM substituto funciona')
    else falhou('arquivar cargo em uso com substituto', JSON.stringify(comSubstituto))
    const pessoaRealocada = await query('SELECT perfil FROM usuarios WHERE id = ?', [pessoaComCargoEmUso.lastID])
    if (pessoaRealocada[0]?.perfil === cargoSubstitutoApi.nome) {
      ok('a pessoa que usava o cargo arquivado foi reatribuída para o substituto')
    } else {
      falhou('pessoa reatribuída para o substituto', JSON.stringify(pessoaRealocada))
    }

    console.log('-- arquivar e restaurar um cargo (Fase 4, bloco J) --')
    const listaArquivados = await chamar('GET', '/perfis?arquivados=1', tokenDono)
    if ((listaArquivados.body || []).some(c => c.id === cargoEmUso.lastID)) {
      ok('o cargo arquivado aparece em GET /perfis?arquivados=1')
    } else {
      falhou('cargo arquivado deveria aparecer na lista de arquivados', JSON.stringify(listaArquivados.body))
    }
    const restauraCargo = await chamar('PUT', `/perfis/${cargoEmUso.lastID}/restaurar`, tokenDono)
    const listaAposRestaurar = await chamar('GET', '/perfis', tokenDono)
    if (restauraCargo.status === 200 && (listaAposRestaurar.body || []).some(c => c.id === cargoEmUso.lastID)) {
      ok('restaurar o cargo funciona — volta a aparecer na lista normal')
    } else {
      falhou('restaurar cargo', JSON.stringify({ restauraCargo, listaAposRestaurar: listaAposRestaurar.body }))
    }

    console.log('-- resumo de impacto de uma unidade --')
    const impacto = await chamar('GET', `/lojas/${lojaA.lastID}/impacto-arquivamento`, tokenDono)
    if (impacto.status === 200 && impacto.body?.tarefas === 1 && impacto.body?.pessoas >= 1) {
      ok(`resumo de impacto da Loja A: ${impacto.body.tarefas} tarefa(s), ${impacto.body.pessoas} pessoa(s)`)
    } else {
      falhou('resumo de impacto', JSON.stringify(impacto))
    }
    const impactoVazia = await chamar('GET', `/lojas/${lojaVazia.lastID}/impacto-arquivamento`, tokenDono)
    if (impactoVazia.status === 200 && impactoVazia.body?.tarefas === 0 && impactoVazia.body?.pessoas === 0) {
      ok('resumo de impacto de uma unidade vazia dá 0 e 0')
    } else {
      falhou('resumo de impacto vazio', JSON.stringify(impactoVazia))
    }

    console.log('-- arquivar e restaurar uma unidade --')
    const arquivaLoja = await chamar('DELETE', `/lojas/${lojaVazia.lastID}`, tokenDono)
    if (arquivaLoja.status === 200) ok('arquivar a Loja Vazia funciona')
    else falhou('arquivar loja', JSON.stringify(arquivaLoja))
    const listaArquivadas = await chamar('GET', '/lojas?arquivadas=1', tokenDono)
    if (listaArquivadas.status === 200 && listaArquivadas.body.some(l => l.id === lojaVazia.lastID)) {
      ok('a loja arquivada aparece na lista de arquivadas')
    } else {
      falhou('loja arquivada aparece na lista', JSON.stringify(listaArquivadas))
    }
    const restauraLoja = await chamar('PUT', `/lojas/${lojaVazia.lastID}/restaurar`, tokenDono)
    if (restauraLoja.status === 200) ok('restaurar a Loja Vazia funciona')
    else falhou('restaurar loja', JSON.stringify(restauraLoja))
    const listaNormal = await chamar('GET', '/lojas', tokenDono)
    if (listaNormal.body.some(l => l.id === lojaVazia.lastID)) {
      ok('depois de restaurada, a Loja Vazia volta a aparecer na lista normal')
    } else {
      falhou('loja volta à lista normal após restaurar', JSON.stringify(listaNormal))
    }

    console.log('-- arquivar e restaurar uma pessoa --')
    const arquivaPessoa = await chamar('DELETE', `/usuarios/${funcA.lastID}`, tokenDono)
    if (arquivaPessoa.status === 200) ok('arquivar o Func A funciona')
    else falhou('arquivar pessoa', JSON.stringify(arquivaPessoa))
    const listaPessoasArquivadas = await chamar('GET', '/usuarios?arquivados=1', tokenDono)
    if (listaPessoasArquivadas.body.some(u => u.id === funcA.lastID)) {
      ok('a pessoa arquivada aparece na lista de arquivados')
    } else {
      falhou('pessoa arquivada aparece na lista', JSON.stringify(listaPessoasArquivadas))
    }
    const restauraPessoa = await chamar('PUT', `/usuarios/${funcA.lastID}/restaurar`, tokenDono)
    if (restauraPessoa.status === 200) ok('restaurar o Func A funciona')
    else falhou('restaurar pessoa', JSON.stringify(restauraPessoa))

    console.log('-- criar colaborador com várias unidades (loja_ids) --')
    const novoGerente = await chamar('POST', '/usuarios', tokenDono, {
      nome: `${PREFIXO}Gerente Multi`, email: `${PREFIXO}gerentemulti@teste.local`, senha: 'teste123',
      perfil: 'gerente', loja_id: lojaA.lastID, loja_ids: [lojaA.lastID, lojaB.lastID]
    })
    if (novoGerente.status === 200) ok('criar colaborador com loja_ids (várias unidades) funciona')
    else falhou('criar colaborador com várias unidades', JSON.stringify(novoGerente))
    const vinculos = await query('SELECT loja_id FROM usuario_lojas WHERE usuario_id = ? ORDER BY loja_id', [novoGerente.body?.id])
    const idsVinculados = vinculos.map(v => v.loja_id).sort()
    if (idsVinculados.length === 2 && idsVinculados.includes(lojaA.lastID) && idsVinculados.includes(lojaB.lastID)) {
      ok('o novo gerente ficou vinculado às duas unidades')
    } else {
      falhou('gerente vinculado a duas unidades', JSON.stringify(idsVinculados))
    }

    console.log('-- alcance do cargo: "unidades escolhidas" vale mais que a unidade da pessoa --')
    const cargoAlcance = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, sistema, ordem) VALUES (?, ?, ?, 'pin', 0, 95)`,
      [`${PREFIXO.toLowerCase()}supervisor`, `${PREFIXO}Supervisor`, dono.lastID]
    )
    await run('INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)', [cargoAlcance.lastID, 'unidades', 'ver'])
    const salvaAlcance = await chamar('PUT', `/perfis/${cargoAlcance.lastID}/permissoes`, tokenDono, {
      escopo: 'unidades_escolhidas', loja_ids: [lojaB.lastID]
    })
    if (salvaAlcance.status === 200) ok('salvar alcance "unidades escolhidas" (Loja B) funciona')
    else falhou('salvar alcance', JSON.stringify(salvaAlcance))

    const leAlcance = await chamar('GET', `/perfis/${cargoAlcance.lastID}/permissoes`, tokenDono)
    if (leAlcance.body?.escopo === 'unidades_escolhidas' && leAlcance.body?.loja_ids?.includes(lojaB.lastID)) {
      ok('GET devolve o alcance e a unidade escolhida salvos')
    } else {
      falhou('GET devolve o alcance salvo', JSON.stringify(leAlcance.body))
    }

    // Pessoa com esse cargo, vinculada (usuario_lojas) só à Loja A — mas o
    // CARGO diz "Loja B" — o alcance do cargo deve prevalecer.
    const pessoaSupervisor = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`,
      [`${PREFIXO}Pessoa Supervisor`, `${PREFIXO}pessoasupervisor@teste.local`, hash, `${PREFIXO.toLowerCase()}supervisor`, lojaA.lastID]
    )
    await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?)', [pessoaSupervisor.lastID, lojaA.lastID])
    const tokenSupervisor = await login(`${PREFIXO}pessoasupervisor@teste.local`)
    const lojasVisiveisSupervisor = await chamar('GET', '/lojas', tokenSupervisor)
    const nomesVisiveis = (lojasVisiveisSupervisor.body || []).map(l => l.nome)
    if (nomesVisiveis.includes(`${PREFIXO}Loja B`) && !nomesVisiveis.includes(`${PREFIXO}Loja A`)) {
      ok('pessoa com cargo "unidades escolhidas" vê a Loja B (do cargo), não a Loja A (da própria pessoa)')
    } else {
      falhou('alcance do cargo prevalece sobre a unidade da pessoa', JSON.stringify(nomesVisiveis))
    }
    await run('DELETE FROM usuario_lojas WHERE usuario_id = ?', [pessoaSupervisor.lastID])
    await run('DELETE FROM usuarios WHERE id = ?', [pessoaSupervisor.lastID])
    await run('DELETE FROM perfil_lojas WHERE perfil_id = ?', [cargoAlcance.lastID])
    await run('DELETE FROM perfil_permissoes WHERE perfil_id = ?', [cargoAlcance.lastID])
    await run('DELETE FROM perfis WHERE id = ?', [cargoAlcance.lastID])

    console.log('-- horários: salvar com lista vazia realmente limpa os dias (Fase 4, bloco G) --')
    const salvaDoisHorarios = await chamar('PUT', `/lojas/${lojaA.lastID}/horarios`, tokenDono, {
      horarios: [
        { dia_semana: 1, hora_abertura: '08:00', hora_fechamento: '18:00' },
        { dia_semana: 2, hora_abertura: '08:00', hora_fechamento: '18:00' }
      ]
    })
    const leDoisHorarios = await chamar('GET', `/lojas/${lojaA.lastID}/horarios`, tokenDono)
    if (salvaDoisHorarios.status === 200 && (leDoisHorarios.body || []).length === 2) {
      ok('salva 2 horários e a leitura devolve os 2')
    } else {
      falhou('deveria salvar e ler 2 horários', JSON.stringify({ salvaDoisHorarios, leDoisHorarios }))
    }
    const salvaVazio = await chamar('PUT', `/lojas/${lojaA.lastID}/horarios`, tokenDono, { horarios: [] })
    const leVazio = await chamar('GET', `/lojas/${lojaA.lastID}/horarios`, tokenDono)
    if (salvaVazio.status === 200 && (leVazio.body || []).length === 0) {
      ok('salvar com lista vazia realmente limpa os horários (o bug era o front nunca chamar isso)')
    } else {
      falhou('salvar lista vazia deveria limpar os horários', JSON.stringify({ salvaVazio, leVazio }))
    }

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — API de Acessos e Unidades funciona.')
    else console.log(`❌ ${falhas} teste(s) falharam.`)
  } catch (e) {
    falhas++
    console.error('\n❌ Erro ao rodar o teste:', e.message)
  } finally {
    if (child) child.kill()
    for (const id of idsCargosExtras) {
      await run('DELETE FROM perfil_permissoes WHERE perfil_id = ?', [id])
      await run('DELETE FROM perfis WHERE id = ?', [id])
    }
    await limpar()
    await pool.end()
  }
  process.exit(falhas > 0 ? 1 : 0)
}

main()
