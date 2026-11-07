// Aplica todos os arquivos de back/migrations/*.sql, em ordem, no banco
// configurado em DB_NAME (padrão: valida_v2). Não usa psql (não está
// instalado nesta máquina) — usa o driver "pg" direto.
//
// Todas as migrations já são escritas pra serem seguras de rodar mais de
// uma vez (IF NOT EXISTS / ON CONFLICT), então rodar este script de novo
// não causa problema mesmo que algumas já tenham sido aplicadas antes.
//
// SEGURANÇA: só roda contra um host local.
//
// Como rodar (dentro da pasta back/):
//   node scripts/rodar_migrations.js             -> aplica em valida_v2 (padrão)
//   DB_NAME=valida_ensaio node scripts/rodar_migrations.js  -> aplica no ensaio

require('dotenv').config()

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  process.exit(1)
}

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const pool = new Pool({
  host,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'valida_v2',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})

async function main() {
  console.log(`Banco de destino: ${host} / ${pool.options.database} (local)\n`)

  const dir = path.join(__dirname, '..', 'migrations')
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8')
    process.stdout.write(`→ ${arquivo} ... `)
    await pool.query(sql)
    console.log('ok')
  }

  console.log(`\n✅ ${arquivos.length} migration(s) aplicada(s).`)
  await pool.end()
}

main().catch((e) => {
  console.error('\n❌ Erro:', e.message)
  process.exit(1)
})
