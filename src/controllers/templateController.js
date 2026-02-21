const { query, run } = require('../config/database')

exports.listar = async (req, res) => {
  try {
    const templates = await query('SELECT * FROM templates WHERE ativo = 1')
    for (var t of templates) {
      t.itens = await query('SELECT * FROM template_itens WHERE template_id = ? ORDER BY ordem', [t.id])
    }
    res.json(templates)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.obter = async (req, res) => {
  try {
    const t = await query('SELECT * FROM templates WHERE id = ? AND ativo = 1', [req.params.id])
    if (!t[0]) return res.status(404).json({ erro: 'Template não encontrado' })
    t[0].itens = await query('SELECT * FROM template_itens WHERE template_id = ? ORDER BY ordem', [t[0].id])
    res.json(t[0])
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criar = async (req, res) => {
  try {
    const { titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim, itens } = req.body
    const result = await run(
      'INSERT INTO templates (titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim) VALUES (?, ?, ?, ?, ?, ?)',
      [titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim]
    )
    if (itens && itens.length > 0) {
      for (var i = 0; i < itens.length; i++) {
        await run(
          'INSERT INTO template_itens (template_id, titulo, descricao, ordem, critico) VALUES (?, ?, ?, ?, ?)',
          [result.lastID, itens[i].titulo, itens[i].descricao || '', itens[i].ordem || i + 1, itens[i].critico ? 1 : 0]
        )
      }
    }
    res.json({ id: result.lastID, message: 'Template criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim, itens } = req.body
    await run(
      'UPDATE templates SET titulo = ?, descricao = ?, categoria = ?, recorrencia = ?, horario_inicio = ?, horario_fim = ? WHERE id = ?',
      [titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim, req.params.id]
    )
    if (itens) {
      await run('DELETE FROM template_itens WHERE template_id = ?', [req.params.id])
      for (var i = 0; i < itens.length; i++) {
        await run(
          'INSERT INTO template_itens (template_id, titulo, descricao, ordem, critico) VALUES (?, ?, ?, ?, ?)',
          [req.params.id, itens[i].titulo, itens[i].descricao || '', itens[i].ordem || i + 1, itens[i].critico ? 1 : 0]
        )
      }
    }
    res.json({ message: 'Template atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    await run('UPDATE templates SET ativo = 0 WHERE id = ?', [req.params.id])
    res.json({ message: 'Template removido!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.aplicar = async (req, res) => {
  try {
    const { template_id, loja_id } = req.body
    const t = await query('SELECT * FROM templates WHERE id = ?', [template_id])
    if (!t[0]) return res.status(404).json({ erro: 'Template não encontrado' })
    const itens = await query('SELECT * FROM template_itens WHERE template_id = ? ORDER BY ordem', [template_id])
    const result = await run(
      'INSERT INTO checklists (titulo, descricao, categoria, loja_id, criado_por, horario_inicio, horario_fim, recorrencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [t[0].titulo, t[0].descricao, t[0].categoria, loja_id, req.userId, t[0].horario_inicio, t[0].horario_fim, t[0].recorrencia]
    )
    for (var item of itens) {
      await run(
        'INSERT INTO checklist_itens (checklist_id, titulo, descricao, ordem, critico) VALUES (?, ?, ?, ?, ?)',
        [result.lastID, item.titulo, item.descricao, item.ordem, item.critico]
      )
    }
    res.json({ id: result.lastID, message: 'Template aplicado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
