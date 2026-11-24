-- 041 · O que o código novo da Etapa 1 precisa e não estava nas tabelas:
--
-- senha_tokens: "esqueci a senha" do admin (D17). Guarda só o HASH
--   (sha256) do token, com validade curta e uso único. A password_resets
--   antiga fica como legado.
-- colaboradores.excluido_em / excluido_por: "excluir" pessoa já arquivada
--   (permissão del) tira da equipe sem apagar a linha (o histórico de
--   execuções fica, §6 e D12). Ao excluir, o celular e o PIN são limpos.
-- pedidos: índice para a lista de Aprovações e para "Meus pedidos".

CREATE TABLE senha_tokens (
  id         BIGSERIAL   PRIMARY KEY,
  admin_id   BIGINT      NOT NULL REFERENCES admins(id),
  token_hash TEXT        NOT NULL UNIQUE,
  expira_em  TIMESTAMPTZ NOT NULL,
  usado_em   TIMESTAMPTZ,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE colaboradores ADD COLUMN excluido_em  TIMESTAMPTZ;
ALTER TABLE colaboradores ADD COLUMN excluido_por BIGINT;

CREATE INDEX pedidos_solicitante_idx ON pedidos (empresa_id, solicitante_tipo, solicitante_id, criado_em DESC);
CREATE INDEX pedidos_pend_idx ON pedidos (empresa_id, criado_em DESC) WHERE estado = 'pend';
