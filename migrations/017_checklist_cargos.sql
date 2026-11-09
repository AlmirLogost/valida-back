-- Migration 017 (Fase 5, bloco E5): tarefa atribuída a um CARGO inteiro,
-- não só a pessoas. Tabela NOVA, separada de usuario_checklists — não
-- apaga nem reaproveita nada; "quem faz" uma tarefa passa a ser a UNIÃO
-- dos vínculos diretos (usuario_checklists) com os vínculos por cargo
-- (aqui): quem entra no cargo depois passa a receber a tarefa, quem sai
-- deixa de receber, sem precisar editar vínculo nenhum por pessoa.
--
-- perfil_nome guarda o NOME (slug) do cargo, não o id — mesmo padrão já
-- usado em usuarios.perfil, porque cargos de sistema (sistema=1) são
-- compartilhados por todas as contas e não têm uma linha "por conta" em
-- perfis; guardar o id obrigaria resolver qual id vale pra cada conta.

CREATE TABLE IF NOT EXISTS checklist_cargos (
  id SERIAL PRIMARY KEY,
  checklist_id INTEGER NOT NULL,
  perfil_nome TEXT NOT NULL,
  ativo INTEGER DEFAULT 1,
  vinculado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(checklist_id, perfil_nome)
);
