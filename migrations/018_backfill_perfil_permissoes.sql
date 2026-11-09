-- Migration 018: backfill de perfil_permissoes pra cargo sem NENHUMA linha
-- na matriz. Bug relatado: ao abrir um cargo em Acessos, a matriz de
-- permissões não aparecia — a causa raiz real era um defeito de UI (grupos
-- da matriz nasciam todos recolhidos, ver AcessoDetalhe.vue), mas um cargo
-- SEM nenhuma linha em perfil_permissoes também deixaria a matriz vazia de
-- verdade (0 itens marcados, "0 pessoas" de contagem some em alguns
-- lugares) — isso pode acontecer com cargo antigo (de antes da matriz
-- existir), de sistema recém-criado por uma versão antiga do seed, ou
-- duplicado por um caminho de código anterior ao que copia a matriz.
--
-- Nada é apagado nem sobrescrito: só INSERE linha pra cargo que hoje tem
-- ZERO linhas na matriz — cargo que já tem qualquer linha (mesmo que
-- incompleta) não é tocado. Pra cargo de sistema, deriva das colunas
-- legadas (perm_conferir etc., mesmo mapeamento do seed.js); pra cargo
-- personalizado sem colunas legadas confiáveis, nasce com tudo desligado
-- (o Dono liga o que precisar na tela — mas a matriz aparece completa,
-- nunca em branco).

INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT p.id, m.modulo, m.acao,
  CASE
    WHEN m.modulo = 'painel' AND m.acao = 'ver' THEN p.perm_dashboard
    WHEN m.modulo = 'tarefas' AND m.acao = 'ver' THEN CASE WHEN p.perm_criar_tarefas = 1 OR p.perm_executar_tarefas = 1 THEN 1 ELSE 0 END
    WHEN m.modulo = 'tarefas' AND m.acao IN ('criar', 'editar', 'arquivar') THEN p.perm_criar_tarefas
    WHEN m.modulo = 'tarefas' AND m.acao = 'executar' THEN p.perm_executar_tarefas
    WHEN m.modulo = 'tarefas' AND m.acao = 'conferir' THEN p.perm_conferir
    WHEN m.modulo = 'unidades' THEN p.perm_gerenciar_lojas
    WHEN m.modulo = 'equipe' THEN p.perm_gerenciar_equipe
    WHEN m.modulo = 'relatorios' AND m.acao = 'ver' THEN CASE WHEN p.perm_relatorios = 1 OR p.perm_conferir = 1 THEN 1 ELSE 0 END
    WHEN m.modulo = 'relatorios' AND m.acao = 'exportar' THEN p.perm_relatorios
    WHEN m.modulo = 'comissoes' AND m.acao = 'ver_todas' THEN p.perm_gerenciar_equipe
    WHEN m.modulo = 'comissoes' AND m.acao = 'ver_minhas' THEN 1
    WHEN m.modulo = 'configuracoes' THEN p.perm_configuracoes
    WHEN m.modulo = 'acessos' AND p.nome = 'super_admin' THEN 1
    ELSE 0
  END
FROM perfis p
CROSS JOIN (VALUES
  ('painel','ver'),
  ('tarefas','ver'),('tarefas','criar'),('tarefas','editar'),('tarefas','arquivar'),('tarefas','executar'),('tarefas','conferir'),
  ('unidades','ver'),('unidades','criar'),('unidades','editar'),('unidades','arquivar'),
  ('equipe','ver'),('equipe','criar'),('equipe','editar'),('equipe','arquivar'),
  ('relatorios','ver'),('relatorios','exportar'),
  ('comissoes','ver_todas'),('comissoes','ver_minhas'),
  ('configuracoes','ver'),('configuracoes','editar'),
  ('acessos','ver'),('acessos','criar'),('acessos','editar'),('acessos','arquivar'),
  ('plano','ver')
) AS m(modulo, acao)
WHERE NOT EXISTS (SELECT 1 FROM perfil_permissoes pp WHERE pp.perfil_id = p.id)
ON CONFLICT (perfil_id, modulo, acao) DO NOTHING;
