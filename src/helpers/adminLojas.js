const { query } = require('../config/database')

// ============================================================================
// Resolução única de "a qual conta pertence este usuário e quais lojas ele
// pode ver". Usada em TODOS os controllers no lugar de tratar req.userId
// como se fosse sempre o dono (admin_id) — esse era o bug que fazia
// gerente/funcionário verem lojas e tarefas vazias ou erradas.
//
// Regra: super_admin É o dono da conta (admin_id = o próprio id).
// Qualquer outro perfil (gerente, funcionário, cargos customizados) pertence
// à conta do dono da loja em que está cadastrado (usuarios.loja_id -> lojas.admin_id).
// ============================================================================

// Resolve o admin_id (dono da conta) a partir do usuário logado.
async function getAdminId(userId, userPerfil) {
  if (userPerfil === 'super_admin') return userId
  const rows = await query(
    'SELECT l.admin_id FROM usuarios u JOIN lojas l ON u.loja_id = l.id WHERE u.id = ? LIMIT 1',
    [userId]
  )
  return rows[0]?.admin_id ?? null
}

// Retorna os ids de todas as lojas da conta do usuário logado (array de inteiros).
// Se a conta não puder ser resolvida, retorna [] (nenhuma loja) em vez de
// quebrar a consulta — nunca retorna "todas as lojas" por engano.
async function getLojaIds(userId, userPerfil) {
  const adminId = await getAdminId(userId, userPerfil)
  if (!adminId) return []
  const rows = await query('SELECT id FROM lojas WHERE admin_id = ? AND ativo >= 0', [adminId])
  return rows.map(r => r.id)
}

// Confere se uma loja específica pertence à conta do usuário logado.
async function lojaPertenceAConta(lojaId, userId, userPerfil) {
  if (!lojaId) return false
  const ids = await getLojaIds(userId, userPerfil)
  return ids.includes(parseInt(lojaId))
}

// Confere se um checklist (tarefa) pertence à conta do usuário logado.
async function checklistPertenceAConta(checklistId, userId, userPerfil) {
  const rows = await query('SELECT loja_id FROM checklists WHERE id = ?', [checklistId])
  if (!rows.length) return false
  return lojaPertenceAConta(rows[0].loja_id, userId, userPerfil)
}

// Confere se um usuário (colaborador) pertence à conta do usuário logado.
// O próprio dono (super_admin) sempre "pertence" a si mesmo.
async function usuarioPertenceAConta(usuarioAlvoId, userId, userPerfil) {
  const adminId = await getAdminId(userId, userPerfil)
  if (!adminId) return false
  if (parseInt(usuarioAlvoId) === adminId) return true
  const rows = await query('SELECT loja_id FROM usuarios WHERE id = ?', [usuarioAlvoId])
  if (!rows.length || !rows[0].loja_id) return false
  return lojaPertenceAConta(rows[0].loja_id, userId, userPerfil)
}

module.exports = {
  getAdminId,
  getLojaIds,
  lojaPertenceAConta,
  checklistPertenceAConta,
  usuarioPertenceAConta
}
