const { query, run } = require('../config/database')
const { getAdminId, lojaPertenceAConta } = require('../helpers/adminLojas')

exports.listar = async (req, res) => {
  try {
    const todas = req.query.todas === '1'
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.json([])
    const lojas = todas
      ? await query('SELECT * FROM lojas WHERE ativo >= 0 AND admin_id = ?', [adminId])
      : await query('SELECT * FROM lojas WHERE ativo = 1 AND admin_id = ?', [adminId])
    res.json(lojas)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criar = async (req, res) => {
  try {
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.status(403).json({ erro: 'Conta não encontrada.' })
    const { nome, endereco, cidade, estado, telefone, setores } = req.body
    const result = await run(
      'INSERT INTO lojas (nome, endereco, cidade, estado, telefone, setores, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nome, endereco, cidade, estado, telefone, setores, adminId]
    )
    res.json({ id: result.lastID, message: 'Loja criada!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const { nome, endereco, cidade, estado, telefone, setores, ativo } = req.body
    const ativoVal = ativo === undefined ? 1 : (ativo === false || ativo === 0 || ativo === '0') ? 0 : 1
    await run(
      'UPDATE lojas SET nome = ?, endereco = ?, cidade = ?, estado = ?, telefone = ?, setores = ?, ativo = ? WHERE id = ?',
      [nome, endereco, cidade, estado, telefone, setores, ativoVal, id]
    )
    res.json({ message: 'Loja atualizada!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    await run('UPDATE lojas SET ativo = -1 WHERE id = ?', [id])
    res.json({ message: 'Loja desativada!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Toggle aberta/fechada
exports.obterPorId = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const rows = await query('SELECT * FROM lojas WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ erro: 'Loja não encontrada' })
    res.json(rows[0])
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

exports.toggleAberta = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const loja = await query('SELECT aberta FROM lojas WHERE id = ?', [id])
    if (!loja.length) return res.status(404).json({ erro: 'Loja não encontrada' })
    const novoStatus = loja[0].aberta ? 0 : 1
    await run('UPDATE lojas SET aberta = ? WHERE id = ?', [novoStatus, id])
    res.json({ aberta: novoStatus })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

// Atualizar hora_reset
exports.atualizarReset = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    await run('UPDATE lojas SET hora_reset = ? WHERE id = ?', [req.body.hora_reset, id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

// Listar horários da loja
exports.listarHorarios = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const rows = await query('SELECT * FROM loja_horarios WHERE loja_id = ? ORDER BY dia_semana', [id])
    res.json(rows)
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

// Salvar horários (recebe array completo)
exports.salvarHorarios = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    await run('DELETE FROM loja_horarios WHERE loja_id = ?', [id])
    for (const h of req.body.horarios) {
      await run('INSERT INTO loja_horarios (loja_id, dia_semana, hora_abertura, hora_fechamento) VALUES (?,?,?,?)',
        [id, h.dia_semana, h.hora_abertura, h.hora_fechamento])
    }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

// Listar fechamentos
exports.listarFechamentos = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const rows = await query('SELECT * FROM loja_fechamentos WHERE loja_id = ? ORDER BY data', [id])
    res.json(rows)
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

// Adicionar fechamento
exports.adicionarFechamento = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const r = await run('INSERT INTO loja_fechamentos (loja_id, data, motivo) VALUES (?,?,?)',
      [id, req.body.data, req.body.motivo || null])
    res.json({ id: r.lastID })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

// Remover fechamento
exports.removerFechamento = async (req, res) => {
  try {
    const { fid } = req.params
    // fechamento não tem admin_id direto: confere pela loja a que ele pertence
    const fechamento = await query('SELECT loja_id FROM loja_fechamentos WHERE id = ?', [fid])
    if (!fechamento.length) return res.status(404).json({ erro: 'Fechamento não encontrado' })
    if (!(await lojaPertenceAConta(fechamento[0].loja_id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Fechamento não encontrado' })
    }
    await run('DELETE FROM loja_fechamentos WHERE id = ?', [fid])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}
