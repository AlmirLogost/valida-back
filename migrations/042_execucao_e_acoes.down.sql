DROP INDEX IF EXISTS acoes_prazo_idx;
DROP INDEX IF EXISTS acoes_aberta_un;
ALTER TABLE acoes DROP COLUMN IF EXISTS resolvida_por_tipo;
DROP INDEX IF EXISTS execucoes_estado_idx;
DROP INDEX IF EXISTS execucoes_dia_un;
ALTER TABLE execucoes DROP COLUMN IF EXISTS desfeita_por_tipo;
ALTER TABLE execucoes DROP COLUMN IF EXISTS conferida_por_tipo;
