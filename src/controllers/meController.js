const { query, run } = require('../config/database')
const bcrypt = require('bcrypt')

exports.obter = async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, nome, email, perfil, whatsapp, documento, razao_social, email_cobranca, cep, endereco, cidade, estado FROM usuarios WHERE id = ?',
      [req.user.id]
    )
    if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' })
    res.json(rows[0])
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

exports.atualizar = async (req, res) => {
  try {
    const { nome, email, senha, senhaAtual, whatsapp, documento, razao_social, email_cobranca, cep, endereco, cidade, estado } = req.body

    const rows = await query('SELECT * FROM usuarios WHERE id = ?', [req.user.id])
    if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' })
    const user = rows[0]

    let novaSenha = user.senha
    if (senha && senhaAtual) {
      const ok = await bcrypt.compare(senhaAtual, user.senha)
      if (!ok) return res.status(400).json({ erro: 'Senha atual incorreta' })
      novaSenha = await bcrypt.hash(senha, 10)
    }

    await run(
      `UPDATE usuarios SET nome=?, email=?, senha=?, whatsapp=?, documento=?, razao_social=?, email_cobranca=?, cep=?, endereco=?, cidade=?, estado=? WHERE id=?`,
      [nome, email, novaSenha, whatsapp, documento, razao_social, email_cobranca, cep, endereco, cidade, estado, req.user.id]
    )
    res.json({ message: 'Conta atualizada!' })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}
