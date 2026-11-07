-- Migration 006 (Reforma de Acessos, Passo 2b): matriz de permissões por
-- módulo x ação, mantendo as 8 colunas antigas (compatibilidade com código
-- que ainda não migrou).
--
-- Módulos: painel, tarefas, unidades, equipe, acessos, relatorios,
-- comissoes, plano, configuracoes.
-- Ações: ver, criar, editar, arquivar, executar (só tarefas),
-- ver_todas/ver_minhas (só comissões).
--
-- Mapeamento das 8 colunas antigas pra matriz nova (documentado também em
-- docs/REFORMA.md, pra revisão):
--   perm_dashboard        -> painel.ver
--   perm_criar_tarefas    -> tarefas.ver/criar/editar/arquivar
--   perm_executar_tarefas -> tarefas.executar (e também ajuda a dar tarefas.ver)
--   perm_gerenciar_lojas  -> unidades.ver/criar/editar/arquivar
--   perm_gerenciar_equipe -> equipe.ver/criar/editar/arquivar + comissoes.ver_todas
--   perm_relatorios OU perm_conferir -> relatorios.ver (a tela de Conferência
--     entra como relatório; não havia coluna própria pra ela)
--   perm_configuracoes    -> configuracoes.ver/editar
--   acessos.* e plano.ver -> não existiam antes, migram desligados (0) por
--     segurança (ninguém tinha essa permissão explícita antes, então ninguém
--     ganha agora por engano); quem precisar, o dono liga na tela Acessos.
--   comissoes.ver_minhas  -> sempre 1 (ver a própria comissão é básico,
--     qualquer colaborador já vê isso hoje em "Minhas Tarefas")
--
-- Seguro rodar mais de uma vez: CREATE TABLE/INDEX IF NOT EXISTS, e os
-- INSERTs usam ON CONFLICT (nunca sobrescrevem uma permissão já ajustada
-- manualmente na matriz nova, exceto o bloco final do Dono, que sempre
-- força tudo ligado de propósito).

CREATE TABLE IF NOT EXISTS perfil_permissoes (
  id SERIAL PRIMARY KEY,
  perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  acao TEXT NOT NULL,
  permitido INTEGER NOT NULL DEFAULT 0,
  UNIQUE (perfil_id, modulo, acao)
);
CREATE INDEX IF NOT EXISTS idx_perfil_permissoes_perfil_id ON perfil_permissoes(perfil_id);

INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT id, 'painel', 'ver', perm_dashboard FROM perfis
UNION ALL SELECT id, 'tarefas', 'ver', CASE WHEN perm_criar_tarefas = 1 OR perm_executar_tarefas = 1 THEN 1 ELSE 0 END FROM perfis
UNION ALL SELECT id, 'tarefas', 'criar', perm_criar_tarefas FROM perfis
UNION ALL SELECT id, 'tarefas', 'editar', perm_criar_tarefas FROM perfis
UNION ALL SELECT id, 'tarefas', 'arquivar', perm_criar_tarefas FROM perfis
UNION ALL SELECT id, 'tarefas', 'executar', perm_executar_tarefas FROM perfis
UNION ALL SELECT id, 'unidades', 'ver', perm_gerenciar_lojas FROM perfis
UNION ALL SELECT id, 'unidades', 'criar', perm_gerenciar_lojas FROM perfis
UNION ALL SELECT id, 'unidades', 'editar', perm_gerenciar_lojas FROM perfis
UNION ALL SELECT id, 'unidades', 'arquivar', perm_gerenciar_lojas FROM perfis
UNION ALL SELECT id, 'equipe', 'ver', perm_gerenciar_equipe FROM perfis
UNION ALL SELECT id, 'equipe', 'criar', perm_gerenciar_equipe FROM perfis
UNION ALL SELECT id, 'equipe', 'editar', perm_gerenciar_equipe FROM perfis
UNION ALL SELECT id, 'equipe', 'arquivar', perm_gerenciar_equipe FROM perfis
UNION ALL SELECT id, 'relatorios', 'ver', CASE WHEN perm_relatorios = 1 OR perm_conferir = 1 THEN 1 ELSE 0 END FROM perfis
UNION ALL SELECT id, 'comissoes', 'ver_todas', perm_gerenciar_equipe FROM perfis
UNION ALL SELECT id, 'comissoes', 'ver_minhas', 1 FROM perfis
UNION ALL SELECT id, 'configuracoes', 'ver', perm_configuracoes FROM perfis
UNION ALL SELECT id, 'configuracoes', 'editar', perm_configuracoes FROM perfis
UNION ALL SELECT id, 'acessos', 'ver', 0 FROM perfis
UNION ALL SELECT id, 'acessos', 'criar', 0 FROM perfis
UNION ALL SELECT id, 'acessos', 'editar', 0 FROM perfis
UNION ALL SELECT id, 'acessos', 'arquivar', 0 FROM perfis
UNION ALL SELECT id, 'plano', 'ver', 0 FROM perfis
ON CONFLICT (perfil_id, modulo, acao) DO NOTHING;

-- O Dono (super_admin) sempre com tudo marcado na matriz, pra tela Acessos
-- não precisar de um caso especial pra mostrar isso (o back já faz bypass
-- total pra super_admin independente do que estiver aqui — isso é só pra
-- a tela mostrar certo).
INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT p.id, m.modulo, m.acao, 1
FROM perfis p
CROSS JOIN (VALUES
  ('painel','ver'),
  ('tarefas','ver'),('tarefas','criar'),('tarefas','editar'),('tarefas','arquivar'),('tarefas','executar'),
  ('unidades','ver'),('unidades','criar'),('unidades','editar'),('unidades','arquivar'),
  ('equipe','ver'),('equipe','criar'),('equipe','editar'),('equipe','arquivar'),
  ('relatorios','ver'),
  ('comissoes','ver_todas'),('comissoes','ver_minhas'),
  ('configuracoes','ver'),('configuracoes','editar'),
  ('acessos','ver'),('acessos','criar'),('acessos','editar'),('acessos','arquivar'),
  ('plano','ver')
) AS m(modulo, acao)
WHERE p.nome = 'super_admin' AND p.sistema = 1
ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = 1;
