const { query } = require('../config/database')
// Resolução de conta única, compartilhada com o resto do sistema (helpers/adminLojas.js)
const { getAdminId } = require('../helpers/adminLojas')

// Busca subscription ativa + dados do plano
async function getSubscription(adminId) {
  const rows = await query(
    `SELECT s.*, p.nome AS plano_nome, p.slug AS plano_slug, p.preco,
            p.max_lojas, p.max_usuarios, p.max_tarefas_ativas, p.tem_comissoes
     FROM subscriptions s
     JOIN planos p ON s.plano_id = p.id
     WHERE s.admin_id = ?
     ORDER BY s.id DESC
     LIMIT 1`,
    [adminId]
  )
  return rows[0] ?? null
}

// Bloqueia com 402 se suspenso/cancelado ou trial expirado
const requirePlanoAtivo = async (req, res, next) => {
  try {
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.status(402).json({ erro: 'Sem assinatura ativa.' })

    const sub = await getSubscription(adminId)
    if (!sub) return res.status(402).json({ erro: 'Sem assinatura ativa.' })

    if (sub.status === 'suspenso' || sub.status === 'cancelado') {
      return res.status(402).json({ erro: 'Assinatura suspensa ou cancelada.', status: sub.status })
    }

    if (sub.status === 'trial' && sub.trial_fim && new Date(sub.trial_fim) < new Date()) {
      return res.status(402).json({ erro: 'Período de trial expirado.', status: 'trial_expirado' })
    }

    req.adminId = adminId
    req.subscription = sub
    next()
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}

// Bloqueia com 403 se o plano não tem a feature solicitada
const requireFeature = (feature) => async (req, res, next) => {
  try {
    if (!req.subscription) {
      const adminId = await getAdminId(req.userId, req.userPerfil)
      if (!adminId) return res.status(402).json({ erro: 'Sem assinatura ativa.' })
      const sub = await getSubscription(adminId)
      if (!sub) return res.status(402).json({ erro: 'Sem assinatura ativa.' })
      req.adminId = adminId
      req.subscription = sub
    }

    const sub = req.subscription
    const features = { comissoes: sub.tem_comissoes === 1 }

    if (features[feature] === false) {
      return res.status(403).json({
        erro: `Funcionalidade "${feature}" não disponível no plano ${sub.plano_nome}.`,
        plano: sub.plano_slug
      })
    }

    next()
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}

// Bloqueia criação se o limite do plano foi atingido
const checkLimite = (tipo) => async (req, res, next) => {
  try {
    if (!req.subscription) {
      const adminId = await getAdminId(req.userId, req.userPerfil)
      if (!adminId) return res.status(402).json({ erro: 'Sem assinatura ativa.' })
      const sub = await getSubscription(adminId)
      if (!sub) return res.status(402).json({ erro: 'Sem assinatura ativa.' })
      req.adminId = adminId
      req.subscription = sub
    }

    const { adminId, subscription: sub } = req

    if (tipo === 'lojas') {
      if (sub.max_lojas === null) return next()
      const [row] = await query(
        'SELECT COUNT(*) AS total FROM lojas WHERE admin_id = ? AND ativo >= 0',
        [adminId]
      )
      if (parseInt(row.total) >= sub.max_lojas) {
        return res.status(403).json({
          erro: `Limite de ${sub.max_lojas} loja(s) atingido no plano ${sub.plano_nome}.`
        })
      }
    }

    if (tipo === 'usuarios') {
      if (sub.max_usuarios === null) return next()
      const [row] = await query(
        `SELECT COUNT(*) AS total FROM usuarios
         WHERE loja_id IN (SELECT id FROM lojas WHERE admin_id = ?) AND ativo = 1`,
        [adminId]
      )
      if (parseInt(row.total) >= sub.max_usuarios) {
        return res.status(403).json({
          erro: `Limite de ${sub.max_usuarios} usuário(s) atingido no plano ${sub.plano_nome}.`
        })
      }
    }

    if (tipo === 'tarefas') {
      if (sub.max_tarefas_ativas === null) return next()
      const [row] = await query(
        `SELECT COUNT(*) AS total FROM checklists
         WHERE loja_id IN (SELECT id FROM lojas WHERE admin_id = ?) AND ativo = 1`,
        [adminId]
      )
      if (parseInt(row.total) >= sub.max_tarefas_ativas) {
        return res.status(403).json({
          erro: `Limite de ${sub.max_tarefas_ativas} tarefa(s) ativa(s) atingido no plano ${sub.plano_nome}.`
        })
      }
    }

    next()
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}

module.exports = { requirePlanoAtivo, requireFeature, checkLimite }
