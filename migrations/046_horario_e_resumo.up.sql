-- 046 · Conclusão sem internet que precisa de conferência de horário (chegou
-- mais de 12 h depois, ou com o relógio do celular muito diferente) e a opção
-- de cada admin/gerente receber ou não o resumo das 22 h.
-- Só ACRESCENTA colunas; não altera nem apaga dados.
ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS horario_conferir TEXT CHECK (horario_conferir IN ('tarde', 'relogio'));
CREATE INDEX IF NOT EXISTS execucoes_horario ON execucoes (unidade_id) WHERE horario_conferir IS NOT NULL;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS resumo_whatsapp BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS resumo_whatsapp BOOLEAN NOT NULL DEFAULT true;
