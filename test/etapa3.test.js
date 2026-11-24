// Testes da Etapa 3 (app do operador): histórico próprio, pedido de liberação
// pelo Início e a configuração do alerta no /eu. Rodam no valida_ensaio.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./ajuda')
const tempo = require('../src/lib/tempo')
const agenda = require('../src/servicos/agenda')

const FUSO = 'America/Sao_Paulo'
const U1 = { lat: -26.849, lng: -52.991 }
const S = {}

before(async () => {
  await h.subir()
  S.E = await h.criarEmpresa('Empresa 3')
  S.u = await h.criarUnidade(S.E.token, 'U3', U1.lat, U1.lng)
  S.g = await h.criarPessoa(S.E.token, S.u.id, 'Gerente', 'Gerente U3')
  S.o = await h.criarPessoa(S.E.token, S.u.id, 'Operador', 'Operador U3')
  S.g.token = (await h.entrar(S.g)).corpo.token
  S.o.token = (await h.entrar(S.o, U1)).corpo.token
  S.hoje = tempo.hoje(FUSO)
  S.ontem = tempo.somarDias(S.hoje, -1)
})
after(async () => { await h.descer() })

test('/eu traz a configuração do alerta da unidade e o cargo', async () => {
  const r = await h.api(S.o.token).get('/eu')
  assert.equal(r.status, 200)
  assert.equal(r.corpo.cargo, 'Operador')
  assert.deepEqual(Object.keys(r.corpo.alerta).sort(), ['antes_min', 'modo', 'push', 'repetir_min', 'som', 'vibrar'])
})

test('histórico: só a própria pessoa, com "atrasada" quando feita depois da tolerância', async () => {
  const t = await h.api(S.E.token).post('/tarefas', { titulo: 'Abertura U3', unidade_id: S.u.id, colaborador_id: S.o.id, hora_ini: '08:00', recorrencia: 'diario', tolerancia_min: 10 })
  assert.equal(t.status, 200, JSON.stringify(t.corpo))
  const id = t.corpo.resultado.tarefa_id
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, tempo.momento(S.ontem, '07:00', FUSO)))
  await h.db.exec(`UPDATE execucoes SET estado = 'feita', feita_em = $3 WHERE tarefa_id = $1 AND data = $2`, [id, S.ontem, tempo.momento(S.ontem, '08:25', FUSO)])
  const r = await h.api(S.o.token).get(`/meu-historico?de=${S.ontem}&ate=${S.hoje}`)
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  const ontem = r.corpo.find((x) => x.data === S.ontem && x.titulo === 'Abertura U3')
  assert.equal(ontem.estado, 'feita')
  assert.equal(ontem.atrasada, true)
  assert.ok(r.corpo.every((x) => x.titulo !== undefined && x.colaborador_id === undefined))
  assert.equal((await h.api(S.E.token).get(`/meu-historico?de=${S.ontem}&ate=${S.hoje}`)).status, 403, 'admin não tem histórico de tarefas')
})

test('pedido de liberação pelo Início: "Outro" exige texto, um pendente por vez, o gerente aprova', async () => {
  const a = h.api(S.o.token)
  assert.equal((await a.post('/liberacao', { motivo: 'outro' })).status, 400)
  const r = await a.post('/liberacao', { motivo: 'cobrir_outra_unidade', lat: U1.lat + 0.01, lng: U1.lng })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  assert.equal((await a.post('/liberacao', { motivo: 'cheguei_antes' })).status, 409)
  const p = await h.db.um('SELECT detalhe, tipo FROM pedidos WHERE id = $1', [r.corpo.pedido.id])
  assert.equal(p.tipo, 'lib')
  assert.match(p.detalhe, /vou cobrir outra unidade/)
  assert.equal((await h.api(S.g.token).post(`/pedidos/${r.corpo.pedido.id}/aprovar`)).status, 200)
  // A liberação vale na próxima entrada fora do local.
  const fora = await h.entrar(S.o, { lat: U1.lat + 0.05, lng: U1.lng })
  assert.equal(fora.status, 200, JSON.stringify(fora.corpo))
  assert.equal(fora.corpo.estado, 'liberado')
})
