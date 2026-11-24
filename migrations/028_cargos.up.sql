-- 028 · cargos, por unidade (D1, D16).
--
-- Toda unidade migrada (inclusive arquivada, para o histórico) recebe:
--   Gerente (Coordenação) · Líder (Coordenação, padrão) · Operador (Operador, padrão)
-- e um cargo para cada perfil personalizado do legado usado por alguém
-- daquela unidade (nome = rótulo; Coordenação/Operador ← perfis.perfil_acesso).
-- perfil_acesso_id: o perfil de acesso padrão do cargo (fixo do mesmo tipo,
-- ou o tipo x criado na 027 para o personalizado).
-- Alcance antigo (perfis.escopo) e perfil_lojas: hoje todos são
-- "propria_unidade"; o vínculo com unidades fica em colaborador_unidades (029).

CREATE TABLE cargos (
  id               BIGSERIAL   PRIMARY KEY,
  empresa_id       BIGINT      NOT NULL REFERENCES empresas(id),
  unidade_id       BIGINT      NOT NULL REFERENCES unidades(id),
  nome             TEXT        NOT NULL,
  perfil           TEXT        NOT NULL CHECK (perfil IN ('coordenador', 'operador')),
  descricao        TEXT,
  padrao           BOOLEAN     NOT NULL DEFAULT false,
  perfil_acesso_id BIGINT      NOT NULL REFERENCES perfis_acesso(id),
  legado_perfil_id INTEGER,
  legado_slug      TEXT,
  arquivado_em     TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cargos_padrao_un ON cargos (unidade_id, perfil) WHERE padrao AND arquivado_em IS NULL;

INSERT INTO cargos (empresa_id, unidade_id, nome, perfil, padrao, perfil_acesso_id, legado_slug)
SELECT un.empresa_id, un.id, f.nome, f.perfil, f.padrao, pa.id, f.slug
FROM unidades un
CROSS JOIN (VALUES ('Gerente', 'coordenador', false, 'gerente', 'gerente'),
                   ('Líder', 'coordenador', true, 'lider', 'fiscal'),
                   ('Operador', 'operador', true, 'operadores', 'operador')) AS f(nome, perfil, padrao, fixo_tipo, slug)
JOIN perfis_acesso pa ON pa.empresa_id = un.empresa_id AND pa.fixo_tipo = f.fixo_tipo;

-- Personalizados em uso, por unidade principal da pessoa.
INSERT INTO cargos (empresa_id, unidade_id, nome, perfil, descricao, perfil_acesso_id, legado_perfil_id, legado_slug)
SELECT DISTINCT un.empresa_id, un.id, p.rotulo,
       CASE WHEN p.perfil_acesso = 'coordenador' THEN 'coordenador' ELSE 'operador' END,
       p.descricao,
       COALESCE(px.id, pf.id), p.id, p.nome
FROM usuarios u
JOIN unidades un ON un.id = u.loja_id
JOIN LATERAL (
  SELECT p.* FROM perfis p
  WHERE p.nome = u.perfil AND p.ativo = 1 AND (p.sistema = 1 OR p.admin_id = un.empresa_id)
  ORDER BY p.sistema DESC, p.id LIMIT 1
) p ON p.sistema = 0
LEFT JOIN perfis_acesso px ON px.empresa_id = un.empresa_id AND px.legado_perfil_id = p.id
JOIN perfis_acesso pf ON pf.empresa_id = un.empresa_id
     AND pf.fixo_tipo = CASE WHEN p.perfil_acesso = 'coordenador' THEN 'lider' ELSE 'operadores' END
WHERE COALESCE(u.perfil, '') <> 'super_admin';
