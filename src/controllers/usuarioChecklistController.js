const { query, run } = require('../config/database')

exports.listarChecklists = async (req, res) => {
  try {
    const { usuario_id } = req.params
    
    const vinculados = await query(`
      SELECT c.*, uc.id as vinculo_id
      FROM checklists c
      INNER JOIN usuario_checklists uc ON c.id = uc.checklist_id
      WHERE uc.usuario_id = ? AND uc.ativo = 1 AND c.ativo = 1
    `, [usuario_id])
    
    res.json(vinculados)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.listarDisponiveis = async (req, res) => {
  try {
    const { usuario_id } = req.params
    
    // Busca usuário e sua loja
    const user = await query('SELECT loja_id FROM usuarios WHERE id = ?', [usuario_id])
    if (!user[0]) return res.json([])
    
    const lojaId = user[0].loja_id
    
    // Checklists da loja que NÃO estão vinculados ao usuário
    const disponiveis = await query(`
      SELECT c.*
      FROM checklists c
      WHERE c.loja_id = ? 
        AND c.ativo = 1
        AND c.id NOT IN (
          SELECT checklist_id 
          FROM usuario_checklists 
          WHERE usuario_id = ? AND ativo = 1
        )
    `, [lojaId, usuario_id])
    
    res.json(disponiveis)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.vincular = async (req, res) => {
  try {
    const { usuario_id, checklist_id } = req.body
    
    await run(
      'INSERT OR IGNORE INTO usuario_checklists (usuario_id, checklist_id) VALUES (?, ?)',
      [usuario_id, checklist_id]
    )
    
    res.json({ message: 'Checklist vinculado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.desvincular = async (req, res) => {
  try {
    const { id } = req.params
    
    await run('UPDATE usuario_checklists SET ativo = 0 WHERE id = ?', [id])
    
    res.json({ message: 'Checklist desvinculado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.listarTodos = async (req, res) => {
  try {
    const { query } = require('../config/database')
    const vinculos = await query(`
      SELECT uc.*, u.nome as usuario_nome 
      FROM usuario_checklists uc
      LEFT JOIN usuarios u ON uc.usuario_id = u.id
      WHERE uc.ativo = 1
    `)
    res.json(vinculos)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
