-- 039 · painel da plataforma (vazias) e tentativas de login no banco
-- (Segurança item 1: limite de tentativas guardado no banco, não em memória).
-- chave_hash: hash do que foi digitado (celular/e-mail) + IP; nunca o valor.

CREATE TABLE plataforma_usuarios (
  id           BIGSERIAL   PRIMARY KEY,
  nome         TEXT        NOT NULL,
  email        TEXT        NOT NULL UNIQUE,
  senha_hash   TEXT        NOT NULL,
  papel        TEXT        NOT NULL CHECK (papel IN ('dono', 'suporte', 'financeiro')),
  totp_segredo TEXT,       -- cifrado
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE acessos_suporte (
  id                      BIGSERIAL   PRIMARY KEY,
  empresa_id              BIGINT      NOT NULL REFERENCES empresas(id),
  plataforma_usuario_id   BIGINT      NOT NULL REFERENCES plataforma_usuarios(id),
  motivo                  TEXT        NOT NULL,
  pedido_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  autorizado_por_admin_id BIGINT      REFERENCES admins(id),
  inicio                  TIMESTAMPTZ,
  fim                     TIMESTAMPTZ,
  encerrado_em            TIMESTAMPTZ
);

CREATE TABLE plataforma_registro (
  id         BIGSERIAL   PRIMARY KEY,
  quem       BIGINT      REFERENCES plataforma_usuarios(id),
  acao       TEXT        NOT NULL,
  empresa_id BIGINT      REFERENCES empresas(id),
  em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  detalhe    JSONB
);

CREATE TABLE login_tentativas (
  chave_hash       TEXT        PRIMARY KEY,
  tipo             TEXT        NOT NULL CHECK (tipo IN ('equipe', 'admin', 'plataforma')),
  falhas           INTEGER     NOT NULL DEFAULT 0,
  primeira_falha_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  bloqueado_ate    TIMESTAMPTZ
);
