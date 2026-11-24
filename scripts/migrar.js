// Runner de migrations do VALIDA (Etapa 1 · Segurança item 7).
//
// Substitui scripts/rodar_migrations.js (que fica como legado, sem uso).
//
// Arquivos em back/migrations/:
//   001_…sql a 019_…sql      legado: idempotentes, sem "desfazer". Rodam como
//                            hoje (o DEPLOY.md já roda todos a cada
//                            atualização) e ficam registrados.
//   020_nome.up.sql          a partir da 020: toda migration tem "up" e
//   020_nome.down.sql        "down" (desfazer). Sem o par, o runner recusa.
//
// Controle: tabela schema_migrations (criada pela própria 020). Guarda a
// versão, o nome, o hash do arquivo e quando foi aplicada.
//
// Cada migration roda numa transação (BEGIN … COMMIT): ou entra inteira ou
// nada muda. Uma trava (pg_advisory_lock) impede dois runners ao mesmo tempo.
//
// Uso (dentro da pasta back/):
//   node scripts/migrar.js --status           mostra o que foi aplicado e o que falta
//   node scripts/migrar.js --dry-run          mostra o que seria aplicado, sem aplicar
//   node scripts/migrar.js                    aplica tudo o que falta
//   node scripts/migrar.js --ate=020          aplica só até a 020
//   node scripts/migrar.js --down             desfaz a ÚLTIMA aplicada (precisa ter .down.sql)
//   node scripts/migrar.js --down --dry-run   mostra o que seria desfeito
//
// Banco não local (produção) fica BLOQUEADO por padrão. Para liberar, as duas
// opções juntas:
//   --producao --confirmar-banco=<nome exato do DB_NAME>
// O runner nunca imprime host, usuário, senha nem nome do banco.

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const fs = require('fs')
const crypto = require('crypto')
const { Client } = require('pg')

const DIR = path.join(__dirname, '..', 'migrations')
const PRIMEIRA_COM_DOWN = 20
const TRAVA = 4815162342 // número fixo da trava do runner
const RE_ARQUIVO = /^(\d{3})_([a-z0-9_]+?)(?:\.(up|down))?\.sql$/

// ---------------------------------------------------------------------------
// Argumentos
const opcoes = { status: false, dryRun: false, down: false, producao: false, ate: null, confirmarBanco: null }
for (const a of process.argv.slice(2)) {
  if (a === '--status') opcoes.status = true
  else if (a === '--dry-run') opcoes.dryRun = true
  else if (a === '--down') opcoes.down = true
  else if (a === '--producao') opcoes.producao = true
  else if (/^--ate=\d{3}$/.test(a)) opcoes.ate = parseInt(a.slice(6), 10)
  else if (a.startsWith('--confirmar-banco=')) opcoes.confirmarBanco = a.slice('--confirmar-banco='.length)
  else sair(`Opção não reconhecida: ${a.split('=')[0]}. Veja o topo de scripts/migrar.js.`)
}
if (opcoes.status && opcoes.down) sair('Use --status ou --down, não os dois.')
if (opcoes.down && opcoes.ate !== null) sair('--ate não vale com --down (o --down desfaz só a última).')

function sair(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Banco de destino: local por padrão; produção só com liberação explícita.
const host = process.env.DB_HOST || 'localhost'
const database = process.env.DB_NAME || 'valida_v2'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)

if (!ehLocal) {
  if (!opcoes.producao) sair('Banco não local. Bloqueado por padrão. Para liberar: --producao --confirmar-banco=<DB_NAME>.')
  if (!opcoes.confirmarBanco) sair('Falta --confirmar-banco=<DB_NAME>.')
  if (opcoes.confirmarBanco !== database) sair('O nome em --confirmar-banco não confere com o DB_NAME do .env.')
} else if (opcoes.producao) {
  sair('--producao foi passado, mas o banco configurado é local. Confira o .env.')
}
const rotuloBanco = ehLocal ? 'local' : 'REMOTO (produção liberada)'

// ---------------------------------------------------------------------------
// Leitura dos arquivos
function lerMigrations() {
  const porVersao = new Map()
  for (const arq of fs.readdirSync(DIR).sort()) {
    if (!arq.endsWith('.sql')) continue
    const m = arq.match(RE_ARQUIVO)
    if (!m) sair(`Nome de arquivo fora do padrão: ${arq}`)
    const versao = parseInt(m[1], 10)
    const tipo = m[3] || 'legado'
    const item = porVersao.get(versao) || { versao, nome: m[2] }
    if (item.nome !== m[2]) sair(`Duas migrations com o número ${m[1]} e nomes diferentes.`)
    if (item[tipo]) sair(`Arquivo repetido para a versão ${m[1]} (${tipo}).`)
    item[tipo] = path.join(DIR, arq)
    porVersao.set(versao, item)
  }
  const lista = [...porVersao.values()].sort((a, b) => a.versao - b.versao)
  for (const it of lista) {
    const v = String(it.versao).padStart(3, '0')
    if (it.versao < PRIMEIRA_COM_DOWN) {
      if (!it.legado || it.up || it.down) sair(`A ${v} é do legado: deve ser só ${v}_${it.nome}.sql.`)
    } else {
      if (it.legado) sair(`A ${v} precisa ser ${v}_${it.nome}.up.sql + .down.sql (não .sql sozinho).`)
      if (!it.up || !it.down) sair(`A ${v} precisa dos dois arquivos: .up.sql e .down.sql.`)
    }
    it.arquivoUp = it.legado || it.up
    it.sqlUp = fs.readFileSync(it.arquivoUp, 'utf8')
    it.hash = crypto.createHash('sha256').update(it.sqlUp).digest('hex')
    it.rotulo = `${v}_${it.nome}`
  }
  return lista
}

// Uma migration pode pedir para rodar fora de transação (ex.: CREATE INDEX
// CONCURRENTLY) com a linha "-- migrar: sem-transacao" no começo do arquivo.
function semTransacao(sql) {
  return /^\s*--\s*migrar:\s*sem-transacao\s*$/m.test(sql.split('\n').slice(0, 5).join('\n'))
}

// ---------------------------------------------------------------------------
async function tabelaControleExiste(client) {
  const r = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS existe`)
  return r.rows[0].existe === true
}

async function aplicadas(client) {
  if (!(await tabelaControleExiste(client))) return new Map()
  const r = await client.query('SELECT versao, nome, hash, aplicada_em FROM schema_migrations ORDER BY versao')
  return new Map(r.rows.map((x) => [x.versao, x]))
}

async function registrar(client, it) {
  await client.query(
    `INSERT INTO schema_migrations (versao, nome, hash, tem_down)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (versao) DO NOTHING`,
    [it.versao, it.nome, it.hash, !!it.down]
  )
}

function erroSeguro(e) {
  // Mensagem do Postgres sobre o SQL (útil para corrigir a migration), sem
  // dados da conexão. Erros de conexão mostram só o código.
  if (e && e.code && /^[0-9A-Z]{5}$/.test(e.code)) return `${e.message} (código ${e.code})`
  return `código ${e && e.code ? e.code : 'desconhecido'}`
}

async function main() {
  const migrations = lerMigrations()

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
    sair(`Não consegui conectar ao banco (${erroSeguro(e)}).`)
  }

  let travado = false
  try {
    const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [TRAVA])
    if (!r.rows[0].ok) sair('Outro runner de migrations está rodando neste banco. Tente de novo depois.')
    travado = true

    console.log(`Banco: ${rotuloBanco}${opcoes.dryRun ? ' · SIMULAÇÃO (nada será gravado)' : ''}\n`)
    const feitas = await aplicadas(client)

    // Arquivo alterado depois de aplicado = alerta.
    const alterados = migrations.filter((it) => feitas.has(it.versao) && feitas.get(it.versao).hash !== it.hash)
    // Registro sem arquivo = alerta.
    const semArquivo = [...feitas.keys()].filter((v) => !migrations.some((it) => it.versao === v))

    if (opcoes.status) {
      for (const it of migrations) {
        const f = feitas.get(it.versao)
        const marca = f ? (f.hash !== it.hash ? '⚠️  aplicada, arquivo ALTERADO depois' : `✅ aplicada em ${new Date(f.aplicada_em).toISOString()}`) : '…  pendente'
        console.log(`  ${it.rotulo.padEnd(42)} ${marca}${it.versao < PRIMEIRA_COM_DOWN ? ' (legado, sem down)' : ''}`)
      }
      for (const v of semArquivo) console.log(`  ${String(v).padStart(3, '0')} ⚠️  registrada no banco, mas o arquivo não existe`)
      if (!(await tabelaControleExiste(client))) console.log('\n  (schema_migrations ainda não existe: tudo aparece como pendente)')
      return
    }

    if (alterados.length) {
      sair(`Arquivo de migration já aplicada foi alterado: ${alterados.map((x) => x.rotulo).join(', ')}. Não se edita migration aplicada: crie uma nova.`)
    }

    if (opcoes.down) {
      await desfazerUltima(client, migrations, feitas)
      return
    }

    let pendentes = migrations.filter((it) => !feitas.has(it.versao))
    if (opcoes.ate !== null) {
      if (!migrations.some((it) => it.versao === opcoes.ate)) sair(`Não existe migration ${String(opcoes.ate).padStart(3, '0')}.`)
      pendentes = pendentes.filter((it) => it.versao <= opcoes.ate)
    }
    // Não pode haver buraco: uma pendente antes de uma já aplicada.
    const maiorFeita = Math.max(0, ...feitas.keys())
    const buraco = pendentes.find((it) => it.versao < maiorFeita)
    if (buraco) sair(`A ${buraco.rotulo} está pendente, mas uma migration posterior já foi aplicada. Resolva antes de seguir.`)

    if (!pendentes.length) {
      console.log('Nada a aplicar: tudo em dia.')
      return
    }

    console.log(`${opcoes.dryRun ? 'Seriam aplicadas' : 'Aplicando'} ${pendentes.length} migration(s):`)
    if (opcoes.dryRun) {
      for (const it of pendentes) console.log(`  → ${it.rotulo}${semTransacao(it.sqlUp) ? ' (sem transação)' : ''}`)
      return
    }

    // As legadas que rodarem antes da 020 só podem ser registradas depois
    // que a 020 criar a tabela de controle: ficam na fila até lá.
    const filaRegistro = []
    for (const it of pendentes) {
      process.stdout.write(`  → ${it.rotulo} ... `)
      const transacao = !semTransacao(it.sqlUp)
      try {
        if (transacao) await client.query('BEGIN')
        await client.query(it.sqlUp)
        filaRegistro.push(it)
        if (await tabelaControleExiste(client)) {
          for (const x of filaRegistro) await registrar(client, x)
          filaRegistro.length = 0
        }
        if (transacao) await client.query('COMMIT')
        console.log('ok')
      } catch (e) {
        if (transacao) await client.query('ROLLBACK').catch(() => {})
        console.log('ERRO')
        sair(`${it.rotulo} falhou e foi desfeita${transacao ? '' : ' (ATENÇÃO: rodava sem transação, confira o banco)'}: ${erroSeguro(e)}`)
      }
    }
    if (filaRegistro.length) {
      console.log(`\n⚠️  ${filaRegistro.length} migration(s) do legado rodaram, mas a schema_migrations ainda não existe para registrá-las. Rode de novo incluindo a 020.`)
    }
    console.log('\n✅ Concluído.')
  } finally {
    if (travado) await client.query('SELECT pg_advisory_unlock($1)', [TRAVA]).catch(() => {})
    await client.end().catch(() => {})
  }
}

async function desfazerUltima(client, migrations, feitas) {
  if (!feitas.size) sair('Nenhuma migration registrada para desfazer.')
  const versao = Math.max(...feitas.keys())
  const it = migrations.find((x) => x.versao === versao)
  if (!it) sair('A última migration registrada não tem arquivo. Nada foi feito.')
  if (!it.down) sair(`A ${it.rotulo} é do legado e não tem "desfazer". Volta só por backup.`)
  const sqlDown = fs.readFileSync(it.down, 'utf8')

  console.log(`${opcoes.dryRun ? 'Seria desfeita' : 'Desfazendo'}: ${it.rotulo}`)
  if (opcoes.dryRun) return

  const transacao = !semTransacao(sqlDown)
  try {
    if (transacao) await client.query('BEGIN')
    await client.query(sqlDown)
    // A down da 020 apaga a própria tabela de controle: aí não há o que tirar.
    if (await tabelaControleExiste(client)) {
      await client.query('DELETE FROM schema_migrations WHERE versao = $1', [it.versao])
    }
    if (transacao) await client.query('COMMIT')
    console.log('✅ Desfeita.')
  } catch (e) {
    if (transacao) await client.query('ROLLBACK').catch(() => {})
    sair(`Não consegui desfazer ${it.rotulo}; nada mudou${transacao ? '' : ' (ATENÇÃO: rodava sem transação, confira o banco)'}: ${erroSeguro(e)}`)
  }
}

main().catch((e) => sair(`Falhou: ${erroSeguro(e)}`))
