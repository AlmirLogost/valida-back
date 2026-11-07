-- Migration 007 (Reforma de Acessos, Passo 2c): perfis padrão do sistema.
--
-- A tabela perfis já tinha a coluna "sistema" (1 = perfil de sistema, não
-- apagável) desde antes da reforma — não precisou criar is_sistema, só usar
-- o que já existe. Hoje só existiam 3 perfis de sistema (Super Admin,
-- Fiscal, Operador); o pedido fala em 4 (Dono, Gerente, Fiscal, Operador).
--
-- "Super Admin" É o Dono (mesma conta, mesmo acesso total) — em vez de criar
-- um perfil novo, só deixei o rótulo mostrado na tela mais claro. O "nome"
-- (slug técnico "super_admin") não muda, porque usuarios.perfil já guarda
-- esse texto em produção.
--
-- "Gerente" não existia — é novo, com acesso a tarefas/unidades/equipe/
-- relatórios/comissões, mas sem acessos (gerenciar cargos) nem configurações
-- da conta nem plano. Ajustável depois na tela Acessos, como qualquer outro
-- perfil de sistema (duplicável, não apagável, mas editável? -- não: perfis
-- de sistema não são editáveis na matriz, só duplicáveis — Passo 3/4 trata
-- disso no código).
--
-- Seguro rodar mais de uma vez: INSERT condicional (WHERE NOT EXISTS) e
-- UPDATE que só muda o rótulo se ainda não estiver certo.

INSERT INTO perfis (nome, rotulo, metodo_login, pode_acessar_painel, cor, sistema, ordem,
  perm_dashboard, perm_criar_tarefas, perm_executar_tarefas, perm_conferir,
  perm_gerenciar_equipe, perm_gerenciar_lojas, perm_relatorios, perm_configuracoes)
SELECT 'gerente', 'Gerente', 'email_senha', 1, '#1a73e8', 1, 1,
  1, 1, 1, 1, 1, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM perfis WHERE nome = 'gerente' AND sistema = 1);

UPDATE perfis SET rotulo = 'Dono' WHERE nome = 'super_admin' AND sistema = 1 AND rotulo <> 'Dono';

-- Matriz de permissões do Gerente (só é criada se o perfil acima acabou de
-- nascer agora — se já existia de uma rodada anterior desta migration, a
-- migration 006 ou uma rodada anterior desta já cobriu, e o ON CONFLICT
-- DO NOTHING evita duplicar ou sobrescrever ajuste manual).
INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT p.id, m.modulo, m.acao, m.permitido
FROM perfis p
CROSS JOIN (VALUES
  ('painel','ver',1),
  ('tarefas','ver',1),('tarefas','criar',1),('tarefas','editar',1),('tarefas','arquivar',1),('tarefas','executar',1),
  ('unidades','ver',1),('unidades','criar',1),('unidades','editar',1),('unidades','arquivar',1),
  ('equipe','ver',1),('equipe','criar',1),('equipe','editar',1),('equipe','arquivar',1),
  ('relatorios','ver',1),
  ('comissoes','ver_todas',1),('comissoes','ver_minhas',1),
  ('configuracoes','ver',0),('configuracoes','editar',0),
  ('acessos','ver',0),('acessos','criar',0),('acessos','editar',0),('acessos','arquivar',0),
  ('plano','ver',0)
) AS m(modulo, acao, permitido)
WHERE p.nome = 'gerente' AND p.sistema = 1
ON CONFLICT (perfil_id, modulo, acao) DO NOTHING;
