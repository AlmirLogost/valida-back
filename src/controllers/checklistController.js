const { query, run } = require('../config/database')
exports.listar = async (req, res) => {
  try {
    let sql = `
      SELECT c.*, u.nome as criador, l.nome as loja_nome
      FROM checklists c 
      LEFT JOIN usuarios u ON c.criado_por = u.id 
      LEFT JOIN lojas l ON c.loja_id = l.id
      WHERE c.ativo = 1
    `
    if (req.userPerfil !== 'super_admin') {
      const user = await query('SELECT loja_id FROM usuarios WHERE id = ?', [req.userId])
      if (user[0]?.loja_id) {
        sql += ` AND c.loja_id = ${user[0].loja_id}`
      }
    }
    sql += ' ORDER BY c.criado_em DESC'
    const checklists = await query(sql)
    res.json(checklists)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.criar = async (req, res) => {
  try {
    const b = req.body
    const result = await run(
      `INSERT INTO checklists (titulo, descricao, categoria, loja_id, criado_por, 
       horario_inicio, horario_fim, recorrencia, data_mensal, dias_semana, momento,
       tipo_campo, evidencia_obrigatoria, tipo_evidencia, critico,
       subtipo_numerico, peso, rotulo_positivo, rotulo_negativo,
       data_inicio, data_termino, repeticao_intervalo, tolerancia_min) 
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.titulo, b.descricao, b.categoria, b.loja_id||null, req.userId, 
       b.horario_inicio, b.horario_fim, b.recorrencia,
       b.data_mensal||null, b.dias_semana||null, b.momento||'outros',
       b.tipo_campo||'boolean', b.evidencia_obrigatoria||0, b.tipo_evidencia||'imagem',
       b.critico||0, b.subtipo_numerico||'inteiro', b.peso||1,
       b.rotulo_positivo||'Feito', b.rotulo_negativo||'Nao Feito',
       b.data_inicio||null, b.data_termino||null, b.repeticao_intervalo||1, b.tolerancia_min||30, b.tolerancia_min||30]
    )
    res.json({ id: result.lastID, message: 'Checklist criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const b = req.body
    await run(
      `UPDATE checklists SET titulo=?, descricao=?, categoria=?, loja_id=?, 
       horario_inicio=?, horario_fim=?, recorrencia=?, data_mensal=?, dias_semana=?, momento=?,
       tipo_campo=?, evidencia_obrigatoria=?, tipo_evidencia=?, critico=?,
       subtipo_numerico=?, peso=?, rotulo_positivo=?, rotulo_negativo=?,
       data_inicio=?, data_termino=?, repeticao_intervalo=?, tolerancia_min=?
       WHERE id=?`,
      [b.titulo, b.descricao, b.categoria, b.loja_id, b.horario_inicio, b.horario_fim, 
       b.recorrencia, b.data_mensal||null, b.dias_semana||null, b.momento||'outros',
       b.tipo_campo||'boolean', b.evidencia_obrigatoria||0, b.tipo_evidencia||'imagem',
       b.critico||0, b.subtipo_numerico||'inteiro', b.peso||1,
       b.rotulo_positivo||'Feito', b.rotulo_negativo||'Nao Feito',
       b.data_inicio||null, b.data_termino||null, b.repeticao_intervalo||1, id]
    )
    res.json({ id: parseInt(id), message: 'Checklist atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    await run('UPDATE checklists SET ativo = 0 WHERE id = ?', [id])
    res.json({ message: 'Checklist desativado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params
    const checklist = await query('SELECT ativo FROM checklists WHERE id = ?', [id])
    const novoStatus = checklist[0].ativo ? 0 : 1
    await run('UPDATE checklists SET ativo = ? WHERE id = ?', [novoStatus, id])
    res.json({ message: 'Status atualizado!', ativo: novoStatus })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
