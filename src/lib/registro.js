// Registro de atividades (§17): toda mudança passa por aqui.
// Nunca grava senha, PIN, token, hash ou segredo: essas chaves são
// removidas do detalhe em qualquer nível.
const PROIBIDAS = /(pin|senha|password|token|hash|segredo|secret|cifra)/i

function limpar(v) {
  if (Array.isArray(v)) return v.map(limpar)
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {}
    for (const [k, x] of Object.entries(v)) if (!PROIBIDAS.test(k)) out[k] = limpar(x)
    return out
  }
  return v
}

async function registrar(db, { empresaId, unidadeId = null, ator, acao, entidade = null, entidadeId = null, detalhe = null }) {
  await db.exec(
    `INSERT INTO registro_atividades (empresa_id, unidade_id, quem_tipo, quem_id, quem_nome, acao, entidade, entidade_id, detalhe)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [empresaId, unidadeId, ator?.tipo || 'sistema', ator?.id || null, ator?.nome || null, acao, entidade, entidadeId,
      detalhe ? JSON.stringify(limpar(detalhe)) : null]
  )
}

module.exports = { registrar, limpar }
