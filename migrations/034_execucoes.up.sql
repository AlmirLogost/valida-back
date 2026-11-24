-- 034 · execucoes nova (D6, D7, D3).
--
-- execucoes → execucoes_legado e execucoes_itens → execucoes_itens_legado
-- (índices e sequências renomeados junto). Nada é apagado.
-- Entram só as execuções concluídas ('concluido') que acham a tarefa da
-- mesma pessoa (legado_checklist_id + colaborador_id):
--   estado feita · data ← dia de iniciado_em (fuso America/Sao_Paulo) ·
--   feita_em = recebida_em ← concluido_em · hora_prevista ← hora_ini da tarefa ·
--   resposta: número/nota → resposta_num, texto → resposta_texto
--   (observação vai para resposta_texto quando não há texto) ·
--   conferência (D7): aprovado → aprovada; reprovado → reaberta; pendente → vazio.
-- Sub-itens concluídos viram execuções das tarefas filhas (P4).
-- Mesmo id da execução antiga nas execuções-mãe.
-- Fica só no legado: em_andamento (D6), as do dono (D3), as de órfãos e as
-- sem tarefa correspondente; sub-itens não concluídos.
-- foto_id é preenchido depois pelo scripts/migrar_fotos.js.

ALTER TABLE execucoes RENAME TO execucoes_legado;
ALTER TABLE execucoes_itens RENAME TO execucoes_itens_legado;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'
           AND tablename IN ('execucoes_legado', 'execucoes_itens_legado') LOOP
    IF r.tablename = 'execucoes_legado' AND r.indexname LIKE 'execucoes%' AND r.indexname NOT LIKE 'execucoes_legado%' AND r.indexname NOT LIKE 'execucoes_itens%' THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'execucoes_legado' || substring(r.indexname FROM length('execucoes') + 1));
    ELSIF r.tablename = 'execucoes_itens_legado' AND r.indexname LIKE 'execucoes_itens%' AND r.indexname NOT LIKE 'execucoes_itens_legado%' THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'execucoes_itens_legado' || substring(r.indexname FROM length('execucoes_itens') + 1));
    END IF;
  END LOOP;
  IF to_regclass('public.execucoes_id_seq') IS NOT NULL THEN ALTER SEQUENCE execucoes_id_seq RENAME TO execucoes_legado_id_seq; END IF;
  IF to_regclass('public.execucoes_itens_id_seq') IS NOT NULL THEN ALTER SEQUENCE execucoes_itens_id_seq RENAME TO execucoes_itens_legado_id_seq; END IF;
END $$;

CREATE TABLE execucoes (
  id                  BIGSERIAL   PRIMARY KEY,
  empresa_id          BIGINT      NOT NULL REFERENCES empresas(id),
  tarefa_id           BIGINT      NOT NULL REFERENCES tarefas(id),
  colaborador_id      BIGINT      NOT NULL REFERENCES colaboradores(id),
  unidade_id          BIGINT      NOT NULL REFERENCES unidades(id),
  data                DATE        NOT NULL,
  hora_prevista       TIME,
  estado              TEXT        NOT NULL DEFAULT 'a_fazer'
                      CHECK (estado IN ('a_fazer', 'feita', 'nao_feita', 'dispensada', 'cancelada', 'na')),
  motivo_dispensa     TEXT,
  feita_em            TIMESTAMPTZ,          -- horário real no celular
  recebida_em         TIMESTAMPTZ,          -- servidor
  resposta_texto      TEXT,
  resposta_num        NUMERIC,
  resposta_fora       BOOLEAN     NOT NULL DEFAULT false,
  foto_id             BIGINT      REFERENCES fotos(id),
  conferencia         TEXT        CHECK (conferencia IN ('aprovada', 'reaberta')),   -- D7
  conferencia_motivo  TEXT,                                                          -- D7
  conferida_por       BIGINT,
  conferida_em        TIMESTAMPTZ,
  desfeita_por        BIGINT,
  desfeita_em         TIMESTAMPTZ,
  chave_envio         TEXT        UNIQUE,   -- envio offline sem duplicar
  diferenca_relogio_s INTEGER,
  legado_execucao_id  INTEGER,
  legado_item_id      INTEGER,              -- execucoes_itens_legado.id da resposta
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contestacoes ADD CONSTRAINT contestacoes_execucao_fk FOREIGN KEY (execucao_id) REFERENCES execucoes(id);

CREATE OR REPLACE FUNCTION pg_temp.num_ou_nulo(t text) RETURNS numeric LANGUAGE plpgsql AS $$
BEGIN
  IF t IS NULL OR trim(t) = '' THEN RETURN NULL; END IF;
  RETURN replace(trim(t), ',', '.')::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- Execuções-mãe.
CREATE TEMP TABLE _ex ON COMMIT DROP AS
SELECT e.*, t.id AS tarefa_id, t.empresa_id, t.unidade_id AS t_unidade_id, t.hora_ini, t.tipo_resposta,
       (SELECT i.id FROM execucoes_itens_legado i WHERE i.execucao_id = e.id AND i.checklist_item_id = 0 ORDER BY i.id LIMIT 1) AS item0_id
FROM execucoes_legado e
JOIN LATERAL (SELECT t.* FROM tarefas t
              WHERE t.legado_checklist_id = e.checklist_id AND t.colaborador_id = e.usuario_id AND t.pai_id IS NULL
              ORDER BY t.arquivado_em NULLS FIRST, t.id LIMIT 1) t ON true
WHERE e.status = 'concluido';

INSERT INTO execucoes (id, empresa_id, tarefa_id, colaborador_id, unidade_id, data, hora_prevista, estado,
                       feita_em, recebida_em, resposta_texto, resposta_num, conferencia, conferida_em,
                       legado_execucao_id, legado_item_id, criado_em)
SELECT x.id, x.empresa_id, x.tarefa_id, x.usuario_id,
       COALESCE((SELECT un.id FROM unidades un WHERE un.id = x.loja_id AND un.empresa_id = x.empresa_id), x.t_unidade_id),
       (COALESCE(x.iniciado_em, x.concluido_em)::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
       x.hora_ini, 'feita',
       COALESCE(x.concluido_em, x.iniciado_em)::timestamptz, COALESCE(x.concluido_em, x.iniciado_em)::timestamptz,
       CASE WHEN x.tipo_resposta = 'texto' THEN COALESCE(NULLIF(i.valor_resposta, ''), i.observacao) ELSE NULLIF(i.observacao, '') END,
       CASE WHEN x.tipo_resposta IN ('numero', 'nota') THEN pg_temp.num_ou_nulo(i.valor_resposta) END,
       CASE x.status_conferencia WHEN 'aprovado' THEN 'aprovada' WHEN 'aprovada' THEN 'aprovada'
                                 WHEN 'reprovado' THEN 'reaberta' WHEN 'reprovada' THEN 'reaberta' END,
       CASE WHEN x.status_conferencia <> 'pendente' THEN i.validado_em::timestamptz END,
       x.id, x.item0_id, COALESCE(x.iniciado_em::timestamptz, now())
FROM _ex x
LEFT JOIN execucoes_itens_legado i ON i.id = x.item0_id;

-- Ids novos sempre acima de qualquer id antigo (nunca coincidem com o legado).
SELECT setval(pg_get_serial_sequence('execucoes', 'id'), GREATEST((SELECT MAX(id) FROM execucoes), (SELECT MAX(id) FROM execucoes_legado), 1));

-- Execuções das filhas: sub-itens concluídos.
INSERT INTO execucoes (empresa_id, tarefa_id, colaborador_id, unidade_id, data, hora_prevista, estado,
                       feita_em, recebida_em, resposta_texto, resposta_num, legado_execucao_id, legado_item_id, criado_em)
SELECT m.empresa_id, f.id, m.colaborador_id, m.unidade_id, m.data, f.hora_ini, 'feita',
       COALESCE(i.respondido_em::timestamptz, m.feita_em), COALESCE(i.respondido_em::timestamptz, m.recebida_em),
       CASE WHEN f.tipo_resposta = 'texto' THEN COALESCE(NULLIF(i.valor_resposta, ''), i.observacao) ELSE NULLIF(i.observacao, '') END,
       CASE WHEN f.tipo_resposta IN ('numero', 'nota') THEN pg_temp.num_ou_nulo(i.valor_resposta) END,
       m.legado_execucao_id, i.id, m.criado_em
FROM execucoes m
JOIN execucoes_itens_legado i ON i.execucao_id = m.legado_execucao_id AND i.checklist_item_id <> 0 AND i.concluido = 1
JOIN tarefas f ON f.pai_id = m.tarefa_id AND f.legado_item_id = i.checklist_item_id
WHERE m.legado_item_id IS NULL OR m.legado_item_id <> i.id;

CREATE INDEX execucoes_tarefa_data_idx ON execucoes (tarefa_id, data);
CREATE INDEX execucoes_legado_idx ON execucoes (legado_execucao_id);

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '034', 'execuções em andamento', COUNT(*), 'D6: fica só no legado'
FROM execucoes_legado WHERE status = 'em_andamento'
UNION ALL
SELECT '034', 'execuções concluídas do dono', COUNT(*), 'D3: fica só no legado'
FROM execucoes_legado e JOIN usuarios u ON u.id = e.usuario_id WHERE e.status = 'concluido' AND u.perfil = 'super_admin'
UNION ALL
SELECT '034', 'execuções concluídas de pessoa órfã ou sem tarefa correspondente', COUNT(*), 'fica só no legado'
FROM execucoes_legado e JOIN usuarios u ON u.id = e.usuario_id
WHERE e.status = 'concluido' AND COALESCE(u.perfil, '') <> 'super_admin'
  AND NOT EXISTS (SELECT 1 FROM execucoes n WHERE n.legado_execucao_id = e.id)
UNION ALL
SELECT '034', 'execuções com outro status', COUNT(*), 'fica só no legado'
FROM execucoes_legado WHERE status IS NULL OR status NOT IN ('concluido', 'em_andamento')
UNION ALL
SELECT '034', 'sub-itens não concluídos de execuções migradas', COUNT(*), 'fica só no legado'
FROM execucoes_itens_legado i JOIN execucoes m ON m.id = i.execucao_id AND m.legado_execucao_id = i.execucao_id
WHERE i.checklist_item_id <> 0 AND COALESCE(i.concluido, 0) <> 1
UNION ALL
SELECT '034', 'execuções reprovadas (entraram como feita + reaberta)', COUNT(*), 'D7: informativo'
FROM execucoes WHERE conferencia = 'reaberta';
