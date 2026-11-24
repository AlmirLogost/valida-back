-- 033 · fotos (vazia). As fotos em base64 do legado são extraídas para
-- arquivos pelo script scripts/migrar_fotos.js (depois da 034); o base64
-- original fica onde está.

CREATE TABLE fotos (
  id                      BIGSERIAL   PRIMARY KEY,
  empresa_id              BIGINT      NOT NULL REFERENCES empresas(id),
  caminho                 TEXT        NOT NULL,      -- relativo a FOTOS_DIR; nunca o arquivo no banco
  tamanho                 INTEGER     NOT NULL,
  mime                    TEXT        NOT NULL,
  sha256                  TEXT        NOT NULL,
  criado_por_tipo         TEXT        CHECK (criado_por_tipo IN ('colaborador', 'admin')),
  criado_por              BIGINT,
  legado_execucao_item_id INTEGER,
  legado_campo            TEXT        CHECK (legado_campo IN ('evidencia_url', 'foto_url')),
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legado_execucao_item_id, legado_campo)
);
