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
    const token = jwt.sign({ id: user.id, perfil: user.perfil }, process.env.JWT_SECRET || 'valida_jwt_secret_2024', { expiresIn: '90d' })

    res.json({ token, user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil } })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}
