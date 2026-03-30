-- Migration 001: Planos e Subscriptions
-- Executar: psql -U postgres -d valida_v2 -f migrations/001_planos_subscriptions.sql

CREATE TABLE IF NOT EXISTS planos (
  id             SERIAL PRIMARY KEY,
  nome           TEXT    NOT NULL,
  slug           TEXT    NOT NULL UNIQUE,
  preco          NUMERIC NOT NULL,
  max_lojas      INTEGER,          -- NULL = ilimitado
  max_usuarios   INTEGER,          -- NULL = ilimitado
  max_tarefas_ativas INTEGER,      -- NULL = ilimitado
  tem_comissoes  INTEGER DEFAULT 0,
  ativo          INTEGER DEFAULT 1,
  criado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       SERIAL PRIMARY KEY,
  admin_id                 INTEGER NOT NULL REFERENCES usuarios(id),
  plano_id                 INTEGER NOT NULL REFERENCES planos(id),
  status                   TEXT    NOT NULL DEFAULT 'trial',
  trial_fim                TIMESTAMP,
  gateway_customer_id      TEXT,
  gateway_subscription_id  TEXT,
  criado_em                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed: 3 planos base
INSERT INTO planos (nome, slug, preco, max_lojas, max_usuarios, max_tarefas_ativas, tem_comissoes)
VALUES
  ('Essencial',    'essencial',    197,  1,    10,   NULL, 0),
  ('Profissional', 'profissional', 397,  5,    30,   NULL, 1),
  ('Franquia',     'franquia',     897,  NULL, NULL, NULL, 1)
ON CONFLICT (slug) DO NOTHING;
