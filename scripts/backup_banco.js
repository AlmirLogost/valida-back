// Backup do banco LOCAL com pg_dump (formato custom, -Fc) em BACKUPS-VALIDA/
// na raiz do projeto (fora do git).
//
// Lê a conexão do back/.env sem imprimir nada dela. A senha vai para o
// pg_dump pela variável PGPASSWORD do processo filho (nunca na linha de
// comando, nunca no log).
//
// Só roda contra banco local. Para produção o backup é feito no servidor,
// pelo processo do DEPLOY.md.
//
// Uso (dentro de back/):
//   node scripts/backup_banco.js
// Binários do Postgres: PG_BIN (pasta) ou, se não houver, /Library/PostgreSQL/18/bin
// ou o PATH.

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const fs = require('fs')
const { spawnSync } = require('child_process')

const host = process.env.DB_HOST || 'localhost'
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error('❌ Só faz backup de banco local.')
  process.exit(1)
}
const banco = process.env.DB_NAME || 'valida_v2'

function binario(nome) {
  const pastas = [process.env.PG_BIN, '/Library/PostgreSQL/18/bin'].filter(Boolean)
  for (const p of pastas) if (fs.existsSync(path.join(p, nome))) return path.join(p, nome)
  return nome
}

const pasta = path.join(__dirname, '..', '..', 'BACKUPS-VALIDA')
fs.mkdirSync(pasta, { recursive: true })
const carimbo = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)
const arquivo = path.join(pasta, `banco_local_${carimbo}.dump`)

const r = spawnSync(binario('pg_dump'), [
  '-Fc', '--no-owner', '--no-privileges',
  '-h', host, '-p', String(parseInt(process.env.DB_PORT) || 5432),
  '-U', process.env.DB_USER || 'postgres',
  '-f', arquivo, banco
], { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' }, stdio: ['ignore', 'ignore', 'pipe'] })

if (r.status !== 0) {
  // Não repete a mensagem do pg_dump (pode citar host/usuário).
  console.error(`❌ pg_dump falhou (código ${r.status}). Nenhum backup novo.`)
  if (fs.existsSync(arquivo)) fs.renameSync(arquivo, `${arquivo}.incompleto`)
  process.exit(1)
}

// Confere o arquivo: lista o conteúdo sem restaurar nada.
const l = spawnSync(binario('pg_restore'), ['--list', arquivo], { stdio: ['ignore', 'pipe', 'ignore'] })
const tabelas = l.status === 0 ? (String(l.stdout).match(/ TABLE DATA /g) || []).length : -1
if (tabelas < 1) {
  console.error('❌ O backup foi gerado mas não passou na conferência (pg_restore --list).')
  process.exit(1)
}
const mb = (fs.statSync(arquivo).size / 1048576).toFixed(2)
console.log(`✅ Backup: BACKUPS-VALIDA/${path.basename(arquivo)} (${mb} MB, ${tabelas} tabelas com dados).`)
