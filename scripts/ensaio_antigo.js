// Ensaio da migração a partir da ESTRUTURA ANTIGA de produção (pg_dump
// --schema-only, sem dados), no banco valida_antigo. Faz o caminho do guia
// (docs/valida/PUBLICAR_PILOTO.md): relatório → PINs → migrar → fotos →
// conferir; depois desfaz tudo (down até a 020) e refaz (up).
//
// Dados INVENTADOS, parecidos com os de lá: 18 pessoas com PIN de 4 números em
// texto puro (4 delas órfãs) e sem celular, 10 fotos base64. PINs e senha
// aleatórios, só em memória. Nunca toca em outro banco.
//
// Uso (dentro de back/):
//   node scripts/ensaio_antigo.js ../_producao/estrutura_producao.sql [--dump=arquivo.dump]
//   --dump: no fim, grava uma cópia do banco migrado (para TESTE_DUMP=… npm test)
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('child_process')
const raiz = path.join(__dirname, '..')
process.env.DB_NAME = 'valida_antigo'
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true })
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST || 'localhost')) { console.error('❌ Só com banco local.'); process.exit(1) }
const estrutura = process.argv[2] && path.resolve(process.argv[2])
const dump = (process.argv.find((a) => a.startsWith('--dump=')) || '').slice(7)
if (!estrutura || !fs.existsSync(estrutura)) { console.error('Uso: node scripts/ensaio_antigo.js <estrutura.sql> [--dump=arquivo.dump]'); process.exit(1) }
Object.assign(process.env, {
  JWT_SECRET: crypto.randomBytes(32).toString('hex'), PIN_CIFRA_CHAVE: crypto.randomBytes(32).toString('hex'), ENVIO_SIMULADO: 'true', ENVIO_SIMULADO_ARQUIVO: '',
  FRONTEND_URL: '', APP_BASE: '/', WEBHOOK_ASAAS_ATIVO: 'false', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', RELOGIO_FIXO: '', DEMO_REDE: '',
  FOTOS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'valida-fotos-antigo-'))
})
const bcrypt = require('bcrypt')
const { Client } = require('pg')

function script(nome, args = [], esperado = 0) {
  const r = spawnSync(process.execPath, [path.join('scripts', nome), ...args], { cwd: raiz, env: process.env })
  const saida = String(r.stdout) + String(r.stderr)
  if (esperado !== null && r.status !== esperado) { console.log(saida); throw new Error(`${nome} ${args.join(' ')} saiu com ${r.status}`) }
  return { saida, status: r.status }
}
const passo = (t) => console.log(`→ ${t}`)
async function comBanco(fn) {
  const c = new Client({ host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT) || 5432, user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: 'valida_antigo' })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}
const um = async (c, sql, p) => (await c.query(sql, p)).rows[0]

// ---- dados inventados ------------------------------------------------------
const SENHA = crypto.randomBytes(12).toString('base64url')
const pins = new Map()   // id → PIN em texto puro
const EMAIL = 'dono@ensaio.valida'
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300)])
async function semear(c) {
  const senha = await bcrypt.hash(SENHA, 10)
  const q = async (sql, p) => (await c.query(sql, p)).rows[0]
  for (const p of [['Essencial', 'essencial', 197, 1, 10, 0], ['Profissional', 'profissional', 397, 5, 30, 1], ['Franquia', 'franquia', 897, null, null, 1]]) await c.query('INSERT INTO planos (nome, slug, preco, max_lojas, max_usuarios, tem_comissoes) VALUES ($1,$2,$3,$4,$5,$6)', p)
  // como o seed antigo: sem "gerente" de sistema, com "funcionario"
  for (const [nome, rotulo, painel, conferir, executar] of [['super_admin', 'Super Admin', 1, 1, 1], ['fiscal', 'Fiscal', 1, 1, 0], ['operador', 'Operador', 0, 0, 1], ['funcionario', 'Funcionário', 0, 0, 1]]) {
    await c.query(`INSERT INTO perfis (nome, rotulo, sistema, pode_acessar_painel, perm_dashboard, perm_conferir, perm_executar_tarefas, perm_relatorios) VALUES ($1,$2,1,$3,$3,$4,$5,$4)`, [nome, rotulo, painel, conferir, executar])
  }
  const dono = (await q(`INSERT INTO usuarios (nome, email, senha, perfil, razao_social) VALUES ('Dono Ensaio', $1, $2, 'super_admin', 'Ensaio Ltda') RETURNING id`, [EMAIL, senha])).id
  const dono2 = (await q(`INSERT INTO usuarios (nome, email, senha, perfil) VALUES ('Outro Dono', 'outro@ensaio.valida', $1, 'super_admin') RETURNING id`, [senha])).id
  await c.query(`INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) SELECT $1, id, 'ativo', NULL FROM planos WHERE slug = 'franquia'`, [dono])
  await c.query(`INSERT INTO subscriptions (admin_id, plano_id, status, trial_fim) SELECT $1, id, 'trial', now() - interval '3 days' FROM planos WHERE slug = 'essencial'`, [dono2])
  const loja = async (nome, adm, ativo = 1) => (await q('INSERT INTO lojas (nome, cidade, estado, admin_id, ativo, aberta) VALUES ($1, $2, $3, $4, $5, 1) RETURNING id', [nome, 'Chapecó', 'SC', adm, ativo])).id
  const l1 = await loja('Centro', dono), l2 = await loja('Shopping', dono), l3 = await loja('Fechada', dono, -1), l4 = await loja('Da outra', dono2), orfa = await loja('Órfã', 99999)
  for (const l of [l1, l2, l4]) for (let d = 1; d <= 6; d++) await c.query('INSERT INTO loja_horarios (loja_id, dia_semana, hora_abertura, hora_fechamento) VALUES ($1,$2,$3,$4)', [l, d, '08:00', '18:00'])
  await c.query(`INSERT INTO loja_fechamentos (loja_id, data, motivo) VALUES ($1, '2026-12-25', 'Natal'), ($1, 'sem data', 'inválida')`, [l1])
  await c.query(`INSERT INTO perfis (nome, rotulo, loja_id, sistema, perm_executar_tarefas, perm_conferir) VALUES ('caixa', 'Caixa', $1, 0, 1, 0), ('solto', 'Solto', NULL, 0, 1, 0), ('gerente', 'Gerente da loja', $1, 0, 1, 1)`, [l1])
  // 18 pessoas: 14 em empresa válida e 4 órfãs (unidade de ninguém, unidade que não existe, sem unidade)
  const onde = [...Array(6).fill(l1), ...Array(5).fill(l2), l3, l4, l4, orfa, orfa, 98765, null]
  const perfil = ['gerente', 'fiscal', 'operador', 'funcionario', 'caixa', 'operador', 'gerente', 'fiscal', 'operador', 'funcionario', 'sumido', 'operador', 'operador', 'fiscal', 'operador', 'operador', 'operador', 'operador']
  const pessoas = []
  for (let i = 0; i < 18; i++) {
    const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0')
    const u = await q(`INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin, ativo, tipo_comissao, valor_tarefa_feita, valor_mensal_fixo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1.5,300) RETURNING id`,
      [`Pessoa ${i + 1}`, `p${i + 1}@ensaio.valida`, senha, perfil[i], onde[i], pin, i === 11 ? 0 : 1, [null, 'por_tarefa', 'mensal'][i % 3]])
    pins.set(u.id, pin); pessoas.push(u.id)
  }
  // tarefas: diária, semanal, mensal, pontual (coluna DATE em produção), numérica com sub-itens, uma órfã
  const tarefa = async (titulo, l, extra = {}) => { const k = Object.keys(extra); return (await q(`INSERT INTO checklists (titulo, loja_id, criado_por, horario_inicio${k.map((x) => ', ' + x).join('')}) VALUES ($1,$2,$3,'09:00'${k.map((_, i) => ', $' + (i + 4)).join('')}) RETURNING id`, [titulo, l, dono, ...Object.values(extra)])).id }
  const ts = [await tarefa('Abertura', l1, { evidencia_obrigatoria: 1 }), await tarefa('Limpeza', l1, { recorrencia: 'semanal', dias_semana: '1,3,5' }), await tarefa('Inventário', l1, { recorrencia: 'mensal', data_mensal: '15' }),
    await tarefa('Reunião', l1, { recorrencia: 'pontual', data_pontual: '2026-12-01' }), await tarefa('Temperatura', l1, { tipo_campo: 'numerico' }), await tarefa('Pausada', l2, { pausado: 1 }), await tarefa('Abertura 2', l2, { evidencia_obrigatoria: 1 })]
  const tOrfa = await tarefa('De ninguém', orfa)
  for (let i = 0; i < 3; i++) await c.query('INSERT INTO checklist_itens (checklist_id, titulo, ordem) VALUES ($1,$2,$3)', [ts[4], `Item ${i + 1}`, i])
  await c.query(`INSERT INTO checklist_datas (checklist_id, data) VALUES ($1, '2026-12-02')`, [ts[0]])
  for (let i = 0; i < 6; i++) for (const t of ts.slice(0, 5)) await c.query('INSERT INTO usuario_checklists (usuario_id, checklist_id, bonus_override) VALUES ($1,$2,$3)', [pessoas[i], t, i === 0 ? 2 : null])
  for (let i = 6; i < 11; i++) for (const t of ts.slice(5)) await c.query('INSERT INTO usuario_checklists (usuario_id, checklist_id) VALUES ($1,$2)', [pessoas[i], t])
  await c.query('INSERT INTO usuario_checklists (usuario_id, checklist_id) VALUES ($1,$2), ($3,$4)', [dono, ts[0], pessoas[14], tOrfa])
  // execuções: 10 concluídas com foto base64, outras concluídas, em andamento e do dono
  let n = 0
  const exec = async (u, t, l, status, foto, item = 0) => {
    const e = await q(`INSERT INTO execucoes (checklist_id, usuario_id, loja_id, status, iniciado_em, concluido_em) VALUES ($1,$2,$3,$4, now() - make_interval(days => $5), CASE WHEN $4 = 'concluido' THEN now() - make_interval(days => $5) END) RETURNING id`, [t, u, l, status, ++n % 20])
    await c.query(`INSERT INTO execucoes_itens (execucao_id, checklist_item_id, concluido, valor_resposta, observacao, evidencia_url, foto_url, respondido_em) VALUES ($1,$2,1,'3,5','ok',$3,$4, now())`,
      [e.id, item, foto === 'e' ? `data:image/jpeg;base64,${jpeg().toString('base64')}` : null, foto === 'f' ? `data:image/jpeg;base64,${jpeg().toString('base64')}` : null])
  }
  for (let i = 0; i < 6; i++) await exec(pessoas[i], ts[0], l1, 'concluido', i % 2 ? 'e' : 'f')
  for (let i = 6; i < 10; i++) await exec(pessoas[i], ts[6], l2, 'concluido', i % 2 ? 'e' : 'f')
  for (let i = 0; i < 6; i++) await exec(pessoas[i], ts[4], l1, 'concluido', null)
  await exec(pessoas[0], ts[1], l1, 'em_andamento', null); await exec(dono, ts[0], l1, 'concluido', null); await exec(pessoas[14], tOrfa, orfa, 'concluido', null)
}

// ---- conferências ------------------------------------------------------------
const LEGADO_DEPOIS_DA_019 = ['usuarios', 'lojas', 'perfis', 'perfil_permissoes', 'usuario_lojas', 'perfil_lojas', 'auditoria', 'checklists', 'checklist_cargos', 'onboarding_progresso', 'execucoes', 'execucoes_itens', 'usuario_checklists']
async function impressao(c, tabelas) {
  const o = {}
  for (const t of tabelas) o[t] = (await um(c, `SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(x::text, '|' ORDER BY x.id)), '') AS h FROM ${t} x`))
  return o
}
const matriz = async (c) => (await c.query(`SELECT p.nome || '/' || p.sistema || ' ' || m.modulo || '.' || m.acao || '=' || m.permitido AS x FROM perfil_permissoes m JOIN perfis p ON p.id = m.perfil_id ORDER BY 1`)).rows.map((r) => r.x)
const permissoesNovas = async (c) => (await c.query(`SELECT pa.empresa_id, pa.nome, m.chave, m.permitido, (SELECT COUNT(*)::int FROM colaboradores co JOIN cargos cg ON cg.id = co.cargo_id WHERE COALESCE(co.perfil_acesso_id, cg.perfil_acesso_id) = pa.id) AS pessoas FROM perfil_permissoes m JOIN perfis_acesso pa ON pa.id = m.perfil_id ORDER BY 1, 2, 3`)).rows
async function conferirDados(c) {
  const r = await um(c, `SELECT (SELECT COUNT(*)::int FROM colaboradores) AS pessoas, (SELECT COUNT(*)::int FROM colaboradores WHERE pin_hash IS NOT NULL) AS com_pin, (SELECT COUNT(*)::int FROM fotos) AS fotos,
    (SELECT COUNT(*)::int FROM execucoes WHERE foto_id IS NOT NULL) AS com_foto, (SELECT COUNT(*)::int FROM empresas) AS empresas, (SELECT COUNT(*)::int FROM unidades) AS unidades,
    (SELECT COUNT(*)::int FROM tarefas WHERE data_pontual = '2026-12-01') AS pontuais, (SELECT COUNT(*)::int FROM schema_migrations) AS registradas, (SELECT MAX(versao) FROM schema_migrations) AS ultima`)
  assert.deepEqual(r, { pessoas: 14, com_pin: 14, fotos: 10, com_foto: 10, empresas: 2, unidades: 4, pontuais: 6, registradas: 46, ultima: 46 })
  for (const x of (await c.query('SELECT legado_usuario_id AS id, pin_hash FROM colaboradores')).rows) assert.ok(await bcrypt.compare(pins.get(x.id), x.pin_hash), 'o PIN antigo continua valendo')
  for (const f of (await c.query('SELECT caminho, sha256 FROM fotos')).rows) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(process.env.FOTOS_DIR, f.caminho))).digest('hex'), f.sha256)
  return r
}
const relatorio = () => { const s = script('relatorio_pre_migracao.js').saida; assert.ok(!/erro \(código/.test(s), 'relatório com erro'); return s }
const semHora = (s) => s.replace(/Gerado em:.*/g, '').replace(/ {2}permitidas: \d+/, '')   // ver a exceção da 013

// Entra de verdade no app: o admin completa o celular e a pessoa entra com o PIN antigo.
async function entrarNoApp() {
  const db = require('../src/db')
  const { criarApp } = require('../src/app')
  const s = await new Promise((ok) => { const x = criarApp().listen(0, '127.0.0.1', () => ok(x)) })
  const ch = async (m, c, corpo, tk) => { const r = await fetch(`http://127.0.0.1:${s.address().port}/api/v2${c}`, { method: m, headers: { 'content-type': 'application/json', ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: corpo && JSON.stringify(corpo) }); return { status: r.status, corpo: await r.json().catch(() => null) } }
  try {
    const a = await ch('POST', '/auth/admin/entrar', { email: EMAIL, senha: SENHA })
    assert.equal(a.status, 200, 'admin entra com a senha antiga')
    const p = await db.um(`SELECT id, legado_usuario_id FROM colaboradores WHERE nome = 'Pessoa 3'`)
    const cel = '49991110777'
    assert.equal((await ch('PUT', `/colaboradores/${p.id}/celular`, { celular: cel }, a.corpo.token)).status, 200)
    const e = await ch('POST', '/auth/entrar', { celular: cel, pin: pins.get(p.legado_usuario_id) })
    assert.ok(e.status < 300 && e.corpo.token, `pessoa entra com o PIN antigo: ${e.status} ${JSON.stringify(e.corpo)}`)
    const errado = pins.get(p.legado_usuario_id) === '0000' ? '1111' : '0000'
    assert.equal((await ch('POST', '/auth/entrar', { celular: cel, pin: errado })).status, 401)
  } finally { await new Promise((ok) => s.close(ok)); await db.fechar() }
}

async function main() {
  passo('banco valida_antigo com a estrutura antiga, e dados inventados')
  script('ensaio_db.js', ['estrutura', estrutura])
  await comBanco(semear)
  passo('relatório antes (estrutura antiga)')
  const r0 = relatorio()
  assert.match(r0, /pin_texto_puro: 18/); assert.match(r0, /fotos_base64: 10/); assert.match(r0, /pessoas_orfas: 4/); assert.match(r0, /coluna ausente \(perfis\.escopo\)/)
  passo('PINs: simulação, conversão e repetição')
  assert.match(script('migrar_pins_para_hash.js', ['--dry-run']).saida, /texto_puro: 18/)
  await comBanco(async (c) => assert.equal((await um(c, `SELECT COUNT(*)::int AS n FROM usuarios WHERE pin LIKE '$2%'`)).n, 0))
  const sp = script('migrar_pins_para_hash.js').saida
  assert.match(sp, /PINs depois\n {2}texto_puro: 0\n {2}em_hash: 18/); assert.ok(!/Pessoa/.test(sp) && ![...pins.values()].some((p) => new RegExp(`\\b${p}\\b`).test(sp)), 'não mostra nome nem PIN')
  assert.match(script('migrar_pins_para_hash.js').saida, /Nada a fazer/)
  assert.match(relatorio(), /pin_texto_puro: 0\n {2}pin_em_hash: 18/)
  passo('proteção: 001–019 marcadas como aplicadas sem rodar são recusadas')
  await comBanco(async (c) => {
    await c.query(fs.readFileSync(path.join(raiz, 'migrations', '020_schema_migrations.up.sql'), 'utf8'))
    for (const f of fs.readdirSync(path.join(raiz, 'migrations')).filter((x) => /^0(0\d|1\d|20)_.*(?<!down)\.sql$/.test(x))) {
      await c.query('INSERT INTO schema_migrations (versao, nome, hash) VALUES ($1, $2, $3)', [parseInt(f), f.slice(4).replace(/(\.up)?\.sql$/, ''), crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, 'migrations', f), 'utf8')).digest('hex')])
    }
  })
  assert.match(script('migrar.js', [], 1).saida, /constam como aplicadas, mas o banco não tem a estrutura/)
  assert.match(script('migrar.js', ['--down']).saida, /Desfazendo: 020/)   // a saída que a mensagem indica
  passo('migrar 001–046')
  script('migrar.js', ['--status']); script('migrar.js', ['--dry-run'])
  assert.match(script('migrar.js', ['--ate=020']).saida, /020_schema_migrations \.\.\. ok/)
  const matriz1 = await comBanco(matriz)
  const legado1 = await comBanco((c) => impressao(c, LEGADO_DEPOIS_DA_019))
  script('migrar.js')
  assert.match(script('migrar.js').saida, /Nada a aplicar/)
  passo('fotos e conferência')
  assert.match(script('migrar_fotos.js', ['--dry-run']).saida, /gravadas: 10/)
  assert.match(script('migrar_fotos.js').saida, /gravadas: 10/)
  assert.match(script('migrar_fotos.js').saida, /ja_registradas: 10/)
  assert.match(script('conferir_migracao.js').saida, /Tudo confere/)
  await comBanco(conferirDados)
  const novas1 = await comBanco(permissoesNovas)
  const r1 = semHora(relatorio())
  passo('down até a 020 (as 001–019 não têm down)')
  for (let v = 46; v >= 20; v--) assert.match(script('migrar.js', ['--down']).saida, new RegExp(`Desfazendo: 0${v}_`))
  assert.match(script('migrar.js', ['--down'], 1).saida, /Nenhuma migration registrada/)
  await comBanco(async (c) => {
    assert.deepEqual(await impressao(c, LEGADO_DEPOIS_DA_019), legado1, 'o legado volta igual')
    assert.equal((await um(c, `SELECT to_regclass('public.empresas') IS NULL AND to_regclass('public.schema_migrations') IS NULL AS ok`)).ok, true)
  })
  passo('up de novo (001–019 rodam outra vez), fotos e conferência')
  script('migrar.js', ['--ate=020'])
  const matriz2 = await comBanco(matriz)
  // Única diferença conhecida ao repetir: a 013 liga "executar" do Líder depois de a
  // 011 já ter calculado "ver". Não muda nada no app novo (a 027 já liga "ver").
  assert.deepEqual(matriz2.filter((x) => !matriz1.includes(x)), ['fiscal/1 tarefas.ver=1'])
  assert.deepEqual(await comBanco((c) => impressao(c, LEGADO_DEPOIS_DA_019.filter((t) => t !== 'perfil_permissoes'))), Object.fromEntries(Object.entries(legado1).filter(([t]) => t !== 'perfil_permissoes')), '001–019 repetidas não mudam nada')
  script('migrar.js'); assert.match(script('migrar_fotos.js').saida, /gravadas: 10/)
  assert.match(script('conferir_migracao.js').saida, /Tudo confere/)
  console.log('  ' + JSON.stringify(await comBanco(conferirDados)))
  assert.deepEqual(await comBanco(permissoesNovas), novas1, 'permissões do app novo iguais')
  assert.equal(semHora(relatorio()), r1, 'relatório igual depois do down e up')
  if (dump) {
    const bin = [process.env.PG_BIN, '/Library/PostgreSQL/18/bin'].filter(Boolean).map((d) => path.join(d, 'pg_dump')).find((p) => fs.existsSync(p)) || 'pg_dump'
    const d = spawnSync(bin, ['-Fc', '--no-owner', '--no-privileges', '-h', process.env.DB_HOST || 'localhost', '-p', String(parseInt(process.env.DB_PORT) || 5432), '-U', process.env.DB_USER || 'postgres', '-f', path.resolve(dump), 'valida_antigo'], { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' } })
    assert.equal(d.status, 0, 'pg_dump'); passo('cópia do banco migrado gravada')
  }
  passo('entrar no app com a senha e o PIN antigos')
  await entrarNoApp()
  console.log('✅ Caminho completo, down e up: tudo confere.')
}
main().catch((e) => { console.error('❌ ' + e.message); process.exit(1) })
