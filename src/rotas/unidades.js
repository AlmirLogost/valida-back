// Unidades e dias fechados (roteiro item 8, §4, §5).
const express = require('express')
const db = require('../db')
const v = require('../lib/validar')
const buscar = require('../servicos/buscar')
const { criarCargosPadrao } = require('../servicos/padroes')
const servUnid = require('../servicos/unidades')
const { registrar } = require('../lib/registro')
const tempo = require('../lib/tempo')
const { proibido, conflito } = require('../lib/erros')
const { soAdmin, conferirUnidade, tem } = require('../auth/sessao')
const { agirOuPedir } = require('../pedidos/servico')

const r = express.Router()

async function comTurnos(u) {
  const turnos = await db.q('SELECT dia_semana, ativo, ordem, abre, fecha FROM unidade_turnos WHERE unidade_id = $1 ORDER BY dia_semana, ordem', [u.id])
  const semana = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const t = turnos.filter((x) => x.dia_semana === d)
    return { dia_semana: d, ativo: t.some((x) => x.ativo), turnos: t.filter((x) => x.ativo).map((x) => ({ abre: x.abre.slice(0, 5), fecha: x.fecha.slice(0, 5) })) }
  })
  // "Aberta hoje" só vale para o dia em que foi marcado; noutro dia, aberta.
  const hojeLocal = tempo.hoje(u.fuso)
  const abertaHoje = u.aberta_hoje_data === hojeLocal ? u.aberta_hoje : true
  return { ...u, aberta_hoje: abertaHoje, semana }
}

async function limiteDoPlano(empresaId) {
  return db.um(
    `SELECT pc.max_unidades, (SELECT COUNT(*) FROM unidades WHERE empresa_id = $1 AND arquivado_em IS NULL) AS ativas
     FROM empresas e LEFT JOIN planos_catalogo pc ON pc.slug = e.plano WHERE e.id = $1`, [empresaId])
}

r.get('/unidades', async (req, res) => {
  const arquivadas = req.query.arquivadas === '1'
  if (arquivadas && !req.acesso.admin) throw proibido()
  const us = await db.q(
    `SELECT * FROM unidades WHERE empresa_id = $1 AND id = ANY($2) AND (arquivado_em IS ${arquivadas ? 'NOT' : ''} NULL) ORDER BY nome`,
    [req.ator.empresaId, [...req.acesso.unidades]])
  res.json(await Promise.all(us.map(comTurnos)))
})

r.get('/unidades/:id', async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, u.id)
  res.json(await comTurnos(u))
})

r.post('/unidades', soAdmin, async (req, res) => {
  const b = req.body
  const dados = {
    nome: v.texto(b.nome, 'o nome', { obrigatorio: true, max: 80 }),
    cidade: v.texto(b.cidade, 'a cidade', { max: 80 }),
    uf: v.texto(b.uf, 'a UF', { max: 2 }),
    endereco: v.texto(b.endereco, 'o endereço', { max: 200 }),
    telefone: v.texto(b.telefone, 'o telefone', { max: 20 })
  }
  const local = servUnid.validarLocal(b)
  const semana = b.semana ? servUnid.validarSemana(b.semana) : []
  const baseId = v.inteiro(b.unidade_base_id, 'a unidade base', { min: 1 })
  if (baseId) await buscar.unidade(db, req.ator.empresaId, baseId)
  const lim = await limiteDoPlano(req.ator.empresaId)
  if (lim && lim.max_unidades !== null && lim.ativas >= lim.max_unidades) throw conflito('O plano atual não permite mais unidades.')

  const u = await db.tx(async (t) => {
    const nova = await t.um(
      `INSERT INTO unidades (empresa_id, nome, cidade, uf, endereco, telefone, lat, lng, raio_m)
       VALUES ($1, $2, $3, upper($4), $5, $6, $7, $8, COALESCE($9, (SELECT (config->>'raio_padrao_m')::int FROM empresas WHERE id = $1), 100))
       RETURNING *`,
      [req.ator.empresaId, dados.nome, dados.cidade, dados.uf, dados.endereco, dados.telefone, local.lat ?? null, local.lng ?? null, local.raio_m ?? null])
    await criarCargosPadrao(t, req.ator.empresaId, nova.id, baseId)
    if (semana.length) await servUnid.gravarDias(t, nova.id, semana)
    await t.exec('INSERT INTO config_notificacoes (unidade_id) VALUES ($1)', [nova.id])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: nova.id, ator: req.ator, acao: 'unidade.criada', entidade: 'unidade', entidadeId: nova.id, detalhe: dados })
    return nova
  })
  res.status(201).json(await comTurnos(u))
})

r.put('/unidades/:id', soAdmin, async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  const b = req.body
  const d = {
    nome: 'nome' in b ? v.texto(b.nome, 'o nome', { obrigatorio: true, max: 80 }) : u.nome,
    cidade: 'cidade' in b ? v.texto(b.cidade, 'a cidade', { max: 80 }) : u.cidade,
    uf: 'uf' in b ? v.texto(b.uf, 'a UF', { max: 2 }) : u.uf,
    endereco: 'endereco' in b ? v.texto(b.endereco, 'o endereço', { max: 200 }) : u.endereco,
    telefone: 'telefone' in b ? v.texto(b.telefone, 'o telefone', { max: 20 }) : u.telefone
  }
  await db.tx(async (t) => {
    await t.exec('UPDATE unidades SET nome = $3, cidade = $4, uf = upper($5), endereco = $6, telefone = $7, atualizado_em = now() WHERE id = $1 AND empresa_id = $2',
      [u.id, req.ator.empresaId, d.nome, d.cidade, d.uf, d.endereco, d.telefone])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: 'unidade.editada', entidade: 'unidade', entidadeId: u.id, detalhe: d })
  })
  res.json(await comTurnos(await buscar.unidade(db, req.ator.empresaId, u.id)))
})

// Horário da semana + raio/local (usem) e de um dia (udom): "hor" (e "loc" para local).
r.put('/unidades/:id/horario', (req, res) => agirOuPedir(req, res, 'usem', { ...req.body, unidade_id: req.params.id }))
r.put('/unidades/:id/horario/:dia', (req, res) => agirOuPedir(req, res, 'udom', { ...req.body, unidade_id: req.params.id, dia_semana: req.params.dia }))
// Abrir/fechar hoje (gutog): "abre".
r.post('/unidades/:id/aberta', (req, res) => agirOuPedir(req, res, 'gutog', { ...req.body, unidade_id: req.params.id }))

r.post('/unidades/:id/arquivar', soAdmin, async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  if (u.arquivado_em) throw conflito('A unidade já está arquivada.')
  const ativas = await db.um('SELECT COUNT(*)::int AS n FROM unidades WHERE empresa_id = $1 AND arquivado_em IS NULL', [req.ator.empresaId])
  if (ativas.n <= 1) throw conflito('A empresa precisa manter ao menos uma unidade ativa.')
  await db.tx(async (t) => {
    await t.exec('UPDATE unidades SET arquivado_em = now(), arquivado_por = $3 WHERE id = $1 AND empresa_id = $2', [u.id, req.ator.empresaId, req.ator.id])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: 'unidade.arquivada', entidade: 'unidade', entidadeId: u.id })
  })
  res.json({ ok: true })
})

r.post('/unidades/:id/restaurar', soAdmin, async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  if (!u.arquivado_em) throw conflito('A unidade não está arquivada.')
  const lim = await limiteDoPlano(req.ator.empresaId)
  if (lim && lim.max_unidades !== null && lim.ativas >= lim.max_unidades) throw conflito('O plano atual não permite mais unidades.')
  await db.tx(async (t) => {
    await t.exec('UPDATE unidades SET arquivado_em = NULL, arquivado_por = NULL WHERE id = $1 AND empresa_id = $2', [u.id, req.ator.empresaId])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: 'unidade.restaurada', entidade: 'unidade', entidadeId: u.id })
  })
  res.json({ ok: true })
})

// ---- Dias fechados ----------------------------------------------------------
// Com unidade: os dias dela + os de "todas". Sem unidade (admin): todos.
r.get('/dias-fechados', async (req, res) => {
  const unidadeId = v.inteiro(req.query.unidade_id, 'a unidade', { min: 1 })
  if (unidadeId) conferirUnidade(req, unidadeId)
  if (!unidadeId && !req.acesso.admin) throw proibido('Escolha uma unidade.')
  const dias = await db.q(
    `SELECT d.*, COALESCE(array_agg(x.unidade_id) FILTER (WHERE x.unidade_id IS NOT NULL), '{}') AS unidades
     FROM dias_fechados d LEFT JOIN dias_fechados_unidades x ON x.dia_fechado_id = d.id
     WHERE d.empresa_id = $1 AND ($2::bigint IS NULL OR d.todas_unidades OR x.unidade_id = $2
       OR EXISTS (SELECT 1 FROM dias_fechados_unidades y WHERE y.dia_fechado_id = d.id AND y.unidade_id = $2))
     GROUP BY d.id ORDER BY d.data`, [req.ator.empresaId, unidadeId])
  res.json(dias)
})

r.post('/dias-fechados', (req, res) => agirOuPedir(req, res, 'dia', req.body))
r.delete('/dias-fechados/:id', (req, res) => agirOuPedir(req, res, 'diarm', { dia_fechado_id: req.params.id, unidade_id: req.query.unidade_id }))
r.post('/dias-fechados/feriados', (req, res) => agirOuPedir(req, res, 'diapre', req.body))

r.get('/feriados-nacionais', async (req, res) => {
  const ano = v.inteiro(req.query.ano, 'o ano', { min: 2000, max: 2100 })
  res.json(ano ? servUnid.feriadosNacionais(ano) : servUnid.proximosFeriados(tempo.hoje()))
})

module.exports = r
