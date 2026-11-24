// Conta da empresa (Etapa 2 · Parte C, §20, §21): dados da empresa, plano e
// pagamento (SEM cobrança real), minha conta (admin), pedido de exclusão,
// manual da marca e notificações da unidade.
const express = require('express')
const db = require('../db')
const v = require('../lib/validar')
const buscar = require('../servicos/buscar')
const { registrar } = require('../lib/registro')
const { soAdmin, conferirUnidade } = require('../auth/sessao')
const { invalido, conflito, naoEncontrado } = require('../lib/erros')

const r = express.Router()

// ---- Dados da empresa ---------------------------------------------------------
const CAMPOS_EMPRESA = 'id, nome, razao_social, cnpj, segmento, endereco, cidade, uf, email, telefone, plano, ciclo, situacao, trial_ate, config, exclusao_pedida_em'
r.get('/empresa', soAdmin, async (req, res) => {
  res.json(await db.um(`SELECT ${CAMPOS_EMPRESA} FROM empresas WHERE id = $1`, [req.ator.empresaId]))
})
r.put('/empresa', soAdmin, async (req, res) => {
  const e = await db.um(`SELECT ${CAMPOS_EMPRESA} FROM empresas WHERE id = $1`, [req.ator.empresaId])
  const b = req.body
  const campo = (k, nome, max) => (k in b ? v.texto(b[k], nome, { max }) : e[k])
  const d = {
    nome: 'nome' in b ? v.texto(b.nome, 'o nome fantasia', { obrigatorio: true, max: 120 }) : e.nome,
    razao_social: campo('razao_social', 'a razão social', 160), cnpj: campo('cnpj', 'o CNPJ', 20), endereco: campo('endereco', 'o endereço', 200),
    cidade: campo('cidade', 'a cidade', 80), uf: campo('uf', 'a UF', 2), email: 'email' in b ? (b.email ? v.email(b.email) : null) : e.email, telefone: campo('telefone', 'o telefone', 20)
  }
  if (d.cnpj && d.cnpj.replace(/\D/g, '').length !== 14) throw invalido('CNPJ com 14 números.')
  await db.tx(async (t) => {
    await t.exec(`UPDATE empresas SET nome = $2, razao_social = $3, cnpj = $4, endereco = $5, cidade = $6, uf = upper($7), email = $8, telefone = $9, atualizado_em = now() WHERE id = $1`,
      [req.ator.empresaId, d.nome, d.razao_social, d.cnpj, d.endereco, d.cidade, d.uf, d.email, d.telefone])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'empresa.editada', entidade: 'empresa', entidadeId: req.ator.empresaId })
  })
  res.json(await db.um(`SELECT ${CAMPOS_EMPRESA} FROM empresas WHERE id = $1`, [req.ator.empresaId]))
})

// ---- Plano e pagamento (sem cobrança real nesta fase) ---------------------
r.get('/plano', soAdmin, async (req, res) => {
  const e = await db.um('SELECT plano, ciclo, situacao, trial_ate, config FROM empresas WHERE id = $1', [req.ator.empresaId])
  const catalogo = await db.q('SELECT * FROM planos_catalogo WHERE ativo ORDER BY preco_mensal')
  const assinatura = await db.um('SELECT plano, ciclo, unidades_extra, valor, situacao, proxima_cobranca FROM assinaturas WHERE empresa_id = $1', [req.ator.empresaId])
  const faturas = await db.q('SELECT id, valor, vencimento, paga_em, situacao FROM faturas WHERE empresa_id = $1 ORDER BY vencimento DESC LIMIT 24', [req.ator.empresaId])
  const unidades = await db.um('SELECT COUNT(*)::int AS n FROM unidades WHERE empresa_id = $1 AND arquivado_em IS NULL', [req.ator.empresaId])
  res.json({ empresa: { ...e, forma_pagamento: (e.config || {}).forma_pagamento || 'pix' }, plano: catalogo.find((p) => p.slug === e.plano) || null, catalogo, assinatura, faturas, unidades_ativas: unidades.n })
})
// Escolher plano/ciclo/forma: só registra a escolha. Nenhuma cobrança é criada
// aqui; o checkout entra na Etapa 5 (simulado).
r.post('/plano/escolher', soAdmin, async (req, res) => {
  const b = req.body
  const plano = 'plano' in b ? v.umDe(b.plano, 'o plano', ['ess', 'pro', 'rede'], { obrigatorio: true }) : null
  const ciclo = 'ciclo' in b ? v.umDe(b.ciclo, 'o ciclo', ['mensal', 'anual'], { obrigatorio: true }) : null
  const forma = 'forma_pagamento' in b ? v.umDe(b.forma_pagamento, 'a forma de pagamento', ['pix', 'cartao', 'boleto'], { obrigatorio: true }) : null
  if (plano) {
    const ativas = await db.um('SELECT COUNT(*)::int AS n FROM unidades WHERE empresa_id = $1 AND arquivado_em IS NULL', [req.ator.empresaId])
    const p = await db.um('SELECT * FROM planos_catalogo WHERE slug = $1', [plano])
    if (p.max_unidades !== null && ativas.n > p.max_unidades) throw conflito(`O plano ${p.nome} vai até ${p.max_unidades} unidade(s). Arquive unidades antes de trocar.`)
  }
  await db.tx(async (t) => {
    if (plano || ciclo) await t.exec('UPDATE empresas SET plano = COALESCE($2, plano), ciclo = COALESCE($3, ciclo), atualizado_em = now() WHERE id = $1', [req.ator.empresaId, plano, ciclo])
    if (forma) await t.exec(`UPDATE empresas SET config = config || jsonb_build_object('forma_pagamento', $2::text) WHERE id = $1`, [req.ator.empresaId, forma])
    if (plano || ciclo) await t.exec('UPDATE assinaturas SET plano = COALESCE($2, plano), ciclo = COALESCE($3, ciclo), atualizado_em = now() WHERE empresa_id = $1', [req.ator.empresaId, plano, ciclo])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'plano.escolhido', entidade: 'empresa', entidadeId: req.ator.empresaId, detalhe: { plano, ciclo, forma } })
  })
  res.json({ ok: true, cobranca: false })
})

// ---- Minha conta (admin) ----------------------------------------------------
r.get('/conta', soAdmin, async (req, res) => {
  res.json(await db.um('SELECT a.id, a.nome, a.email, a.celular, e.nome AS empresa FROM admins a JOIN empresas e ON e.id = a.empresa_id WHERE a.id = $1', [req.ator.id]))
})
r.put('/conta', soAdmin, async (req, res) => {
  const a = await db.um('SELECT id, nome, email, celular FROM admins WHERE id = $1', [req.ator.id])
  const b = req.body
  const nome = 'nome' in b ? v.texto(b.nome, 'o nome', { obrigatorio: true, max: 80 }) : a.nome
  const email = 'email' in b ? v.email(b.email, { obrigatorio: true }) : a.email
  const celular = 'celular' in b ? (b.celular ? v.celular(b.celular) : null) : a.celular
  const dup = await db.um('SELECT 1 FROM admins WHERE lower(email) = $1 AND id <> $2', [email, a.id])
  if (dup) throw conflito('Esse e-mail já é usado por outra conta.')
  await db.tx(async (t) => {
    await t.exec('UPDATE admins SET nome = $2, email = $3, celular = $4, atualizado_em = now() WHERE id = $1', [a.id, nome, email, celular])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'conta.editada', entidade: 'admin', entidadeId: a.id })
  })
  res.json({ ok: true })
})
// Excluir conta (§17): só com a palavra EXCLUIR; vira contato do suporte, não apaga na hora.
r.post('/conta/excluir', soAdmin, async (req, res) => {
  if (String(req.body.confirmacao || '').trim() !== 'EXCLUIR') throw invalido('Para confirmar, digite EXCLUIR.')
  await db.tx(async (t) => {
    await t.exec('UPDATE empresas SET exclusao_pedida_em = COALESCE(exclusao_pedida_em, now()) WHERE id = $1', [req.ator.empresaId])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'conta.exclusao_pedida', entidade: 'empresa', entidadeId: req.ator.empresaId })
  })
  res.json({ ok: true, mensagem: 'Pedido registrado. O suporte entra em contato para confirmar. Nada foi apagado.' })
})

// ---- Manual da marca (§20): o admin escreve; a equipe só lê -----------------
r.get('/manual', async (req, res) => {
  res.json(await db.q('SELECT id, titulo, texto, ordem FROM manual_documentos WHERE empresa_id = $1 AND arquivado_em IS NULL ORDER BY ordem, id', [req.ator.empresaId]))
})
r.post('/manual', soAdmin, async (req, res) => {
  const titulo = v.texto(req.body.titulo, 'o título', { obrigatorio: true, max: 40 })
  const texto = v.texto(req.body.texto, 'o texto', { max: 10000 }) || ''
  const d = await db.tx(async (t) => {
    const n = await t.um('INSERT INTO manual_documentos (empresa_id, titulo, texto, ordem) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM manual_documentos WHERE empresa_id = $1)) RETURNING id, titulo, texto, ordem', [req.ator.empresaId, titulo, texto])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'manual.criado', entidade: 'manual', entidadeId: n.id, detalhe: { titulo } })
    return n
  })
  res.status(201).json(d)
})
async function documento(req) {
  const d = await db.um('SELECT * FROM manual_documentos WHERE id = $1 AND empresa_id = $2 AND arquivado_em IS NULL', [v.id(req.params.id), req.ator.empresaId])
  if (!d) throw naoEncontrado()
  return d
}
r.put('/manual/:id', soAdmin, async (req, res) => {
  const d = await documento(req)
  const titulo = 'titulo' in req.body ? v.texto(req.body.titulo, 'o título', { obrigatorio: true, max: 40 }) : d.titulo
  const texto = 'texto' in req.body ? v.texto(req.body.texto, 'o texto', { max: 10000 }) || '' : d.texto
  await db.tx(async (t) => {
    await t.exec('UPDATE manual_documentos SET titulo = $2, texto = $3 WHERE id = $1', [d.id, titulo, texto])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'manual.editado', entidade: 'manual', entidadeId: d.id, detalhe: { titulo } })
  })
  res.json({ ok: true })
})
r.post('/manual/:id/arquivar', soAdmin, async (req, res) => {
  const d = await documento(req)
  await db.tx(async (t) => {
    await t.exec('UPDATE manual_documentos SET arquivado_em = now() WHERE id = $1', [d.id])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'manual.arquivado', entidade: 'manual', entidadeId: d.id, detalhe: { titulo: d.titulo } })
  })
  res.json({ ok: true })
})

// ---- Notificações da unidade (§18) ------------------------------------------
const CAMPOS_NOT = 'push, antes_min, modo, som, vibrar, repetir_min, avisar_atraso, resumo_whatsapp'
r.get('/unidades/:id/notificacoes', async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, u.id)
  const c = await db.um(`SELECT ${CAMPOS_NOT} FROM config_notificacoes WHERE unidade_id = $1`, [u.id])
  res.json(c || { push: true, antes_min: 0, modo: 2, som: true, vibrar: true, repetir_min: 0, avisar_atraso: true, resumo_whatsapp: false })
})
r.put('/unidades/:id/notificacoes', soAdmin, async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  const b = req.body, d = {}
  for (const k of ['push', 'som', 'vibrar', 'avisar_atraso', 'resumo_whatsapp']) if (k in b) d[k] = v.bool(b[k], k, { obrigatorio: true })
  if ('antes_min' in b) d.antes_min = v.umDe(Number(b.antes_min), 'a antecedência', [0, 5, 15, 30])
  if ('modo' in b) d.modo = v.umDe(Number(b.modo), 'o modo', [0, 1, 2])
  if ('repetir_min' in b) d.repetir_min = v.umDe(Number(b.repetir_min), 'a repetição', [0, 10, 15, 30])
  const ks = Object.keys(d)
  if (!ks.length) throw invalido('Nada para alterar.')
  await db.tx(async (t) => {
    await t.exec('INSERT INTO config_notificacoes (unidade_id) VALUES ($1) ON CONFLICT (unidade_id) DO NOTHING', [u.id])
    await t.exec(`UPDATE config_notificacoes SET ${ks.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE unidade_id = $1`, [u.id, ...ks.map((k) => d[k])])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: 'notificacoes.editadas', entidade: 'unidade', entidadeId: u.id, detalhe: d })
  })
  res.json(await db.um(`SELECT ${CAMPOS_NOT} FROM config_notificacoes WHERE unidade_id = $1`, [u.id]))
})

module.exports = r
