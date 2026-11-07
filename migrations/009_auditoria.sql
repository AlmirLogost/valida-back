-- Migration 009 (Reforma de Acessos, Passo 2e): tabela de auditoria —
-- registro de ações importantes (quem fez o quê, quando, em qual coisa).
--
-- NUNCA deve ser gravado aqui: senha, PIN ou token (nem em "detalhes"). O
-- código que grava auditoria (Passo 3/4) é responsável por isso; a tabela
-- em si só guarda o que for passado a ela.
--
-- Seguro rodar mais de uma vez: CREATE TABLE/INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS auditoria (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  usuario_id INTEGER,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id INTEGER,
  detalhes JSONB,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auditoria_admin_id ON auditoria(admin_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON auditoria(criado_em);
