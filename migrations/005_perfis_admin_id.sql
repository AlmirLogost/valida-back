-- Migration 005 (Reforma de Acessos, Passo 2a): perfis passam a pertencer a
-- uma conta (admin_id), não mais a uma loja específica.
--
-- Hoje um cargo personalizado é amarrado a UMA loja (perfis.loja_id). A
-- reforma trata cargo como coisa da CONTA (pode ser usado em qualquer
-- unidade do dono) — quem restringe unidade é o vínculo usuario_lojas
-- (migration 008), não o cargo.
--
-- Os cargos "de sistema" (super_admin/fiscal/operador/gerente, loja_id nulo)
-- continuam globais, compartilhados por todas as contas — por isso ficam
-- com admin_id nulo também.
--
-- NÃO apaga nem altera a coluna loja_id (fica como está, por
-- compatibilidade com código antigo que ainda não migrou).
--
-- Seguro rodar mais de uma vez: ADD COLUMN IF NOT EXISTS, e o UPDATE só
-- afeta linhas com admin_id ainda nulo.

ALTER TABLE perfis ADD COLUMN IF NOT EXISTS admin_id INTEGER;

UPDATE perfis p
SET admin_id = l.admin_id
FROM lojas l
WHERE p.loja_id = l.id
  AND p.admin_id IS NULL
  AND p.sistema = 0;

CREATE INDEX IF NOT EXISTS idx_perfis_admin_id ON perfis(admin_id);
