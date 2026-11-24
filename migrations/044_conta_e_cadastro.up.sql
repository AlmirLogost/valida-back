-- 044 · Dados da empresa (fatura e recibos), pedido de exclusão da conta e
-- código de confirmação do cadastro de cliente novo (§20, §21).
-- Só ACRESCENTA: colunas novas (vazias) e uma tabela nova. Não altera nem apaga dados.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS razao_social TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS uf TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS exclusao_pedida_em TIMESTAMPTZ;

-- Código de 6 números enviado ao WhatsApp no cadastro (só o hash fica aqui).
CREATE TABLE IF NOT EXISTS cadastro_codigos (
  id          BIGSERIAL   PRIMARY KEY,
  celular     TEXT        NOT NULL,
  codigo_hash TEXT        NOT NULL,
  tentativas  INTEGER     NOT NULL DEFAULT 0,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em   TIMESTAMPTZ NOT NULL,
  usado_em    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cadastro_codigos_celular ON cadastro_codigos (celular, criado_em DESC);
