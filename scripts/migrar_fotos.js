// Extrai as fotos em base64 do legado (execucoes_itens_legado.evidencia_url /
// foto_url) para arquivos em FOTOS_DIR e registra cada uma em `fotos`,
// ligando a execução nova (execucoes.foto_id). Roda DEPOIS da migration 034.
//
// - O base64 original NÃO é apagado (continua no legado).
// - Idempotente: foto já registrada (mesmo item + campo) é pulada.
// - Arquivo: <FOTOS_DIR>/<empresa_id>/<sha256>.<ext>, pasta 700 e arquivo 600.
// - FOTOS_DIR é obrigatório, absoluto e fora da pasta do app.
// - Só aceita imagem jpeg/png/webp/gif com cabeçalho conferido.
// - Imprime só contagens. Nunca imprime conteúdo, nome de pessoa ou conexão.
//
// Uso (dentro de back/):
//   FOTOS_DIR=/caminho/fora/do/app node scripts/migrar_fotos.js --dry-run
//   FOTOS_DIR=/caminho/fora/do/app node scripts/migrar_fotos.js
// Banco não local: --producao --confirmar-banco=<DB_NAME> (igual ao migrar.js).

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const fs = require('fs')
const crypto = require('crypto')
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
} else if (opcoes.producao) {
  sair('--producao foi passado, mas o banco configurado é local. Confira o .env.')
}

const FOTOS_DIR = process.env.FOTOS_DIR
if (!FOTOS_DIR || !path.isAbsolute(FOTOS_DIR)) sair('Defina FOTOS_DIR com um caminho absoluto.')
const app = path.resolve(__dirname, '..', '..')
const destino = path.resolve(FOTOS_DIR)
for (const pasta of ['back', 'front']) {
  const p = path.join(app, pasta)
  if (destino === p || destino.startsWith(p + path.sep)) sair('FOTOS_DIR não pode ficar dentro de back/ ou front/.')
}

const TIPOS = {
  'image/jpeg': { ext: 'jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/jpg': { ext: 'jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', confere: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', confere: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  'image/gif': { ext: 'gif', confere: (b) => b.slice(0, 4).toString('latin1') === 'GIF8' }
}

function decodificar(dataUrl) {
  const m = /^data:([a-z/+.-]+);base64,(.*)$/is.exec(dataUrl || '')
  if (!m) return null
  const mime = m[1].toLowerCase()
  const tipo = TIPOS[mime]
  if (!tipo) return null
  const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64')
  if (bytes.length < 16 || !tipo.confere(bytes)) return null
  return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, ext: tipo.ext, bytes }
}

async function main() {
  const client = new Client({
    host,
    port: parseInt(process.env.DB_PORT) || 5432,
    database,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  })
  try {
    await client.connect()
  } catch (e) {
    sair(`Não consegui conectar ao banco (código ${e.code || 'desconhecido'}).`)
  }

  const conta = { candidatas: 0, gravadas: 0, ja_registradas: 0, invalidas: 0, sem_execucao_migrada: 0 }
  try {
    const t = await client.query(`SELECT to_regclass('public.fotos') IS NOT NULL AS f, to_regclass('public.execucoes_itens_legado') IS NOT NULL AS l`)
    if (!t.rows[0].f || !t.rows[0].l) sair('Rode antes as migrations até a 034 (fotos e execucoes_itens_legado).')

    const semExec = await client.query(`
      SELECT COUNT(*)::int AS n FROM execucoes_itens_legado i
      WHERE (i.evidencia_url LIKE 'data:%' OR i.foto_url LIKE 'data:%')
        AND NOT EXISTS (SELECT 1 FROM execucoes m WHERE m.legado_item_id = i.id)`)
    conta.sem_execucao_migrada = semExec.rows[0].n

    // Só os ids primeiro; o conteúdo é lido um por vez (memória).
    const alvos = await client.query(`
      SELECT i.id AS item_id, m.id AS execucao_id, m.empresa_id, m.colaborador_id,
             (i.evidencia_url LIKE 'data:%') AS tem_evid, (i.foto_url LIKE 'data:%') AS tem_foto
      FROM execucoes_itens_legado i
      JOIN execucoes m ON m.legado_item_id = i.id
      WHERE i.evidencia_url LIKE 'data:%' OR i.foto_url LIKE 'data:%'
      ORDER BY i.id`)

    for (const a of alvos.rows) {
      for (const campo of ['evidencia_url', 'foto_url']) {
        if (!(campo === 'evidencia_url' ? a.tem_evid : a.tem_foto)) continue
        conta.candidatas++
        const ja = await client.query('SELECT id FROM fotos WHERE legado_execucao_item_id = $1 AND legado_campo = $2', [a.item_id, campo])
        if (ja.rows.length) {
          conta.ja_registradas++
          continue
        }
        const r = await client.query(`SELECT ${campo} AS v FROM execucoes_itens_legado WHERE id = $1`, [a.item_id])
        const foto = decodificar(r.rows[0].v)
        if (!foto) {
          conta.invalidas++
          continue
        }
        if (opcoes.dryRun) {
          conta.gravadas++
          continue
        }
        const sha = crypto.createHash('sha256').update(foto.bytes).digest('hex')
        const relativo = path.join(String(a.empresa_id), `${sha}.${foto.ext}`)
        const absoluto = path.join(destino, relativo)
        fs.mkdirSync(path.dirname(absoluto), { recursive: true, mode: 0o700 })
        if (!fs.existsSync(absoluto)) {
          const tmp = `${absoluto}.tmp-${process.pid}`
          fs.writeFileSync(tmp, foto.bytes, { mode: 0o600 })
          fs.renameSync(tmp, absoluto)
        }
        await client.query('BEGIN')
        try {
          const ins = await client.query(
            `INSERT INTO fotos (empresa_id, caminho, tamanho, mime, sha256, criado_por_tipo, criado_por, legado_execucao_item_id, legado_campo)
             VALUES ($1, $2, $3, $4, $5, 'colaborador', $6, $7, $8)
             ON CONFLICT (legado_execucao_item_id, legado_campo) DO NOTHING RETURNING id`,
            [a.empresa_id, relativo, foto.bytes.length, foto.mime, sha, a.colaborador_id, a.item_id, campo]
          )
          if (ins.rows.length) {
            await client.query('UPDATE execucoes SET foto_id = $1 WHERE id = $2 AND foto_id IS NULL', [ins.rows[0].id, a.execucao_id])
          }
          await client.query('COMMIT')
          conta.gravadas++
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {})
          sair(`Falhou ao registrar uma foto (código ${e.code || 'desconhecido'}). As anteriores ficaram registradas; rode de novo.`)
        }
      }
    }

    console.log(`Fotos ${opcoes.dryRun ? '(SIMULAÇÃO, nada gravado)' : ''}`)
    for (const [k, v] of Object.entries(conta)) console.log(`  ${k}: ${v}`)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((e) => sair(`Falhou (código ${e && e.code ? e.code : 'desconhecido'}).`))
