const sqlite3 = require('sqlite3').verbose()
const path = require('path')

const dbPath = path.resolve(__dirname, '../../database.db')

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('❌ Erro:', err)
  else console.log('✅ Conectado ao SQLite')
})

const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

const createTables = async () => {
  await run(`CREATE TABLE IF NOT EXISTS lojas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    endereco TEXT,
    cidade TEXT,
    estado TEXT,
    telefone TEXT,
    ativo BOOLEAN DEFAULT 1,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  await run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    perfil TEXT,
    loja_id INTEGER,
    ativo BOOLEAN DEFAULT 1,
    score INTEGER DEFAULT 0,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  await run(`CREATE TABLE IF NOT EXISTS checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT,
    categoria TEXT,
    loja_id INTEGER,
    criado_por INTEGER,
    horario_inicio TEXT,
    horario_fim TEXT,
    recorrencia TEXT DEFAULT 'diario',
    ativo BOOLEAN DEFAULT 1,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  await run(`CREATE TABLE IF NOT EXISTS checklist_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    titulo TEXT NOT NULL,
    descricao TEXT,
    ordem INTEGER DEFAULT 0,
    tipo_campo TEXT DEFAULT 'boolean',
    obrigatorio BOOLEAN DEFAULT 1,
    critico BOOLEAN DEFAULT 0
  )`)

  await run(`CREATE TABLE IF NOT EXISTS execucoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    loja_id INTEGER,
    status TEXT DEFAULT 'em_andamento',
    iniciado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    concluido_em DATETIME,
    total_itens INTEGER DEFAULT 0,
    itens_concluidos INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0
  )`)

  await run(`CREATE TABLE IF NOT EXISTS execucoes_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execucao_id INTEGER NOT NULL,
    checklist_item_id INTEGER NOT NULL,
    concluido BOOLEAN DEFAULT 0,
    observacao TEXT,
    foto_url TEXT,
    validado_em DATETIME
  )`)

  console.log('✅ Tabelas criadas!')
}

const createUsuarioChecklistsTable = async () => {
  await run(`CREATE TABLE IF NOT EXISTS usuario_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    checklist_id INTEGER NOT NULL,
    ativo BOOLEAN DEFAULT 1,
    vinculado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(usuario_id, checklist_id)
  )`)
  console.log('✅ Tabela usuario_checklists criada!')
}

module.exports = { db, query, run, createTables, createUsuarioChecklistsTable }
