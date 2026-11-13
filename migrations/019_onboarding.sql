-- Migration 019: tabela de progresso do onboarding do Proprietário.
--
-- Guarda, por conta (admin_id), se já: configurou a primeira unidade com
-- horários, criou a primeira tarefa (manual ou por modelo pronto),
-- adicionou a primeira pessoa da equipe e teve a primeira tarefa
-- concluída. Usado pelo passo a passo em tela cheia e pelo cartão
-- "Primeiros passos — N de 4" em Tarefas.
--
-- Não destrutiva: só cria a tabela (IF NOT EXISTS) e preenche uma linha
-- por conta já existente, já marcada como concluída — contas que já
-- existiam antes desta reforma nunca devem ver o passo a passo de novo.
-- Contas novas (cadastradas depois desta migration) ganham a própria
-- linha, com concluido = 0, no momento do cadastro (ver
-- registroController.js) — não aqui.

CREATE TABLE IF NOT EXISTS onboarding_progresso (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL UNIQUE,
  passo_unidade INTEGER DEFAULT 0,
  passo_tarefa INTEGER DEFAULT 0,
  passo_pessoa INTEGER DEFAULT 0,
  passo_execucao INTEGER DEFAULT 0,
  concluido INTEGER DEFAULT 0,
  dispensado_em TIMESTAMP,
  wizard_visto_em TIMESTAMP,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO onboarding_progresso (admin_id, passo_unidade, passo_tarefa, passo_pessoa, passo_execucao, concluido, wizard_visto_em)
SELECT id, 1, 1, 1, 1, 1, NOW()
FROM usuarios
WHERE perfil = 'super_admin'
ON CONFLICT (admin_id) DO NOTHING;
