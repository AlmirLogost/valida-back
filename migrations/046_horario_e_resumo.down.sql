ALTER TABLE colaboradores DROP COLUMN IF EXISTS resumo_whatsapp;
ALTER TABLE admins DROP COLUMN IF EXISTS resumo_whatsapp;
DROP INDEX IF EXISTS execucoes_horario;
ALTER TABLE execucoes DROP COLUMN IF EXISTS horario_conferir;
