const { query, run } = require('../config/database')
const { getAdminId } = require('../helpers/adminLojas')

exports.status = async (req, res) => {
  try {
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.status(404).json({ erro: 'Sem assinatura.' })

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

    if (!rows.length) return res.status(404).json({ erro: 'Sem assinatura.' })

    const sub = rows[0]

    let dias_trial = null
    if (sub.status === 'trial' && sub.trial_fim) {
      const diff = new Date(sub.trial_fim) - new Date()
      dias_trial = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
    }

    const [[lojas], [usuarios], [tarefas]] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM lojas WHERE admin_id = ? AND ativo >= 0', [adminId]),
      query(
        `SELECT COUNT(*) AS total FROM usuarios
         WHERE loja_id IN (SELECT id FROM lojas WHERE admin_id = ?) AND ativo = 1`,
        [adminId]
      ),
      query(
        `SELECT COUNT(*) AS total FROM checklists
         WHERE loja_id IN (SELECT id FROM lojas WHERE admin_id = ?) AND ativo = 1`,
        [adminId]
      )
    ])

    res.json({
      plano: { nome: sub.plano_nome, slug: sub.plano_slug, preco: Number(sub.preco) },
      status: sub.status,
      dias_trial,
      trial_fim: sub.trial_fim,
      gateway_customer_id: sub.gateway_customer_id,
      gateway_subscription_id: sub.gateway_subscription_id,
      limites: {
        lojas:          { max: sub.max_lojas,          uso: parseInt(lojas.total) },
        usuarios:       { max: sub.max_usuarios,       uso: parseInt(usuarios.total) },
        tarefas_ativas: { max: sub.max_tarefas_ativas, uso: parseInt(tarefas.total) }
      },
      features: {
        comissoes: sub.tem_comissoes === 1
      }
    })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}

exports.webhookAsaas = async (req, res) => {
  try {
    const { event, payment, subscription: asaasSub } = req.body

    if (event === 'PAYMENT_CONFIRMED' && payment?.subscription) {
      await run(
        `UPDATE subscriptions SET status = 'ativo', atualizado_em = NOW()
         WHERE gateway_subscription_id = ?`,
        [payment.subscription]
      )
    }

    if (event === 'SUBSCRIPTION_DELETED' && asaasSub?.id) {
      await run(
        `UPDATE subscriptions SET status = 'cancelado', atualizado_em = NOW()
         WHERE gateway_subscription_id = ?`,
        [asaasSub.id]
      )
    }

    res.json({ received: true })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}
