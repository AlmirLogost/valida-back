// Busca por id SEMPRE dentro da empresa. Fora dela → 404 (nunca revela que existe).
const { naoEncontrado } = require('../lib/erros')

async function porId(db, tabela, empresaId, id, extra = '') {
  const r = await db.um(`SELECT * FROM ${tabela} WHERE id = $1 AND empresa_id = $2 ${extra}`, [id, empresaId])
  if (!r) throw naoEncontrado()
  return r
}

module.exports = {
  unidade: (db, e, id) => porId(db, 'unidades', e, id),
  colaborador: (db, e, id) => porId(db, 'colaboradores', e, id, 'AND excluido_em IS NULL'),
  cargo: (db, e, id) => porId(db, 'cargos', e, id),
  perfil: (db, e, id) => porId(db, 'perfis_acesso', e, id, 'AND arquivado_em IS NULL'),
  tarefa: (db, e, id) => porId(db, 'tarefas', e, id),
  diaFechado: (db, e, id) => porId(db, 'dias_fechados', e, id),
  pedido: (db, e, id) => porId(db, 'pedidos', e, id)
}
