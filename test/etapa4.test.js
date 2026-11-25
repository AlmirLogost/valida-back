// Testes da Etapa 4: envio da fila sem duplicar, relógio do celular, .xlsx,
// inscrição de push e agendamento das notificações. Rodam no valida_teste;
// o envio de push é trocado por uma lista (nada sai do computador).
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const h = require('./ajuda')
const tempo = require('../src/lib/tempo')
const agenda = require('../src/servicos/agenda')
const notificacoes = require('../src/servicos/notificacoes')
const push = require('../src/lib/push')
const { caixa } = require('../src/lib/envio')

const FUSO = 'America/Sao_Paulo'
const U1 = { lat: -26.849, lng: -52.991 }
const S = {}
const em = (d, hm) => tempo.momento(d, hm, FUSO)
const JPEG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)])
const ecdh = () => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return e.getPublicKey().toString('base64url') }
const insc = (host = 'fcm.googleapis.com') => ({ endpoint: `https://${host}/fcm/send/${crypto.randomBytes(12).toString('hex')}`, chaves: { p256dh: ecdh(), auth: crypto.randomBytes(16).toString('base64url') }, aparelho: 'Teste' })
let enviados = []
let falhaCom = null

async function tarefa(campos) {
  const r = await h.api(S.E.token).post('/tarefas', { recorrencia: 'diario', nf_min: 120, prazo_acao_min: 60, unidade_id: S.u.id, colaborador_id: S.o.id, ...campos })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  return r.corpo.resultado.tarefa_id
}
const execDe = (t, d) => h.db.um('SELECT * FROM execucoes WHERE tarefa_id = $1 AND data = $2', [t, d])
const un = () => h.db.um('SELECT * FROM unidades WHERE id = $1', [S.u.id])
async function rodar(d, hm) { enviados = []; await notificacoes.avisarUnidade(await un(), em(d, hm)); return enviados.map((x) => ({ p: x.p, ...JSON.parse(x.corpo) })) }

before(async () => {
  await h.subir()
  S.E = await h.criarEmpresa('Empresa 4'); S.B = await h.criarEmpresa('Outra 4')
  S.u = await h.criarUnidade(S.E.token, 'U4', U1.lat, U1.lng)
  S.g = await h.criarPessoa(S.E.token, S.u.id, 'Gerente', 'Gil Gerente')
  S.o = await h.criarPessoa(S.E.token, S.u.id, 'Operador', 'Olga Operadora')
  S.g.token = (await h.entrar(S.g)).corpo.token
  S.o.token = (await h.entrar(S.o, U1)).corpo.token
  S.hoje = tempo.hoje(FUSO); S.ontem = tempo.somarDias(S.hoje, -1); S.dia = tempo.somarDias(S.hoje, 3)
  push.usarEnviador(async (i, corpo) => { if (falhaCom) throw Object.assign(new Error('x'), { statusCode: falhaCom }); enviados.push({ p: i.endpoint, corpo }) })
})
after(async () => { push.usarEnviador(null); await h.descer() })

test('relógio do celular adiantado não faz tarefa vencida ser aceita', async () => {
  const t = await tarefa({ titulo: 'Vencida', hora_ini: '08:00' })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(S.ontem, '07:00')))
  const e = await execDe(t, S.ontem)
  const r = await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, { chave_envio: crypto.randomUUID(), relogio_celular: new Date(Date.now() + 48 * 3600e3).toISOString() })
  assert.equal(r.status, 409)
})

test('fila: o mesmo envio repetido (em seguida e ao mesmo tempo) conclui uma vez e abre uma ação só', async () => {
  const t = await tarefa({ titulo: 'Temperatura', hora_ini: '08:00', tipo_resposta: 'numero', faixa_min: 0, faixa_max: 4, pede_foto: true })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(S.ontem, '07:00')))
  const e = await execDe(t, S.ontem)
  const foto = JPEG()
  const f1 = await h.enviarFoto(S.o.token, foto), f2 = await h.enviarFoto(S.o.token, foto)
  assert.equal(f2.corpo.foto_id, f1.corpo.foto_id, 'foto reenviada não vira outra')
  const b = { chave_envio: crypto.randomUUID(), resposta_num: 9, foto_id: f1.corpo.foto_id, feita_em: em(S.ontem, '08:30').toISOString(), relogio_celular: new Date().toISOString() }
  const rs = await Promise.all([1, 2, 3].map(() => h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, b)))
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200], JSON.stringify(rs.map((r) => r.corpo)))
  assert.equal(rs.filter((r) => r.corpo.duplicado).length, 2)
  const d = await execDe(t, S.ontem)
  assert.equal(d.estado, 'feita')
  assert.ok(Math.abs(new Date(d.feita_em) - em(S.ontem, '08:30')) < 5000, 'vale a hora em que foi feita, não a do envio')
  assert.equal((await h.db.um(`SELECT COUNT(*)::int AS n FROM acoes WHERE execucao_id = $1`, [e.id])).n, 1)
  // chave de outra pessoa/tarefa não passa
  const t2 = await tarefa({ titulo: 'Outra', hora_ini: '08:00' })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(S.ontem, '07:00')))
  assert.equal((await h.api(S.o.token).post(`/execucoes/${(await execDe(t2, S.ontem)).id}/concluir`, { chave_envio: b.chave_envio })).status, 409)
})

test('fila: dois envios iguais presos na mesma trava concluem uma vez (corrida forçada)', async () => {
  const t = await tarefa({ titulo: 'Corrida', hora_ini: '08:00' })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(S.ontem, '07:00')))
  const e = await execDe(t, S.ontem)
  const b = { chave_envio: crypto.randomUUID(), feita_em: em(S.ontem, '08:30').toISOString(), relogio_celular: new Date().toISOString() }
  let pedidos
  await h.db.tx(async (x) => {
    await x.um('SELECT id FROM execucoes WHERE id = $1 FOR UPDATE', [e.id])
    pedidos = [1, 2].map(() => h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, b))
    // espera os dois chegarem na trava
    for (let i = 0; i < 100; i++) {
      const n = (await h.db.um(`SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).n
      if (n >= 2) break
      await new Promise((ok) => setTimeout(ok, 30))
    }
  })
  const rs = await Promise.all(pedidos)
  assert.deepEqual(rs.map((r) => r.status), [200, 200], JSON.stringify(rs.map((r) => r.corpo)))
  assert.equal(rs.filter((r) => r.corpo.duplicado).length, 1)
})

test('exportar .xlsx: várias abas, sem fórmula; CSV continua e neutraliza fórmula', async () => {
  await tarefa({ titulo: '=1+1', hora_ini: '23:00' })
  const r = await h.baixar(S.E.token, '/relatorios/exportar?formato=xlsx&conteudo=tarefas,pessoas')
  assert.equal(r.status, 200)
  assert.match(r.tipo, /spreadsheetml/)
  const wb = new (require('exceljs').Workbook)(); await wb.xlsx.load(r.bytes)
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Cadastro de tarefas', 'Pessoas e cargos'])
  let achou = null
  wb.worksheets[0].eachRow((l) => { if (l.getCell(2).value === '=1+1') achou = l.getCell(2) })
  assert.ok(achou, 'texto preservado'); assert.equal(achou.formula, undefined)
  const c = await h.baixar(S.E.token, '/relatorios/exportar?conteudo=tarefas')
  assert.ok(c.bytes.toString('utf8').includes("'=1+1"))
  assert.equal((await h.api(S.E.token).get('/relatorios/exportar?conteudo=tarefas,pessoas')).status, 400, 'CSV: um por vez')
  assert.equal((await h.api(S.g.token).get('/relatorios/exportar?formato=xlsx')).status, 403)
})

test('inscrição: só serviços de push conhecidos, chaves válidas, uma pessoa por aparelho', async () => {
  const a = h.api(S.o.token)
  for (const e of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost:5432/', 'https://fcm.googleapis.com.evil.com/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8080/x']) {
    assert.equal((await a.post('/push/inscrever', { ...insc(), endpoint: e })).status, 400, e)
  }
  assert.equal((await a.post('/push/inscrever', { ...insc(), chaves: { p256dh: 'abc', auth: 'abc' } })).status, 400)
  const i = insc()
  assert.equal((await a.post('/push/inscrever', i)).status, 201)
  assert.equal((await push.aparelhos('colaborador', S.o.id)).length, 1)
  // o mesmo aparelho com outra pessoa: sai do primeiro
  assert.equal((await h.api(S.g.token).post('/push/inscrever', i)).status, 201)
  assert.equal((await push.aparelhos('colaborador', S.o.id)).length, 0)
  // ninguém remove o aparelho de outro
  await a.post('/push/remover', { endpoint: i.endpoint })
  assert.equal((await push.aparelhos('colaborador', S.g.id)).length, 1)
  await h.api(S.g.token).post('/push/remover', { endpoint: i.endpoint })
  assert.equal((await push.aparelhos('colaborador', S.g.id)).length, 0)
  assert.equal((await h.chamar('POST', '/api/v2/push/inscrever', { corpo: i })).status, 401)
})

test('sair ou ser arquivado para os avisos; 410 do serviço marca o aparelho (não apaga)', async () => {
  const p = await h.criarPessoa(S.E.token, S.u.id, 'Operador', 'Paula Sai')
  const tk = (await h.entrar(p, U1)).corpo.token
  await h.api(tk).post('/push/inscrever', insc())
  assert.equal((await push.aparelhos('colaborador', p.id)).length, 1)
  await h.api(tk).post('/auth/sair')
  assert.equal((await push.aparelhos('colaborador', p.id)).length, 0, 'sessão encerrada')
  const tk2 = (await h.entrar(p, U1)).corpo.token
  const morta = insc()
  await h.api(tk2).post('/push/inscrever', morta)
  falhaCom = 410; await push.paraDono('colaborador', p.id, { titulo: 'x', corpo: 'y' }); falhaCom = null
  assert.equal((await push.aparelhos('colaborador', p.id)).length, 0)
  const volta = await h.api(tk2).post('/push/inscrever', morta)
  assert.equal(volta.status, 409); assert.equal(volta.corpo.refazer, true, 'endereço cancelado não volta: o app refaz')
  assert.equal((await h.db.um('SELECT COUNT(*)::int AS n FROM push_inscricoes WHERE dono_id = $1 AND dono_tipo = $2', [p.id, 'colaborador'])).n, 2, 'nada apagado')
  await h.api(tk2).post('/push/inscrever', insc())
  await h.api(S.E.token).post(`/colaboradores/${p.id}/arquivar`)
  assert.equal((await push.aparelhos('colaborador', p.id)).length, 0, 'arquivada')
})

test('agendamento: antes da hora, repetição, atraso, ação nova e ação vencida, cada um uma vez', async () => {
  // Unidade limpa: desativa as tarefas dos outros testes.
  await h.db.exec('UPDATE tarefas SET ativa = false WHERE unidade_id = $1', [S.u.id])
  await h.api(S.E.token).put(`/unidades/${S.u.id}/notificacoes`, { push: true, antes_min: 15, repetir_min: 15, avisar_atraso: true })
  const io = insc(), ig = insc(), ia = insc()
  await h.api(S.o.token).post('/push/inscrever', io); await h.api(S.g.token).post('/push/inscrever', ig); await h.api(S.E.token).post('/push/inscrever', ia)
  const t = await tarefa({ titulo: 'Abrir a loja', hora_ini: '08:00', tolerancia_min: 10, nf_min: 60 })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(S.dia, '06:00')))
  assert.equal((await rodar(S.dia, '07:44')).length, 0)
  const a = await rodar(S.dia, '07:45')
  assert.equal(a.length, 1); assert.equal(a[0].p, io.endpoint); assert.equal(a[0].titulo, 'Hora da tarefa'); assert.match(a[0].corpo, /Abrir a loja · 08:00 \(em 15 min\)/)
  assert.equal((await rodar(S.dia, '07:46')).length, 0, 'uma vez só')
  // passou da tolerância: gerente e admin (a pessoa já foi avisada no horário)
  const b = await rodar(S.dia, '08:11')
  assert.deepEqual(b.map((x) => x.p).sort(), [ig.endpoint, ia.endpoint].sort())
  assert.match(b[0].corpo, /Abrir a loja · Olga/)
  // repetição a cada 15 min, só para a pessoa; duas rodadas juntas não duplicam
  enviados = []
  const u = await un()
  await Promise.all([1, 2, 3].map(() => notificacoes.avisarUnidade(u, em(S.dia, '08:15'))))
  assert.equal(enviados.length, 1); assert.equal(enviados[0].p, io.endpoint)
  assert.equal((await rodar(S.dia, '08:20')).length, 0)
  assert.equal((await rodar(S.dia, '08:30')).length, 1)
  // vence às 09:00: ação nova para o gerente; prazo da ação (1 h) vencido → admin
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(S.dia, '09:01')))
  const c = await rodar(S.dia, '09:01')
  assert.equal(c.length, 1); assert.equal(c[0].p, ig.endpoint); assert.equal(c[0].titulo, 'Ação para resolver'); assert.equal(c[0].aba, 'acoes')
  const d = await rodar(S.dia, '10:02')
  assert.equal(d.length, 1); assert.equal(d[0].p, ia.endpoint); assert.equal(d[0].titulo, 'Prazo vencido')
  assert.equal((await rodar(S.dia, '10:03')).length, 0)
  void t
})

test('agendamento: tarefa feita, push desligado e servidor parado não geram aviso; vários viram um', async () => {
  await h.db.exec('UPDATE tarefas SET ativa = false WHERE unidade_id = $1', [S.u.id])
  const dia = tempo.somarDias(S.hoje, 5)
  const ts = []
  for (const n of ['A', 'B', 'C', 'D']) ts.push(await tarefa({ titulo: `Tarefa ${n}`, hora_ini: '08:00', tolerancia_min: 10, nf_min: 240 }))
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(dia, '06:00')))
  await h.db.exec(`UPDATE execucoes SET estado = 'feita' WHERE tarefa_id = $1 AND data = $2`, [ts[0], dia])
  await h.api(S.E.token).put(`/unidades/${S.u.id}/notificacoes`, { push: false })
  assert.equal((await rodar(dia, '08:00')).length, 0, 'push desligado na unidade')
  await h.api(S.E.token).put(`/unidades/${S.u.id}/notificacoes`, { push: true, repetir_min: 0 })
  assert.equal((await rodar(dia, '08:00')).length, 3, 'a feita não avisa')
  const at = await rodar(dia, '08:11')
  assert.equal(at.length, 2, 'gerente e admin recebem um aviso cada')
  assert.equal(at[0].titulo, '3 tarefas atrasadas'); assert.match(at[0].corpo, /Tarefa B, Tarefa C, Tarefa D/)
  // servidor parado: horas depois não despeja os avisos antigos
  const dia2 = tempo.somarDias(S.hoje, 6)
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(dia2, '06:00')))
  assert.equal((await rodar(dia2, '11:00')).length, 0)
})

test('resumo das 22 h: admin e gerente, cada um só das suas unidades, uma vez, e cada um desliga o seu', async () => {
  const u2 = await h.criarUnidade(S.E.token, 'U4 dois', -27.1, -52.6)
  const g2 = await h.criarPessoa(S.E.token, u2.id, 'Gerente', 'Guto Dois')
  const o2 = await h.criarPessoa(S.E.token, u2.id, 'Operador', 'Otto Dois')
  g2.token = (await h.entrar(g2)).corpo.token
  for (const u of [S.u, u2]) await h.api(S.E.token).put(`/unidades/${u.id}/notificacoes`, { resumo_whatsapp: true })
  await h.db.exec(`UPDATE admins SET celular = '49999990001' WHERE id = $1`, [S.E.adminId])
  assert.equal((await h.api(S.E.token).post('/tarefas', { titulo: 'Só da dois', unidade_id: u2.id, colaborador_id: o2.id, hora_ini: '08:00', recorrencia: 'diario' })).status, 200)
  const dia = tempo.somarDias(S.hoje, 5), dia2 = tempo.somarDias(S.hoje, 6)
  for (const d of [dia, dia2]) for (const u of [S.u, u2]) await h.db.tx((x) => agenda.processarUnidade(x, u.id, em(d, '06:00')))
  const rodar22 = async (d, hm) => { const a = caixa.length; const n = await notificacoes.resumos(em(d, hm), S.E.id); return { n, l: caixa.slice(a).filter((x) => x.canal === 'whatsapp') } }
  assert.equal((await rodar22(dia, '21:59')).n, 0)
  const r = await rodar22(dia, '22:00')
  const de = (cel) => r.l.filter((x) => x.destino === cel)
  assert.equal(r.n, 3)
  assert.equal(de('49999990001').length, 1, 'admin: uma mensagem só')
  assert.match(de('49999990001')[0].texto, /Tarefa B/); assert.match(de('49999990001')[0].texto, /Só da dois/)
  assert.match(de(S.g.celular)[0].texto, /Tarefa B/); assert.ok(!de(S.g.celular)[0].texto.includes('Só da dois'), 'gerente só vê a unidade dele')
  assert.ok(!de(g2.celular)[0].texto.includes('Tarefa B')); assert.match(de(g2.celular)[0].texto, /Só da dois/)
  assert.ok(!r.l.some((x) => x.texto.includes('Tarefa A')), 'a feita não entra')
  assert.equal((await rodar22(dia, '22:01')).n, 0, 'uma vez')
  // cada um desliga o seu; operador não tem essa opção
  assert.equal((await h.api(S.g.token).get('/eu')).corpo.recebe_resumo, true)
  assert.equal((await h.api(S.g.token).put('/meu-resumo', { receber: false })).status, 200)
  assert.equal((await h.api(S.g.token).get('/eu')).corpo.recebe_resumo, false)
  assert.equal((await h.api(S.E.token).put('/meu-resumo', { receber: false })).status, 200)
  assert.equal((await h.api(S.o.token).put('/meu-resumo', { receber: true })).status, 403)
  assert.equal((await h.api(S.o.token).get('/eu')).corpo.recebe_resumo, null)
  const s2 = await rodar22(dia2, '22:00')
  assert.deepEqual(s2.l.map((x) => x.destino), [g2.celular])
})

// ---- decisão 2: conclusão sem internet e "conferir horário" ------------------
async function deOntem(titulo, campos = {}) {
  const t = await tarefa({ titulo, hora_ini: '08:00', ...campos })
  await h.db.tx((x) => agenda.processarUnidade(x, S.u.id, em(S.ontem, '07:00')))
  return execDe(t, S.ontem)
}
// Envio da fila: feito há `min` minutos, com o relógio do celular adiantado `dif` segundos.
// (O horário da tarefa passa a ser o da conclusão, para o teste valer a qualquer hora do dia.)
async function enviarFila(e, min, dif = 0) {
  const quando = new Date(Date.now() - min * 60000)
  await h.db.exec(`UPDATE execucoes SET data = $2, hora_prevista = $3 WHERE id = $1`, [e.id, tempo.hoje(FUSO, quando), tempo.horaAgora(FUSO, quando)])
  const cel = Date.now() + dif * 1000
  return h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, { chave_envio: crypto.randomUUID(), feita_em: new Date(cel - min * 60000).toISOString(), relogio_celular: new Date(cel).toISOString() })
}
const bonusDe = async () => (await h.api(S.o.token).get(`/bonus/colaboradores/${S.o.id}?de=${tempo.somarDias(S.hoje, -3)}&ate=${S.hoje}`)).corpo

test('sem internet: até 12 h e relógio próximo vale; acima, ou relógio diferente, entra para conferir', async () => {
  assert.equal((await h.api(S.E.token).put(`/colaboradores/${S.o.id}/regra-bonus`, { regra: { tipo: 'tarefa', valor_feita: 5, valor_nao_feita: 1 } })).status, 200)
  await h.db.exec(`UPDATE regras_bonus SET vigente_desde = $2 WHERE colaborador_id = $1 AND tipo = 'tarefa'`, [S.o.id, tempo.somarDias(S.hoje, -4)])
  for (const [min, dif, marca, porque] of [[11 * 60 + 58, 0, false, '11 h 58'], [12 * 60 + 2, 0, true, '12 h 02'], [30, 290, false, 'relógio 4 min 50'], [30, 310, true, 'relógio 5 min 10 adiantado'], [30, -310, true, 'relógio atrasado']]) {
    const r = await enviarFila(await deOntem(`Fila ${porque}`), min, dif)
    assert.equal(r.status, 200, porque + JSON.stringify(r.corpo)); assert.equal(r.corpo.estado, 'feita', porque); assert.equal(r.corpo.conferir_horario, marca, porque)
  }
  // sem dizer o relógio não dá para conferir: marca. E sem feita_em (com internet) nunca marca.
  const e = await deOntem('Sem relógio')
  await h.db.exec(`UPDATE execucoes SET data = $2, hora_prevista = '23:59' WHERE id = $1`, [e.id, S.hoje])
  assert.equal((await h.api(S.o.token).post(`/execucoes/${e.id}/concluir`, { feita_em: new Date(Date.now() - 60000).toISOString() })).corpo.conferir_horario, true)
  const e2 = await deOntem('Com internet')
  await h.db.exec(`UPDATE execucoes SET data = $2, hora_prevista = '23:59' WHERE id = $1`, [e2.id, S.hoje])
  assert.equal((await h.api(S.o.token).post(`/execucoes/${e2.id}/concluir`, { relogio_celular: new Date(Date.now() + 9e6).toISOString() })).corpo.conferir_horario, false)
})

test('conferir horário: fora do bônus e do prazo até aprovar; reabrir devolve; só quem confere, e nunca a própria', async () => {
  const e = await deOntem('Horário a conferir')
  const antes = await bonusDe()
  assert.equal((await enviarFila(e, 13 * 60)).corpo.conferir_horario, true)
  const pend = await bonusDe()
  assert.equal(pend.bruto, antes.bruto, 'não soma'); assert.equal(pend.descontos, antes.descontos, 'nem desconta'); assert.equal(pend.a_conferir, antes.a_conferir + 5)
  const d = (await h.db.um('SELECT data::text AS d FROM execucoes WHERE id = $1', [e.id])).d
  const rel = async () => (await h.api(S.E.token).get(`/relatorios?unidade_id=${S.u.id}&de=${d}&ate=${d}&itens=1`)).corpo.itens.find((x) => x.id === e.id)
  assert.equal((await rel()).atrasada, true, 'não conta no prazo')
  // aparece para o gerente (de qualquer dia), não para o operador nem para outra empresa
  const lista = (await h.api(S.g.token).get(`/execucoes/horarios?unidade_id=${S.u.id}`)).corpo
  assert.ok(lista.some((x) => x.id === e.id && x.horario_conferir === 'tarde'))
  assert.equal((await h.api(S.o.token).get('/execucoes/horarios')).status, 403)
  assert.ok(!(await h.api(S.B.token).get('/execucoes/horarios')).corpo.some((x) => x.id === e.id))
  assert.equal((await h.api(S.B.token).get(`/execucoes/horarios?unidade_id=${S.u.id}`)).status, 404)
  assert.equal((await h.api(S.o.token).post(`/execucoes/${e.id}/conferir`, { decisao: 'aprovar' })).status, 403)
  // aprovar: conta
  assert.equal((await h.api(S.g.token).post(`/execucoes/${e.id}/conferir`, { decisao: 'aprovar' })).status, 200)
  const ok = await bonusDe()
  assert.equal(ok.bruto, antes.bruto + 5); assert.equal(ok.a_conferir, antes.a_conferir)
  assert.ok(!(await h.api(S.g.token).get('/execucoes/horarios')).corpo.some((x) => x.id === e.id))
  // reabrir outra: depois do limite vira não feita e desconta
  const e2 = await deOntem('Horário recusado')
  await enviarFila(e2, 13 * 60)
  await h.db.exec('UPDATE tarefas SET nf_min = 60 WHERE id = $1', [e2.tarefa_id])
  const r = await h.api(S.g.token).post(`/execucoes/${e2.id}/conferir`, { decisao: 'reabrir', motivo: 'Não estava na loja' })
  assert.equal(r.corpo.estado, 'nao_feita')
  assert.equal((await bonusDe()).descontos, ok.descontos + 1)
})
