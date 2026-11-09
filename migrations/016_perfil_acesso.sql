-- Migration 016 (Fase 5, bloco B): teto de permissões por "perfil de
-- acesso". Todo cargo (menos o Proprietário/super_admin, que fica de
-- fora dos dois, sempre com tudo liberado) passa a pertencer a um de
-- dois perfis fixos: 'operador' ou 'coordenador'. O perfil é o TETO do
-- que aquele cargo pode receber de permissão — aplicado no back em
-- perfilController.salvarPermissoes (ver código).
--
-- Nada é apagado. Cargos arquivados são classificados também (pra não
-- ficar um valor nulo estranho se algum dia forem restaurados).

ALTER TABLE perfis ADD COLUMN IF NOT EXISTS perfil_acesso TEXT;

-- Classificação: usa a MATRIZ (perfil_permissoes) como fonte de verdade,
-- não as colunas antigas (perm_conferir/perm_gerenciar_equipe) — um cargo
-- personalizado criado pela tela de Acessos (Fase 3+) só grava na matriz,
-- nunca nas colunas antigas, então classificar pelas colunas antigas
-- erraria todo cargo personalizado moderno.
--
-- Regra (pedida no Bloco B1): tem "conferir" tarefas OU gerencia
-- equipe/unidades (criar ou editar) => 'coordenador'; os demais =>
-- 'operador'. super_admin fica fora dos dois (permanece NULL).
UPDATE perfis p SET perfil_acesso = CASE
  WHEN p.nome = 'super_admin' THEN NULL
  WHEN EXISTS (
    SELECT 1 FROM perfil_permissoes pp
    WHERE pp.perfil_id = p.id AND pp.permitido = 1
      AND (
        (pp.modulo = 'tarefas' AND pp.acao = 'conferir') OR
        (pp.modulo = 'equipe' AND pp.acao IN ('criar', 'editar')) OR
        (pp.modulo = 'unidades' AND pp.acao IN ('criar', 'editar'))
      )
  ) THEN 'coordenador'
  ELSE 'operador'
END
WHERE p.perfil_acesso IS NULL;

-- Backfill de usuario_lojas pra gente antiga que só tinha usuarios.loja_id
-- preenchido (sem nenhuma linha em usuario_lojas ainda) — getLojaIdsVisiveis
-- já tinha um fallback pra isso em tempo de consulta, mas o Bloco B5 pediu
-- o backfill de verdade. Idempotente: só insere o que não existe.
INSERT INTO usuario_lojas (usuario_id, loja_id)
SELECT u.id, u.loja_id
FROM usuarios u
WHERE u.loja_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM usuario_lojas ul WHERE ul.usuario_id = u.id)
ON CONFLICT DO NOTHING;
