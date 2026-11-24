const crypto = require('crypto')
const bcrypt = require('bcrypt')
const { query, run } = require('../config/database')
const emailService = require('../services/emailService')

exports.solicitar = async (req, res) => {
  try {
    const { email } = req.body
    const users = await query('SELECT * FROM usuarios WHERE email = ?', [email])
    // Sempre retorna sucesso para não vazar se email existe
    if (!users.length) return res.json({ message: 'Se o email existir, você receberá as instruções.' })
    
    const user = users[0]
    const token = crypto.randomBytes(32).toString('hex')
    const expira = new Date(Date.now() + 60 * 60 * 1000) // 1 hora
    
    // Invalidar tokens anteriores
    await run('UPDATE password_resets SET usado = true WHERE usuario_id = ?', [user.id])
    
    await run(
      'INSERT INTO password_resets (usuario_id, token, expira_em) VALUES (?, ?, ?)',
      [user.id, token, expira.toISOString()]
    )
    
    await emailService.enviarResetSenha(user.email, user.nome, token)
    res.json({ message: 'Se o email existir, você receberá as instruções.' })
  } catch (e) {
    console.error('Erro reset senha:', e)
    res.status(500).json({ erro: e.message })
  }
}

exports.redefinir = async (req, res) => {
  try {
    const { token, senha } = req.body
    if (!token || !senha || senha.length < 6) {
      return res.status(400).json({ erro: 'Dados inválidos. Senha mínima 6 caracteres.' })
    }
    
    const rows = await query(
      'SELECT * FROM password_resets WHERE token = ? AND usado = false AND expira_em > NOW()',
      [token]
    )
    if (!rows.length) return res.status(400).json({ erro: 'Token inválido ou expirado.' })
    
    const reset = rows[0]
    const hash = await bcrypt.hash(senha, 10)
    
    await run('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, reset.usuario_id])
    await run('UPDATE password_resets SET usado = true WHERE id = ?', [reset.id])
    
    res.json({ message: 'Senha redefinida com sucesso!' })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}
