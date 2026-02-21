const { query, run } = require('../config/database')

exports.iniciar = async (req, res) => {
  try {
    const { checklist_id } = req.body
    
    const itens = await query('SELECT COUNT(*) as total FROM checklist_itens WHERE checklist_id = ?', [checklist_id])
    const totalItens = itens[0].total
    
    const checklist = await query('SELECT * FROM checklists WHERE id = ?', [checklist_id])
    
    const result = await run(
      'INSERT INTO execucoes (checklist_id, usuario_id, loja_id, total_itens, status) VALUES (?, ?, ?, ?, ?)',
      [checklist_id, req.userId, checklist[0].loja_id, totalItens, 'em_andamento']
    )
    
    const checklistItens = await query('SELECT * FROM checklist_itens WHERE checklist_id = ? ORDER BY ordem', [checklist_id])
    
    for (const item of checklistItens) {
      await run(
        'INSERT INTO execucoes_itens (execucao_id, checklist_item_id, tipo_resposta) VALUES (?, ?, ?)',
        [result.lastID, item.id, item.tipo_campo]
      )
    }
    
    res.json({ 
      id: result.lastID, 
      message: 'Execução iniciada!',
      total_itens: totalItens 
    })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.responderItem = async (req, res) => {
  try {
    const { execucao_id, item_id, concluido, valor_resposta, observacao, evidencia_base64 } = req.body
    
    await run(
      `UPDATE execucoes_itens SET 
       concluido = ?, valor_resposta = ?, observacao = ?, 
       evidencia_url = ?, respondido_em = CURRENT_TIMESTAMP
       WHERE execucao_id = ? AND checklist_item_id = ?`,
      [concluido ? 1 : 0, valor_resposta || null, observacao || null,
       evidencia_base64 || null, execucao_id, item_id]
    )
    
    const concluidos = await query(
      'SELECT COUNT(*) as total FROM execucoes_itens WHERE execucao_id = ? AND concluido = 1',
      [execucao_id]
    )
    
    await run(
      'UPDATE execucoes SET itens_concluidos = ? WHERE id = ?',
      [concluidos[0].total, execucao_id]
    )
    
    res.json({ message: 'Item respondido!', concluidos: concluidos[0].total })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Manter compatibilidade com o antigo
exports.validarItem = async (req, res) => {
  req.body.concluido = true
  return exports.responderItem(req, res)
}

exports.concluir = async (req, res) => {
  try {
    const { id } = req.params
    const { score } = req.body
    
    // Verificar se todos os itens obrigatórios com evidência foram respondidos
    const pendentes = await query(`
      SELECT ei.*, ci.titulo, ci.evidencia_obrigatoria
      FROM execucoes_itens ei
      JOIN checklist_itens ci ON ei.checklist_item_id = ci.id
      WHERE ei.execucao_id = ? AND ci.evidencia_obrigatoria = 1 
      AND (ei.evidencia_url IS NULL OR ei.evidencia_url = '')
    `, [id])
    
    if (pendentes.length > 0) {
      return res.status(400).json({ 
        erro: 'Existem itens com evidência obrigatória pendente',
        itens_pendentes: pendentes.map(p => p.titulo)
      })
    }
    
    await run(
      'UPDATE execucoes SET status = ?, concluido_em = CURRENT_TIMESTAMP, score = ? WHERE id = ?',
      ['concluido', score, id]
    )
    
    const execucao = await query('SELECT usuario_id FROM execucoes WHERE id = ?', [id])
    await run(
      'UPDATE usuarios SET score = score + ? WHERE id = ?',
      [score, execucao[0].usuario_id]
    )
    
    res.json({ message: 'Execução concluída!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.buscarExecucao = async (req, res) => {
  try {
    const { id } = req.params
    
    const execucao = await query(`
      SELECT e.*, c.titulo as checklist_titulo, c.categoria, c.momento,
             u.nome as usuario_nome, l.nome as loja_nome
      FROM execucoes e 
      LEFT JOIN checklists c ON e.checklist_id = c.id
      LEFT JOIN usuarios u ON e.usuario_id = u.id
      LEFT JOIN lojas l ON e.loja_id = l.id
      WHERE e.id = ?
    `, [id])
    
    const itens = await query(`
      SELECT ei.*, ci.titulo, ci.descricao, ci.critico, ci.ordem,
             ci.tipo_campo, ci.subtipo_numerico, ci.evidencia_obrigatoria,
             ci.tipo_evidencia, ci.peso, ci.rotulo_positivo, ci.rotulo_negativo,
             ci.opcoes_selecao, ci.obrigatorio
      FROM execucoes_itens ei
      LEFT JOIN checklist_itens ci ON ei.checklist_item_id = ci.id
      WHERE ei.execucao_id = ?
      ORDER BY ci.ordem
    `, [id])
    
    res.json({
      ...execucao[0],
      itens
    })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.listar = async (req, res) => {
  try {
    const { loja_id, status, data_inicio, data_fim } = req.query
    
    let sql = `
      SELECT e.*, c.titulo as checklist_titulo, c.categoria, c.momento,
             u.nome as usuario_nome, l.nome as loja_nome
      FROM execucoes e
      LEFT JOIN checklists c ON e.checklist_id = c.id
      LEFT JOIN usuarios u ON e.usuario_id = u.id
      LEFT JOIN lojas l ON e.loja_id = l.id
      WHERE 1=1
    `
    const params = []
    
    if (loja_id) { sql += ' AND e.loja_id = ?'; params.push(loja_id) }
    if (req.query.usuario_id) { sql += ' AND e.usuario_id = ?'; params.push(req.query.usuario_id) }
    if (status) { sql += ' AND e.status = ?'; params.push(status) }
    if (data_inicio) { sql += ' AND DATE(e.iniciado_em) >= ?'; params.push(data_inicio) }
    if (data_fim) { sql += ' AND DATE(e.iniciado_em) <= ?'; params.push(data_fim) }
    
    sql += ' ORDER BY e.iniciado_em DESC LIMIT 100'
    
    const execucoes = await query(sql, params)
    res.json(execucoes)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.dashboard = async (req, res) => {
  try {
    const { loja_id, data_inicio, data_fim, setor, usuario_id, momento } = req.query
    
    let where = 'WHERE 1=1'
    const params = []
    
    if (loja_id) { where += ' AND e.loja_id = ?'; params.push(loja_id) }
    if (data_inicio) { where += ' AND DATE(e.iniciado_em) >= ?'; params.push(data_inicio) }
    if (data_fim) { where += ' AND DATE(e.iniciado_em) <= ?'; params.push(data_fim) }
    if (setor) { where += ' AND c.categoria = ?'; params.push(setor) }
    if (usuario_id) { where += ' AND e.usuario_id = ?'; params.push(usuario_id) }
    if (momento) { where += ' AND c.momento = ?'; params.push(momento) }
    
    // Cards de status
    const status = await query(`
      SELECT 
        COUNT(*) as agendados,
        SUM(CASE WHEN e.status = 'concluido' AND e.concluido_em <= e.iniciado_em THEN 1 ELSE 0 END) as finalizado_tempo,
        SUM(CASE WHEN e.status = 'concluido' AND e.concluido_em > e.iniciado_em THEN 1 ELSE 0 END) as finalizado_atraso,
        SUM(CASE WHEN e.status = 'em_andamento' THEN 1 ELSE 0 END) as iniciado_nao_finalizado,
        SUM(CASE WHEN e.status = 'nao_executado' OR (e.status = 'em_andamento' AND e.itens_concluidos = 0) THEN 1 ELSE 0 END) as nao_executado
      FROM execucoes e
      LEFT JOIN checklists c ON e.checklist_id = c.id
      ${where}
    `, params)
    
    // Taxa de conclusão
    const taxa = await query(`
      SELECT 
        CASE WHEN COUNT(*) > 0 
          THEN ROUND(SUM(CASE WHEN e.status = 'concluido' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)
          ELSE 0 END as taxa_conclusao
      FROM execucoes e
      LEFT JOIN checklists c ON e.checklist_id = c.id
      ${where}
    `, params)
    
    // Ranking por usuários
    const rankUsuarios = await query(`
      SELECT u.nome as nome, 
             CASE WHEN COUNT(*) > 0
               THEN ROUND(SUM(CASE WHEN e.status = 'concluido' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)
               ELSE 0 END as score
      FROM execucoes e
      LEFT JOIN usuarios u ON e.usuario_id = u.id
      LEFT JOIN checklists c ON e.checklist_id = c.id
      ${where}
      GROUP BY e.usuario_id
      ORDER BY score DESC
      LIMIT 10
    `, params)
    
    // Ranking por unidades
    const rankUnidades = await query(`
      SELECT l.nome as nome,
             CASE WHEN COUNT(*) > 0
               THEN ROUND(SUM(CASE WHEN e.status = 'concluido' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)
               ELSE 0 END as score
      FROM execucoes e
      LEFT JOIN lojas l ON e.loja_id = l.id
      LEFT JOIN checklists c ON e.checklist_id = c.id
      ${where}
      GROUP BY e.loja_id
      ORDER BY score DESC
      LIMIT 10
    `, params)
    
    // Ranking por setores
    const rankSetores = await query(`
      SELECT c.categoria as nome,
             CASE WHEN COUNT(*) > 0
               THEN ROUND(SUM(CASE WHEN e.status = 'concluido' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)
               ELSE 0 END as score
      FROM execucoes e
      LEFT JOIN checklists c ON e.checklist_id = c.id
      ${where}
      GROUP BY c.categoria
      ORDER BY score DESC
      LIMIT 10
    `, params)
    
    res.json({
      status: status[0],
      taxa_conclusao: taxa[0].taxa_conclusao,
      rank_usuarios: rankUsuarios,
      rank_unidades: rankUnidades,
      rank_setores: rankSetores
    })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.reverter = async (req, res) => {
  try {
    const { id } = req.params
    await run('DELETE FROM execucoes_itens WHERE execucao_id = ?', [id])
    await run('DELETE FROM execucoes WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}
