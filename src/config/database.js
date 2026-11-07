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

// Roda várias queries como uma única transação: se qualquer uma falhar,
// tudo é desfeito (ROLLBACK) e nada fica gravado pela metade.
// Uso: await withTransaction(async ({ query, run }) => { ... })
const withTransaction = async (fn) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const queryTx = async (sql, params = []) => {
      const res = await client.query(convertPlaceholders(sql), params)
      return res.rows
    }
    const runTx = async (sql, params = []) => {
      let pgSql = convertPlaceholders(sql)
      if (pgSql.trim().toUpperCase().startsWith('INSERT') &&
          !pgSql.toUpperCase().includes('RETURNING')) {
        pgSql = pgSql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id'
      }
      const res = await client.query(pgSql, params)
      return { lastID: res.rows[0]?.id ?? null, changes: res.rowCount }
    }

    const resultado = await fn({ query: queryTx, run: runTx })
    await client.query('COMMIT')
    return resultado
  } catch (erro) {
    await client.query('ROLLBACK')
    throw erro
  } finally {
    client.release()
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
      admin_id INTEGER,
      arquivado_em TIMESTAMP,
      arquivado_por INTEGER,
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
      admin_id INTEGER,
      escopo TEXT NOT NULL DEFAULT 'propria_unidade',
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
      arquivado_em TIMESTAMP,
      arquivado_por INTEGER,
      score INTEGER DEFAULT 0,
      razao_social TEXT,
      whatsapp TEXT,
      documento TEXT,
      email_cobranca TEXT,
      cep TEXT,
      endereco TEXT,
      cidade TEXT,
      estado TEXT,
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
      data_pontual TEXT,
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
      bonus_override NUMERIC DEFAULT NULL,
      desconto_override NUMERIC DEFAULT NULL,
      UNIQUE(usuario_id, checklist_id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checklist_datas (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      tipo TEXT,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Tabela templates
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT,
      categoria TEXT,
      recorrencia TEXT DEFAULT 'diario',
      horario_inicio TEXT,
      horario_fim TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Tabela template_itens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_itens (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      descricao TEXT,
      ordem INTEGER DEFAULT 1,
      critico INTEGER DEFAULT 0
    )
  `)

  // Tabela planos
  await pool.query(`
    CREATE TABLE IF NOT EXISTS planos (
      id                 SERIAL PRIMARY KEY,
      nome               TEXT    NOT NULL,
      slug               TEXT    NOT NULL UNIQUE,
      preco              NUMERIC NOT NULL,
      max_lojas          INTEGER,
      max_usuarios       INTEGER,
      max_tarefas_ativas INTEGER,
      tem_comissoes      INTEGER DEFAULT 0,
      ativo              INTEGER DEFAULT 1,
      criado_em          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Seed planos (idempotente)
  await pool.query(`
    INSERT INTO planos (nome, slug, preco, max_lojas, max_usuarios, max_tarefas_ativas, tem_comissoes)
    VALUES
      ('Essencial',    'essencial',    197,  1,    10,   NULL, 0),
      ('Profissional', 'profissional', 397,  5,    30,   NULL, 1),
      ('Franquia',     'franquia',     897,  NULL, NULL, NULL, 1)
    ON CONFLICT (slug) DO NOTHING
  `)

  // Tabela subscriptions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                      SERIAL PRIMARY KEY,
      admin_id                INTEGER NOT NULL REFERENCES usuarios(id),
      plano_id                INTEGER NOT NULL REFERENCES planos(id),
      status                  TEXT    NOT NULL DEFAULT 'trial',
      trial_fim               TIMESTAMP,
      gateway_customer_id     TEXT,
      gateway_subscription_id TEXT,
      criado_em               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Reforma de Acessos: matriz de permissões por módulo x ação (migration 006)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS perfil_permissoes (
      id SERIAL PRIMARY KEY,
      perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      modulo TEXT NOT NULL,
      acao TEXT NOT NULL,
      permitido INTEGER NOT NULL DEFAULT 0,
      UNIQUE (perfil_id, modulo, acao)
    )
  `)

  // Reforma de Acessos: alcance do cargo em unidades escolhidas (migration 012)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS perfil_lojas (
      id SERIAL PRIMARY KEY,
      perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (perfil_id, loja_id)
    )
  `)

  // Reforma de Acessos: um usuário pode ter acesso a várias lojas (migration 008)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuario_lojas (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (usuario_id, loja_id)
    )
  `)

  // Reforma de Acessos: auditoria de ações importantes (migration 009)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      usuario_id INTEGER,
      acao TEXT NOT NULL,
      entidade TEXT NOT NULL,
      entidade_id INTEGER,
      detalhes JSONB,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

module.exports = { pool, query, run, withTransaction, createTables, createUsuarioChecklistsTable, migratePerfisPermissions }
