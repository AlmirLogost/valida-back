const { query, run } = require('../config/database')
const { getLojaIds, getLojaIdsVisiveis, checklistPertenceAConta } = require('../helpers/adminLojas')
exports.listar = async (req, res) => {
  try {
    // Dono vê as tarefas de todas as lojas da conta; qualquer outro perfil
    // só vê as das unidades vinculadas a ele (usuario_lojas) — cobre quem
    // tem mais de uma unidade também, o que a checagem antiga (só
    // usuarios.loja_id) não cobria.
    const lojaIds = await getLojaIdsVisiveis(req.userId, req.userPerfil)
    let sql = `
      SELECT c.*, u.nome as criador, l.nome as loja_nome
      FROM checklists c
      LEFT JOIN usuarios u ON c.criado_por = u.id
      LEFT JOIN lojas l ON c.loja_id = l.id
      WHERE c.ativo = 1 AND c.loja_id = ANY(?)
    `
    const params = [lojaIds]
    sql += ' ORDER BY c.criado_em DESC'
    const checklists = await query(sql, params)
    res.json(checklists)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.criar = async (req, res) => {
  try {
    const b = req.body
    const lojaIds = await getLojaIds(req.userId, req.userPerfil)
    if (!b.loja_id || !lojaIds.includes(parseInt(b.loja_id))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const tipoTarefa = b.tipo === 'lider' ? 'lider' : 'operador'
    const result = await run(
      `INSERT INTO checklists (titulo, descricao, categoria, loja_id, criado_por,
       horario_inicio, horario_fim, recorrencia, data_mensal, data_pontual, dias_semana, momento,
       tipo_campo, evidencia_obrigatoria, tipo_evidencia, critico,
       subtipo_numerico, peso, rotulo_positivo, rotulo_negativo,
       data_inicio, data_termino, repeticao_intervalo, tolerancia_min, tipo)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.titulo, b.descricao, b.categoria, b.loja_id||null, req.userId,
       b.horario_inicio, b.horario_fim, b.recorrencia,
       b.data_mensal||null, b.data_pontual||null, b.dias_semana||null, b.momento||'outros',
       b.tipo_campo||'boolean', b.evidencia_obrigatoria||0, b.tipo_evidencia||'imagem',
       b.critico||0, b.subtipo_numerico||'inteiro', b.peso||1,
       b.rotulo_positivo||'Feito', b.rotulo_negativo||'Nao Feito',
       b.data_inicio||null, b.data_termino||null, b.repeticao_intervalo||1, b.tolerancia_min||30, tipoTarefa]
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
    if (!(await checklistPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Tarefa não encontrada' })
    }
    if (b.loja_id) {
      const lojaIds = await getLojaIds(req.userId, req.userPerfil)
      if (!lojaIds.includes(parseInt(b.loja_id))) {
        return res.status(404).json({ erro: 'Loja não encontrada' })
      }
    }
    const campos = ['titulo=?', 'descricao=?', 'categoria=?', 'loja_id=?',
       'horario_inicio=?', 'horario_fim=?', 'recorrencia=?', 'data_mensal=?', 'data_pontual=?', 'dias_semana=?', 'momento=?',
       'tipo_campo=?', 'evidencia_obrigatoria=?', 'tipo_evidencia=?', 'critico=?',
       'subtipo_numerico=?', 'peso=?', 'rotulo_positivo=?', 'rotulo_negativo=?',
       'data_inicio=?', 'data_termino=?', 'repeticao_intervalo=?', 'tolerancia_min=?']
    const valores = [b.titulo, b.descricao, b.categoria, b.loja_id, b.horario_inicio, b.horario_fim,
       b.recorrencia, b.data_mensal||null, b.data_pontual||null, b.dias_semana||null, b.momento||'outros',
       b.tipo_campo||'boolean', b.evidencia_obrigatoria||0, b.tipo_evidencia||'imagem',
       b.critico||0, b.subtipo_numerico||'inteiro', b.peso||1,
       b.rotulo_positivo||'Feito', b.rotulo_negativo||'Nao Feito',
       b.data_inicio||null, b.data_termino||null, b.repeticao_intervalo||1, b.tolerancia_min||30]
    // tipo (líder/operador) só é alterado se vier no corpo — editar outro
    // campo da tarefa não deve mudar a aba em que ela aparece por acidente.
    if (b.tipo === 'lider' || b.tipo === 'operador') {
      campos.push('tipo=?')
      valores.push(b.tipo)
    }
    valores.push(id)
    await run(`UPDATE checklists SET ${campos.join(', ')} WHERE id=?`, valores)
    res.json({ id: parseInt(id), message: 'Checklist atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await checklistPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Tarefa não encontrada' })
    }
    await run('UPDATE checklists SET ativo = 0 WHERE id = ?', [id])
    res.json({ message: 'Checklist desativado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await checklistPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Tarefa não encontrada' })
    }
    const checklist = await query('SELECT ativo FROM checklists WHERE id = ?', [id])
    const novoStatus = checklist[0].ativo ? 0 : 1
    await run('UPDATE checklists SET ativo = ? WHERE id = ?', [novoStatus, id])
    res.json({ message: 'Status atualizado!', ativo: novoStatus })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
exports.togglePausado = async (req, res) => {
  try {
    const { id } = req.params
    const { tipo, ate } = req.body || {}
    if (!(await checklistPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Tarefa não encontrada' })
    }

    // Migrations seguras: adiciona colunas se não existirem
    await run(`ALTER TABLE checklists ADD COLUMN pausado BOOLEAN DEFAULT 0`).catch(() => {})
    await run(`ALTER TABLE checklists ADD COLUMN pausado_tipo TEXT`).catch(() => {})
    await run(`ALTER TABLE checklists ADD COLUMN pausado_ate TEXT`).catch(() => {})

    const checklist = await query('SELECT pausado, pausado_tipo FROM checklists WHERE id = ?', [id])
    if (!checklist[0]) return res.status(404).json({ erro: 'Tarefa não encontrada' })

    const jaPausado = checklist[0].pausado

    if (jaPausado) {
      // Retomar: limpa os dados de pausa
      await run(
        'UPDATE checklists SET pausado = 0, pausado_tipo = NULL, pausado_ate = NULL WHERE id = ?',
        [id]
      )
      return res.json({
        pausado: 0,
        pausado_tipo: null,
        pausado_ate: null,
        message: 'Tarefa retomada!'
      })
    }

    // Pausar: tipo e ate vêm prontos do frontend
    const tipoFinal = tipo || 'indeterminado'
    const pausadoAte = ate || null

    await run(
      'UPDATE checklists SET pausado = 1, pausado_tipo = ?, pausado_ate = ? WHERE id = ?',
      [tipoFinal, pausadoAte, id]
    )

    return res.json({
      pausado: 1,
      pausado_tipo: tipoFinal,
      pausado_ate: pausadoAte,
      message: 'Tarefa pausada!'
    })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
