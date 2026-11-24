// npm test: roda os testes automáticos SEMPRE no banco de ensaio.
//
// 1. Recria o valida_ensaio a partir do backup mais recente em BACKUPS-VALIDA/
//    (ou do arquivo em TESTE_DUMP).
// 2. Aplica as migrations nele (scripts/migrar.js).
// 3. Roda node --test test/ com DB_NAME=valida_ensaio.
// Segredos de teste (JWT_SECRET, PIN_CIFRA_CHAVE) são gerados na hora, só
// para este processo; nada fica gravado. Envio sempre simulado.
// Nunca toca no banco local nem em produção.
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const { spawnSync } = require('child_process')

const raiz = path.join(__dirname, '..')
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true })
const host = process.env.DB_HOST || 'localhost'
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error('❌ Os testes só rodam com banco local (ensaio).')
  process.exit(1)
}

const pasta = path.join(raiz, '..', 'BACKUPS-VALIDA')
const dump = process.env.TESTE_DUMP || (fs.existsSync(pasta)
  ? fs.readdirSync(pasta).filter((f) => /^banco_local_.*\.dump$/.test(f)).sort().map((f) => path.join(pasta, f)).pop()
  : null)
if (!dump) {
  console.error('❌ Nenhum backup em BACKUPS-VALIDA/. Rode antes: node scripts/backup_banco.js')
  process.exit(1)
}

const env = {
  ...process.env,
  DB_NAME: 'valida_ensaio',
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  PIN_CIFRA_CHAVE: crypto.randomBytes(32).toString('hex'),
  ENVIO_SIMULADO: 'true',
  ENVIO_SIMULADO_ARQUIVO: '',
  FRONTEND_URL: 'http://front.teste',
  WEBHOOK_ASAAS_ATIVO: 'false',
  // Fotos dos testes numa pasta temporária (nunca em FOTOS-VALIDA/) e limite menor.
  FOTOS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'valida-fotos-teste-')),
  FOTO_MAX_MB: '1'
}

function rodar(args, { silencioso = false } = {}) {
  const r = spawnSync(process.execPath, args, { cwd: raiz, env, stdio: silencioso ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
  if (r.status !== 0) {
    if (silencioso && r.stdout) process.stdout.write(r.stdout)
    process.exit(r.status || 1)
  }
}

console.log(`Ensaio a partir de ${path.basename(dump)}`)
rodar(['scripts/ensaio_db.js', 'copiar', dump], { silencioso: true })
rodar(['scripts/migrar.js'], { silencioso: true })
console.log('Ensaio pronto (migrations aplicadas). Rodando os testes…\n')
rodar(['--test', '--test-concurrency=1', 'test/*.test.js'])
