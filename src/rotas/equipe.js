// Colaboradores, regras de bônus, tarefas (só os executores), pedidos e
// registro de atividades.
const express = require('express')
const db = require('../db')
const v = require('../lib/validar')
const buscar = require('../servicos/buscar')
const { registrar } = require('../lib/registro')
const { gerarPin, hashPin } = require('../lib/segredos')
const { enviar } = require('../lib/envio')
const tempo = require('../lib/tempo')
const { invalido, conflito, proibido, naoEncontrado } = require('../lib/erros')
const { exigir, conferirUnidade, tem, soAdmin } = require('../auth/sessao')
const pedidos = require('../pedidos/servico')
const { conferirNaoConcedeMais } = require('./acessos')

const r = express.Router()

const CAMPOS_PESSOA = `c.id, c.nome, c.celular, c.unidade_principal_id, c.cargo_id, c.perfil_acesso_id, c.situacao,
  c.login_ini, c.login_fim, c.login_tol_min, c.arquivado_em, c.criado_em,
  cg.nome AS cargo_nome, cg.perfil AS cargo_perfil, (c.pin_hash IS NOT NULL) AS tem_pin,
  (SELECT array_agg(cu.unidade_id ORDER BY cu.unidade_id) FROM colaborador_unidades cu WHERE cu.colaborador_id = c.id) AS unidades`

// Lista: Coordenação no topo, Operadores abaixo (§6). Precisa de "ver".
r.get('/colaboradores', async (req, res) => {
  if (!tem(req, 'ver')) throw proibido()
  const unidadeId = v.inteiro(req.query.unidade_id, 'a unidade', { min: 1 })
  if (unidadeId) conferirUnidade(req, unidadeId)
  const situacao = v.umDe(req.query.situacao ?? 'ativo', 'a situação', ['ativo', 'aguardando', 'arquivado', 'todas'])
  const unidades = unidadeId ? [unidadeId] : [...req.acesso.unidades]
  res.json(await db.q(
    `SELECT ${CAMPOS_PESSOA} FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id
     WHERE c.empresa_id = $1 AND c.excluido_em IS NULL AND ($2 = 'todas' OR c.situacao = $2)
       AND EXISTS (SELECT 1 FROM colaborador_unidades cu WHERE cu.colaborador_id = c.id AND cu.unidade_id = ANY($3))
     ORDER BY (cg.perfil = 'coordenador') DESC, c.nome`, [req.ator.empresaId, situacao, unidades]))
})

async function pessoaVisivel(req, id) {
  const p = await db.um(`SELECT ${CAMPOS_PESSOA} FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id
                         WHERE c.id = $1 AND c.empresa_id = $2 AND c.excluido_em IS NULL`, [id, req.ator.empresaId])
  if (!p) throw naoEncontrado()
  if (!req.acesso.admin) {
    if (!(p.unidades || []).some((u) => req.acesso.unidades.has(u))) throw naoEncontrado()
    if (p.id !== req.ator.id && !tem(req, 'ver')) throw naoEncontrado()
  }
  return p
}

r.get('/colaboradores/:id', async (req, res) => {
  res.json(await pessoaVisivel(req, v.id(req.params.id)))
})

// Cadastro. Com "equipe": entra ativo e o PIN aparece uma vez.
// Sem "equipe" (gerente com "ver"): fica aguardando + pedido "cad".
r.post('/colaboradores', async (req, res) => {
  const direto = tem(req, 'equipe')
  if (!direto && !tem(req, 'ver')) throw proibido()
  const b = req.body
  const nome = v.texto(b.nome, 'o nome', { obrigatorio: true, max: 80 })
  const celular = v.celular(b.celular, { obrigatorio: true })
  const unidadeId = v.id(b.unidade_principal_id, 'a unidade')
  const u = await buscar.unidade(db, req.ator.empresaId, unidadeId)
  conferirUnidade(req, u.id)
  if (u.arquivado_em) throw invalido('A unidade está arquivada.')
  let cargo
  if (b.cargo_id) cargo = await buscar.cargo(db, req.ator.empresaId, v.id(b.cargo_id, 'o cargo'))
  else cargo = await db.um(`SELECT * FROM cargos WHERE unidade_id = $1 AND perfil = 'operador' AND padrao AND arquivado_em IS NULL`, [u.id])
  if (!cargo || cargo.unidade_id !== u.id || cargo.arquivado_em) throw invalido('Escolha um cargo desta unidade.')
  const perfilAcessoId = v.inteiro(b.perfil_acesso_id, 'o perfil de acesso', { min: 1 })
  if (perfilAcessoId) await buscar.perfil(db, req.ator.empresaId, perfilAcessoId)
  const outras = [...new Set(v.lista(b.unidades, 'as unidades').map((x) => v.id(x, 'a unidade')))].filter((x) => x !== u.id)
  for (const x of outras) { await buscar.unidade(db, req.ator.empresaId, x); conferirUnidade(req, x) }
  if (direto) await conferirNaoConcedeMais(req, perfilAcessoId || cargo.perfil_acesso_id)

  const dup = await db.um('SELECT 1 FROM colaboradores WHERE empresa_id = $1 AND celular = $2 AND excluido_em IS NULL', [req.ator.empresaId, celular])
  if (dup) throw conflito('Já existe alguém com esse celular na empresa.')
  const lim = await db.um(
    `SELECT pc.max_colaboradores, (SELECT COUNT(*)::int FROM colaboradores WHERE empresa_id = $1 AND situacao <> 'arquivado' AND excluido_em IS NULL) AS ativos
     FROM empresas e LEFT JOIN planos_catalogo pc ON pc.slug = e.plano WHERE e.id = $1`, [req.ator.empresaId])
  if (lim && lim.max_colaboradores !== null && lim.ativos >= lim.max_colaboradores) throw conflito('O plano atual não permite mais pessoas.')

  const pin = direto ? gerarPin() : null
  const out = await db.tx(async (t) => {
    const c = await t.um(
      `INSERT INTO colaboradores (empresa_id, nome, celular, pin_hash, pin_trocado_em, unidade_principal_id, cargo_id, perfil_acesso_id, situacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.ator.empresaId, nome, celular, pin ? await hashPin(pin) : null, pin ? new Date() : null, u.id, cargo.id, perfilAcessoId, direto ? 'ativo' : 'aguardando'])
    for (const x of [u.id, ...outras]) await t.exec('INSERT INTO colaborador_unidades (colaborador_id, unidade_id) VALUES ($1, $2)', [c.id, x])
    await t.exec(`INSERT INTO regras_bonus (colaborador_id, tipo, vigente_desde, criado_por) VALUES ($1, 'depois', $2, $3)`, [c.id, tempo.hoje(u.fuso), req.ator.id])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: direto ? 'colaborador.criado' : 'colaborador.cadastro_pendente', entidade: 'colaborador', entidadeId: c.id, detalhe: { nome, cargo_id: cargo.id } })
    return c
  })

  if (direto) {
    await enviar({ canal: 'whatsapp', destino: celular, assunto: 'Convite VALIDA', texto: `Olá, ${nome}! Seu acesso ao VALIDA está pronto. Entre com este celular e o PIN de 4 números que seu gestor vai te passar.` })
    return res.status(201).json({ colaborador_id: out.id, situacao: 'ativo', pin, aviso: 'O PIN aparece só agora. Anote ou envie para a pessoa.' })
  }
  const pedido = await pedidos.criarPedido(db, req.ator, 'cad', {
    unidadeId: u.id, titulo: `Cadastrar · ${nome}`, detalhe: `${cargo.nome} · ${u.nome}`, payload: { colaborador_id: out.id }
  })
  res.status(202).json({ colaborador_id: out.id, situacao: 'aguardando', pedido, mensagem: 'Enviado para aprovação.' })
})

// Ações que viram pedido quando falta a permissão.
r.put('/colaboradores/:id', (req, res) => pedidos.agirOuPedir(req, res, 'pedit', { ...req.body, colaborador_id: req.params.id }))
r.put('/colaboradores/:id/celular', (req, res) => pedidos.agirOuPedir(req, res, 'cel', { ...req.body, colaborador_id: req.params.id }))
r.post('/colaboradores/:id/pin', (req, res) => pedidos.agirOuPedir(req, res, 'pin', { colaborador_id: req.params.id, motivo: req.body && req.body.motivo }))
r.put('/colaboradores/:id/horario-login', (req, res) => pedidos.agirOuPedir(req, res, 'plhs', { ...req.body, colaborador_id: req.params.id }))
r.post('/colaboradores/:id/arquivar', (req, res) => pedidos.agirOuPedir(req, res, 'arq', { colaborador_id: req.params.id }))
r.post('/colaboradores/:id/restaurar', (req, res) => pedidos.agirOuPedir(req, res, 'rest', { colaborador_id: req.params.id }))
r.delete('/colaboradores/:id', (req, res) => pedidos.agirOuPedir(req, res, 'del', { colaborador_id: req.params.id }))
r.put('/colaboradores/:id/regra-bonus', (req, res) => pedidos.agirOuPedir(req, res, 'rg', { ...req.body, colaborador_id: req.params.id }))

// Mudar o perfil de acesso de alguém: "acesso" (não vira pedido).
r.put('/colaboradores/:id/perfil-acesso', exigir('acesso'), async (req, res) => {
  const p = await pessoaVisivel(req, v.id(req.params.id))
  if (p.id === req.ator.id && req.ator.tipo === 'colaborador') throw proibido('Você não pode mudar o seu próprio acesso.')
  const novo = req.body.perfil_acesso_id === null ? null : v.id(req.body.perfil_acesso_id, 'o perfil de acesso')
  if (novo) await buscar.perfil(db, req.ator.empresaId, novo)
  const efetivo = novo || (await db.um('SELECT perfil_acesso_id FROM cargos WHERE id = $1', [p.cargo_id])).perfil_acesso_id
  await conferirNaoConcedeMais(req, efetivo)
  // Também não pode mexer em quem tem mais do que ele.
  if (!req.acesso.admin) {
    const atual = p.perfil_acesso_id || (await db.um('SELECT perfil_acesso_id FROM cargos WHERE id = $1', [p.cargo_id])).perfil_acesso_id
    await conferirNaoConcedeMais(req, atual)
  }
  await db.tx(async (t) => {
    await t.exec('UPDATE colaboradores SET perfil_acesso_id = $2, atualizado_em = now() WHERE id = $1', [p.id, novo])
    const pf = await t.um('SELECT nome FROM perfis_acesso WHERE id = $1', [efetivo])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: p.unidade_principal_id, ator: req.ator, acao: 'colaborador.acesso_alterado', entidade: 'colaborador', entidadeId: p.id, detalhe: { perfil_acesso_id: novo, nome: p.nome, perfil: pf && pf.nome } })
  })
  res.json({ ok: true })
})

// Regras de bônus (histórico com vigência). "premio" vê a equipe; "own", a própria.
r.get('/colaboradores/:id/regras-bonus', async (req, res) => {
  const p = await pessoaVisivel(req, v.id(req.params.id))
  const propria = req.ator.tipo === 'colaborador' && p.id === req.ator.id
  if (!(propria ? tem(req, 'own') : tem(req, 'premio'))) throw proibido()
  res.json(await db.q('SELECT * FROM regras_bonus WHERE colaborador_id = $1 ORDER BY vigente_desde DESC', [p.id]))
})

// ---- Tarefas (Etapa 1B completa o resto) ------------------------------------
r.get('/tarefas', async (req, res) => {
  const unidadeId = v.id(req.query.unidade_id, 'a unidade')
  conferirUnidade(req, unidadeId)
  const proprias = !tem(req, 'ver')
  // ?desativadas=1 → "Canceladas" (desativadas, ainda não excluídas).
  const desativadas = req.query.desativadas === '1'
  res.json(await db.q(
    `SELECT * FROM tarefas WHERE empresa_id = $1 AND unidade_id = $2 AND arquivado_em IS NULL AND ativa = $5 AND ($3 = false OR colaborador_id = $4)
     ORDER BY hora_ini, id`, [req.ator.empresaId, unidadeId, proprias, req.ator.tipo === 'colaborador' ? req.ator.id : 0, !desativadas]))
})
r.post('/tarefas', (req, res) => pedidos.agirOuPedir(req, res, 'tsave', { campos: req.body }))
r.put('/tarefas/:id', (req, res) => pedidos.agirOuPedir(req, res, 'tsave', { tarefa_id: req.params.id, campos: req.body }))
r.put('/tarefas/:id/horario', (req, res) => pedidos.agirOuPedir(req, res, 'tset', { ...req.body, tarefa_id: req.params.id }))
r.post('/tarefas/:id/desativar', (req, res) => pedidos.agirOuPedir(req, res, 'toff', { tarefa_id: req.params.id }))
r.post('/tarefas/:id/alternar', (req, res) => pedidos.agirOuPedir(req, res, 'ttog', { tarefa_id: req.params.id }))
r.post('/tarefas/:id/duplicar', (req, res) => pedidos.agirOuPedir(req, res, 'tdup', { tarefa_id: req.params.id }))
r.delete('/tarefas/:id', (req, res) => pedidos.agirOuPedir(req, res, 'tdel', { tarefa_id: req.params.id }))

// ---- Pedidos ------------------------------------------------------------------
r.get('/pedidos', async (req, res) => {
  const estado = v.umDe(req.query.estado, 'o estado', ['pend', 'ok', 'no'])
  res.json(await pedidos.listar(req, { meus: req.query.meus === '1', estado }))
})
r.post('/pedidos/:id/aprovar', async (req, res) => {
  res.json(await pedidos.decidir(req, v.id(req.params.id), true))
})
r.post('/pedidos/:id/negar', async (req, res) => {
  res.json(await pedidos.decidir(req, v.id(req.params.id), false, v.texto(req.body.motivo, 'o motivo', { max: 300 })))
})
r.get('/pedidos/:id/pin', async (req, res) => {
  res.json(await pedidos.revelarPin(req, v.id(req.params.id)))
})

// ---- Acesso de suporte em andamento (Aprovações, §9/§20) ---------------------
r.get('/suporte/ativos', soAdmin, async (req, res) => {
  res.json(await db.q(
    `SELECT id, motivo, inicio, fim FROM acessos_suporte
     WHERE empresa_id = $1 AND inicio IS NOT NULL AND encerrado_em IS NULL AND fim > $2 ORDER BY fim`, [req.ator.empresaId, tempo.agora()]))
})
r.post('/suporte/:id/encerrar', soAdmin, async (req, res) => {
  const id = v.id(req.params.id)
  await db.tx(async (t) => {
    const n = await t.exec(
      `UPDATE acessos_suporte SET encerrado_em = now(), fim = LEAST(fim, now())
       WHERE id = $1 AND empresa_id = $2 AND inicio IS NOT NULL AND encerrado_em IS NULL`, [id, req.ator.empresaId])
    if (!n) throw naoEncontrado()
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'suporte.encerrado', entidade: 'acesso_suporte', entidadeId: id })
  })
  res.json({ ok: true })
})

// ---- Registro de atividades ("log") -----------------------------------------
r.get('/registro-atividades', exigir('log'), async (req, res) => {
  const unidadeId = v.inteiro(req.query.unidade_id, 'a unidade', { min: 1 })
  if (unidadeId) conferirUnidade(req, unidadeId)
  const acao = v.texto(req.query.acao, 'a ação', { max: 60 })
  const unidades = req.acesso.admin && !unidadeId ? null : unidadeId ? [unidadeId] : [...req.acesso.unidades]
  res.json(await db.q(
    `SELECT id, unidade_id, quem_tipo, quem_id, quem_nome, acao, entidade, entidade_id, detalhe, em FROM registro_atividades
     WHERE empresa_id = $1 AND ($2::bigint[] IS NULL OR unidade_id = ANY($2)) AND ($3::text IS NULL OR acao LIKE $3 || '%')
     ORDER BY id DESC LIMIT 300`, [req.ator.empresaId, unidades, acao]))   // na ordem em que foi registrado (logInner da v45)
})

module.exports = r
