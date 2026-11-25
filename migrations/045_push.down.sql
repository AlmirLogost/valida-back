DROP TABLE IF EXISTS notificacoes_enviadas;
DROP INDEX IF EXISTS push_inscricoes_dono;
ALTER TABLE push_inscricoes DROP COLUMN IF EXISTS invalida_em;
ALTER TABLE push_inscricoes DROP COLUMN IF EXISTS token_versao;
