-- 021 · password_resets (usada pelo código, nunca teve migration) e o
-- relatório da migração.
--
-- password_resets: IF NOT EXISTS, porque nos bancos atuais ela já existe
-- (criada à mão). Se já existir, não muda nada.
--
-- migracao_relatorio: cada migration 022–040 grava aqui quantas linhas
-- ficaram SÓ no legado e por quê (órfãos, dados inválidos, decisões D3/D6…).
-- Só números e motivos; nunca nomes, celulares, e-mails ou PINs.

CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER   NOT NULL,
  token      TEXT      NOT NULL,
  expira_em  TIMESTAMP NOT NULL,
  usado      BOOLEAN   DEFAULT false,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE migracao_relatorio (
  id         BIGSERIAL   PRIMARY KEY,
  migracao   TEXT        NOT NULL,          -- '024', '032'…
  item       TEXT        NOT NULL,          -- o que ficou no legado
  quantidade INTEGER     NOT NULL,
  motivo     TEXT        NOT NULL,
  em         TIMESTAMPTZ NOT NULL DEFAULT now()
);
