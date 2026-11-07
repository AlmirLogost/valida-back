const { query, run } = require('../config/database')
const { getAdminId, lojaPertenceAConta, getLojaIdsVisiveis } = require('../helpers/adminLojas')
const { registrarAuditoria } = require('../middlewares/permissoes')

exports.listar = async (req, res) => {
  try {
    const todas = req.query.todas === '1'
    const arquivadas = req.query.arquivadas === '1'
    const { busca } = req.query
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.json([])
    const condicaoAtivo = arquivadas ? '= -1' : (todas ? '>= 0' : '= 1')
    let sql = `SELECT * FROM lojas WHERE ativo ${condicaoAtivo} AND admin_id = ?`
    const params = [adminId]
    if (!arquivadas) {
      // Dono vê todas as lojas ativas da conta; qualquer outro perfil só
      // vê as unidades vinculadas a ele (usuario_lojas) — gerente da
      // unidade A não vê a loja B, mesmo sendo da mesma conta. Lojas
      // arquivadas são restauradas só pelo dono (unidades.arquivar), por
      // isso não entram nesse filtro por unidade.
      const lojaIdsVisiveis = await getLojaIdsVisiveis(req.userId, req.userPerfil)
      sql += ' AND id = ANY(?)'
      params.push(lojaIdsVisiveis)
    }
    if (busca) { sql += ' AND nome ILIKE ?'; params.push(`%${busca}%`) }
    sql += ' ORDER BY nome'
    const lojas = await query(sql, params)
    res.json(lojas)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Resumo de impacto antes de arquivar — quantas tarefas e pessoas estão
// nessa unidade, pra avisar o dono do que vai ficar "pausado" junto.
exports.impactoArquivamento = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await lojaPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const [[tarefas], [pessoas]] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM checklists WHERE loja_id = ? AND ativo = 1', [id]),
      query('SELECT COUNT(*) AS total FROM usuarios WHERE loja_id = ? AND ativo = 1', [id])
    ])
    res.json({ tarefas: Number(tarefas.total), pessoas: Number(pessoas.total) })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Restaura uma unidade arquivada (ativo = -1 -> 1), limpando quem/quando
// arquivou.
exports.restaurar = async (req, res) => {
  try {
    const { id } = req.params
    // lojaPertenceAConta (via getLojaIds) só considera lojas com ativo >= 0
    // — uma loja ARQUIVADA tem ativo = -1 e não passaria nessa checagem.
    // Pra restaurar, confere direto pelo admin_id, aceitando qualquer
    // status.
    const adminId = await getAdminId(req.userId, req.userPerfil)
    const rows = await query('SELECT admin_id FROM lojas WHERE id = ?', [id])
    if (!adminId || !rows.length || rows[0].admin_id !== adminId) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    await run('UPDATE lojas SET ativo = 1, arquivado_em = NULL, arquivado_por = NULL WHERE id = ?', [id])
    await registrarAuditoria(req, { acao: 'restaurar', entidade: 'loja', entidade_id: id })
    res.json({ message: 'Loja restaurada!' })
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
    await registrarAuditoria(req, { acao: 'criar', entidade: 'loja', entidade_id: result.lastID, detalhes: { nome } })
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
    await registrarAuditoria(req, { acao: 'editar', entidade: 'loja', entidade_id: id, detalhes: { nome } })
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
    await run('UPDATE lojas SET ativo = -1, arquivado_em = NOW(), arquivado_por = ? WHERE id = ?', [req.userId, id])
    await registrarAuditoria(req, { acao: 'arquivar', entidade: 'loja', entidade_id: id })
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
