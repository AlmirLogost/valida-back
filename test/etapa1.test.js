// Testes da Etapa 1 (roteiro item 9) + segurança. Rodam no valida_ensaio.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./ajuda')
const { caixa } = require('../src/lib/envio')

// Coordenadas de teste (unidades fictícias).
const A1 = { lat: -26.849, lng: -52.991 }
const A2 = { lat: -27.100, lng: -52.620 }
const B1 = { lat: -26.700, lng: -53.000 }
const longe = (p) => ({ lat: p.lat + 0.05, lng: p.lng })   // ~5,5 km

const S = {}

before(async () => {
  await h.subir()
  S.A = await h.criarEmpresa('Empresa A')
  S.B = await h.criarEmpresa('Empresa B')
  S.uA1 = await h.criarUnidade(S.A.token, 'A1 Centro', A1.lat, A1.lng)
  S.uA2 = await h.criarUnidade(S.A.token, 'A2 Shopping', A2.lat, A2.lng)
  S.uB1 = await h.criarUnidade(S.B.token, 'B1 Matriz', B1.lat, B1.lng)
  S.gerente = await h.criarPessoa(S.A.token, S.uA1.id, 'Gerente', 'Gerente A1')
  S.op = await h.criarPessoa(S.A.token, S.uA1.id, 'Operador', 'Operador A1')
  S.op2 = await h.criarPessoa(S.A.token, S.uA1.id, 'Operador', 'Operador A1 dois')
  S.opA2 = await h.criarPessoa(S.A.token, S.uA2.id, 'Operador', 'Operador A2')
  S.opB = await h.criarPessoa(S.B.token, S.uB1.id, 'Operador', 'Operador B1')
  const g = await h.entrar(S.gerente)  // Gerente tem "dispensa": entra sem localização
  assert.equal(g.status, 200, JSON.stringify(g.corpo))
  S.gerente.token = g.corpo.token
  const o = await h.entrar(S.op, A1)
  assert.equal(o.status, 200, JSON.stringify(o.corpo))
  S.op.token = o.corpo.token
})

after(async () => { await h.descer() })

test('empresa A nunca vê a empresa B, nem por ID', async () => {
  const a = h.api(S.A.token)
  assert.equal((await a.get(`/colaboradores/${S.op.id}`)).status, 200, 'controle: a própria empresa vê')
  assert.equal((await a.get(`/unidades/${S.uB1.id}`)).status, 404)
  assert.equal((await a.get(`/unidades/${S.uB1.id}/cargos`)).status, 404)
  assert.equal((await a.get(`/colaboradores/${S.opB.id}`)).status, 404)
  assert.equal((await a.put(`/colaboradores/${S.opB.id}`, { nome: 'X' })).status, 404)
  assert.equal((await a.post(`/colaboradores/${S.opB.id}/arquivar`)).status, 404)
  assert.equal((await a.post(`/colaboradores/${S.opB.id}/pin`)).status, 404)
  const lista = (await a.get('/unidades')).corpo.map((u) => u.id)
  assert.ok(!lista.includes(S.uB1.id))
  const pessoas = (await a.get('/colaboradores?situacao=todas')).corpo.map((p) => p.id)
  assert.ok(!pessoas.includes(S.opB.id))
  // Pedido da empresa B também é invisível para A.
  const pb = await h.db.um(`INSERT INTO pedidos (empresa_id, solicitante_tipo, solicitante_id, tipo, titulo, payload)
                            VALUES ($1, 'colaborador', $2, 'arq', 'teste', '{}') RETURNING id`, [S.B.id, S.opB.id])
  assert.equal((await a.post(`/pedidos/${pb.id}/aprovar`)).status, 404)
})

test('gerente da unidade A1 não vê a unidade A2', async () => {
  const g = h.api(S.gerente.token)
  // Vê o que é da unidade dele…
  assert.equal((await g.get(`/unidades/${S.uA1.id}`)).status, 200)
  assert.equal((await g.get(`/colaboradores/${S.op.id}`)).status, 200)
  assert.equal((await g.get(`/tarefas?unidade_id=${S.uA1.id}`)).status, 200)
  // …e nada da outra.
  assert.equal((await g.get(`/unidades/${S.uA2.id}`)).status, 404)
  assert.equal((await g.get(`/colaboradores/${S.opA2.id}`)).status, 404)
  assert.equal((await g.get(`/colaboradores?unidade_id=${S.uA2.id}`)).status, 404)
  assert.equal((await g.get(`/tarefas?unidade_id=${S.uA2.id}`)).status, 404)
  const pessoas = (await g.get('/colaboradores')).corpo.map((p) => p.id)
  assert.ok(pessoas.includes(S.op.id))
  assert.ok(!pessoas.includes(S.opA2.id))
})

test('operador não cria unidade (403)', async () => {
  const r = await h.api(S.op.token).post('/unidades', { nome: 'Nova' })
  assert.equal(r.status, 403)
  assert.match(r.corpo.erro, /permissão|admin/)
})

test('gerente sem "tedit" gera pedido; o admin aprova e a tarefa muda', async () => {
  const criada = await h.api(S.A.token).post('/tarefas', {
    titulo: 'Conferir temperatura', unidade_id: S.uA1.id, colaborador_id: S.op.id, recorrencia: 'diario', hora_ini: '09:00', hora_fim: '09:30'
  })
  assert.equal(criada.status, 200, JSON.stringify(criada.corpo))
  const tarefaId = criada.corpo.resultado.tarefa_id

  const pedido = await h.api(S.gerente.token).put(`/tarefas/${tarefaId}/horario`, { hora_ini: '10:30', hora_fim: '11:00' })
  assert.equal(pedido.status, 202, JSON.stringify(pedido.corpo))
  assert.equal(pedido.corpo.pedido.tipo, 'tset')
  let t = await h.db.um('SELECT hora_ini FROM tarefas WHERE id = $1', [tarefaId])
  assert.equal(t.hora_ini.slice(0, 5), '09:00', 'antes de aprovar não muda')

  // Gerente não aprova pedido que não é "lib".
  assert.equal((await h.api(S.gerente.token).post(`/pedidos/${pedido.corpo.pedido.id}/aprovar`)).status, 404)

  const pend = await h.api(S.A.token).get('/pedidos?estado=pend')
  assert.ok(pend.corpo.some((p) => p.id === pedido.corpo.pedido.id))
  const ok = await h.api(S.A.token).post(`/pedidos/${pedido.corpo.pedido.id}/aprovar`)
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo))
  t = await h.db.um('SELECT hora_ini, hora_fim FROM tarefas WHERE id = $1', [tarefaId])
  assert.equal(t.hora_ini.slice(0, 5), '10:30')
  assert.equal(t.hora_fim.slice(0, 5), '11:00')
  // Já decidido não decide de novo.
  assert.equal((await h.api(S.A.token).post(`/pedidos/${pedido.corpo.pedido.id}/aprovar`)).status, 409)

  // Editar a tarefa inteira também vira pedido (tsave), e duplicar (tdup).
  const ed = await h.api(S.gerente.token).put(`/tarefas/${tarefaId}`, { titulo: 'Conferir temperatura da câmara' })
  assert.equal(ed.status, 202)
  assert.equal(ed.corpo.pedido.tipo, 'tsave')
  await h.api(S.A.token).post(`/pedidos/${ed.corpo.pedido.id}/aprovar`)
  assert.equal((await h.db.um('SELECT titulo FROM tarefas WHERE id = $1', [tarefaId])).titulo, 'Conferir temperatura da câmara')
  const dup = await h.api(S.gerente.token).post(`/tarefas/${tarefaId}/duplicar`)
  assert.equal(dup.corpo.pedido.tipo, 'tdup')
  const dupOk = await h.api(S.A.token).post(`/pedidos/${dup.corpo.pedido.id}/aprovar`)
  const copia = await h.db.um('SELECT titulo FROM tarefas WHERE id = $1', [dupOk.corpo.resultado.tarefa_id])
  assert.match(copia.titulo, /\(cópia\)$/)
  S.tarefaId = tarefaId
})

test('pedido "pin": gera PIN novo, o antigo deixa de valer e o PIN aparece uma vez', async () => {
  const sessaoAntiga = (await h.entrar(S.op2, A1)).corpo.token
  const p = await h.api(S.gerente.token).post(`/colaboradores/${S.op2.id}/pin`)
  assert.equal(p.status, 202, JSON.stringify(p.corpo))
  const ok = await h.api(S.A.token).post(`/pedidos/${p.corpo.pedido.id}/aprovar`)
  assert.equal(ok.status, 200)
  const novo = ok.corpo.resultado.pin
  assert.match(novo, /^\d{4}$/)

  const antigo = S.op2.pin
  if (antigo !== novo) assert.equal((await h.entrar(S.op2, A1)).status, 401, 'o PIN antigo não vale mais')
  S.op2.pin = novo
  assert.equal((await h.entrar(S.op2, A1)).status, 200, 'o PIN novo vale')
  assert.equal((await h.api(sessaoAntiga).get('/eu')).status, 401, 'a sessão antiga cai')

  // Quem pediu vê o PIN uma vez.
  const v1 = await h.api(S.gerente.token).get(`/pedidos/${p.corpo.pedido.id}/pin`)
  assert.equal(v1.status, 200)
  assert.equal(v1.corpo.pin, novo)
  assert.equal((await h.api(S.gerente.token).get(`/pedidos/${p.corpo.pedido.id}/pin`)).status, 404)

  // O PIN não fica em claro no pedido nem no registro de atividades.
  const ped = await h.db.um('SELECT resultado::text AS r FROM pedidos WHERE id = $1', [p.corpo.pedido.id])
  assert.ok(!ped.r.includes('"pin"'))
  const reg = await h.db.q(`SELECT detalhe::text AS d FROM registro_atividades WHERE empresa_id = $1 AND detalhe IS NOT NULL`, [S.A.id])
  assert.ok(reg.length > 0)
  // Nenhum campo de segredo (o nome do tipo "pin" pode aparecer como valor).
  assert.ok(reg.every((x) => !/"(pin|pin_cifrado|pin_hash|senha|token)"\s*:/.test(x.d)))
  assert.ok(reg.every((x) => !x.d.includes(`"${novo}"`)))
})

test('login fora do raio cria "lib" e a liberação vale uma vez', async () => {
  const fora = await h.entrar(S.op, longe(A1))
  assert.equal(fora.status, 403)
  assert.equal(fora.corpo.estado, 'fora_do_local')

  const pede = await h.entrar(S.op, { ...longe(A1), pedir_liberacao: 'cheguei_antes' })
  assert.equal(pede.status, 202, JSON.stringify(pede.corpo))
  assert.equal(pede.corpo.estado, 'aguardando_liberacao')

  // O gerente (tem "lib") libera.
  const lib = await h.api(S.gerente.token).post(`/pedidos/${pede.corpo.pedido_id}/aprovar`)
  assert.equal(lib.status, 200, JSON.stringify(lib.corpo))

  const liberado = await h.entrar(S.op, longe(A1))
  assert.equal(liberado.status, 200, JSON.stringify(liberado.corpo))
  assert.equal(liberado.corpo.estado, 'liberado')
  const reg = await h.db.um('SELECT liberado_por_pedido_id FROM logins WHERE colaborador_id = $1 ORDER BY id DESC LIMIT 1', [S.op.id])
  assert.equal(Number(reg.liberado_por_pedido_id), pede.corpo.pedido_id)

  const deNovo = await h.entrar(S.op, longe(A1))
  assert.equal(deNovo.status, 403, 'a liberação valeu só uma vez')

  // No local entra normalmente; sem localização, pede.
  assert.equal((await h.entrar(S.op, A1)).status, 200)
  assert.equal((await h.entrar(S.op)).corpo.estado, 'localizacao_necessaria')
})

test('PIN errado várias vezes bloqueia (até com o PIN certo)', async () => {
  const p = await h.criarPessoa(S.A.token, S.uA1.id, 'Operador', 'Pessoa Bloqueio')
  const errado = p.pin === '0000' ? '1111' : '0000'
  for (let i = 0; i < 5; i++) {
    const r = await h.entrar({ ...p, pin: errado }, A1)
    assert.equal(r.status, 401, `tentativa ${i + 1}`)
  }
  const certo = await h.entrar(p, A1)
  assert.equal(certo.status, 429)
  assert.match(certo.corpo.erro, /Muitas tentativas/)
  // Fica no banco (não em memória).
  const n = await h.db.um(`SELECT COUNT(*)::int AS n FROM login_tentativas WHERE bloqueado_ate > now()`)
  assert.ok(n.n >= 1)
})

test('perfil sem pessoas pode ser excluído; com pessoas, não', async () => {
  const a = h.api(S.A.token)
  const livre = await a.post('/perfis', { nome: 'Perfil livre', modelo: 'operador' })
  assert.equal(livre.status, 201)
  assert.equal((await a.del(`/perfis/${livre.corpo.id}`)).status, 200)

  const usado = await a.post('/perfis', { nome: 'Perfil usado', modelo: 'operador' })
  assert.equal((await a.put(`/colaboradores/${S.op2.id}/perfil-acesso`, { perfil_acesso_id: usado.corpo.id })).status, 200)
  const r = await a.del(`/perfis/${usado.corpo.id}`)
  assert.equal(r.status, 409)
  assert.equal(r.corpo.pessoas, 1)

  // Perfil fixo nunca é excluído.
  const fixo = (await a.get('/perfis')).corpo.find((p) => p.fixo)
  assert.equal((await a.del(`/perfis/${fixo.id}`)).status, 409)
  // Dependências: ligar "conf" liga "ver"; sem "faz", "foto" sai.
  const dep = await a.post('/perfis', { nome: 'Dep', permissoes: { conf: true, foto: true } })
  assert.equal(dep.corpo.permissoes.ver, true)
  assert.equal(dep.corpo.permissoes.foto, false)
})

test('cargo: não deixa arquivar o último de cada perfil', async () => {
  const u = await h.criarUnidade(S.A.token, 'A3 Cargos', -26.5, -52.5)
  const a = h.api(S.A.token)
  const cargos = (await a.get(`/unidades/${u.id}/cargos`)).corpo
  const por = (n) => cargos.find((c) => c.nome === n)
  assert.equal((await a.post(`/cargos/${por('Cozinha').id}/arquivar`)).status, 200)
  const ultimoOp = await a.post(`/cargos/${por('Operador').id}/arquivar`)
  assert.equal(ultimoOp.status, 409)
  assert.match(ultimoOp.corpo.erro, /ao menos um cargo de Operador/)
  assert.equal((await a.post(`/cargos/${por('Gerente').id}/arquivar`)).status, 200)
  assert.equal((await a.post(`/cargos/${por('Líder').id}/arquivar`)).status, 409)
  // Cargo com pessoas também não arquiva.
  const opA1 = await h.cargoDe(S.A.token, S.uA1.id, 'Operador')
  assert.equal((await a.post(`/cargos/${opA1.id}/arquivar`)).status, 409)
})

test('admin não pode ser rebaixado nem perde acesso', async () => {
  const a = h.api(S.A.token)
  // Mesmo um colaborador com "Tudo liberado" não mexe em perfis nem no admin.
  const tudo = await a.post('/perfis', { nome: 'Tudo', modelo: 'tudo' })
  const p = await h.criarPessoa(S.A.token, S.uA1.id, 'Líder', 'Líder tudo', { perfil_acesso_id: tudo.corpo.id })
  const tk = (await h.entrar(p)).corpo.token
  const x = h.api(tk)
  const tentativa = await x.put(`/perfis/${tudo.corpo.id}`, { permissoes: {} })
  assert.equal(tentativa.status, 403, JSON.stringify(tentativa.corpo))
  assert.equal((await x.post('/unidades', { nome: 'X' })).status, 403)
  // Ninguém se dá acesso maior nem muda o próprio.
  assert.equal((await x.put(`/colaboradores/${p.id}/perfil-acesso`, { perfil_acesso_id: tudo.corpo.id })).status, 403)
  // O admin não é colaborador: não há rota que o arquive ou troque o perfil.
  const ehColab = await h.db.um('SELECT 1 FROM colaboradores WHERE id = $1 AND empresa_id = $2', [S.A.adminId, S.A.id])
  if (!ehColab) {
    assert.equal((await x.post(`/colaboradores/${S.A.adminId}/arquivar`)).status, 404)
    assert.equal((await x.put(`/colaboradores/${S.A.adminId}/perfil-acesso`, { perfil_acesso_id: tudo.corpo.id })).status, 404)
  }
  // Zerar todos os perfis não tira nada do admin.
  for (const pf of (await a.get('/perfis')).corpo) await a.put(`/perfis/${pf.id}`, { permissoes: pf.permissoes })
  const eu = await a.get('/eu')
  assert.equal(eu.corpo.perfil, 'admin')
  assert.equal(eu.corpo.permissoes.length, 33)
})

test('gerente sem "equipe": cadastro fica aguardando; aprovar ativa e gera PIN; negar arquiva', async () => {
  const cargo = await h.cargoDe(S.A.token, S.uA1.id, 'Operador')
  const cad = await h.api(S.gerente.token).post('/colaboradores', { nome: 'Novo pelo gerente', celular: h.celular(), unidade_principal_id: S.uA1.id, cargo_id: cargo.id })
  assert.equal(cad.status, 202, JSON.stringify(cad.corpo))
  assert.equal(cad.corpo.situacao, 'aguardando')
  const ok = await h.api(S.A.token).post(`/pedidos/${cad.corpo.pedido.id}/aprovar`)
  assert.match(ok.corpo.resultado.pin, /^\d{4}$/)
  assert.equal((await h.db.um('SELECT situacao FROM colaboradores WHERE id = $1', [cad.corpo.colaborador_id])).situacao, 'ativo')

  const cad2 = await h.api(S.gerente.token).post('/colaboradores', { nome: 'Negado', celular: h.celular(), unidade_principal_id: S.uA1.id, cargo_id: cargo.id })
  await h.api(S.A.token).post(`/pedidos/${cad2.corpo.pedido.id}/negar`, { motivo: 'teste' })
  assert.equal((await h.db.um('SELECT situacao FROM colaboradores WHERE id = $1', [cad2.corpo.colaborador_id])).situacao, 'arquivado')
})

test('arquivar derruba a sessão; excluir só arquivado e o histórico fica', async () => {
  const p = await h.criarPessoa(S.A.token, S.uA1.id, 'Operador', 'Para arquivar')
  const tk = (await h.entrar(p, A1)).corpo.token
  const a = h.api(S.A.token)
  assert.equal((await a.del(`/colaboradores/${p.id}`)).status, 409, 'só exclui arquivado')
  assert.equal((await a.post(`/colaboradores/${p.id}/arquivar`)).status, 200)
  assert.equal((await h.api(tk).get('/eu')).status, 401)
  assert.equal((await a.del(`/colaboradores/${p.id}`)).status, 200)
  const linha = await h.db.um('SELECT excluido_em, celular, pin_hash FROM colaboradores WHERE id = $1', [p.id])
  assert.ok(linha.excluido_em, 'a linha continua (histórico)')
  assert.equal(linha.celular, null)
  assert.equal(linha.pin_hash, null)
})

test('regra de bônus com vigência e unidade: horário, abrir/fechar e dias fechados', async () => {
  const a = h.api(S.A.token)
  const rg = await a.put(`/colaboradores/${S.op.id}/regra-bonus`, { regra: { tipo: 'tarefa', valor_feita: 2, valor_nao_feita: 1 } })
  assert.equal(rg.status, 200, JSON.stringify(rg.corpo))
  const regras = (await a.get(`/colaboradores/${S.op.id}/regras-bonus`)).corpo
  assert.equal(regras[0].tipo, 'tarefa')
  // Gerente sem "regra" → pedido.
  assert.equal((await h.api(S.gerente.token).put(`/colaboradores/${S.op.id}/regra-bonus`, { regra: null })).status, 202)

  const hor = await a.put(`/unidades/${S.uA1.id}/horario`, { semana: [{ dia_semana: 1, ativo: true, turnos: [{ abre: '08:00', fecha: '12:00' }, { abre: '13:00', fecha: '18:00' }] }], raio_m: 150 })
  assert.equal(hor.status, 200, JSON.stringify(hor.corpo))
  const u = (await a.get(`/unidades/${S.uA1.id}`)).corpo
  assert.equal(u.semana[1].turnos.length, 2)
  assert.equal(u.raio_m, 150)
  assert.equal((await a.put(`/unidades/${S.uA1.id}/horario`, { semana: [{ dia_semana: 2, ativo: true, turnos: [{ abre: '08:00', fecha: '12:00' }, { abre: '11:00', fecha: '13:00' }] }] })).status, 400)

  // Gerente sem "abre" → pedido gutog; com aprovação fecha.
  const g = await h.api(S.gerente.token).post(`/unidades/${S.uA1.id}/aberta`, { aberta: false })
  assert.equal(g.status, 202)
  await a.post(`/pedidos/${g.corpo.pedido.id}/aprovar`)
  assert.equal((await a.get(`/unidades/${S.uA1.id}`)).corpo.aberta_hoje, false)

  const dia = await a.post('/dias-fechados', { data: '2031-12-24', motivo: 'Reforma', unidades: [S.uA1.id] })
  assert.equal(dia.status, 200)
  const fer = await a.post('/dias-fechados/feriados', { todas_unidades: true })
  assert.ok(fer.corpo.resultado.criados >= 9)
  const lista = (await a.get(`/dias-fechados?unidade_id=${S.uA1.id}`)).corpo
  assert.ok(lista.some((d) => d.motivo === 'Reforma'))
  assert.ok(lista.some((d) => d.todas_unidades))
})

test('segurança: rotas antigas, webhook, CORS, JSON grande, esqueci a senha', async () => {
  assert.equal((await h.chamar('POST', '/api/webhooks/asaas', { corpo: {} })).status, 404)
  assert.equal((await h.chamar('GET', '/api/checklists')).status, 410)
  const antigo = await h.chamar('POST', '/api/login', { corpo: { email: S.A.email, senha: S.A.senha } })
  assert.equal(antigo.status, 200, 'login antigo do admin continua respondendo')

  const outra = await h.chamar('GET', '/api/v2/eu', { cabecalhos: { origin: 'http://outro.site' } })
  assert.equal(outra.headers.get('access-control-allow-origin'), null)
  const front = await h.chamar('GET', '/api/v2/eu', { cabecalhos: { origin: 'http://front.teste' } })
  assert.equal(front.headers.get('access-control-allow-origin'), 'http://front.teste')

  const grande = await h.chamar('POST', '/api/v2/auth/admin/entrar', { corpo: { email: 'a@b.c', senha: 'x'.repeat(200000) } })
  assert.equal(grande.status, 413)

  // Esqueci a senha: o token vai pelo envio simulado e no banco só fica o hash.
  assert.equal((await h.chamar('POST', '/api/v2/auth/admin/esqueci', { corpo: { email: S.B.email } })).status, 200)
  const msg = caixa.filter((m) => m.destino === S.B.email).pop()
  const token = /token=([\w-]+)/.exec(msg.texto)[1]
  const guardado = await h.db.um('SELECT token_hash FROM senha_tokens WHERE admin_id = $1 ORDER BY id DESC LIMIT 1', [S.B.adminId])
  assert.notEqual(guardado.token_hash, token)
  const nova = 'senha-nova-' + Date.now()
  assert.equal((await h.chamar('POST', '/api/v2/auth/admin/redefinir', { corpo: { token, senha: nova } })).status, 200)
  assert.equal((await h.chamar('POST', '/api/v2/auth/admin/redefinir', { corpo: { token, senha: nova } })).status, 400, 'uso único')
  assert.equal((await h.api(S.B.token).get('/eu')).status, 401, 'sessão antiga cai ao trocar a senha')
  assert.equal((await h.chamar('POST', '/api/v2/auth/admin/entrar', { corpo: { email: S.B.email, senha: nova } })).status, 200)

  // Registro de atividades existe e só o admin (ou "log") lê.
  assert.equal((await h.api(S.op.token).get('/registro-atividades')).status, 403)
  const reg = await h.api(S.A.token).get('/registro-atividades')
  assert.ok(reg.corpo.length > 10)
})

test('horário de login: fora da janela não entra; livre volta a entrar', async () => {
  const tempo = require('../src/lib/tempo')
  const agora = tempo.horaAgora('America/Sao_Paulo')
  const janela = agora < '12:00' ? { login_ini: '20:00', login_fim: '23:00' } : { login_ini: '01:00', login_fim: '04:00' }
  const a = h.api(S.A.token)
  assert.equal((await a.put(`/colaboradores/${S.op2.id}/horario-login`, { ...janela, login_tol_min: 10 })).status, 200)
  const r = await h.entrar(S.op2, A1)
  assert.equal(r.status, 403)
  assert.equal(r.corpo.estado, 'fora_do_horario')
  assert.equal((await a.put(`/colaboradores/${S.op2.id}/horario-login`, { livre: true })).status, 200)
  assert.equal((await h.entrar(S.op2, A1)).status, 200)
})

test('dados migrados do legado respondem nas rotas novas', async () => {
  const { assinar } = require('../src/auth/sessao')
  const adm = await h.db.um(`SELECT a.id, a.empresa_id, a.token_versao FROM admins a JOIN empresas e ON e.id = a.empresa_id
                             WHERE e.legado_admin_id IS NOT NULL ORDER BY a.id LIMIT 1`)
  if (!adm) return // banco sem dados antigos
  const tk = assinar({ tipo: 'admin', id: adm.id, empresaId: adm.empresa_id, tokenVersao: adm.token_versao })
  const a = h.api(tk)
  const us = await a.get('/unidades')
  assert.equal(us.status, 200)
  for (const caminho of ['/colaboradores?situacao=todas', '/perfis', '/pedidos', '/registro-atividades', '/dias-fechados', '/eu']) {
    const r = await a.get(caminho)
    assert.equal(r.status, 200, `${caminho}: ${JSON.stringify(r.corpo).slice(0, 200)}`)
  }
  for (const u of us.corpo) {
    assert.equal((await a.get(`/unidades/${u.id}/cargos`)).status, 200)
    assert.equal((await a.get(`/tarefas?unidade_id=${u.id}`)).status, 200)
  }
  // Um colaborador migrado também carrega o acesso (cargo + perfil).
  const c = await h.db.um(`SELECT c.id, c.empresa_id, c.token_versao FROM colaboradores c WHERE c.legado_usuario_id IS NOT NULL AND c.situacao = 'ativo' LIMIT 1`)
  if (c) {
    const tc = assinar({ tipo: 'colaborador', id: c.id, empresaId: c.empresa_id, tokenVersao: c.token_versao })
    const eu = await h.api(tc).get('/eu')
    assert.equal(eu.status, 200)
    assert.ok(eu.corpo.permissoes.includes('faz'))
  }
})
