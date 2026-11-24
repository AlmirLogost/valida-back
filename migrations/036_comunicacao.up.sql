-- 036 · config_notificacoes (uma por unidade, com padrões), push_inscricoes,
-- manual_documentos. Nenhum envio real é ligado aqui.

CREATE TABLE config_notificacoes (
  unidade_id      BIGINT   PRIMARY KEY REFERENCES unidades(id),
  push            BOOLEAN  NOT NULL DEFAULT true,
  antes_min       INTEGER  NOT NULL DEFAULT 0 CHECK (antes_min IN (0, 5, 15, 30)),
  modo            SMALLINT NOT NULL DEFAULT 2 CHECK (modo IN (0, 1, 2)),   -- 0 balançar, 1 pop-up, 2 os dois
  som             BOOLEAN  NOT NULL DEFAULT true,
  vibrar          BOOLEAN  NOT NULL DEFAULT true,
  repetir_min     INTEGER  NOT NULL DEFAULT 0 CHECK (repetir_min IN (0, 10, 15, 30)),
  avisar_atraso   BOOLEAN  NOT NULL DEFAULT true,
  resumo_whatsapp BOOLEAN  NOT NULL DEFAULT false
);

INSERT INTO config_notificacoes (unidade_id) SELECT id FROM unidades;

CREATE TABLE push_inscricoes (
  id         BIGSERIAL   PRIMARY KEY,
  empresa_id BIGINT      NOT NULL REFERENCES empresas(id),
  dono_tipo  TEXT        NOT NULL CHECK (dono_tipo IN ('colaborador', 'admin')),
  dono_id    BIGINT      NOT NULL,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  aparelho   TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE manual_documentos (
  id           BIGSERIAL   PRIMARY KEY,
  empresa_id   BIGINT      NOT NULL REFERENCES empresas(id),
  titulo       TEXT        NOT NULL,
  texto        TEXT        NOT NULL DEFAULT '',
  ordem        INTEGER     NOT NULL DEFAULT 0,
  arquivado_em TIMESTAMPTZ,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
