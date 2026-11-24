// Testes da Etapa 1B (roteiro 1B item 9 + ajustes do Almir). Rodam no valida_ensaio.
// O relógio do agendador é injetado (agora); os testes de calendário usam a
// unidade U2 com datas futuras, para não mexer nas execuções de hoje.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const h = require('./ajuda')
const tempo = require('../src/lib/tempo')
const agenda = require('../src/servicos/agenda')
const bonus = require('../src/servicos/bonus')
const config = require('../src/config')
const { caixa } = require('../src/lib/envio')

const FUSO = 'America/Sao_Paulo'
const U1 = { lat: -26.849, lng: -52.991 }
const U2 = { lat: -27.1, lng: -52.62 }
const S = {}
const em = (data, hora) => tempo.momento(data, hora, FUSO)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])

async function tarefa(token, campos) {
  const r = await h.api(token).post('/tarefas', { recorrencia: 'diario', nf_min: 120, prazo_acao_min: 120, ...campos })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  return r.corpo.resultado.tarefa_id
}

async function execucaoDeHoje(pessoa, tarefaId) {
  const r = await h.api(pessoa.token).get('/minhas-tarefas')
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  const e = r.corpo.find((x) => x.tarefa_id === tarefaId)
  assert.ok(e, `execução de hoje da tarefa ${tarefaId} não encontrada`)
  return e
}

const execDe = (tarefaId, pessoaId, data) =>
  h.db.um('SELECT * FROM execucoes WHERE tarefa_id = $1 AND colaborador_id = $2 AND data = $3', [tarefaId, pessoaId, data])

before(async () => {
  await h.subir()
  S.E = await h.criarEmpresa('Empresa 1B')
  S.B = await h.criarEmpresa('Outra 1B')
  S.u1 = await h.criarUnidade(S.E.token, 'U1', U1.lat, U1.lng)
  S.u2 = await h.criarUnidade(S.E.token, 'U2 calendário', U2.lat, U2.lng)
  S.g = await h.criarPessoa(S.E.token, S.u1.id, 'Gerente', 'Gerente U1')
  S.o = await h.criarPessoa(S.E.token, S.u1.id, 'Operador', 'Operador U1')
  S.o3 = await h.criarPessoa(S.E.token, S.u2.id, 'Operador', 'Operador U2 a')
  S.o4 = await h.criarPessoa(S.E.token, S.u2.id, 'Operador', 'Operador U2 b')
  S.g.token = (await h.entrar(S.g)).corpo.token
  const lo = await h.entrar(S.o, U1)
  assert.equal(lo.status, 200, JSON.stringify(lo.corpo))
  S.o.token = lo.corpo.token
  S.hoje = tempo.hoje(FUSO)
  S.ontem = tempo.somarDias(S.hoje, -1)
})

after(async () => { await h.descer() })

test('tarefa vencida não conclui (vira não feita e abre ação "nf")', async () => {
  const t = await tarefa(S.E.token, { titulo: 'Abertura', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '08:00', nf_min: 60 })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u1.id, em(S.ontem, '07:00')))
  const e = await execDe(t, S.o.id, S.ontem)
  assert.equal(e.estado, 'a_fazer')
  const r = await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, {})
  assert.equal(r.status, 409)
  assert.match(r.corpo.erro, /Venceu/)
  assert.equal((await h.db.um('SELECT estado FROM execucoes WHERE id = $1', [e.id])).estado, 'nao_feita')
  const a = await h.db.um(`SELECT * FROM acoes WHERE execucao_id = $1 AND tipo = 'nf'`, [e.id])
  assert.ok(a)
  assert.equal(a.motivo, 'Não feita · venceu às 09:00')
  assert.equal(a.responsavel_tipo, 'colaborador')
  assert.equal(Number(a.responsavel_id), S.g.id, 'responsável = gerente da unidade')
  S.execOntem = e
})

test('resposta fora da faixa cria ação "fx" com o motivo certo', async () => {
  const t = await tarefa(S.E.token, { titulo: 'Conferir temperatura', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:59', tipo_resposta: 'numero', faixa_min: 0, faixa_max: 4, unidade_medida: '°C', prazo_acao_min: 60 })
  const e = await execucaoDeHoje(S.o, t)
  assert.equal((await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, {})).status, 400, 'número é obrigatório')
  const r = await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, { resposta_num: 7.2 })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  assert.equal(r.corpo.fora, true)
  assert.equal(r.corpo.mensagem, 'Registrado. O gerente foi avisado.')
  const a = await h.db.um('SELECT * FROM acoes WHERE id = $1', [r.corpo.acao_id])
  assert.equal(a.tipo, 'fx')
  assert.equal(a.motivo, 'Fora da faixa: 7,2 °C (certo: 0 a 4 °C)')
  assert.equal(Math.round((a.prazo_ate - a.aberta_em) / 60000), 60)
  S.execFeita = e
})

test('nota 1 ou 2 cria "fx"; nota 4 não', async () => {
  const t1 = await tarefa(S.E.token, { titulo: 'Avaliar limpeza', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:58', tipo_resposta: 'nota' })
  const t2 = await tarefa(S.E.token, { titulo: 'Avaliar vitrine', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:57', tipo_resposta: 'nota' })
  const r1 = await h.api(S.o.token).post(`/execucoes/${(await execucaoDeHoje(S.o, t1)).id}/concluir`, { resposta_num: 2 })
  assert.equal(r1.corpo.fora, true)
  assert.equal((await h.db.um('SELECT motivo FROM acoes WHERE id = $1', [r1.corpo.acao_id])).motivo, 'Nota 2 de 5')
  const r2 = await h.api(S.o.token).post(`/execucoes/${(await execucaoDeHoje(S.o, t2)).id}/concluir`, { resposta_num: 4 })
  assert.equal(r2.corpo.fora, false)
  assert.equal(r2.corpo.acao_id, null)
  // Escolha com opção que abre ação.
  const t3 = await tarefa(S.E.token, { titulo: 'Limpeza de bancadas', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:56', tipo_resposta: 'escolha', opcoes: [{ rotulo: 'Limpa' }, { rotulo: 'Precisa limpar de novo', abre_acao: true }] })
  const r3 = await h.api(S.o.token).post(`/execucoes/${(await execucaoDeHoje(S.o, t3)).id}/concluir`, { opcao: 'Precisa limpar de novo' })
  assert.equal((await h.db.um('SELECT motivo FROM acoes WHERE id = $1', [r3.corpo.acao_id])).motivo, 'Resposta: Precisa limpar de novo')
})

test('não feita cria "nf" com prazo certo ("fim do dia" = 23:59; 2 h = +120 min); sem gerente, o admin', async () => {
  const D = '2031-06-10'
  const tA = await tarefa(S.E.token, { titulo: 'Fim do dia', unidade_id: S.u2.id, colaborador_id: S.o3.id, hora_ini: '09:00', nf_min: 60, prazo_acao_min: 0 })
  const tB = await tarefa(S.E.token, { titulo: 'Duas horas', unidade_id: S.u2.id, colaborador_id: S.o3.id, hora_ini: '09:00', nf_min: 60, prazo_acao_min: 120 })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '08:00')))
  assert.equal((await execDe(tA, S.o3.id, D)).estado, 'a_fazer')
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '09:59')))
  assert.equal((await execDe(tA, S.o3.id, D)).estado, 'a_fazer', 'antes do limite continua a fazer')
  const agora = em(D, '12:00')
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, agora))
  const eA = await execDe(tA, S.o3.id, D)
  assert.equal(eA.estado, 'nao_feita')
  const aA = await h.db.um(`SELECT * FROM acoes WHERE execucao_id = $1 AND tipo = 'nf'`, [eA.id])
  assert.equal(aA.aberta_em.getTime(), agora.getTime())
  assert.equal(aA.prazo_ate.getTime(), em(D, '23:59').getTime())
  assert.equal(aA.responsavel_tipo, 'admin')
  const aB = await h.db.um(`SELECT * FROM acoes WHERE execucao_id = $1 AND tipo = 'nf'`, [(await execDe(tB, S.o3.id, D)).id])
  assert.equal(aB.prazo_ate.getTime(), agora.getTime() + 120 * 60000)
  // Rodar de novo não duplica nada.
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, agora))
  assert.equal((await h.db.um(`SELECT COUNT(*)::int AS n FROM acoes WHERE execucao_id = $1`, [eA.id])).n, 1)
  assert.equal((await h.db.um(`SELECT COUNT(*)::int AS n FROM execucoes WHERE tarefa_id = $1 AND data = $2`, [tA, D])).n, 1)
})

test('dia fechado parcial dispensa só a janela', async () => {
  const D = '2031-06-11'
  const t9 = await tarefa(S.E.token, { titulo: 'Às 9', unidade_id: S.u2.id, colaborador_id: S.o4.id, hora_ini: '09:00' })
  const t14 = await tarefa(S.E.token, { titulo: 'Às 14', unidade_id: S.u2.id, colaborador_id: S.o4.id, hora_ini: '14:00' })
  const r = await h.api(S.E.token).post('/dias-fechados', { data: D, motivo: 'Manutenção da cozinha', unidades: [S.u2.id], hora_ini: '06:00', hora_fim: '12:00' })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '05:00')))
  const e9 = await execDe(t9, S.o4.id, D), e14 = await execDe(t14, S.o4.id, D)
  assert.equal(e9.estado, 'dispensada')
  assert.equal(e9.motivo_dispensa, 'janela_fechada')
  assert.equal(e14.estado, 'a_fazer')
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '23:30')))
  assert.equal((await execDe(t9, S.o4.id, D)).estado, 'dispensada', 'dispensada não vence')
  assert.equal((await execDe(t14, S.o4.id, D)).estado, 'nao_feita')
  assert.equal((await h.db.um('SELECT COUNT(*)::int AS n FROM acoes WHERE execucao_id = $1', [e9.id])).n, 0)
})

test('unidade fechada não gera ação; reabrir a unidade devolve as tarefas', async () => {
  const D = '2031-06-12'
  const t = await tarefa(S.E.token, { titulo: 'Unidade fechada', unidade_id: S.u2.id, colaborador_id: S.o4.id, hora_ini: '09:00', nf_min: 60 })
  await h.db.exec('UPDATE unidades SET aberta_hoje = false, aberta_hoje_data = $2 WHERE id = $1', [S.u2.id, D])
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '07:00')))
  assert.equal((await execDe(t, S.o4.id, D)).estado, 'dispensada')
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '20:00')))
  const e = await execDe(t, S.o4.id, D)
  assert.equal(e.estado, 'dispensada')
  assert.equal((await h.db.um('SELECT COUNT(*)::int AS n FROM acoes WHERE execucao_id = $1', [e.id])).n, 0)
  await h.db.exec('UPDATE unidades SET aberta_hoje = true WHERE id = $1', [S.u2.id])
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '08:00')))
  assert.equal((await execDe(t, S.o4.id, D)).estado, 'a_fazer')
})

test('tarefa de cargo gera a execução de cada pessoa ativa do cargo', async () => {
  const D = '2031-06-13'
  const cargo = await h.cargoDe(S.E.token, S.u2.id, 'Operador')
  const t = await tarefa(S.E.token, { titulo: 'Tarefa do cargo', unidade_id: S.u2.id, cargo_id: cargo.id, hora_ini: '10:00' })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '06:00')))
  const ativos = await h.db.q(`SELECT id FROM colaboradores WHERE cargo_id = $1 AND situacao = 'ativo'`, [cargo.id])
  const execs = await h.db.q('SELECT colaborador_id, estado FROM execucoes WHERE tarefa_id = $1 AND data = $2', [t, D])
  assert.equal(execs.length, ativos.length)
  assert.ok(execs.length >= 2)
  // Quem sai do cargo (arquivado) deixa de receber: a do dia vira cancelada.
  const novo = await h.criarPessoa(S.E.token, S.u2.id, 'Operador', 'Entrou no cargo')
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '06:30')))
  assert.ok(await execDe(t, novo.id, D), 'quem entra no cargo passa a receber')
  await h.api(S.E.token).post(`/colaboradores/${novo.id}/arquivar`)
  await h.db.tx((x) => agenda.processarUnidade(x, S.u2.id, em(D, '07:00')))
  const e = await execDe(t, novo.id, D)
  assert.equal(e.estado, 'cancelada')
  assert.equal(e.motivo_dispensa, 'pessoa_inativa')
})

test('envio sem internet: o duplicado não duplica; feita antes do limite vale mesmo chegando depois', async () => {
  const t = await tarefa(S.E.token, { titulo: 'Offline', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:55' })
  const e = await execucaoDeHoje(S.o, t)
  const corpo = { chave_envio: `k-${e.id}`, feita_em: new Date(Date.now() - 60000).toISOString(), relogio_celular: new Date(Date.now() - 600000).toISOString() }
  const r1 = await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, corpo)
  assert.equal(r1.status, 200, JSON.stringify(r1.corpo))
  assert.equal(r1.corpo.relogio_suspeito, true, 'diferença de 10 min fica marcada')
  const r2 = await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, corpo)
  assert.equal(r2.status, 200)
  assert.equal(r2.corpo.duplicado, true)
  const reg = await h.db.um(`SELECT COUNT(*)::int AS n FROM registro_atividades WHERE acao = 'execucao.concluida' AND entidade_id = $1`, [e.id])
  assert.equal(reg.n, 1)
  const outra = await execucaoDeHoje(S.o, await tarefa(S.E.token, { titulo: 'Outra', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:54' }))
  assert.equal((await h.api(S.o.token).post(`/execucoes/${outra.id}/concluir`, corpo)).status, 409, 'a mesma chave em outra tarefa')

  // A de ontem venceu às 09:00, mas foi feita às 08:30 sem internet: vale e fecha a ação.
  const r3 = await h.api(S.o.token).post(`/execucoes/${S.execOntem.id}/concluir`, { chave_envio: `k-ontem-${S.execOntem.id}`, feita_em: em(S.ontem, '08:30').toISOString() })
  assert.equal(r3.status, 200, JSON.stringify(r3.corpo))
  assert.equal((await h.db.um(`SELECT estado FROM acoes WHERE execucao_id = $1 AND tipo = 'nf'`, [S.execOntem.id])).estado, 'resolvida')
})

test('conferência: aprovar, reabrir com motivo, reabrir depois do limite = não feita; ninguém confere o que fez', async () => {
  const g = h.api(S.g.token)
  const ok = await g.post(`/execucoes/${S.execFeita.id}/conferir`, { decisao: 'aprovar' })
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo))
  const e1 = await h.db.um('SELECT conferencia, conferida_por, conferida_por_tipo FROM execucoes WHERE id = $1', [S.execFeita.id])
  assert.equal(e1.conferencia, 'aprovada')
  assert.equal(e1.conferida_por_tipo, 'colaborador')

  assert.equal((await g.post(`/execucoes/${S.execFeita.id}/conferir`, { decisao: 'reabrir' })).status, 400, 'reabrir exige motivo')
  const re = await g.post(`/execucoes/${S.execFeita.id}/conferir`, { decisao: 'reabrir', motivo: 'Medir de novo' })
  assert.equal(re.corpo.estado, 'a_fazer', 'antes do limite volta para a pessoa')
  const e2 = await h.db.um('SELECT estado, conferencia, conferencia_motivo FROM execucoes WHERE id = $1', [S.execFeita.id])
  assert.equal(e2.conferencia, 'reaberta')
  assert.equal(e2.conferencia_motivo, 'Medir de novo')

  const tarde = await g.post(`/execucoes/${S.execOntem.id}/conferir`, { decisao: 'reabrir', motivo: 'Faltou foto' })
  assert.equal(tarde.corpo.estado, 'nao_feita', 'depois do limite fica não feita')
  assert.ok(await h.db.um(`SELECT 1 FROM acoes WHERE execucao_id = $1 AND tipo = 'nf' AND estado = 'aberta'`, [S.execOntem.id]))

  // O gerente faz a própria tarefa e não pode conferir.
  const tg = await tarefa(S.E.token, { titulo: 'Do gerente', unidade_id: S.u1.id, colaborador_id: S.g.id, hora_ini: '23:50' })
  const eg = await execucaoDeHoje(S.g, tg)
  assert.equal((await g.post(`/execucoes/${eg.id}/concluir`, {})).status, 200)
  const proprio = await g.post(`/execucoes/${eg.id}/conferir`, { decisao: 'aprovar' })
  assert.equal(proprio.status, 403)
  assert.match(proprio.corpo.erro, /Ninguém confere/)
  // O operador não confere (sem "conf").
  assert.equal((await h.api(S.o.token).post(`/execucoes/${eg.id}/conferir`, { decisao: 'aprovar' })).status, 403)
})

test('desfazer nunca apaga: marca quem e quando', async () => {
  const t = await tarefa(S.E.token, { titulo: 'Para desfazer', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:53' })
  const e = await execucaoDeHoje(S.o, t)
  await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, {})
  assert.equal((await h.api(S.o.token).post(`/execucoes/${e.id}/desfazer`)).status, 403, 'Operadores não têm "desfaz" (§8)')
  const r = await h.api(S.E.token).post(`/execucoes/${e.id}/desfazer`)
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  const d = await h.db.um('SELECT * FROM execucoes WHERE id = $1', [e.id])
  assert.equal(d.estado, 'a_fazer')
  assert.equal(Number(d.desfeita_por), S.E.adminId)
  assert.equal(d.desfeita_por_tipo, 'admin')
  assert.ok(d.desfeita_em)
  assert.ok(d.feita_em, 'o horário da primeira conclusão continua guardado')
  assert.ok(await h.db.um(`SELECT 1 FROM registro_atividades WHERE acao = 'execucao.desfeita' AND entidade_id = $1`, [e.id]))
})

test('fotos: pede foto, upload com limite, só a empresa vê', async () => {
  const t = await tarefa(S.E.token, { titulo: 'Foto do caixa', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:52', pede_foto: true })
  const e = await execucaoDeHoje(S.o, t)
  assert.equal((await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, {})).status, 400, 'sem foto não conclui')
  assert.equal((await h.enviarFoto(S.o.token, Buffer.from('não é imagem nenhuma, só texto'))).status, 400)
  assert.equal((await h.enviarFoto(S.o.token, Buffer.alloc(1.2 * 1024 * 1024, 0xff))).status, 413, 'acima do limite')
  const up = await h.enviarFoto(S.o.token, JPEG)
  assert.equal(up.status, 201, JSON.stringify(up.corpo))
  const r = await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, { foto_id: up.corpo.foto_id })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  const f = await h.db.um('SELECT caminho FROM fotos WHERE id = $1', [up.corpo.foto_id])
  assert.ok(fs.existsSync(path.join(config.fotosDir, f.caminho)), 'arquivo gravado fora do banco')
  const g = await h.baixar(S.g.token, `/fotos/${up.corpo.foto_id}`)
  assert.equal(g.status, 200)
  assert.equal(g.tipo, 'image/jpeg')
  assert.ok(g.bytes.equals(JPEG))
  assert.equal((await h.baixar(S.B.token, `/fotos/${up.corpo.foto_id}`)).status, 404, 'outra empresa não vê')
  assert.equal((await h.api(S.o.token).post(`/execucoes/${(await execucaoDeHoje(S.o, await tarefa(S.E.token, { titulo: 'Reuso', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:51', pede_foto: true }))).id}/concluir`, { foto_id: up.corpo.foto_id })).status, 400, 'foto não é reaproveitada')
})

test('sub-itens: responde item a item; a principal só conclui com todos', async () => {
  const pai = await tarefa(S.E.token, { titulo: 'Checklist de abertura', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:49' })
  const f1 = await tarefa(S.E.token, { titulo: 'Ligar luzes', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:49', pai_id: pai })
  const f2 = await tarefa(S.E.token, { titulo: 'Temperatura da câmara', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:49', pai_id: pai, tipo_resposta: 'numero', faixa_min: 0, faixa_max: 4 })
  const ep = await execucaoDeHoje(S.o, pai)
  const falta = await h.api(S.o.token).post(`/execucoes/${ep.id}/concluir`, {})
  assert.equal(falta.status, 409)
  assert.match(falta.corpo.erro, /Faltam 2 itens/)
  assert.equal((await h.api(S.o.token).post(`/execucoes/${(await execucaoDeHoje(S.o, f1)).id}/concluir`, {})).status, 200)
  assert.equal((await h.api(S.o.token).post(`/execucoes/${(await execucaoDeHoje(S.o, f2)).id}/concluir`, { resposta_num: 3 })).status, 200)
  assert.equal((await h.api(S.o.token).post(`/execucoes/${ep.id}/concluir`, {})).status, 200)
})

test('ações: lista para quem confere, resolver exige texto; prazo vencido avisa o admin', async () => {
  assert.equal((await h.api(S.o.token).get('/acoes')).status, 403, 'operador não vê ações')
  const lista = await h.api(S.g.token).get(`/acoes?unidade_id=${S.u1.id}`)
  assert.equal(lista.status, 200)
  const fx = lista.corpo.find((a) => a.tipo === 'fx')
  assert.ok(fx)
  assert.equal((await h.api(S.g.token).post(`/acoes/${fx.id}/resolver`, {})).status, 400)
  assert.equal((await h.api(S.g.token).post(`/acoes/${fx.id}/resolver`, { solucao: 'Ajustei o termostato.' })).status, 200)
  const resolvidas = await h.api(S.g.token).get(`/acoes?unidade_id=${S.u1.id}&estado=resolvida`)
  assert.ok(resolvidas.corpo.some((a) => a.id === fx.id && a.solucao === 'Ajustei o termostato.'))
  // Prazo vencido: avisa uma vez.
  const antes = caixa.length
  const n1 = await h.db.tx((x) => agenda.avisarVencidas(x, S.E.id, em('2099-01-01', '12:00')))
  assert.ok(n1 >= 1)
  assert.ok(caixa.length > antes, 'admin recebe o aviso (envio simulado)')
  assert.equal(await h.db.tx((x) => agenda.avisarVencidas(x, S.E.id, em('2099-01-01', '12:00'))), 0, 'não repete o aviso')
})

test('bônus nunca negativo', async () => {
  const p = await h.criarPessoa(S.E.token, S.u2.id, 'Operador', 'Bônus negativo')
  await h.db.exec(`INSERT INTO regras_bonus (colaborador_id, tipo, valor_feita, valor_nao_feita, vigente_desde) VALUES ($1, 'tarefa', 1, 5, '2030-01-01')`, [p.id])
  const ta = await tarefa(S.E.token, { titulo: 'B1', unidade_id: S.u2.id, colaborador_id: p.id, hora_ini: '09:00' })
  const tb = await tarefa(S.E.token, { titulo: 'B2', unidade_id: S.u2.id, colaborador_id: p.id, hora_ini: '10:00' })
  for (const [t, estado] of [[ta, 'feita'], [tb, 'nao_feita']]) {
    await h.db.exec(`INSERT INTO execucoes (empresa_id, tarefa_id, colaborador_id, unidade_id, data, hora_prevista, estado) VALUES ($1, $2, $3, $4, '2032-03-05', '09:00', $5)`, [S.E.id, t, p.id, S.u2.id, estado])
  }
  const b = await bonus.calcular(h.db, p.id, '2032-03-01', '2032-03-31')
  assert.equal(b.bruto, 1)
  assert.equal(b.descontos, 5)
  assert.equal(b.liquido, 0)
})

test('regra nova não muda o mês anterior; fixo, valor próprio da tarefa e atraso', async () => {
  const p = await h.criarPessoa(S.E.token, S.u2.id, 'Operador', 'Bônus vigência')
  await h.db.exec(`INSERT INTO regras_bonus (colaborador_id, tipo, valor_feita, valor_nao_feita, vigente_desde) VALUES ($1, 'tarefa', 2, 1, '2033-01-01'), ($1, 'tarefa', 10, 1, '2033-02-01')`, [p.id])
  const t = await tarefa(S.E.token, { titulo: 'V1', unidade_id: S.u2.id, colaborador_id: p.id, hora_ini: '09:00' })
  const tProprio = await tarefa(S.E.token, { titulo: 'V2', unidade_id: S.u2.id, colaborador_id: p.id, hora_ini: '11:00', valor_feita: 7 })
  for (const d of ['2033-01-15', '2033-02-15']) {
    await h.db.exec(`INSERT INTO execucoes (empresa_id, tarefa_id, colaborador_id, unidade_id, data, hora_prevista, estado) VALUES ($1, $2, $3, $4, $5, '09:00', 'feita')`, [S.E.id, t, p.id, S.u2.id, d])
  }
  await h.db.exec(`INSERT INTO execucoes (empresa_id, tarefa_id, colaborador_id, unidade_id, data, hora_prevista, estado) VALUES ($1, $2, $3, $4, '2033-02-16', '11:00', 'feita')`, [S.E.id, tProprio, p.id, S.u2.id])
  const jan = await h.api(S.E.token).get(`/bonus/colaboradores/${p.id}?mes=2033-01`)
  assert.equal(jan.status, 200, JSON.stringify(jan.corpo))
  assert.equal(jan.corpo.bruto, 2, 'janeiro continua com a regra de janeiro')
  const fev = (await h.api(S.E.token).get(`/bonus/colaboradores/${p.id}?mes=2033-02`)).corpo
  assert.equal(fev.bruto, 17, 'fevereiro: 10 (regra nova) + 7 (valor próprio da tarefa)')

  // Fixo no mês − não feita − atraso de chegada.
  const q = await h.criarPessoa(S.E.token, S.u2.id, 'Operador', 'Bônus fixo')
  await h.db.exec(`INSERT INTO regras_bonus (colaborador_id, tipo, valor_mes, valor_nao_feita, atraso_ativo, atraso_tol_min, atraso_desconto, vigente_desde) VALUES ($1, 'fixo', 500, 20, true, 10, 5, '2034-01-01')`, [q.id])
  const tq = await tarefa(S.E.token, { titulo: 'F1', unidade_id: S.u2.id, colaborador_id: q.id, hora_ini: '09:00' })
  await h.db.exec(`INSERT INTO execucoes (empresa_id, tarefa_id, colaborador_id, unidade_id, data, hora_prevista, estado) VALUES ($1, $2, $3, $4, '2034-01-10', '09:00', 'nao_feita'), ($1, $2, $3, $4, '2034-01-11', '09:00', 'dispensada')`, [S.E.id, tq, q.id, S.u2.id])
  await h.db.exec(`INSERT INTO logins (empresa_id, colaborador_id, unidade_id, em, atraso_min) VALUES ($1, $2, $3, $4, 25), ($1, $2, $3, $5, 0)`, [S.E.id, q.id, S.u2.id, em('2034-01-12', '09:25'), em('2034-01-12', '14:00')])
  const bq = await bonus.calcular(h.db, q.id, '2034-01-01', '2034-01-31')
  assert.equal(bq.bruto, 500)
  assert.equal(bq.descontos, 20, 'dispensada não conta')
  assert.equal(bq.atrasos, 5, 'só o primeiro login do dia conta')
  assert.equal(bq.liquido, 475)
  // Operador vê o próprio bônus (own); não vê o dos outros (sem premio).
  assert.equal((await h.api(S.o.token).get(`/bonus/colaboradores/${S.o.id}`)).status, 200)
  assert.equal((await h.api(S.o.token).get(`/bonus/colaboradores/${q.id}`)).status, 404, 'outra unidade: 404')
  assert.equal((await h.api(S.o.token).get(`/bonus/colaboradores/${S.g.id}`)).status, 403, 'mesma unidade, sem "premio": 403')
})

test('relatórios e exportação CSV com permissão', async () => {
  const r = await h.api(S.g.token).get(`/relatorios?unidade_id=${S.u1.id}`)
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  assert.ok(r.corpo.resumo.feitas >= 1)
  assert.ok(Array.isArray(r.corpo.pessoas) && Array.isArray(r.corpo.dia_a_dia) && Array.isArray(r.corpo.tarefas))
  assert.equal((await h.api(S.o.token).get(`/relatorios?unidade_id=${S.u1.id}`)).status, 403)
  const ex = await h.chamar('GET', `/api/v2/relatorios/exportar?conteudo=execucoes&unidade_id=${S.u1.id}`, { token: S.E.token })
  assert.equal(ex.status, 200)
  assert.match(ex.headers.get('content-type'), /text\/csv/)
  const bruto = await h.baixar(S.E.token, `/relatorios/exportar?conteudo=execucoes&unidade_id=${S.u1.id}`)
  assert.ok(bruto.bytes.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'BOM para o Excel')
  assert.ok(bruto.bytes.slice(3).toString('utf8').startsWith('data;hora_prevista;unidade;pessoa;tarefa;estado'))
  assert.equal((await h.chamar('GET', '/api/v2/relatorios/exportar', { token: S.g.token })).status, 403, 'gerente sem "exp"')
})

test('tarefa desativada sai do dia (cancelada) e volta ao reativar; agendador tem trava', async () => {
  const t = await tarefa(S.E.token, { titulo: 'Desativar', unidade_id: S.u1.id, colaborador_id: S.o.id, hora_ini: '23:48' })
  const e = await execucaoDeHoje(S.o, t)
  await h.api(S.E.token).post(`/tarefas/${t}/desativar`)
  assert.equal((await execucaoDeHoje(S.o, t)).estado, 'cancelada')
  assert.equal((await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, {})).status, 409)
  await h.api(S.E.token).post(`/tarefas/${t}/alternar`)
  assert.equal((await execucaoDeHoje(S.o, t)).estado, 'a_fazer')
  // Com a trava ocupada, a rodada é pulada (nunca roda duas vezes).
  const c = await h.db.pool.connect()
  await c.query('SELECT pg_advisory_lock(7300112)')
  assert.deepEqual(await agenda.rodada(), { pulada: true })
  await c.query('SELECT pg_advisory_unlock(7300112)')
  c.release()
  const r = await agenda.rodada()
  assert.ok(r.unidades >= 1)
})
