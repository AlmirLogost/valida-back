// Cria ou apaga o banco de ENSAIO (cópia descartável), usado para testar
// migrations antes de aplicá-las no banco local de verdade.
//
// O nome do banco de ensaio é FIXO ("valida_ensaio") — não aceita outro
// nome por argumento, de propósito, pra este script nunca poder apagar
// nem criar nada além disso.
//
// Não usa psql/createdb/dropdb (não estão instalados nesta máquina) — usa
// o driver "pg" direto, conectando no banco de manutenção "postgres" (é
// obrigatório não estar conectado ao próprio banco pra criar/apagar outro).
//
// SEGURANÇA: só roda contra um host local.
//
// Como rodar (dentro da pasta back/):
//   node scripts/ensaio_db.js criar   -> cria valida_ensaio vazio
//   node scripts/ensaio_db.js apagar  -> apaga valida_ensaio

require('dotenv').config()

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  process.exit(1)
}

const { Client } = require('pg')
const NOME_ENSAIO = 'valida_ensaio'

const config = {
  host,
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  database: 'postgres' // banco de manutenção — nunca o valida_v2 nem o valida_ensaio
}

async function main() {
  const acao = process.argv[2]
  if (!['criar', 'apagar'].includes(acao)) {
    console.error('Uso: node scripts/ensaio_db.js criar|apagar')
    process.exit(1)
  }

  const client = new Client(config)
  await client.connect()
  try {
    // DROP não aceita parâmetro ($1) no nome do banco — mas como o nome é
    // uma constante fixa no código (nunca vem de fora), não há risco de
    // injeção aqui.
    await client.query(`DROP DATABASE IF EXISTS ${NOME_ENSAIO}`)
    console.log(`  (qualquer ${NOME_ENSAIO} anterior foi removido)`)

    if (acao === 'criar') {
      await client.query(`CREATE DATABASE ${NOME_ENSAIO}`)
      console.log(`✅ ${NOME_ENSAIO} criado (vazio).`)
    } else {
      console.log(`✅ ${NOME_ENSAIO} apagado.`)
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('❌ Erro:', e.message)
  process.exit(1)
})
