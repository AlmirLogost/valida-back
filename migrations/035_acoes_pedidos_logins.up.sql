-- 035 · acoes, pedidos, logins (vazias; não existem no legado).

CREATE TABLE acoes (
  id                 BIGSERIAL   PRIMARY KEY,
  empresa_id         BIGINT      NOT NULL REFERENCES empresas(id),
  unidade_id         BIGINT      NOT NULL REFERENCES unidades(id),
  execucao_id        BIGINT      REFERENCES execucoes(id),
  tipo               TEXT        NOT NULL CHECK (tipo IN ('nf', 'fx')),
  motivo             TEXT,
  porque             TEXT,
  aberta_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  prazo_ate          TIMESTAMPTZ,
  responsavel_tipo   TEXT        CHECK (responsavel_tipo IN ('colaborador', 'admin')),
  responsavel_id     BIGINT,
  estado             TEXT        NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'resolvida')),
  solucao            TEXT,
  foto_id            BIGINT      REFERENCES fotos(id),
  resolvida_por      BIGINT,
  resolvida_em       TIMESTAMPTZ,
  vencida_avisada_em TIMESTAMPTZ
);

CREATE TABLE pedidos (
  id                         BIGSERIAL   PRIMARY KEY,
  empresa_id                 BIGINT      NOT NULL REFERENCES empresas(id),
  unidade_id                 BIGINT      REFERENCES unidades(id),
  solicitante_tipo           TEXT        NOT NULL CHECK (solicitante_tipo IN ('colaborador', 'admin')),
  solicitante_id             BIGINT      NOT NULL,
  tipo                       TEXT        NOT NULL,
  titulo                     TEXT        NOT NULL,
  detalhe                    TEXT,
  payload                    JSONB,
  estado                     TEXT        NOT NULL DEFAULT 'pend' CHECK (estado IN ('pend', 'ok', 'no')),
  decidido_por               BIGINT,
  decidido_em                TIMESTAMPTZ,
  resultado                  JSONB,      -- nunca PIN em claro (vai cifrado e some depois de visto)
  visto_pelo_solicitante_em  TIMESTAMPTZ,
  criado_em                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE logins (
  id                     BIGSERIAL     PRIMARY KEY,
  empresa_id             BIGINT        NOT NULL REFERENCES empresas(id),
  colaborador_id         BIGINT        NOT NULL REFERENCES colaboradores(id),
  unidade_id             BIGINT        REFERENCES unidades(id),
  em                     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  lat                    NUMERIC(9, 6),
  lng                    NUMERIC(9, 6),
  distancia_m            INTEGER,
  dentro_raio            BOOLEAN,
  liberado_por_pedido_id BIGINT        REFERENCES pedidos(id),
  atraso_min             INTEGER
);
