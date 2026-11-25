// PINs em texto puro (legado) → hash bcrypt. Roda ANTES de scripts/migrar.js:
// a migration 029 só leva PIN em hash; sem isto, a pessoa fica sem PIN.
//
// - Só mexe em PIN de exatamente 4 números; o que já é hash fica como está.
// - Tudo numa transação: ou todos, ou nenhum. Pode rodar de novo sem problema.
// - Banco já migrado (colaboradores existe) com PIN em texto puro: recusa, porque
//   mudar aqui não chegaria às pessoas novas (o admin gera o PIN pelo convite).
// - Imprime só contagens. Nunca imprime nome, PIN nem conexão.
//
// Uso (dentro de back/):
//   node scripts/migrar_pins_para_hash.js --dry-run
//   node scripts/migrar_pins_para_hash.js
// Banco não local: --producao --confirmar-banco=<DB_NAME> (igual ao migrar.js).

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const bcrypt = require('bcrypt')
const { Client } = require('pg')

function sair(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

const opcoes = { dryRun: false, producao: false, confirmarBanco: null }
for (const a of process.argv.slice(2)) {
  if (a === '--dry-run') opcoes.dryRun = true
  else if (a === '--producao') opcoes.producao = true
  else if (a.startsWith('--confirmar-banco=')) opcoes.confirmarBanco = a.slice('--confirmar-banco='.length)
  else sair(`Opção não reconhecida: ${a.split('=')[0]}`)
}
const host = process.env.DB_HOST || 'localhost'
const database = process.env.DB_NAME || 'valida_v2'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  if (!opcoes.producao) sair('Banco não local. Bloqueado por padrão. Para liberar: --producao --confirmar-banco=<DB_NAME>.')
  if (opcoes.confirmarBanco !== database) sair('O nome em --confirmar-banco não confere com o DB_NAME do .env.')
} else if (opcoes.producao) sair('--producao foi passado, mas o banco configurado é local. Confira o .env.')

const CUSTO = 10   // o mesmo de src/lib/segredos.js

async function main() {
  const client = new Client({
    host, database, port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  })
  try { await client.connect() } catch (e) { sair(`Não consegui conectar ao banco (código ${e.code || 'desconhecido'}).`) }
  const contar = async () => (await client.query(
    `SELECT COUNT(*) FILTER (WHERE pin ~ '^[0-9]{4}$')::int AS texto_puro,
            COUNT(*) FILTER (WHERE pin LIKE '$2%')::int AS em_hash,
            COUNT(*) FILTER (WHERE pin IS NOT NULL AND pin <> '' AND pin !~ '^[0-9]{4}$' AND pin NOT LIKE '$2%')::int AS fora_do_padrao
     FROM usuarios`)).rows[0]
  const mostrar = (titulo, c) => { console.log(titulo); for (const [k, v] of Object.entries(c)) console.log(`  ${k}: ${v}`) }
  try {
    const t = (await client.query(`SELECT to_regclass('public.usuarios') IS NOT NULL AS u, to_regclass('public.colaboradores') IS NOT NULL AS c`)).rows[0]
    if (!t.u) sair('A tabela usuarios não existe neste banco.')
    const antes = await contar()
    mostrar(`PINs${opcoes.dryRun ? ' (SIMULAÇÃO, nada gravado)' : ' antes'}`, antes)
    if (antes.fora_do_padrao) console.log(`⚠️  ${antes.fora_do_padrao} PIN(s) que não são 4 números nem hash: não serão mexidos, e essas pessoas ficam sem PIN (o admin gera pelo convite).`)
    if (!antes.texto_puro) { console.log('Nada a fazer: nenhum PIN de 4 números em texto puro.'); return }
    if (t.c) sair('Este banco já foi migrado (colaboradores existe): os PINs precisavam ser convertidos antes. Nada foi alterado. Use "Reenviar convite" no app.')
    if (opcoes.dryRun) return
    await client.query('BEGIN')
    try {
      const l = (await client.query(`SELECT id, pin FROM usuarios WHERE pin ~ '^[0-9]{4}$' ORDER BY id FOR UPDATE`)).rows
      for (const u of l) await client.query('UPDATE usuarios SET pin = $1 WHERE id = $2', [await bcrypt.hash(u.pin, CUSTO), u.id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      sair(`Falhou e nada mudou (código ${e.code || 'desconhecido'}).`)
    }
    const depois = await contar()
    mostrar('PINs depois', depois)
    if (depois.texto_puro || depois.em_hash !== antes.em_hash + antes.texto_puro) sair('A conferência não bateu. Pare e veja antes de migrar.')
    console.log('✅ Concluído.')
  } finally { await client.end().catch(() => {}) }
}
main().catch((e) => sair(`Falhou (código ${(e && e.code) || 'desconhecido'}).`))
