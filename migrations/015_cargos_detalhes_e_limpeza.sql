-- Migration 015 (Fase 4, bloco E): coluna "descricao" pra aba Detalhes da
-- página de cargo, e limpeza de cargos duplicados/órfãos.
--
-- Nada é excluído — só migra usuários (se houver) e arquiva (ativo = 0) o
-- que já era redundante. Arquivado continua no banco, só sai da lista de
-- Acessos; reversível manualmente se precisar.

ALTER TABLE perfis ADD COLUMN IF NOT EXISTS descricao TEXT;

-- 1) "funcionario" era o nome antigo do que hoje é "operador" (confirmado:
--    nenhum dos dois nunca existiu com gente de verdade usando os dois ao
--    mesmo tempo). Move quem ainda estiver com esse slug e arquiva o cargo
--    de sistema "funcionario".
UPDATE usuarios SET perfil = 'operador' WHERE perfil = 'funcionario';
UPDATE perfis SET ativo = 0 WHERE nome = 'funcionario' AND sistema = 1;

-- 2) Cargo personalizado (sistema=0) com o MESMO slug de um cargo de
--    sistema nunca é de fato alcançado — resolverPerfilPorNome sempre
--    prioriza o de sistema (ORDER BY sistema DESC). É sobra de duplicação
--    acidental ou de teste antigo; arquivar não muda nada pra ninguém
--    (já era inalcançável).
UPDATE perfis p SET ativo = 0
WHERE p.sistema = 0 AND p.ativo = 1
  AND EXISTS (SELECT 1 FROM perfis s WHERE s.sistema = 1 AND s.nome = p.nome AND s.ativo = 1);

-- 3) Cargo personalizado órfão (sem admin_id e sem loja_id) nunca pertence
--    a ninguém de verdade — nunca é resolvido por login (resolverPerfilPorNome
--    exige sistema=1 OU admin_id = quem chama, e NULL nunca bate com "=").
--    Arquiva pra não aparecer na lista de Acessos como lixo de teste.
UPDATE perfis SET ativo = 0
WHERE sistema = 0 AND admin_id IS NULL AND loja_id IS NULL AND ativo = 1;
