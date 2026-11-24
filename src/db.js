// Acesso ao banco (só as tabelas novas). Placeholders do Postgres ($1, $2…).
// Uma fonte só de esquema: back/migrations (Segurança item 6). Aqui não se
// cria tabela nenhuma.
require('./config')
const { Pool, types } = require('pg')

types.setTypeParser(20, (v) => (v === null ? null : Number(v)))     // bigint → número (ids)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))   // numeric → número
types.setTypeParser(1082, (v) => v)                                  // date → 'AAAA-MM-DD'
const lerListaTexto = types.getTypeParser(1016)                     // bigint[] → lista de números
types.setTypeParser(1016, (v) => (v === null ? null : lerListaTexto(v).map((x) => (x === null ? null : Number(x)))))

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'valida_v2',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10
})

// Conexão parada derrubada pelo Postgres (reinício, DROP ... WITH (FORCE),
// timeout): sem este ouvinte o Node encerra o servidor inteiro. O pool já
// descarta essa conexão e abre outra na próxima consulta.
pool.on('error', (e) => console.error(`[banco] conexão parada caiu: código ${e.code || '-'}`))

function envolver(executor) {
  return {
    q: async (sql, params = []) => (await executor.query(sql, params)).rows,
    um: async (sql, params = []) => (await executor.query(sql, params)).rows[0] || null,
    exec: async (sql, params = []) => (await executor.query(sql, params)).rowCount
  }
}

const db = envolver(pool)

// Transação: tudo ou nada. fn recebe o mesmo formato {q, um, exec}.
db.tx = async (fn) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(envolver(client))
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

db.pool = pool
db.fechar = () => pool.end()

module.exports = db
