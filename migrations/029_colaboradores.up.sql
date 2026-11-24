-- 029 · colaboradores + colaborador_unidades (mesmo id de usuarios) (D3, D11, D19).
--
-- Entra quem não é super_admin e está numa unidade migrada (empresa válida).
-- Sem unidade ou de empresa órfã: fica só no legado.
-- celular ← só os dígitos de whatsapp. pin_hash ← pin só se já for bcrypt
-- (D11: quem não tem PIN em hash fica sem PIN; o admin gera pelo convite).
-- E-mail e senha da equipe NÃO vêm (D11: equipe entra com celular + PIN).
-- cargo ← o cargo da unidade principal pelo perfil do legado; perfil de acesso
-- próprio só para quem ganhou "Gerente (atual)" / "Líder (atual)" (D9).
-- situacao: ativo = 1 → ativo; 0 ou -1 → arquivado.
-- token_versao: muda ao trocar PIN, arquivar ou sair (Segurança item 3).
-- O índice único (empresa_id, celular) entra na 040, depois da conferência.

CREATE TABLE colaboradores (
  id                   BIGSERIAL   PRIMARY KEY,
  empresa_id           BIGINT      NOT NULL REFERENCES empresas(id),
  nome                 TEXT        NOT NULL,
  celular              TEXT        CHECK (celular ~ '^[0-9]{10,13}$'),
  pin_hash             TEXT,
  pin_trocado_em       TIMESTAMPTZ,
  unidade_principal_id BIGINT      NOT NULL REFERENCES unidades(id),
  cargo_id             BIGINT      NOT NULL REFERENCES cargos(id),
  perfil_acesso_id     BIGINT      REFERENCES perfis_acesso(id),   -- null = o do cargo
  situacao             TEXT        NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'aguardando', 'arquivado')),
  login_ini            TIME,
  login_fim            TIME,
  login_tol_min        INTEGER,
  token_versao         INTEGER     NOT NULL DEFAULT 0,
  arquivado_em         TIMESTAMPTZ,
  arquivado_por        BIGINT,
  legado_usuario_id    INTEGER     UNIQUE,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((situacao = 'arquivado') = (arquivado_em IS NOT NULL))
);

CREATE TABLE colaborador_unidades (
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  unidade_id     BIGINT NOT NULL REFERENCES unidades(id),
  PRIMARY KEY (colaborador_id, unidade_id)
);

CREATE TEMP TABLE _pessoas ON COMMIT DROP AS
SELECT u.*, un.empresa_id,
       (SELECT p.id FROM perfis p
         WHERE p.nome = u.perfil AND p.ativo = 1 AND (p.sistema = 1 OR p.admin_id = un.empresa_id)
         ORDER BY p.sistema DESC, p.id LIMIT 1) AS perfil_ok_id,
       NULLIF(regexp_replace(COALESCE(u.whatsapp, ''), '[^0-9]', '', 'g'), '') AS cel
FROM usuarios u
JOIN unidades un ON un.id = u.loja_id
WHERE COALESCE(u.perfil, '') <> 'super_admin';

INSERT INTO colaboradores (id, empresa_id, nome, celular, pin_hash, unidade_principal_id, cargo_id, perfil_acesso_id,
                           situacao, arquivado_em, arquivado_por, legado_usuario_id, criado_em)
SELECT
  x.id, x.empresa_id, x.nome,
  CASE WHEN x.cel ~ '^[0-9]{10,13}$' THEN x.cel END,
  CASE WHEN x.pin LIKE '$2%' THEN x.pin END,
  x.loja_id,
  COALESCE(
    (SELECT c.id FROM cargos c WHERE c.unidade_id = x.loja_id AND c.legado_perfil_id = x.perfil_ok_id LIMIT 1),
    (SELECT c.id FROM cargos c WHERE c.unidade_id = x.loja_id AND c.legado_perfil_id IS NULL
       AND c.legado_slug = CASE WHEN x.perfil IN ('gerente', 'fiscal') THEN x.perfil ELSE 'operador' END LIMIT 1)
  ),
  CASE WHEN x.perfil IN ('gerente', 'fiscal') THEN
    (SELECT pa.id FROM perfis_acesso pa WHERE pa.empresa_id = x.empresa_id AND pa.legado_slug = x.perfil AND pa.tipo = 'x' LIMIT 1)
  END,
  CASE WHEN x.ativo = 1 THEN 'ativo' ELSE 'arquivado' END,
  CASE WHEN x.ativo = 1 THEN NULL ELSE COALESCE(x.arquivado_em::timestamptz, now()) END,
  CASE WHEN x.ativo = 1 THEN NULL ELSE x.arquivado_por END,
  x.id,
  COALESCE(x.criado_em::timestamptz, now())
FROM _pessoas x;

SELECT setval(pg_get_serial_sequence('colaboradores', 'id'), GREATEST((SELECT MAX(id) FROM colaboradores), 1));

INSERT INTO colaborador_unidades (colaborador_id, unidade_id)
SELECT id, unidade_principal_id FROM colaboradores
UNION
SELECT ul.usuario_id, ul.loja_id
FROM usuario_lojas ul
JOIN colaboradores c ON c.id = ul.usuario_id
JOIN unidades un ON un.id = ul.loja_id AND un.empresa_id = c.empresa_id;

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '029', 'pessoas órfãs (sem unidade ou de empresa órfã)', COUNT(*), 'órfão: fica só no legado'
FROM usuarios u WHERE COALESCE(u.perfil, '') <> 'super_admin' AND NOT EXISTS (SELECT 1 FROM colaboradores c WHERE c.id = u.id)
UNION ALL
SELECT '029', 'pessoas sem celular válido', COUNT(*) FILTER (WHERE celular IS NULL), 'informativo: "Falta o celular"' FROM colaboradores
UNION ALL
SELECT '029', 'pessoas sem PIN em hash (ficam sem PIN)', COUNT(*) FILTER (WHERE pin_hash IS NULL), 'D11: o admin gera pelo convite' FROM colaboradores
UNION ALL
SELECT '029', 'pessoas cujo perfil do legado não existe mais (foram para Operador)', COUNT(*), 'conferir'
FROM _pessoas x WHERE x.perfil_ok_id IS NULL
UNION ALL
SELECT '029', 'vínculos de unidade (usuario_lojas) fora da empresa ou de unidade órfã', COUNT(*), 'fica só no legado'
FROM usuario_lojas ul
WHERE NOT EXISTS (SELECT 1 FROM colaborador_unidades cu WHERE cu.colaborador_id = ul.usuario_id AND cu.unidade_id = ul.loja_id);
