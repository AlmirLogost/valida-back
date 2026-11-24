-- 038 · planos_catalogo, assinaturas, faturas (P1, D13, D14).
--
-- Sem amarrar a gateway nenhum: campos genéricos gateway + referencia_externa.
-- A Asaas NÃO será usada (D14): a assinatura entra sem gateway; se o legado
-- tiver id de assinatura externa, ele fica em referencia_externa com
-- gateway = 'legado' (só para consulta).
-- planos_catalogo: planos da §21 (P1). A tabela antiga planos fica intacta.

CREATE TABLE planos_catalogo (
  slug              TEXT          PRIMARY KEY CHECK (slug IN ('ess', 'pro', 'rede')),
  nome              TEXT          NOT NULL,
  preco_mensal      NUMERIC(12,2) NOT NULL,
  unidades_inclusas INTEGER       NOT NULL,
  max_unidades      INTEGER,      -- null = sem limite
  max_colaboradores INTEGER,      -- null = sem limite
  preco_unidade_extra NUMERIC(12,2),
  meses_cobrados_no_anual INTEGER NOT NULL DEFAULT 10,
  ativo             BOOLEAN       NOT NULL DEFAULT true
);
INSERT INTO planos_catalogo (slug, nome, preco_mensal, unidades_inclusas, max_unidades, max_colaboradores, preco_unidade_extra) VALUES
  ('ess',  'Essencial',    197, 1, 1,    10,   NULL),
  ('pro',  'Profissional', 397, 3, 5,    40,   97),
  ('rede', 'Rede',         897, 6, NULL, NULL, 79);

CREATE TABLE assinaturas (
  empresa_id         BIGINT        PRIMARY KEY REFERENCES empresas(id),
  plano              TEXT          REFERENCES planos_catalogo(slug),
  ciclo              TEXT          NOT NULL DEFAULT 'mensal' CHECK (ciclo IN ('mensal', 'anual')),
  unidades_extra     INTEGER       NOT NULL DEFAULT 0,
  valor              NUMERIC(12,2),
  situacao           TEXT          NOT NULL CHECK (situacao IN ('teste', 'ativa', 'atrasada', 'consulta', 'bloqueada')),
  proxima_cobranca   DATE,
  gateway            TEXT,         -- genérico; definido na Etapa 5
  referencia_externa TEXT,         -- id no meio de pagamento
  legado_subscription_id INTEGER,
  criado_em          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

INSERT INTO assinaturas (empresa_id, plano, ciclo, valor, situacao, gateway, referencia_externa, legado_subscription_id, criado_em)
SELECT e.id, e.plano, e.ciclo, pc.preco_mensal, e.situacao,
       CASE WHEN s.gateway_subscription_id IS NOT NULL THEN 'legado' END,
       s.gateway_subscription_id, s.id, COALESCE(s.criado_em::timestamptz, now())
FROM empresas e
LEFT JOIN planos_catalogo pc ON pc.slug = e.plano
LEFT JOIN LATERAL (SELECT * FROM subscriptions s WHERE s.admin_id = e.id ORDER BY s.criado_em DESC NULLS LAST, s.id DESC LIMIT 1) s ON true;

CREATE TABLE faturas (
  id                 BIGSERIAL     PRIMARY KEY,
  empresa_id         BIGINT        NOT NULL REFERENCES empresas(id),
  valor              NUMERIC(12,2) NOT NULL,
  vencimento         DATE          NOT NULL,
  paga_em            TIMESTAMPTZ,
  situacao           TEXT          NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'paga', 'vencida', 'cancelada')),
  link               TEXT,
  gateway            TEXT,
  referencia_externa TEXT,
  criado_em          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '038', 'assinaturas antigas que não são a mais recente da empresa', COUNT(*), 'fica só no legado'
FROM subscriptions s WHERE NOT EXISTS (SELECT 1 FROM assinaturas a WHERE a.legado_subscription_id = s.id)
UNION ALL
SELECT '038', 'assinaturas com id no gateway antigo', COUNT(*), 'D14: gateway = legado, sem cobrança'
FROM assinaturas WHERE gateway = 'legado';
