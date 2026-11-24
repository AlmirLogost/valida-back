-- 022 · empresas (D2, D13, P1, P3).
--
-- Uma empresa por usuário super_admin. O id da empresa é o MESMO id do dono
-- no legado (usuarios.id = lojas.admin_id), então todo admin_id válido do
-- legado vira empresa_id sem tabela de tradução.
-- Plano e situação vêm da assinatura mais recente (subscriptions):
--   essencial → ess · profissional → pro · franquia → rede (P1)
--   trial em dia → teste · trial vencido → consulta · ativo → ativa ·
--   suspenso → atrasada · cancelado → bloqueada · sem assinatura → consulta (D13)
-- config: nf_padrao_min 120, tol_atraso_min 10, raio_padrao_m 100 (P3).

CREATE TABLE empresas (
  id              BIGSERIAL   PRIMARY KEY,
  nome            TEXT        NOT NULL,
  cnpj            TEXT,
  segmento        TEXT,
  plano           TEXT        CHECK (plano IN ('ess', 'pro', 'rede')),
  ciclo           TEXT        NOT NULL DEFAULT 'mensal' CHECK (ciclo IN ('mensal', 'anual')),
  trial_ate       TIMESTAMPTZ,
  situacao        TEXT        NOT NULL DEFAULT 'teste'
                  CHECK (situacao IN ('teste', 'ativa', 'atrasada', 'consulta', 'bloqueada')),
  config          JSONB       NOT NULL DEFAULT '{"nf_padrao_min": 120, "tol_atraso_min": 10, "raio_padrao_m": 100}',
  legado_admin_id INTEGER     UNIQUE,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO empresas (id, nome, cnpj, plano, trial_ate, situacao, legado_admin_id, criado_em)
SELECT
  u.id,
  COALESCE(NULLIF(trim(u.razao_social), ''), u.nome),
  NULLIF(regexp_replace(COALESCE(u.documento, ''), '[^0-9]', '', 'g'), ''),
  CASE p.slug WHEN 'essencial' THEN 'ess' WHEN 'profissional' THEN 'pro' WHEN 'franquia' THEN 'rede' END,
  s.trial_fim::timestamptz,
  CASE
    WHEN s.id IS NULL THEN 'consulta'
    WHEN s.status = 'trial' AND s.trial_fim IS NOT NULL AND s.trial_fim < now()::timestamp THEN 'consulta'
    WHEN s.status = 'trial' THEN 'teste'
    WHEN s.status = 'ativo' THEN 'ativa'
    WHEN s.status = 'suspenso' THEN 'atrasada'
    WHEN s.status = 'cancelado' THEN 'bloqueada'
    ELSE 'consulta'
  END,
  u.id,
  COALESCE(u.criado_em::timestamptz, now())
FROM usuarios u
LEFT JOIN LATERAL (
  SELECT * FROM subscriptions s WHERE s.admin_id = u.id ORDER BY s.criado_em DESC NULLS LAST, s.id DESC LIMIT 1
) s ON true
LEFT JOIN planos p ON p.id = s.plano_id
WHERE u.perfil = 'super_admin';

SELECT setval(pg_get_serial_sequence('empresas', 'id'), GREATEST((SELECT MAX(id) FROM empresas), 1));

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '022', 'empresas sem assinatura (entraram como consulta)', COUNT(*), 'D13'
FROM usuarios u WHERE u.perfil = 'super_admin' AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.admin_id = u.id);
