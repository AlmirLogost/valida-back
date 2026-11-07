-- Migration 013 (Reforma de Acessos, Fase 3, item 3): "Fiscal" passa a se
-- chamar "Líder" na tela (só o rótulo — o slug técnico "fiscal" continua
-- igual em usuarios.perfil, perfis.nome e em todo o código, pra não quebrar
-- nada que já existe). Também separa as tarefas em dois tipos (líder /
-- operador) e cria a base da conferência (aprovar/reprovar/reabrir) que o
-- Líder passa a poder fazer sobre as tarefas da equipe.

UPDATE perfis SET rotulo = 'Líder' WHERE nome = 'fiscal' AND sistema = 1 AND rotulo <> 'Líder';

-- Bug encontrado nesta fase: a Reforma de Acessos (migration 006/011) passou
-- a exigir "tarefas.executar" pra iniciar/responder/concluir/reverter uma
-- execução — mas o fiscal sempre teve perm_executar_tarefas = 0 nas colunas
-- antigas (ele só "confere" a equipe). Isso travava o próprio fiscal/líder
-- de concluir ou reabrir as PRÓPRIAS tarefas do dia (a tela MinhasTarefas
-- sempre permitiu isso, só o back é que recusava). Líder também executa
-- tarefas próprias, então corrige a coluna de origem.
UPDATE perfis SET perm_executar_tarefas = 1 WHERE nome = 'fiscal' AND sistema = 1;

-- Tipo da tarefa: líder (conferência/gestão) ou operador (execução do dia a
-- dia). Toda tarefa nasce "operador"; as que hoje já aparecem só na visão do
-- fiscal (vinculadas a alguém com perfil fiscal) migram pra "lider" aqui,
-- uma única vez, pra não perder o que já existe.
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'operador';

UPDATE checklists SET tipo = 'lider'
WHERE tipo = 'operador'
  AND id IN (
    SELECT DISTINCT uc.checklist_id
    FROM usuario_checklists uc
    JOIN usuarios u ON u.id = uc.usuario_id
    WHERE u.perfil = 'fiscal' AND uc.ativo = 1
  );

-- Conferência: o Líder passa a poder aprovar/reprovar uma execução da
-- equipe (reabrir já existia via DELETE /execucoes/:id/reverter). Guardado
-- na própria execução porque é o registro concreto de UM dia de UMA tarefa
-- de UMA pessoa — aprovar/reprovar a tarefa (checklist) não faria sentido,
-- é a execução específica que é conferida.
ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS status_conferencia TEXT NOT NULL DEFAULT 'pendente';

-- Nova ação na matriz de permissões: tarefas.conferir — já existia como
-- perm_conferir nas colunas antigas (usada até aqui só para liberar a tela
-- de Relatórios/Conferência), agora também libera aprovar/reprovar/reabrir
-- tarefas de outras pessoas. Só os perfis DE SISTEMA são recalculados aqui
-- (cargo personalizado não tem essa ação ainda — fica desligada por
-- padrão, o dono liga manualmente se quiser).
INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT id, 'tarefas', 'conferir', perm_conferir FROM perfis WHERE sistema = 1
ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = EXCLUDED.permitido;

INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT id, 'tarefas', 'executar', perm_executar_tarefas FROM perfis WHERE sistema = 1
ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = EXCLUDED.permitido;
