-- 025 · unidade_turnos (de loja_horarios).
--
-- Até 3 turnos por dia, em ordem de abertura. Linha com hora inválida ou
-- turno além do 3º fica só no legado (contado no relatório).
-- Unidade com algum horário: os dias sem linha entram como desligados
-- (ativo = false), que é o que "sem linha" significa hoje.
-- Unidade sem nenhum horário: não ganha linhas (o admin configura depois).

CREATE TABLE unidade_turnos (
  id          BIGSERIAL PRIMARY KEY,
  unidade_id  BIGINT    NOT NULL REFERENCES unidades(id),
  dia_semana  SMALLINT  NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),   -- 0 = domingo
  ativo       BOOLEAN   NOT NULL DEFAULT true,
  ordem       SMALLINT  NOT NULL DEFAULT 1 CHECK (ordem BETWEEN 1 AND 3),
  abre        TIME,
  fecha       TIME,
  legado_horario_id INTEGER UNIQUE,
  CHECK (NOT ativo OR (abre IS NOT NULL AND fecha IS NOT NULL)),
  UNIQUE (unidade_id, dia_semana, ordem)
);

CREATE TEMP TABLE _horarios ON COMMIT DROP AS
SELECT h.id, h.loja_id, h.dia_semana, h.hora_abertura::time AS abre, h.hora_fechamento::time AS fecha,
       ROW_NUMBER() OVER (PARTITION BY h.loja_id, h.dia_semana ORDER BY h.hora_abertura, h.id) AS ordem
FROM loja_horarios h
JOIN unidades un ON un.id = h.loja_id
WHERE h.dia_semana BETWEEN 0 AND 6
  AND h.hora_abertura   ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
  AND h.hora_fechamento ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$';

INSERT INTO unidade_turnos (unidade_id, dia_semana, ativo, ordem, abre, fecha, legado_horario_id)
SELECT loja_id, dia_semana, true, ordem, abre, fecha, id FROM _horarios WHERE ordem <= 3;

INSERT INTO unidade_turnos (unidade_id, dia_semana, ativo, ordem)
SELECT u.unidade_id, d.dia, false, 1
FROM (SELECT DISTINCT unidade_id FROM unidade_turnos) u
CROSS JOIN generate_series(0, 6) AS d(dia)
WHERE NOT EXISTS (SELECT 1 FROM unidade_turnos t WHERE t.unidade_id = u.unidade_id AND t.dia_semana = d.dia);

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '025', 'horários com hora ou dia inválido', COUNT(*), 'fica só no legado'
FROM loja_horarios h JOIN unidades un ON un.id = h.loja_id
WHERE NOT EXISTS (SELECT 1 FROM _horarios x WHERE x.id = h.id)
UNION ALL
SELECT '025', 'turnos além do 3º no mesmo dia', COUNT(*), 'fica só no legado'
FROM _horarios WHERE ordem > 3
UNION ALL
SELECT '025', 'horários de unidades órfãs', COUNT(*), 'órfão: fica só no legado'
FROM loja_horarios h WHERE NOT EXISTS (SELECT 1 FROM unidades un WHERE un.id = h.loja_id)
UNION ALL
SELECT '025', 'unidades sem nenhum horário (sem turnos)', COUNT(*), 'informativo'
FROM unidades un WHERE NOT EXISTS (SELECT 1 FROM unidade_turnos t WHERE t.unidade_id = un.id);
