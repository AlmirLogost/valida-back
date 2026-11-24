-- 020 · Tabela de controle das migrations (Etapa 1, Segurança item 7).
--
-- Guarda quais migrations já foram aplicadas neste banco. Quem grava aqui é
-- o runner (scripts/migrar.js), na mesma transação de cada migration.
-- Não mexe em nenhuma tabela existente.
--
-- Desfazer: 020_schema_migrations.down.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  versao      INTEGER     PRIMARY KEY,
  nome        TEXT        NOT NULL,
  hash        TEXT        NOT NULL,          -- sha256 do arquivo .sql aplicado
  tem_down    BOOLEAN     NOT NULL DEFAULT false,
  aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
