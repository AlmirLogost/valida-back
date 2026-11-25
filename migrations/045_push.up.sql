-- 045 · Web Push (§18): inscrição presa à sessão (token_versao), inscrição
-- morta marcada em vez de apagada, e o que já foi avisado (para nunca avisar
-- duas vezes a mesma coisa). Só ACRESCENTA; não altera nem apaga dados.
ALTER TABLE push_inscricoes ADD COLUMN IF NOT EXISTS token_versao INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_inscricoes ADD COLUMN IF NOT EXISTS invalida_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS push_inscricoes_dono ON push_inscricoes (dono_tipo, dono_id) WHERE invalida_em IS NULL;

CREATE TABLE IF NOT EXISTS notificacoes_enviadas (
  id          BIGSERIAL   PRIMARY KEY,
  empresa_id  BIGINT      NOT NULL REFERENCES empresas(id),
  unidade_id  BIGINT      REFERENCES unidades(id),
  chave       TEXT        NOT NULL UNIQUE,   -- ex.: hora:123 · rep:123:2 · acao:9:admin:1
  tipo        TEXT        NOT NULL CHECK (tipo IN ('hora', 'repetir', 'atraso', 'acao', 'vencida', 'resumo')),
  dono_tipo   TEXT        NOT NULL CHECK (dono_tipo IN ('colaborador', 'admin')),
  dono_id     BIGINT      NOT NULL,
  aparelhos   INTEGER     NOT NULL DEFAULT 0,
  entregues   INTEGER     NOT NULL DEFAULT 0,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notificacoes_enviadas_empresa ON notificacoes_enviadas (empresa_id, criado_em DESC);
