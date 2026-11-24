// Pedidos e aprovações (§9, roteiro item 6).
//
// agirOuPedir: quem tem a permissão faz direto; o colaborador sem a
// permissão gera um pedido com resumo e payload (202). Aprovar EXECUTA a
// ação pelo mesmo executor. Toda decisão entra no registro de atividades.
//
// PIN (pedidos "pin" e "cad"): aparece uma vez para quem aprova (na
// resposta da aprovação) e uma vez para quem pediu (GET /pedidos/:id/pin);
// até lá fica cifrado no pedido; depois de visto, só fica o hash na pessoa.
const db = require('../db')
const executores = require('./executores')
const { registrar } = require('../lib/registro')
const { cifrar, decifrar, sha256 } = require('../lib/segredos')
const { proibido, conflito, naoEncontrado, invalido } = require('../lib/erros')
const { tem } = require('../auth/sessao')

const TIPOS = Object.keys(executores)

function ctxDe(req) {
  return { empresaId: req.ator.empresaId, ator: req.ator, viaPedido: false }
}

// Separa o que é público do PIN (que nunca vai para o registro nem fica em claro).
function semPin(resultado) {
  if (!resultado || (!('pin' in resultado) && !('codigo' in resultado))) return resultado
  const { pin, codigo, ...resto } = resultado
  return resto
}

async function agirOuPedir(req, res, tipo, entrada) {
  const ex = executores[tipo]
  if (!ex) throw invalido('Tipo de pedido desconhecido.')
  const prep = await ex.preparar(db, req, entrada || {})
  const chaves = ex.chaves(prep.payload)

  if (chaves.every((c) => tem(req, c))) {
    const resultado = await db.tx(async (t) => {
      const r = await ex.executar(t, ctxDe(req), prep.payload)
      await registrar(t, { empresaId: req.ator.empresaId, unidadeId: prep.unidadeId, ator: req.ator, acao: `${tipo}.feito`, entidade: tipo, detalhe: { titulo: prep.titulo, detalhe: prep.detalhe, resultado: semPin(r) } })
      return r
    })
    return res.json({ ok: true, feito: true, resultado })
  }

  if (req.ator.tipo !== 'colaborador') throw proibido()
  const pedido = await criarPedido(db, req.ator, tipo, prep)
  return res.status(202).json({ ok: true, feito: false, pedido, mensagem: 'Enviado para aprovação.' })
}

async function criarPedido(dbx, ator, tipo, prep) {
  return dbx.tx(async (t) => {
    const p = await t.um(
      `INSERT INTO pedidos (empresa_id, unidade_id, solicitante_tipo, solicitante_id, tipo, titulo, detalhe, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, tipo, titulo, detalhe, estado, criado_em`,
      [ator.empresaId, prep.unidadeId, ator.tipo, ator.id, tipo, prep.titulo, prep.detalhe, JSON.stringify(prep.payload)])
    await registrar(t, { empresaId: ator.empresaId, unidadeId: prep.unidadeId, ator, acao: 'pedido.criado', entidade: 'pedido', entidadeId: p.id, detalhe: { tipo, titulo: prep.titulo } })
    return p
  })
}

// Quem pode decidir: o admin; no "lib", também quem tem "lib" naquela unidade.
function podeDecidir(req, pedido) {
  if (req.acesso.admin) return true
  return executores[pedido.tipo].aprovador === 'lib' && tem(req, 'lib') && req.acesso.unidades.has(Number(pedido.unidade_id)) && pedido.solicitante_id !== req.ator.id
}

async function decidir(req, pedidoId, aprovar, motivo) {
  return db.tx(async (t) => {
    const p = await t.um('SELECT * FROM pedidos WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [pedidoId, req.ator.empresaId])
    if (!p) throw naoEncontrado()
    if (!podeDecidir(req, p)) throw (req.acesso.admin ? proibido() : naoEncontrado())
    if (p.estado !== 'pend') throw conflito('Esse pedido já foi decidido.')
    const ex = executores[p.tipo]
    const ctx = { empresaId: req.ator.empresaId, ator: req.ator, viaPedido: true }

    let resultado = null
    let guardado = { decidido_por_tipo: req.ator.tipo }
    if (aprovar) {
      resultado = await ex.executar(t, ctx, p.payload)
      guardado = { ...guardado, ...semPin(resultado) }
      // PIN para quem pediu ver uma vez (se não foi ele mesmo quem aprovou).
      if (resultado && resultado.pin && !(p.solicitante_tipo === req.ator.tipo && p.solicitante_id === req.ator.id)) {
        guardado.pin_cifrado = cifrar(resultado.pin)
      }
      // Código de liberação ("lib"): só o hash, preso a este pedido.
      if (resultado && resultado.codigo) guardado.codigo_hash = sha256(`${p.id}:${resultado.codigo}`)
    } else {
      if (ex.negar) await ex.negar(t, ctx, p.payload)
      guardado.motivo = motivo || null
    }
    await t.exec(
      `UPDATE pedidos SET estado = $2, decidido_por = $3, decidido_em = now(), resultado = $4 WHERE id = $1`,
      [p.id, aprovar ? 'ok' : 'no', req.ator.id, JSON.stringify(guardado)])
    await registrar(t, {
      empresaId: req.ator.empresaId, unidadeId: p.unidade_id, ator: req.ator,
      acao: aprovar ? 'pedido.aprovado' : 'pedido.negado', entidade: 'pedido', entidadeId: p.id,
      detalhe: { tipo: p.tipo, titulo: p.titulo, resultado: semPin(resultado), motivo: motivo || null }
    })
    return { pedido_id: p.id, estado: aprovar ? 'ok' : 'no', resultado }
  })
}

// Quem pediu vê o PIN uma vez; depois o cifrado é apagado.
async function revelarPin(req, pedidoId) {
  return db.tx(async (t) => {
    const p = await t.um(
      `SELECT * FROM pedidos WHERE id = $1 AND empresa_id = $2 AND solicitante_tipo = $3 AND solicitante_id = $4 FOR UPDATE`,
      [pedidoId, req.ator.empresaId, req.ator.tipo, req.ator.id])
    if (!p) throw naoEncontrado()
    if (!p.resultado || !p.resultado.pin_cifrado) throw naoEncontrado('O PIN já foi visto ou não existe.')
    const pin = decifrar(p.resultado.pin_cifrado)
    await t.exec(`UPDATE pedidos SET resultado = resultado - 'pin_cifrado', visto_pelo_solicitante_em = now() WHERE id = $1`, [p.id])
    await registrar(t, { empresaId: req.ator.empresaId, unidadeId: p.unidade_id, ator: req.ator, acao: 'pedido.pin_visto', entidade: 'pedido', entidadeId: p.id })
    return { pin }
  })
}

const CAMPOS_LISTA = `id, unidade_id, solicitante_tipo, solicitante_id, tipo, titulo, detalhe, estado, decidido_por, decidido_em,
  (resultado - 'pin_cifrado' - 'codigo_hash') AS resultado, (resultado ? 'pin_cifrado') AS tem_pin_para_ver, visto_pelo_solicitante_em, criado_em,
  (payload->>'colaborador_id')::bigint AS colaborador_id,
  CASE solicitante_tipo WHEN 'plataforma' THEN 'Suporte Valida'
    WHEN 'admin' THEN (SELECT split_part(nome, ' ', 1) FROM admins WHERE id = pedidos.solicitante_id)
    ELSE (SELECT nome FROM colaboradores WHERE id = pedidos.solicitante_id) END AS solicitante_nome`

async function listar(req, { meus, estado }) {
  const params = [req.ator.empresaId]
  let filtro = ''
  if (meus || (!req.acesso.admin && !tem(req, 'lib'))) {
    params.push(req.ator.tipo, req.ator.id)
    filtro += ` AND solicitante_tipo = $2 AND solicitante_id = $3`
  } else if (!req.acesso.admin) {
    // Quem tem "lib" vê os pedidos de liberação das unidades dele.
    params.push([...req.acesso.unidades])
    filtro += ` AND tipo = 'lib' AND unidade_id = ANY($${params.length})`
  }
  if (estado) { params.push(estado); filtro += ` AND estado = $${params.length}` }
  return db.q(`SELECT ${CAMPOS_LISTA} FROM pedidos WHERE empresa_id = $1 ${filtro}
               ORDER BY (estado = 'pend') DESC, criado_em DESC LIMIT 200`, params)
}

module.exports = { TIPOS, agirOuPedir, criarPedido, decidir, revelarPin, listar, semPin }
