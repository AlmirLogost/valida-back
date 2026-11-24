-- 030 · regras_bonus, bonus_ajustes, contestacoes (§16, P5, D10).
--
-- Uma regra por colaborador, vigente desde o 1º dia do mês da migração
-- (meses anteriores continuam calculados pelo legado nos relatórios antigos):
--   tipo_comissao 'por_tarefa' → tarefa (valor_feita ← valor_tarefa_feita, valor_nao_feita ← valor_desconto)
--   tipo_comissao 'mensal'     → fixo   (valor_mes ← valor_mensal_fixo, valor_nao_feita ← desconto_mensal)
--   vazio ou outro             → depois
-- Período personalizado vira mensal (D10); peso fica só no legado.

CREATE TABLE regras_bonus (
  id              BIGSERIAL     PRIMARY KEY,
  colaborador_id  BIGINT        NOT NULL REFERENCES colaboradores(id),
  tipo            TEXT          NOT NULL CHECK (tipo IN ('tarefa', 'fixo', 'depois')),
  valor_feita     NUMERIC(12,2),
  valor_nao_feita NUMERIC(12,2),
  valor_mes       NUMERIC(12,2),
  atraso_ativo    BOOLEAN       NOT NULL DEFAULT false,
  atraso_tol_min  INTEGER,
  atraso_desconto NUMERIC(12,2),
  vigente_desde   DATE          NOT NULL,
  criado_por      BIGINT,
  criado_em       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (colaborador_id, vigente_desde)
);

CREATE TABLE bonus_ajustes (
  id             BIGSERIAL     PRIMARY KEY,
  colaborador_id BIGINT        NOT NULL REFERENCES colaboradores(id),
  data           DATE          NOT NULL,
  valor          NUMERIC(12,2) NOT NULL,
  motivo         TEXT          NOT NULL,
  criado_por     BIGINT,
  criado_em      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE contestacoes (
  id             BIGSERIAL   PRIMARY KEY,
  execucao_id    BIGINT      NOT NULL,              -- FK na 034 (execucoes nova)
  colaborador_id BIGINT      NOT NULL REFERENCES colaboradores(id),
  motivo         TEXT        NOT NULL,
  estado         TEXT        NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'aceita', 'negada')),
  decidido_por   BIGINT,
  decidido_em    TIMESTAMPTZ,
  resposta       TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO regras_bonus (colaborador_id, tipo, valor_feita, valor_nao_feita, valor_mes, vigente_desde)
SELECT c.id,
  CASE u.tipo_comissao WHEN 'por_tarefa' THEN 'tarefa' WHEN 'mensal' THEN 'fixo' ELSE 'depois' END,
  CASE WHEN u.tipo_comissao = 'por_tarefa' THEN COALESCE(u.valor_tarefa_feita, 0) END,
  CASE u.tipo_comissao WHEN 'por_tarefa' THEN COALESCE(u.valor_desconto, 0)
                       WHEN 'mensal' THEN COALESCE(u.desconto_mensal, 0) END,
  CASE WHEN u.tipo_comissao = 'mensal' THEN COALESCE(u.valor_mensal_fixo, 0) END,
  date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date
FROM colaboradores c
JOIN usuarios u ON u.id = c.legado_usuario_id;

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '030', 'regras com período personalizado (viraram mensais)', COUNT(*), 'D10'
FROM colaboradores c JOIN usuarios u ON u.id = c.legado_usuario_id
WHERE COALESCE(u.periodo_comissao, 'mensal') <> 'mensal'
UNION ALL
SELECT '030', 'tipo_comissao desconhecido (entrou como "definir depois")', COUNT(*), 'conferir'
FROM colaboradores c JOIN usuarios u ON u.id = c.legado_usuario_id
WHERE u.tipo_comissao IS NOT NULL AND u.tipo_comissao NOT IN ('por_tarefa', 'mensal');
