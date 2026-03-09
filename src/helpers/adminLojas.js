const { query } = require('../config/database')

const lojaSubquery = (adminId) => 
  `(SELECT id FROM lojas WHERE admin_id = ${adminId} AND ativo >= 0)`

const getLojaIds = async (adminId) => {
  const rows = await query('SELECT id FROM lojas WHERE admin_id = ? AND ativo >= 0', [adminId])
  return rows.map(r => r.id)
}

module.exports = { lojaSubquery, getLojaIds }
