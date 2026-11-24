const { query, run } = require('../config/database')
const { getLojaIdsVisiveis, checklistPertenceAConta, getAdminId, resolverPerfilPorNome } = require('../helpers/adminLojas')

// Tarefa atribuída a um CARGO inteiro (Fase 5, bloco E5) — tabela separada
// de usuario_checklists (ver migration 017). "Quem faz" uma tarefa é a
// união dos vínculos diretos com os vínculos por cargo; quem entra no
// cargo depois passa a receber a tarefa, quem sai deixa de receber.

// Confere se um vínculo checklist<->cargo pertence à conta do usuário logado.
async function vinculoCargoPertenceAConta(vinculoId, userId, userPerfil) {
  const rows = await query('SELECT checklist_id FROM checklist_cargos WHERE id = ?', [vinculoId])
  if (!rows.length) return false
  return checklistPertenceAConta(rows[0].checklist_id, userId, userPerfil)
}

exports.listarTodos = async (req, res) => {
  try {
    const lojaIds = await getLojaIdsVisiveis(req.userId, req.userPerfil)
    const vinculos = await query(`
      SELECT cc.*, c.titulo as checklist_titulo, c.loja_id as checklist_loja_id
      FROM checklist_cargos cc
      LEFT JOIN checklists c ON cc.checklist_id = c.id
      WHERE cc.ativo = 1 AND c.loja_id = ANY(?)
    `, [lojaIds])
    res.json(vinculos)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.vincular = async (req, res) => {
  try {
    const { checklist_id, perfil_nome } = req.body
    if (!checklist_id || !perfil_nome) {
      return res.status(400).json({ erro: 'checklist_id e perfil_nome são obrigatórios' })
    }
    if (!(await checklistPertenceAConta(checklist_id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Tarefa não encontrada' })
    }
    const adminId = await getAdminId(req.userId, req.userPerfil)
    const cargo = await resolverPerfilPorNome(perfil_nome, adminId)
    if (!cargo) return res.status(404).json({ erro: 'Cargo não encontrado' })
    if (cargo.nome === 'super_admin') {
      return res.status(400).json({ erro: 'Não é possível atribuir uma tarefa ao cargo Proprietário por aqui.' })
    }

    await run(
      `INSERT INTO checklist_cargos (checklist_id, perfil_nome, ativo)
       VALUES (?, ?, 1)
       ON CONFLICT(checklist_id, perfil_nome) DO UPDATE SET ativo = 1`,
      [checklist_id, perfil_nome]
    )
    res.json({ message: 'Cargo vinculado à tarefa!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.desvincular = async (req, res) => {
  try {
    const { id } = req.params
    if (!(await vinculoCargoPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Vínculo não encontrado' })
    }
    await run('UPDATE checklist_cargos SET ativo = 0 WHERE id = ?', [id])
    res.json({ message: 'Cargo desvinculado da tarefa!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
