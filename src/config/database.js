const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'valida_v2',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})
pool.connect((err, client, release) => {
  if (err) console.error('❌ Erro ao conectar PostgreSQL:', err.message)
  else { console.log('✅ Conectado ao PostgreSQL'); release() }
})

function convertPlaceholders(sql) {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

const query = async (sql, params = []) => {
  const pgSql = convertPlaceholders(sql)
  const res = await pool.query(pgSql, params)
  return res.rows
}

const run = async (sql, params = []) => {
  let pgSql = convertPlaceholders(sql)
  if (pgSql.trim().toUpperCase().startsWith('INSERT') &&
      !pgSql.toUpperCase().includes('RETURNING')) {
    pgSql = pgSql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id'
  }
  const res = await pool.query(pgSql, params)
  return {
    lastID: res.rows[0]?.id ?? null,
    changes: res.rowCount
  }
}

const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lojas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      endereco TEXT,
      cidade TEXT,
      estado TEXT,
      telefone TEXT,
      setores TEXT,
      aberta INTEGER DEFAULT 1,
      hora_reset TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loja_horarios (
      id SERIAL PRIMARY KEY,
      loja_id INTEGER NOT NULL,
      dia_semana INTEGER NOT NULL,
      hora_abertura TEXT,
      hora_fechamento TEXT
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loja_fechamentos (
      id SERIAL PRIMARY KEY,
      loja_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      motivo TEXT
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS perfis (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      rotulo TEXT NOT NULL,
      loja_id INTEGER,
      metodo_login TEXT DEFAULT 'pin',
      pode_acessar_painel INTEGER DEFAULT 0,
      cor TEXT DEFAULT '#3483fa',
      sistema INTEGER DEFAULT 0,
      ordem INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      perm_dashboard INTEGER DEFAULT 0,
      perm_criar_tarefas INTEGER DEFAULT 0,
      perm_executar_tarefas INTEGER DEFAULT 0,
      perm_conferir INTEGER DEFAULT 0,
      perm_gerenciar_equipe INTEGER DEFAULT 0,
      perm_gerenciar_lojas INTEGER DEFAULT 0,
      perm_relatorios INTEGER DEFAULT 0,
      perm_configuracoes INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      perfil TEXT,
      loja_id INTEGER,
      ativo INTEGER DEFAULT 1,
      score INTEGER DEFAULT 0,
      pin TEXT,
      tipo_comissao TEXT,
      valor_tarefa_feita NUMERIC DEFAULT 0,
      valor_desconto NUMERIC DEFAULT 0,
      valor_mensal_fixo NUMERIC DEFAULT 0,
      desconto_mensal NUMERIC DEFAULT 0,
      periodo_comissao TEXT DEFAULT 'mensal',
      periodo_inicio TEXT,
      periodo_fim TEXT,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checklists (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT,
      categoria TEXT,
      loja_id INTEGER,
      criado_por INTEGER,
      horario_inicio TEXT,
      horario_fim TEXT,
      recorrencia TEXT DEFAULT 'diario',
      data_mensal TEXT,
      dias_semana TEXT,
      momento TEXT DEFAULT 'outros',
      tipo_campo TEXT DEFAULT 'boolean',
      evidencia_obrigatoria INTEGER DEFAULT 0,
      tipo_evidencia TEXT DEFAULT 'imagem',
      critico INTEGER DEFAULT 0,
      subtipo_numerico TEXT DEFAULT 'inteiro',
      peso INTEGER DEFAULT 1,
      rotulo_positivo TEXT DEFAULT 'Feito',
      rotulo_negativo TEXT DEFAULT 'Nao Feito',
      data_inicio TEXT,
      data_termino TEXT,
      repeticao_intervalo INTEGER DEFAULT 1,
      tolerancia_min INTEGER DEFAULT 30,
      pausado INTEGER DEFAULT 0,
      pausado_tipo TEXT,
      pausado_ate TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checklist_itens (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      descricao TEXT,
      ordem INTEGER DEFAULT 0,
      tipo_campo TEXT DEFAULT 'boolean',
      obrigatorio INTEGER DEFAULT 1,
      critico INTEGER DEFAULT 0,
      evidencia_obrigatoria INTEGER DEFAULT 0,
      tipo_evidencia TEXT DEFAULT 'imagem',
      subtipo_numerico TEXT DEFAULT 'inteiro',
      peso INTEGER DEFAULT 1,
      rotulo_positivo TEXT DEFAULT 'Feito',
      rotulo_negativo TEXT DEFAULT 'Nao Feito',
      opcoes_selecao TEXT
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS execucoes (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL,
      loja_id INTEGER,
      status TEXT DEFAULT 'em_andamento',
      iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      concluido_em TIMESTAMP,
      total_itens INTEGER DEFAULT 0,
      itens_concluidos INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS execucoes_itens (
      id SERIAL PRIMARY KEY,
      execucao_id INTEGER NOT NULL,
      checklist_item_id INTEGER NOT NULL,
      concluido INTEGER DEFAULT 0,
      valor_resposta TEXT,
      tipo_resposta TEXT,
      observacao TEXT,
      evidencia_url TEXT,
      foto_url TEXT,
      respondido_em TIMESTAMP,
      validado_em TIMESTAMP
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuario_checklists (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL,
      checklist_id INTEGER NOT NULL,
      ativo INTEGER DEFAULT 1,
      vinculado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, checklist_id)
    )
  `)
  console.log('✅ Tabelas criadas!')
}

const createUsuarioChecklistsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuario_checklists (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL,
      checklist_id INTEGER NOT NULL,
      ativo INTEGER DEFAULT 1,
      vinculado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, checklist_id)
    )
  `)
  console.log('✅ Tabela usuario_checklists ok!')
}

const migratePerfisPermissions = async () => {
  const permCols = [
    ['perm_dashboard', 'INTEGER DEFAULT 0'],
    ['perm_criar_tarefas', 'INTEGER DEFAULT 0'],
    ['perm_executar_tarefas', 'INTEGER DEFAULT 0'],
    ['perm_conferir', 'INTEGER DEFAULT 0'],
    ['perm_gerenciar_equipe', 'INTEGER DEFAULT 0'],
    ['perm_gerenciar_lojas', 'INTEGER DEFAULT 0'],
    ['perm_relatorios', 'INTEGER DEFAULT 0'],
    ['perm_configuracoes', 'INTEGER DEFAULT 0']
  ]
  for (const [col, def] of permCols) {
    try {
      await pool.query(`ALTER TABLE perfis ADD COLUMN IF NOT EXISTS ${col} ${def}`)
      console.log(`  + coluna ${col} ok`)
    } catch (e) {
      console.warn(`  ! ${col}: ${e.message}`)
    }
  }
}

module.exports = { pool, query, run, createTables, createUsuarioChecklistsTable, migratePerfisPermissions }
