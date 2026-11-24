-- 032 · tarefas (D4, D5/P4, D8, D3).
--
-- Cada tarefa é OU de uma pessoa (colaborador_id) OU de um cargo (cargo_id) (D4).
--   usuario_checklists → 1 tarefa por pessoa, com o valor próprio dela
--                        (bonus_override / desconto_override).
--   checklist_cargos   → 1 tarefa com cargo_id (o cargo da unidade da tarefa).
--   checklist_itens    → tarefas filhas (pai_id) de cada tarefa gerada (P4).
-- Vínculo desligado ou tarefa arquivada no legado → entra arquivada (para
-- manter o histórico das execuções). Pausada → entra desativada (ativa = false).
-- Campos: titulo; porque ← descricao; recorrencia igual; dias_semana texto
-- "2,5" → int[] (0 = domingo); dia_mes ← dia de data_mensal; data_pontual
-- igual; hora_ini/hora_fim ← horario_inicio/fim (texto inválido → vazio);
-- tipo: boolean→feito, numerico→numero, avaliativo→nota, texto→texto,
-- selecao→escolha; pede_foto ← evidencia_obrigatoria; nf_min e
-- prazo_acao_min = 120 (padrão §11).
-- D8: tolerancia_min só quando diferente de 30 (o padrão antigo; 30 não é
-- escolha de ninguém e taparia a tolerância da empresa); valida_de/valida_ate
-- ← data_inicio/data_termino; critica ← critico.
-- Fica só no legado: categoria, momento, peso, score, pausado_ate/tipo,
-- repeticao_intervalo, tipo líder/operador, rótulos, setores, hora_reset.
-- D3: o admin não executa tarefas; vínculos de dono não migram.

CREATE OR REPLACE FUNCTION pg_temp.data_ou_nulo(t text) RETURNS date LANGUAGE plpgsql AS $$
BEGIN
  IF t IS NULL OR t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN RETURN NULL; END IF;
  RETURN substring(t, 1, 10)::date;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.hora_ou_nula(t text) RETURNS time LANGUAGE plpgsql AS $$
BEGIN
  IF t IS NULL OR t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]' THEN RETURN NULL; END IF;
  RETURN substring(t, 1, 5)::time;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE TABLE tarefas (
  id                     BIGSERIAL     PRIMARY KEY,
  empresa_id             BIGINT        NOT NULL REFERENCES empresas(id),
  unidade_id             BIGINT        NOT NULL REFERENCES unidades(id),
  colaborador_id         BIGINT        REFERENCES colaboradores(id),
  cargo_id               BIGINT        REFERENCES cargos(id),
  pai_id                 BIGINT        REFERENCES tarefas(id),
  secao                  TEXT,
  ordem                  INTEGER       NOT NULL DEFAULT 0,
  titulo                 TEXT          NOT NULL,
  porque                 TEXT,
  recorrencia            TEXT          NOT NULL DEFAULT 'diario' CHECK (recorrencia IN ('diario', 'semanal', 'mensal', 'pontual')),
  dias_semana            INTEGER[],
  dia_mes                SMALLINT      CHECK (dia_mes BETWEEN 1 AND 31),
  data_pontual           DATE,
  hora_ini               TIME,
  hora_fim               TIME,
  tipo_resposta          TEXT          NOT NULL DEFAULT 'feito' CHECK (tipo_resposta IN ('feito', 'numero', 'nota', 'escolha', 'texto', 'conjunto')),
  faixa_min              NUMERIC,
  faixa_max              NUMERIC,
  unidade_medida         TEXT,
  opcoes                 JSONB,
  opcao_ruim             TEXT,
  conjunto_id            BIGINT        REFERENCES conjuntos_resposta(id),
  pede_foto              BOOLEAN       NOT NULL DEFAULT false,
  nf_min                 INTEGER       NOT NULL DEFAULT 120 CHECK (nf_min IN (60, 120, 180, 240)),
  prazo_acao_min         INTEGER       NOT NULL DEFAULT 120 CHECK (prazo_acao_min IN (0, 60, 120, 240)),
  valor_feita            NUMERIC(12,2),
  valor_nao_feita        NUMERIC(12,2),
  tolerancia_min         INTEGER,      -- D8: sobrepõe a tolerância da empresa
  valida_de              DATE,         -- D8
  valida_ate             DATE,         -- D8
  critica                BOOLEAN       NOT NULL DEFAULT false,   -- D8 (uso futuro)
  ativa                  BOOLEAN       NOT NULL DEFAULT true,
  arquivado_em           TIMESTAMPTZ,
  criado_por             BIGINT,
  legado_checklist_id    INTEGER,
  legado_vinculo_id      INTEGER,      -- usuario_checklists.id
  legado_cargo_vinculo_id INTEGER,     -- checklist_cargos.id
  legado_item_id         INTEGER,      -- checklist_itens.id (filhas)
  criado_em              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  atualizado_em          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK ((colaborador_id IS NULL) <> (cargo_id IS NULL))
);
CREATE INDEX tarefas_legado_idx ON tarefas (legado_checklist_id, colaborador_id) WHERE pai_id IS NULL;

-- Tarefas-mãe por pessoa e por cargo.
CREATE TEMP TABLE _mae ON COMMIT DROP AS
SELECT c.*, un.empresa_id, col.id AS colab_id, NULL::bigint AS cargo_ok_id,
       uc.id AS vinc_id, NULL::integer AS cvinc_id, COALESCE(uc.ativo, 1) AS vinc_ativo,
       uc.bonus_override, uc.desconto_override
FROM usuario_checklists uc
JOIN checklists c ON c.id = uc.checklist_id
JOIN colaboradores col ON col.id = uc.usuario_id
JOIN unidades un ON un.id = c.loja_id AND un.empresa_id = col.empresa_id
UNION ALL
SELECT c.*, un.empresa_id, NULL, cg.id, NULL, cc.id, COALESCE(cc.ativo, 1), NULL, NULL
FROM checklist_cargos cc
JOIN checklists c ON c.id = cc.checklist_id
JOIN unidades un ON un.id = c.loja_id
JOIN LATERAL (SELECT cg.id FROM cargos cg WHERE cg.unidade_id = un.id AND cg.legado_slug = cc.perfil_nome
              ORDER BY cg.legado_perfil_id NULLS FIRST, cg.id LIMIT 1) cg ON true;

INSERT INTO tarefas (empresa_id, unidade_id, colaborador_id, cargo_id, titulo, porque, recorrencia, dias_semana, dia_mes,
                     data_pontual, hora_ini, hora_fim, tipo_resposta, pede_foto, valor_feita, valor_nao_feita,
                     tolerancia_min, valida_de, valida_ate, critica, ativa, arquivado_em, criado_por,
                     legado_checklist_id, legado_vinculo_id, legado_cargo_vinculo_id, criado_em)
SELECT m.empresa_id, m.loja_id, m.colab_id, m.cargo_ok_id, m.titulo, NULLIF(trim(m.descricao), ''),
  CASE WHEN m.recorrencia IN ('diario', 'semanal', 'mensal', 'pontual') THEN m.recorrencia ELSE 'diario' END,
  CASE WHEN m.dias_semana ~ '^\s*[0-6](\s*,\s*[0-6])*\s*$'
       THEN string_to_array(regexp_replace(m.dias_semana, '\s', '', 'g'), ',')::int[] END,
  CASE WHEN m.data_mensal ~ '^[0-9]{4}-[0-9]{2}-(0[1-9]|[12][0-9]|3[01])' THEN substring(m.data_mensal, 9, 2)::int
       WHEN m.data_mensal ~ '^([1-9]|[12][0-9]|3[01])$' THEN m.data_mensal::int END,
  m.data_pontual,
  pg_temp.hora_ou_nula(m.horario_inicio), pg_temp.hora_ou_nula(m.horario_fim),
  CASE m.tipo_campo WHEN 'numerico' THEN 'numero' WHEN 'avaliativo' THEN 'nota' WHEN 'texto' THEN 'texto'
                    WHEN 'selecao' THEN 'escolha' ELSE 'feito' END,
  COALESCE(m.evidencia_obrigatoria, 0) = 1,
  m.bonus_override, m.desconto_override,
  NULLIF(m.tolerancia_min, 30),
  pg_temp.data_ou_nulo(m.data_inicio), pg_temp.data_ou_nulo(m.data_termino),
  COALESCE(m.critico, 0) = 1,
  COALESCE(m.ativo, 1) = 1 AND m.vinc_ativo = 1 AND COALESCE(m.pausado, 0) = 0,
  CASE WHEN COALESCE(m.ativo, 1) <> 1 OR m.vinc_ativo <> 1 THEN now() END,
  m.criado_por, m.id, m.vinc_id, m.cvinc_id,
  COALESCE(m.criado_em::timestamptz, now())
FROM _mae m;

-- Filhas (sub-itens), uma cópia por tarefa-mãe.
INSERT INTO tarefas (empresa_id, unidade_id, colaborador_id, cargo_id, pai_id, ordem, titulo, porque, recorrencia,
                     dias_semana, dia_mes, data_pontual, hora_ini, hora_fim, tipo_resposta, pede_foto, critica,
                     ativa, arquivado_em, criado_por, legado_checklist_id, legado_item_id, criado_em)
SELECT t.empresa_id, t.unidade_id, t.colaborador_id, t.cargo_id, t.id, COALESCE(i.ordem, 0), i.titulo,
       NULLIF(trim(i.descricao), ''), t.recorrencia, t.dias_semana, t.dia_mes, t.data_pontual, t.hora_ini, t.hora_fim,
       CASE i.tipo_campo WHEN 'numerico' THEN 'numero' WHEN 'avaliativo' THEN 'nota' WHEN 'texto' THEN 'texto'
                         WHEN 'selecao' THEN 'escolha' ELSE 'feito' END,
       COALESCE(i.evidencia_obrigatoria, 0) = 1, COALESCE(i.critico, 0) = 1,
       t.ativa, t.arquivado_em, t.criado_por, t.legado_checklist_id, i.id, t.criado_em
FROM tarefas t
JOIN checklist_itens i ON i.checklist_id = t.legado_checklist_id
WHERE t.pai_id IS NULL;

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '032', 'tarefas órfãs (unidade órfã ou sem unidade)', COUNT(*), 'órfão: fica só no legado'
FROM checklists c WHERE NOT EXISTS (SELECT 1 FROM unidades un WHERE un.id = c.loja_id)
UNION ALL
SELECT '032', 'tarefas sem ninguém e sem cargo vinculado', COUNT(*), 'fica só no legado (não há a quem atribuir)'
FROM checklists c WHERE EXISTS (SELECT 1 FROM unidades un WHERE un.id = c.loja_id)
  AND NOT EXISTS (SELECT 1 FROM tarefas t WHERE t.legado_checklist_id = c.id)
UNION ALL
SELECT '032', 'vínculos de tarefa com o dono (D3)', COUNT(*), 'D3: fica só no legado'
FROM usuario_checklists uc JOIN usuarios u ON u.id = uc.usuario_id WHERE u.perfil = 'super_admin'
UNION ALL
SELECT '032', 'vínculos de tarefa com pessoa não migrada ou de outra empresa', COUNT(*), 'fica só no legado'
FROM usuario_checklists uc JOIN usuarios u ON u.id = uc.usuario_id
WHERE COALESCE(u.perfil, '') <> 'super_admin' AND NOT EXISTS (SELECT 1 FROM tarefas t WHERE t.legado_vinculo_id = uc.id)
UNION ALL
SELECT '032', 'vínculos por cargo sem cargo correspondente na unidade', COUNT(*), 'fica só no legado'
FROM checklist_cargos cc WHERE NOT EXISTS (SELECT 1 FROM tarefas t WHERE t.legado_cargo_vinculo_id = cc.id)
UNION ALL
SELECT '032', 'tarefas pausadas (entraram desativadas)', COUNT(*), 'informativo: "pausar até" fica no legado'
FROM tarefas WHERE pai_id IS NULL AND NOT ativa AND arquivado_em IS NULL
UNION ALL
SELECT '032', 'tarefas de escolha sem opções', COUNT(*), 'conferir: precisam de opções'
FROM tarefas WHERE tipo_resposta = 'escolha' AND opcoes IS NULL
UNION ALL
SELECT '032', 'datas extras (checklist_datas)', COUNT(*), 'fica só no legado'
FROM checklist_datas;
