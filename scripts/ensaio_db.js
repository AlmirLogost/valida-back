// Cria, copia ou apaga o banco de ENSAIO (cópia descartável), usado para
// testar migrations antes de aplicá-las no banco local de verdade.
//
// O nome vem de DB_NAME e PRECISA estar na lista fechada de bancos de ensaio
// (src/lib/ensaio.js: valida_ensaio, valida_visual, valida_teste). Qualquer
// outro nome é recusado, pra este script nunca poder apagar nem criar nada
// além disso. Sem DB_NAME de ensaio, usa valida_ensaio.
//
// Usa o driver "pg" para criar/apagar (conectando no banco de manutenção
// "postgres") e o pg_restore para a cópia. A senha vai para o pg_restore
// pela variável PGPASSWORD do processo filho, nunca impressa.
//
// SEGURANÇA: só roda contra um host local.
//
// Como rodar (dentro da pasta back/):
//   node scripts/ensaio_db.js criar                 -> cria valida_ensaio vazio
//   node scripts/ensaio_db.js copiar <arquivo.dump> -> recria valida_ensaio a partir
//                                                      de um backup (scripts/backup_banco.js)
//   node scripts/ensaio_db.js estrutura <arquivo.sql> -> recria valida_ensaio a partir
//                                                      de um pg_dump --schema-only
//   node scripts/ensaio_db.js apagar                -> apaga valida_ensaio

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true })

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  process.exit(1)
}

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { Client } = require('pg')
const { ehEnsaio } = require('../src/lib/ensaio')
const NOME_ENSAIO = ehEnsaio(process.env.DB_NAME) ? process.env.DB_NAME : 'valida_ensaio'
if (!/^valida_[a-z]+$/.test(NOME_ENSAIO) || !ehEnsaio(NOME_ENSAIO)) { console.error('❌ Banco de ensaio inválido.'); process.exit(1) }

const config = {
  host,
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  database: 'postgres' // banco de manutenção — nunca o valida_v2 nem o valida_ensaio
}

function binario(nome) {
  const pastas = [process.env.PG_BIN, '/Library/PostgreSQL/18/bin'].filter(Boolean)
  for (const p of pastas) if (fs.existsSync(path.join(p, nome))) return path.join(p, nome)
  return nome
}

async function main() {
  const acao = process.argv[2]
  if (!['criar', 'copiar', 'estrutura', 'apagar'].includes(acao)) {
    console.error('Uso: node scripts/ensaio_db.js criar | copiar <arquivo.dump> | estrutura <arquivo.sql> | apagar')
    process.exit(1)
  }
  let dump = null
  if (acao === 'copiar') {
    dump = process.argv[3] && path.resolve(process.argv[3])
    if (!dump || !fs.existsSync(dump) || !dump.endsWith('.dump')) {
      console.error('❌ Informe um arquivo .dump existente (gerado por scripts/backup_banco.js).')
      process.exit(1)
    }
  }

  if (acao === 'estrutura') {
    dump = process.argv[3] && path.resolve(process.argv[3])
    if (!dump || !fs.existsSync(dump) || !dump.endsWith('.sql')) {
      console.error('❌ Informe um arquivo .sql existente (pg_dump --schema-only).')
      process.exit(1)
    }
  }

  const client = new Client(config)
  await client.connect()
  try {
    // DROP não aceita parâmetro ($1) no nome do banco — mas o nome só pode
    // ser um da lista fechada (conferido acima), então não há risco de injeção.
    await client.query(`DROP DATABASE IF EXISTS ${NOME_ENSAIO} WITH (FORCE)`)
    console.log(`  (qualquer ${NOME_ENSAIO} anterior foi removido)`)

    if (acao === 'apagar') {
      console.log(`✅ ${NOME_ENSAIO} apagado.`)
      return
    }
    await client.query(`CREATE DATABASE ${NOME_ENSAIO}`)
    if (acao === 'criar') {
      console.log(`✅ ${NOME_ENSAIO} criado (vazio).`)
      return
    }
  } finally {
    await client.end()
  }

  if (acao === 'estrutura') {
    const e = spawnSync(binario('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-h', host, '-p', String(config.port), '-U', config.user, '-d', NOME_ENSAIO, '-f', dump],
      { env: { ...process.env, PGPASSWORD: config.password }, stdio: ['ignore', 'ignore', 'pipe'] })
    if (e.status !== 0) { console.error(`❌ psql falhou (código ${e.status}).`); process.exit(1) }
    console.log(`✅ ${NOME_ENSAIO} recriado com a estrutura de ${path.basename(dump)} (sem dados).`)
    return
  }

  const r = spawnSync(binario('pg_restore'), [
    '--no-owner', '--no-privileges', '--exit-on-error',
    '-h', host, '-p', String(config.port), '-U', config.user,
    '-d', NOME_ENSAIO, dump
  ], { env: { ...process.env, PGPASSWORD: config.password }, stdio: ['ignore', 'ignore', 'pipe'] })
  if (r.status !== 0) {
    console.error(`❌ pg_restore falhou (código ${r.status}). O ${NOME_ENSAIO} pode estar incompleto: rode "apagar".`)
    process.exit(1)
  }
  console.log(`✅ ${NOME_ENSAIO} recriado como cópia de ${path.basename(dump)}.`)
}

main().catch((e) => {
  console.error(`❌ Erro (código ${e && e.code ? e.code : 'desconhecido'}).`)
  process.exit(1)
})
