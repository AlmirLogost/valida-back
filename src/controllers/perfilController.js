const { query, run } = require('../config/database')

const PERM_COLS = [
  'perm_dashboard', 'perm_criar_tarefas', 'perm_executar_tarefas',
  'perm_conferir', 'perm_gerenciar_equipe', 'perm_gerenciar_lojas',
  'perm_relatorios', 'perm_configuracoes'
]

// Listar perfis ativos (filtrar por loja_id quando fornecido)
exports.listar = async (req, res) => {
  try {
    const { loja_id } = req.query
    let sql = 'SELECT * FROM perfis WHERE ativo = 1'
    const params = []
    if (loja_id) {
      sql += ' AND (loja_id = ? OR loja_id IS NULL)'
      params.push(loja_id)
    }
    sql += ' ORDER BY ordem ASC, rotulo ASC'
    const perfis = await query(sql, params)
    res.json(perfis)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Criar novo perfil com permissoes
exports.criar = async (req, res) => {
  try {
    const { nome, rotulo, metodo_login, pode_acessar_painel, cor, loja_id } = req.body

    if (!rotulo) {
      return res.status(400).json({ erro: 'Nome do cargo e obrigatorio' })
    }

    const slug = (nome || rotulo).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

    const existente = await query(
      'SELECT id, nome FROM perfis WHERE nome = ? AND (loja_id = ? OR (loja_id IS NULL AND ? IS NULL)) AND ativo = 1',
      [slug, loja_id || null, loja_id || null]
    )
    if (existente.length > 0) {
      // Já existe — retorna o existente em vez de erro
      return res.json({ id: existente[0].id, nome: existente[0].nome, message: 'Cargo já existia' })
    }

    const maxOrdem = await query('SELECT MAX(ordem) as max FROM perfis')
    const proximaOrdem = (maxOrdem[0]?.max || 0) + 1

    const permValues = PERM_COLS.map(col => req.body[col] ? 1 : 0)
    
    const temAcessoPainel = pode_acessar_painel || 
      req.body.perm_dashboard || req.body.perm_criar_tarefas || 
      req.body.perm_conferir || req.body.perm_gerenciar_equipe || 
      req.body.perm_gerenciar_lojas || req.body.perm_relatorios || 
      req.body.perm_configuracoes

    const result = await run(
      `INSERT INTO perfis (nome, rotulo, loja_id, metodo_login, pode_acessar_painel, cor, ordem,
        ${PERM_COLS.join(', ')}) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ${PERM_COLS.map(() => '?').join(', ')})`,
      [
        slug, rotulo.trim(), loja_id || null,
        metodo_login || 'pin', temAcessoPainel ? 1 : 0,
        cor || '#3483fa', proximaOrdem,
        ...permValues
      ]
    )

    res.json({ id: result.lastID, nome: slug, message: 'Cargo criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Atualizar perfil com permissoes
exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const { rotulo, metodo_login, pode_acessar_painel, cor } = req.body

    const perfil = await query('SELECT * FROM perfis WHERE id = ?', [id])
    if (perfil.length === 0) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }

    const permValues = PERM_COLS.map(col => 
      req.body[col] !== undefined ? (req.body[col] ? 1 : 0) : perfil[0][col]
    )

    const temAcessoPainel = pode_acessar_painel ||
      permValues[0] || permValues[1] || permValues[3] || 
      permValues[4] || permValues[5] || permValues[6] || permValues[7]

    if (perfil[0].sistema) {
      const permUpdate = PERM_COLS.map(col => `${col} = ?`).join(', ')
      await run(
        `UPDATE perfis SET rotulo = ?, cor = ?, pode_acessar_painel = ?, ${permUpdate} WHERE id = ?`,
        [rotulo || perfil[0].rotulo, cor || perfil[0].cor, temAcessoPainel ? 1 : 0, ...permValues, id]
      )
      return res.json({ message: 'Perfil atualizado!' })
    }

    const permUpdate = PERM_COLS.map(col => `${col} = ?`).join(', ')
    await run(
      `UPDATE perfis SET rotulo = ?, metodo_login = ?, pode_acessar_painel = ?, cor = ?, ${permUpdate} WHERE id = ?`,
      [
        rotulo || perfil[0].rotulo,
        metodo_login || perfil[0].metodo_login,
        temAcessoPainel ? 1 : 0,
        cor || perfil[0].cor,
        ...permValues, id
      ]
    )
    res.json({ message: 'Perfil atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Deletar perfil (soft delete)
exports.deletar = async (req, res) => {
  try {
    const { id } = req.params

    const perfil = await query('SELECT * FROM perfis WHERE id = ?', [id])
    if (perfil.length === 0) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }
    if (perfil[0].sistema) {
      return res.status(403).json({ erro: 'Nao e possivel excluir perfis do sistema' })
    }

    const usuarios = await query(
      'SELECT COUNT(*) as total FROM usuarios WHERE perfil = ? AND ativo = 1',
      [perfil[0].nome]
    )
    if (usuarios[0].total > 0) {
      return res.status(400).json({ 
        erro: `Existem ${usuarios[0].total} usuario(s) com este perfil. Reatribua-os antes de excluir.` 
      })
    }

    await run('UPDATE perfis SET ativo = 0 WHERE id = ?', [id])
    res.json({ message: 'Perfil excluido!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
