-- 042 · Etapa 1B: execução do dia, conferência, desfazer e ações.
--
-- execucoes:
--   conferida_por_tipo / desfeita_por_tipo: 'admin' | 'colaborador' (o id
--     sozinho não diz de qual tabela é).
--   execucoes_dia_un: uma execução por tarefa + pessoa + dia (o agendador
--     pode rodar várias vezes sem duplicar). As execuções migradas do legado
--     ficam fora da regra.
-- acoes:
--   resolvida_por_tipo, e no máximo uma ação ABERTA por execução e tipo.

ALTER TABLE execucoes ADD COLUMN conferida_por_tipo TEXT CHECK (conferida_por_tipo IN ('admin', 'colaborador'));
ALTER TABLE execucoes ADD COLUMN desfeita_por_tipo  TEXT CHECK (desfeita_por_tipo IN ('admin', 'colaborador'));
CREATE UNIQUE INDEX execucoes_dia_un ON execucoes (tarefa_id, colaborador_id, data) WHERE legado_execucao_id IS NULL;
CREATE INDEX execucoes_estado_idx ON execucoes (unidade_id, estado, data);

ALTER TABLE acoes ADD COLUMN resolvida_por_tipo TEXT CHECK (resolvida_por_tipo IN ('admin', 'colaborador'));
CREATE UNIQUE INDEX acoes_aberta_un ON acoes (execucao_id, tipo) WHERE estado = 'aberta';
CREATE INDEX acoes_prazo_idx ON acoes (prazo_ate) WHERE estado = 'aberta';
