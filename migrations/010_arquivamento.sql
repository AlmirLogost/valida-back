-- Migration 010 (Reforma de Acessos, Passo 2f): arquivar unidade/pessoa com
-- data e quem arquivou, permitindo restaurar depois.
--
-- Lojas já usavam ativo = -1 pra "arquivada" (em vez de apagar) — isso não
-- muda. Usuários (pessoas) passam a seguir o mesmo padrão (ativo = -1 pra
-- arquivado, diferente de ativo = 0 que já existia antes). O código que
-- arquiva/restaura (Passo 4) é responsável por preencher e limpar essas
-- colunas; a migration só adiciona o espaço pra isso.
--
-- Seguro rodar mais de uma vez: ADD COLUMN IF NOT EXISTS.

ALTER TABLE lojas    ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMP;
ALTER TABLE lojas    ADD COLUMN IF NOT EXISTS arquivado_por INTEGER;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMP;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS arquivado_por INTEGER;
