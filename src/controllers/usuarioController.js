const bcrypt = require('bcrypt')
const { query, run } = require('../config/database')

exports.listar = async (req, res) => {
  try {
    const { loja_id } = req.query
    let sql = 'SELECT id, nome, email, perfil, loja_id, ativo, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim, score FROM usuarios WHERE ativo = 1'
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
    const { nome, email, senha, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim } = req.body

    // Buscar configuração do perfil para determinar método de login
    const perfilConfig = await query('SELECT * FROM perfis WHERE nome = ? AND ativo = 1', [perfil])
    const metodoLogin = perfilConfig.length > 0 ? perfilConfig[0].metodo_login : 'email_senha'

    if (metodoLogin === 'pin') {
      // Perfis com login por PIN: PIN obrigatório, email opcional
      if (!pin || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ erro: 'PIN de 4 dígitos é obrigatório para este perfil' })
      }
    } else {
      // Perfis com login por email/senha
      if (!email) return res.status(400).json({ erro: 'Email é obrigatório para este perfil' })
      if (!senha) return res.status(400).json({ erro: 'Senha é obrigatória para este perfil' })
    }

    // Verificar nome duplicado apenas na mesma loja
    let dupNome = []
    if (loja_id) {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id = ? AND ativo = 1',
        [nome.trim(), loja_id]
      )
    } else {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id IS NULL AND ativo = 1',
        [nome.trim()]
      )
    }
    if (dupNome.length > 0) {
      return res.status(400).json({ erro: 'Já existe um colaborador com este nome nesta loja.' })
    }

    const emailFinal = email || (nome.toLowerCase().replace(/\s+/g, '.') + '.' + Date.now() + '@func.valida.local')
    const senhaHash = await bcrypt.hash(senha || pin, 10)

    const result = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, emailFinal, senhaHash, perfil, loja_id || null, pin || null, tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0, periodo_comissao || 'mensal', periodo_inicio || null, periodo_fim || null]
    )
    res.json({ id: result.lastID, message: 'Usuário criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const { nome, email, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim } = req.body

    if (pin && !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ erro: 'PIN deve ter 4 dígitos numéricos' })
    }

    // Verificar nome duplicado na mesma loja (excluindo o próprio)
    let dupNome = []
    if (loja_id) {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id = ? AND ativo = 1 AND id != ?',
        [nome.trim(), loja_id, id]
      )
    } else {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id IS NULL AND ativo = 1 AND id != ?',
        [nome.trim(), id]
      )
    }
    if (dupNome.length > 0) {
      return res.status(400).json({ erro: 'Já existe um colaborador com este nome nesta loja.' })
    }

    // Buscar configuração do perfil para determinar se email é opcional
    const perfilConfig = await query('SELECT * FROM perfis WHERE nome = ? AND ativo = 1', [perfil])
    const metodoLogin = perfilConfig.length > 0 ? perfilConfig[0].metodo_login : 'email_senha'

    let emailFinal = email
    if (!email && metodoLogin === 'pin') {
      const current = await query('SELECT email FROM usuarios WHERE id = ?', [id])
      emailFinal = current[0] ? current[0].email : (nome.toLowerCase().replace(/\s+/g, '.') + '@func.valida.local')
    }

    await run(
      `UPDATE usuarios SET nome = ?, email = ?, perfil = ?, loja_id = ?, pin = ?, 
       tipo_comissao = ?, valor_tarefa_feita = ?, valor_desconto = ?, valor_mensal_fixo = ?, desconto_mensal = ?, periodo_comissao = ?, periodo_inicio = ?, periodo_fim = ? 
       WHERE id = ?`,
      [nome, emailFinal, perfil, loja_id || null, pin || null, tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0, periodo_comissao || 'mensal', periodo_inicio || null, periodo_fim || null, id]
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
