const { query, run } = require('../config/database')

exports.listar = async (req, res) => {
  try {
    const { checklist_id } = req.params
    const itens = await query(
      'SELECT * FROM checklist_itens WHERE checklist_id = ? ORDER BY ordem',
      [checklist_id]
    )
    res.json(itens)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criar = async (req, res) => {
  try {
    const { checklist_id } = req.params
    const { titulo, descricao, ordem, tipo_campo, obrigatorio, critico,
            evidencia_obrigatoria, tipo_evidencia, subtipo_numerico,
            opcoes_selecao, peso, rotulo_positivo, rotulo_negativo } = req.body
    
    const result = await run(
      `INSERT INTO checklist_itens 
       (checklist_id, titulo, descricao, ordem, tipo_campo, obrigatorio, critico,
        evidencia_obrigatoria, tipo_evidencia, subtipo_numerico, opcoes_selecao,
        peso, rotulo_positivo, rotulo_negativo) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [checklist_id, titulo, descricao || null, ordem || 0,
       tipo_campo || 'boolean', obrigatorio !== false ? 1 : 0, critico || 0,
       evidencia_obrigatoria || 0, tipo_evidencia || 'imagem',
       subtipo_numerico || 'inteiro', opcoes_selecao || null,
       peso || 1, rotulo_positivo || 'Feito', rotulo_negativo || 'Não Feito']
    )
    
    res.json({ id: result.lastID, message: 'Item criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const { titulo, descricao, ordem, tipo_campo, obrigatorio, critico,
            evidencia_obrigatoria, tipo_evidencia, subtipo_numerico,
            opcoes_selecao, peso, rotulo_positivo, rotulo_negativo } = req.body
    
    await run(
      `UPDATE checklist_itens SET 
       titulo=?, descricao=?, ordem=?, tipo_campo=?, obrigatorio=?, critico=?,
       evidencia_obrigatoria=?, tipo_evidencia=?, subtipo_numerico=?,
       opcoes_selecao=?, peso=?, rotulo_positivo=?, rotulo_negativo=?
       WHERE id=?`,
      [titulo, descricao || null, ordem || 0,
       tipo_campo || 'boolean', obrigatorio !== false ? 1 : 0, critico || 0,
       evidencia_obrigatoria || 0, tipo_evidencia || 'imagem',
       subtipo_numerico || 'inteiro', opcoes_selecao || null,
       peso || 1, rotulo_positivo || 'Feito', rotulo_negativo || 'Não Feito', id]
    )
    
    res.json({ message: 'Item atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    await run('DELETE FROM checklist_itens WHERE id = ?', [id])
    res.json({ message: 'Item deletado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
