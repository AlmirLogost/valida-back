-- Migration 011 (Reforma de Acessos): corrige a matriz de permissões dos
-- perfis DE SISTEMA pra sempre bater com as 8 colunas antigas.
--
-- O que aconteceu: no banco local, "gerente" já existia de muito antes desta
-- reforma (criado em 2026-02-24, bem antes do Passo 2), com valores
-- diferentes dos atuais nas colunas antigas no momento em que a migration
-- 006 rodou pela primeira vez. Como 006 usa ON CONFLICT DO NOTHING (pra
-- nunca sobrescrever um ajuste manual em cargo personalizado), ela travou
-- esses valores desatualizados na matriz pra sempre — nada rodado depois
-- conseguia corrigir.
--
-- Esta migration força (DO UPDATE, não DO NOTHING) a matriz dos perfis DE
-- SISTEMA a bater com as colunas antigas, que são a fonte de verdade pra
-- eles (perfis de sistema não são editáveis na matriz pelo dono, então não
-- existe "ajuste manual" aqui pra proteger). Perfis personalizados (não-
-- sistema) não são tocados por esta migration.
--
-- Seguro rodar mais de uma vez: sempre recalcula a partir das colunas
-- atuais, então rodar de novo não muda nada se já estiver certo.
--
-- Também reativa qualquer perfil de sistema que porventura esteja com
-- ativo = 0 (achamos o "gerente" antigo exatamente assim) — um cargo de
-- sistema nunca deveria ficar desativado.
UPDATE perfis SET ativo = 1 WHERE sistema = 1 AND ativo != 1;

INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT id, 'painel', 'ver', perm_dashboard FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'tarefas', 'ver', CASE WHEN perm_criar_tarefas = 1 OR perm_executar_tarefas = 1 THEN 1 ELSE 0 END FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'tarefas', 'criar', perm_criar_tarefas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'tarefas', 'editar', perm_criar_tarefas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'tarefas', 'arquivar', perm_criar_tarefas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'tarefas', 'executar', perm_executar_tarefas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'unidades', 'ver', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'unidades', 'criar', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'unidades', 'editar', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'unidades', 'arquivar', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'equipe', 'ver', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'equipe', 'criar', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'equipe', 'editar', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'equipe', 'arquivar', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'relatorios', 'ver', CASE WHEN perm_relatorios = 1 OR perm_conferir = 1 THEN 1 ELSE 0 END FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'comissoes', 'ver_todas', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'comissoes', 'ver_minhas', 1 FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'configuracoes', 'ver', perm_configuracoes FROM perfis WHERE sistema = 1
UNION ALL SELECT id, 'configuracoes', 'editar', perm_configuracoes FROM perfis WHERE sistema = 1
ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = EXCLUDED.permitido;

-- O Dono (super_admin) continua com "acessos" e "plano" sempre ligados,
-- mesmo não tendo coluna antiga equivalente (nenhum outro perfil de
-- sistema ganha isso aqui).
INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT p.id, m.modulo, m.acao, 1
FROM perfis p
CROSS JOIN (VALUES
  ('acessos','ver'),('acessos','criar'),('acessos','editar'),('acessos','arquivar'),
  ('plano','ver')
) AS m(modulo, acao)
WHERE p.nome = 'super_admin' AND p.sistema = 1
ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = 1;
