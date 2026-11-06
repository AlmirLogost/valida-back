const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { query, run } = require('../config/database')

exports.registrar = async (req, res) => {
  try {
    const { nome, email, senha } = req.body
    if (!nome || !email || !senha || senha.length < 6) {
      return res.status(400).json({ erro: 'Preencha todos os campos. Senha mínima 6 caracteres.' })
    }

    const existe = await query('SELECT id FROM usuarios WHERE email = ?', [email])
    if (existe.length) return res.status(400).json({ erro: 'Email já cadastrado.' })

    const hash = await bcrypt.hash(senha, 10)
    await run(
      'INSERT INTO usuarios (nome, email, senha, perfil, ativo) VALUES (?, ?, ?, ?, ?)',
      [nome.trim(), email.trim().toLowerCase(), hash, 'super_admin', 1]
    )

    const users = await query('SELECT * FROM usuarios WHERE email = ?', [email])
    const user = users[0]

    // Criar subscription trial no plano Profissional por 14 dias
    const planos = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")
    if (planos.length) {
      const trialFim = new Date()
      trialFim.setDate(trialFim.getDate() + 14)
      await run(
        'INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)',
        [user.id, planos[0].id, 'trial', trialFim.toISOString()]
      )
    }

    // JWT_SECRET vem só do .env — o servidor nem inicia sem ela (ver server.js)
    const token = jwt.sign({ id: user.id, perfil: user.perfil }, process.env.JWT_SECRET, { expiresIn: '90d' })

    res.json({ token, user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil } })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}
