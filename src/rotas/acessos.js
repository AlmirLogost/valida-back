// Cargos (§7) e perfis de acesso (§8).
const express = require('express')
const db = require('../db')
const v = require('../lib/validar')
const buscar = require('../servicos/buscar')
const { gravarMatriz } = require('../servicos/padroes')
const { CHAVES, MODELOS, normalizar } = require('../auth/permissoes')
const { registrar } = require('../lib/registro')
const { invalido, conflito, proibido } = require('../lib/erros')
const { soAdmin, exigir, conferirUnidade, tem } = require('../auth/sessao')

const r = express.Router()

async function chavesDoPerfil(dbx, perfilId) {
  return (await dbx.q('SELECT chave FROM perfil_permissoes WHERE perfil_id = $1 AND permitido', [perfilId])).map((x) => x.chave)
}

// Ninguém dá a outro mais do que tem (o admin tem tudo).
async function conferirNaoConcedeMais(req, perfilId) {
  if (req.acesso.admin) return
  const ch = await chavesDoPerfil(db, perfilId)
  const sobra = ch.filter((c) => !req.acesso.chaves.has(c))
  if (sobra.length) throw proibido('Você não pode dar a alguém permissões que você não tem.', { permissoes: sobra })
}

// ---- Cargos (dentro da unidade) --------------------------------------------
r.get('/unidades/:id/cargos', async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, u.id)
  const arq = req.query.arquivados === '1'
  res.json(await db.q(
    `SELECT c.*, (SELECT COUNT(*)::int FROM colaboradores co WHERE co.cargo_id = c.id AND co.excluido_em IS NULL AND co.situacao <> 'arquivado') AS pessoas
     FROM cargos c WHERE c.unidade_id = $1 AND c.empresa_id = $2 AND (c.arquivado_em IS ${arq ? 'NOT' : ''} NULL)
     ORDER BY (c.perfil = 'coordenador') DESC, c.nome`, [u.id, req.ator.empresaId]))
})

async function lerCargo(req, b, atual) {
  const d = {
    nome: 'nome' in b || !atual ? v.texto(b.nome, 'o nome', { obrigatorio: true, max: 60 }) : atual.nome,
    perfil: 'perfil' in b || !atual ? v.umDe(b.perfil, 'o perfil', ['coordenador', 'operador'], { obrigatorio: true }) : atual.perfil,
    descricao: 'descricao' in b ? v.texto(b.descricao, 'a descrição', { max: 300 }) : atual ? atual.descricao : null,
    padrao: 'padrao' in b ? b.padrao === true : atual ? atual.padrao : false
  }
  let pa = 'perfil_acesso_id' in b ? v.id(b.perfil_acesso_id, 'o perfil de acesso') : atual ? atual.perfil_acesso_id : null
  if (!pa) {
    const fixo = await db.um('SELECT id FROM perfis_acesso WHERE empresa_id = $1 AND fixo_tipo = $2', [req.ator.empresaId, d.perfil === 'coordenador' ? 'lider' : 'operadores'])
    pa = fixo.id
  }
  await buscar.perfil(db, req.ator.empresaId, pa)
  await conferirNaoConcedeMais(req, pa)
  d.perfil_acesso_id = pa
  return d
}

r.post('/unidades/:id/cargos', exigir('cargos'), async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, u.id)
  const d = await lerCargo(req, req.body, null)
  const c = await db.tx(async (t) => {
    if (d.padrao) await t.exec('UPDATE cargos SET padrao = false WHERE unidade_id = $1 AND perfil = $2', [u.id, d.perfil])
    const novo = await t.um(
      `INSERT INTO cargos (empresa_id, unidade_id, nome, perfil, descricao, padrao, perfil_acesso_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.ator.empresaId, u.id, d.nome, d.perfil, d.descricao, d.padrao, d.perfil_acesso_id])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: 'cargo.criado', entidade: 'cargo', entidadeId: novo.id, detalhe: d })
    return novo
  })
  res.status(201).json(c)
})

r.put('/cargos/:id', exigir('cargos'), async (req, res) => {
  const atual = await buscar.cargo(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, atual.unidade_id)
  if (atual.arquivado_em) throw conflito('O cargo está arquivado.')
  const d = await lerCargo(req, req.body, atual)
  if (d.perfil !== atual.perfil) await garantirUmDeCada(atual, 'mudar o perfil')
  const c = await db.tx(async (t) => {
    if (d.padrao) await t.exec('UPDATE cargos SET padrao = false WHERE unidade_id = $1 AND perfil = $2 AND id <> $3', [atual.unidade_id, d.perfil, atual.id])
    const novo = await t.um(
      `UPDATE cargos SET nome = $2, perfil = $3, descricao = $4, padrao = $5, perfil_acesso_id = $6 WHERE id = $1 RETURNING *`,
      [atual.id, d.nome, d.perfil, d.descricao, d.padrao, d.perfil_acesso_id])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: atual.unidade_id, ator: req.ator, acao: 'cargo.editado', entidade: 'cargo', entidadeId: atual.id, detalhe: d })
    return novo
  })
  res.json(c)
})

// A unidade precisa manter ao menos um cargo ativo de cada perfil.
async function garantirUmDeCada(cargo, acao) {
  const r2 = await db.um(
    `SELECT COUNT(*)::int AS n FROM cargos WHERE unidade_id = $1 AND perfil = $2 AND arquivado_em IS NULL AND id <> $3`,
    [cargo.unidade_id, cargo.perfil, cargo.id])
  if (r2.n < 1) throw conflito(`Não dá para ${acao}: a unidade precisa manter ao menos um cargo de ${cargo.perfil === 'coordenador' ? 'Coordenação' : 'Operador'}.`)
}

r.post('/cargos/:id/arquivar', exigir('cargos'), async (req, res) => {
  const c = await buscar.cargo(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, c.unidade_id)
  if (c.arquivado_em) throw conflito('O cargo já está arquivado.')
  await garantirUmDeCada(c, 'arquivar')
  const usando = await db.um(`SELECT COUNT(*)::int AS n FROM colaboradores WHERE cargo_id = $1 AND excluido_em IS NULL AND situacao <> 'arquivado'`, [c.id])
  if (usando.n) throw conflito('Há pessoas neste cargo. Troque o cargo delas antes de arquivar.')
  await db.tx(async (t) => {
    await t.exec('UPDATE cargos SET arquivado_em = now(), padrao = false WHERE id = $1', [c.id])
    if (c.padrao) {
      await t.exec(`UPDATE cargos SET padrao = true WHERE id = (SELECT id FROM cargos WHERE unidade_id = $1 AND perfil = $2 AND arquivado_em IS NULL ORDER BY id LIMIT 1)`, [c.unidade_id, c.perfil])
    }
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: c.unidade_id, ator: req.ator, acao: 'cargo.arquivado', entidade: 'cargo', entidadeId: c.id })
  })
  res.json({ ok: true })
})

r.post('/cargos/:id/restaurar', exigir('cargos'), async (req, res) => {
  const c = await buscar.cargo(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, c.unidade_id)
  if (!c.arquivado_em) throw conflito('O cargo não está arquivado.')
  await db.tx(async (t) => {
    await t.exec('UPDATE cargos SET arquivado_em = NULL WHERE id = $1', [c.id])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: c.unidade_id, ator: req.ator, acao: 'cargo.restaurado', entidade: 'cargo', entidadeId: c.id })
  })
  res.json({ ok: true })
})

// Copiar cargos de outra unidade (não duplica mesmo nome + perfil).
r.post('/unidades/:id/cargos/copiar', exigir('cargos'), async (req, res) => {
  const destino = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  const origem = await buscar.unidade(db, req.ator.empresaId, v.id(req.body.de_unidade_id, 'a unidade de origem'))
  conferirUnidade(req, destino.id); conferirUnidade(req, origem.id)
  const n = await db.tx(async (t) => {
    const copiados = await t.q(
      `INSERT INTO cargos (empresa_id, unidade_id, nome, perfil, descricao, padrao, perfil_acesso_id)
       SELECT o.empresa_id, $2, o.nome, o.perfil, o.descricao, false, o.perfil_acesso_id FROM cargos o
       WHERE o.unidade_id = $1 AND o.arquivado_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM cargos d WHERE d.unidade_id = $2 AND d.arquivado_em IS NULL AND lower(d.nome) = lower(o.nome) AND d.perfil = o.perfil)
       RETURNING id, perfil_acesso_id`, [origem.id, destino.id])
    for (const c of copiados) await conferirNaoConcedeMais(req, c.perfil_acesso_id)
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: destino.id, ator: req.ator, acao: 'cargo.copiados', entidade: 'unidade', entidadeId: destino.id, detalhe: { de_unidade_id: origem.id, quantidade: copiados.length } })
    return copiados.length
  })
  res.json({ ok: true, copiados: n })
})

// ---- Perfis de acesso (só o admin, tela Acessos) ---------------------------
async function perfilCompleto(p) {
  const ch = await chavesDoPerfil(db, p.id)
  const uso = await db.um(
    `SELECT (SELECT COUNT(*)::int FROM colaboradores WHERE perfil_acesso_id = $1 AND excluido_em IS NULL) AS pessoas,
            (SELECT COUNT(*)::int FROM cargos WHERE perfil_acesso_id = $1 AND arquivado_em IS NULL) AS cargos,
            (SELECT COUNT(*)::int FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id
             WHERE COALESCE(c.perfil_acesso_id, cg.perfil_acesso_id) = $1 AND c.excluido_em IS NULL AND c.situacao = 'ativo') AS pessoas_efetivas`, [p.id])
  return { ...p, permissoes: Object.fromEntries(CHAVES.map((c) => [c, ch.includes(c)])), ...uso }
}

r.get('/perfis', soAdmin, async (req, res) => {
  const ps = await db.q('SELECT * FROM perfis_acesso WHERE empresa_id = $1 AND arquivado_em IS NULL ORDER BY fixo DESC, id', [req.ator.empresaId])
  res.json(await Promise.all(ps.map(perfilCompleto)))
})

r.get('/perfis/:id', soAdmin, async (req, res) => {
  res.json(await perfilCompleto(await buscar.perfil(db, req.ator.empresaId, v.id(req.params.id))))
})

function lerPermissoes(mapa) {
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) throw invalido('Envie as permissões como { chave: true/false }.')
  const desconhecidas = Object.keys(mapa).filter((k) => !CHAVES.includes(k))
  if (desconhecidas.length) throw invalido(`Permissão desconhecida: ${desconhecidas.join(', ')}.`)
  return normalizar(Object.keys(mapa).filter((k) => mapa[k] === true))
}

// Novo perfil: em branco, a partir de um modelo, ou duplicando outro.
r.post('/perfis', soAdmin, async (req, res) => {
  const nome = v.texto(req.body.nome, 'o nome', { obrigatorio: true, max: 60 })
  let chaves
  if (req.body.de_perfil_id) chaves = await chavesDoPerfil(db, (await buscar.perfil(db, req.ator.empresaId, v.id(req.body.de_perfil_id))).id)
  else if (req.body.permissoes) chaves = lerPermissoes(req.body.permissoes)
  else chaves = MODELOS[v.umDe(req.body.modelo ?? 'branco', 'o modelo', Object.keys(MODELOS))]
  const p = await db.tx(async (t) => {
    const novo = await t.um(`INSERT INTO perfis_acesso (empresa_id, nome, tipo) VALUES ($1, $2, 'x') RETURNING *`, [req.ator.empresaId, nome])
    await gravarMatriz(t, novo.id, normalizar(chaves))
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'perfil.criado', entidade: 'perfil_acesso', entidadeId: novo.id, detalhe: { nome, permissoes: chaves } })
    return novo
  })
  res.status(201).json(await perfilCompleto(p))
})

r.post('/perfis/:id/duplicar', soAdmin, async (req, res) => {
  const o = await buscar.perfil(db, req.ator.empresaId, v.id(req.params.id))
  const chaves = await chavesDoPerfil(db, o.id)
  const p = await db.tx(async (t) => {
    const novo = await t.um(`INSERT INTO perfis_acesso (empresa_id, nome, tipo) VALUES ($1, $2, 'x') RETURNING *`, [req.ator.empresaId, `${o.nome} (cópia)`.slice(0, 60)])
    await gravarMatriz(t, novo.id, chaves)
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'perfil.duplicado', entidade: 'perfil_acesso', entidadeId: novo.id, detalhe: { de: o.id } })
    return novo
  })
  res.status(201).json(await perfilCompleto(p))
})

r.put('/perfis/:id', soAdmin, async (req, res) => {
  const p = await buscar.perfil(db, req.ator.empresaId, v.id(req.params.id))
  const nome = 'nome' in req.body ? v.texto(req.body.nome, 'o nome', { obrigatorio: true, max: 60 }) : p.nome
  if (p.fixo && nome !== p.nome) throw conflito('Perfis fixos não mudam de nome.')
  const chaves = 'permissoes' in req.body ? lerPermissoes(req.body.permissoes) : null
  await db.tx(async (t) => {
    await t.exec('UPDATE perfis_acesso SET nome = $2 WHERE id = $1', [p.id, nome])
    if (chaves) await gravarMatriz(t, p.id, chaves)
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'perfil.editado', entidade: 'perfil_acesso', entidadeId: p.id, detalhe: { nome, permissoes: chaves } })
  })
  res.json(await perfilCompleto(await buscar.perfil(db, req.ator.empresaId, p.id)))
})

// Excluir: só perfil não fixo e sem ninguém usando (pessoas ou cargos).
r.delete('/perfis/:id', soAdmin, async (req, res) => {
  const p = await perfilCompleto(await buscar.perfil(db, req.ator.empresaId, v.id(req.params.id)))
  if (p.fixo) throw conflito('Perfis fixos não podem ser excluídos.')
  if (p.pessoas || p.cargos) throw conflito('Há pessoas ou cargos usando este perfil. Troque antes de excluir.', { pessoas: p.pessoas, cargos: p.cargos })
  await db.tx(async (t) => {
    await t.exec('UPDATE perfis_acesso SET arquivado_em = now() WHERE id = $1', [p.id])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'perfil.excluido', entidade: 'perfil_acesso', entidadeId: p.id })
  })
  res.json({ ok: true })
})

module.exports = { rotas: r, conferirNaoConcedeMais }
