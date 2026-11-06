const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { query, withTransaction } = require('../config/database')

const SENHA_MIN = 8

exports.registrar = async (req, res) => {
  try {
    const { nome, email, senha, empresa } = req.body

    if (!nome || !nome.trim()) {
      return res.status(400).json({ erro: 'Informe seu nome.' })
    }
    if (!empresa || !empresa.trim()) {
      return res.status(400).json({ erro: 'Informe o nome da empresa.' })
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ erro: 'Informe seu e-mail.' })
    }
    if (!senha || senha.length < SENHA_MIN) {
      return res.status(400).json({ erro: `A senha deve ter no mínimo ${SENHA_MIN} caracteres.` })
    }

    const emailNormalizado = email.trim().toLowerCase()

    const existe = await query('SELECT id FROM usuarios WHERE email = ?', [emailNormalizado])
    if (existe.length) {
      return res.status(400).json({ erro: 'Este e-mail já está cadastrado. Faça login ou use "Esqueci minha senha".' })
    }

    const planos = await query("SELECT id FROM planos WHERE slug = 'profissional' LIMIT 1")
    if (!planos.length) {
      return res.status(500).json({ erro: 'Não foi possível concluir o cadastro. Tente novamente em alguns minutos.' })
    }

    const hash = await bcrypt.hash(senha, 10)
    const nomeFinal = nome.trim()
    const empresaFinal = empresa.trim()

    // Cria conta (usuário dono) + primeira loja + trial de 14 dias numa única
    // transação: se qualquer passo falhar, nada fica gravado pela metade.
    const user = await withTransaction(async ({ query: queryTx, run: runTx }) => {
      const novoUsuario = await runTx(
        'INSERT INTO usuarios (nome, email, senha, perfil, ativo, razao_social) VALUES (?, ?, ?, ?, ?, ?)',
        [nomeFinal, emailNormalizado, hash, 'super_admin', 1, empresaFinal]
      )
      const userId = novoUsuario.lastID

      await runTx(
        'INSERT INTO lojas (nome, admin_id) VALUES (?, ?)',
        [empresaFinal, userId]
      )

      const trialFim = new Date()
      trialFim.setDate(trialFim.getDate() + 14)
      await runTx(
        'INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) VALUES (?, ?, ?, ?)',
        [userId, planos[0].id, 'trial', trialFim.toISOString()]
      )

      return { id: userId, nome: nomeFinal, email: emailNormalizado, perfil: 'super_admin' }
    })

    // JWT_SECRET vem só do .env — o servidor nem inicia sem ela (ver server.js)
    const token = jwt.sign({ id: user.id, perfil: user.perfil }, process.env.JWT_SECRET, { expiresIn: '90d' })

    res.json({ token, user })
  } catch (e) {
    // Corrida rara: dois cadastros com o mesmo e-mail ao mesmo tempo.
    // O banco (UNIQUE em usuarios.email) rejeita o segundo; devolvemos a
    // mesma mensagem amigável em vez do erro técnico do PostgreSQL.
    if (e.code === '23505') {
      return res.status(400).json({ erro: 'Este e-mail já está cadastrado. Faça login ou use "Esqueci minha senha".' })
    }
    res.status(500).json({ erro: 'Não foi possível concluir o cadastro. Tente novamente.' })
  }
}
