const { query, run } = require('../config/database')

exports.listar = async (req, res) => {
  try {
    const { checklist_id, data_inicio, data_fim, loja_id } = req.query
    let sql = 'SELECT cd.*, c.titulo as checklist_titulo FROM checklist_datas cd LEFT JOIN checklists c ON cd.checklist_id = c.id WHERE 1=1'
    const params = []

    if (checklist_id) {
      sql += ' AND cd.checklist_id = ?'
      params.push(checklist_id)
    }
    if (loja_id) {
      sql += ' AND c.loja_id = ?'
      params.push(loja_id)
    }
    if (data_inicio && data_fim) {
      sql += ' AND cd.data BETWEEN ? AND ?'
      params.push(data_inicio, data_fim)
    } else if (data_inicio) {
      sql += ' AND cd.data = ?'
      params.push(data_inicio)
    }

    sql += ' ORDER BY cd.data ASC'
    const rows = await query(sql, params)
    res.json(rows)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criar = async (req, res) => {
  try {
    const { checklist_id, data, tipo } = req.body
    const result = await run(
      'INSERT INTO checklist_datas (checklist_id, data, tipo) VALUES (?, ?, ?)',
      [checklist_id, data, tipo]
    )
    res.json({ id: result.lastID, message: 'Data registrada!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criarLote = async (req, res) => {
  try {
    const { checklist_id, data_inicio, data_fim, tipo } = req.body
    const inicio = new Date(data_inicio)
    const fim = new Date(data_fim)
    const ids = []

    for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
      const dataStr = d.toISOString().split('T')[0]
      const result = await run(
        'INSERT INTO checklist_datas (checklist_id, data, tipo) VALUES (?, ?, ?)',
        [checklist_id, dataStr, tipo]
      )
      ids.push(result.lastID)
    }

    res.json({ ids, message: ids.length + ' datas registradas!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    await run('DELETE FROM checklist_datas WHERE id = ?', [id])
    res.json({ message: 'Data removida!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletarPorChecklist = async (req, res) => {
  try {
    const { checklist_id } = req.params
    const { tipo } = req.query
    let sql = 'DELETE FROM checklist_datas WHERE checklist_id = ?'
    const params = [checklist_id]
    if (tipo) {
      sql += ' AND tipo = ?'
      params.push(tipo)
    }
    const result = await run(sql, params)
    res.json({ message: result.changes + ' datas removidas!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
