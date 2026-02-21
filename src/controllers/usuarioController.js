const bcrypt = require('bcrypt')
const { query, run } = require('../config/database')

exports.listar = async (req, res) => {
  try {
    const { loja_id } = req.query
    let sql = 'SELECT id, nome, email, perfil, loja_id, ativo, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, score FROM usuarios WHERE ativo = 1'
    const params = []
    if (loja_id) { sql += ' AND loja_id = ?'; params.push(loja_id) }
    sql += ' ORDER BY nome'
    const usuarios = await query(sql, params)
    res.json(usuarios)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criar = async (req, res) => {
  try {
    const { nome, email, senha, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal } = req.body

    // Funcionário e Gerente: PIN obrigatório, email opcional
    if (perfil === 'funcionario' || perfil === 'gerente') {
      if (!pin || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ erro: 'PIN de 4 dígitos é obrigatório' })
      }
    } else {
      if (!email) return res.status(400).json({ erro: 'Email é obrigatório para este perfil' })
      if (!senha) return res.status(400).json({ erro: 'Senha é obrigatória para este perfil' })
    }

    // Verificar nome duplicado
    const dupNome = await query(
      'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND ativo = 1',
      [nome.trim()]
    )
    if (dupNome.length > 0) {
      return res.status(400).json({ erro: 'Já existe um usuário com este nome. Use um nome diferente.' })
    }

    const emailFinal = email || (nome.toLowerCase().replace(/\s+/g, '.') + '.' + Date.now() + '@func.valida.local')
    const senhaHash = await bcrypt.hash(senha || pin, 10)

    const result = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, emailFinal, senhaHash, perfil, loja_id || null, pin || null, tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0]
    )
    res.json({ id: result.lastID, message: 'Usuário criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const { nome, email, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal } = req.body

    if (pin && !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ erro: 'PIN deve ter 4 dígitos numéricos' })
    }

    // Verificar nome duplicado (excluindo o próprio)
    const dupNome = await query(
      'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND ativo = 1 AND id != ?',
      [nome.trim(), id]
    )
    if (dupNome.length > 0) {
      return res.status(400).json({ erro: 'Já existe um usuário com este nome. Use um nome diferente.' })
    }

    let emailFinal = email
    if (!email && (perfil === 'funcionario' || perfil === 'gerente')) {
      const current = await query('SELECT email FROM usuarios WHERE id = ?', [id])
      emailFinal = current[0] ? current[0].email : (nome.toLowerCase().replace(/\s+/g, '.') + '@func.valida.local')
    }

    await run(
      `UPDATE usuarios SET nome = ?, email = ?, perfil = ?, loja_id = ?, pin = ?, 
       tipo_comissao = ?, valor_tarefa_feita = ?, valor_desconto = ?, valor_mensal_fixo = ?, desconto_mensal = ? 
       WHERE id = ?`,
      [nome, emailFinal, perfil, loja_id || null, pin || null, tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0, id]
    )
    res.json({ message: 'Usuário atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    await run('UPDATE usuarios SET ativo = 0 WHERE id = ?', [id])
    res.json({ message: 'Usuário desativado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
