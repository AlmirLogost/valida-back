DROP INDEX IF EXISTS pedidos_pend_idx;
DROP INDEX IF EXISTS pedidos_solicitante_idx;
ALTER TABLE colaboradores DROP COLUMN IF EXISTS excluido_por;
ALTER TABLE colaboradores DROP COLUMN IF EXISTS excluido_em;
DROP TABLE IF EXISTS senha_tokens;
