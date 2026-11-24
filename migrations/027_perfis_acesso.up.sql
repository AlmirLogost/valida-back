-- 027 · perfis_acesso + perfil_permissoes nova (33 chaves da §8) (D1, D9).
--
-- A tabela antiga perfil_permissoes (modulo, acao) vira
-- perfil_permissoes_legado, com os índices renomeados junto; nada é apagado.
--
-- Por empresa:
--   1. Três perfis fixos com os padrões da §8: Gerente, Líder, Operadores.
--   2. D9 · ninguém perde acesso: se as pessoas de perfil gerente/fiscal
--      (Líder) têm hoje mais do que o padrão da §8, a empresa ganha um perfil
--      personalizado (tipo x) "Gerente (atual)" / "Líder (atual)" com
--      padrão + o que elas têm hoje. Só se houver alguém usando.
--   3. Perfil personalizado do legado (sistema = 0, ativo) em uso: vira
--      tipo x com as chaves convertidas, a não ser que dê igual ao fixo do
--      mesmo tipo (aí o cargo usa o fixo).
-- Conversão (mapa §3.3). Sempre: hist (hoje todo mundo vê o próprio
-- histórico). Qualquer permissão de equipe liga ver.

ALTER TABLE perfil_permissoes RENAME TO perfil_permissoes_legado;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'perfil_permissoes_legado'
           AND indexname LIKE 'perfil_permissoes%' AND indexname NOT LIKE 'perfil_permissoes_legado%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, replace(r.indexname, 'perfil_permissoes', 'perfil_permissoes_legado'));
  END LOOP;
  IF to_regclass('public.perfil_permissoes_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE perfil_permissoes_id_seq RENAME TO perfil_permissoes_legado_id_seq;
  END IF;
END $$;

CREATE TABLE perfis_acesso (
  id               BIGSERIAL   PRIMARY KEY,
  empresa_id       BIGINT      NOT NULL REFERENCES empresas(id),
  nome             TEXT        NOT NULL,
  tipo             TEXT        NOT NULL CHECK (tipo IN ('c', 'o', 'x')),
  fixo             BOOLEAN     NOT NULL DEFAULT false,
  fixo_tipo        TEXT        CHECK (fixo_tipo IN ('gerente', 'lider', 'operadores')),
  legado_perfil_id INTEGER,
  legado_slug      TEXT,
  arquivado_em     TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fixo = (fixo_tipo IS NOT NULL))
);
CREATE UNIQUE INDEX perfis_acesso_fixo_un ON perfis_acesso (empresa_id, fixo_tipo) WHERE fixo_tipo IS NOT NULL;
CREATE UNIQUE INDEX perfis_acesso_legado_un ON perfis_acesso (empresa_id, legado_perfil_id) WHERE legado_perfil_id IS NOT NULL;

CREATE TABLE perfil_permissoes (
  perfil_id BIGINT  NOT NULL REFERENCES perfis_acesso(id) ON DELETE CASCADE,
  chave     TEXT    NOT NULL CHECK (chave IN (
              'faz','foto','desfaz','hist','own','pedlib',
              'ver','conf','criar','tedit','tdup','toff','tdel',
              'equipe','ecol','pin','arq','del','cargos','acesso',
              'premio','regra','ajuste','contest',
              'abre','dias','hor','loc','lib','dispensa',
              'rel','exp','log')),
  permitido BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (perfil_id, chave)
);

-- As 33 chaves e os padrões da §8.
CREATE TEMP TABLE _chaves ON COMMIT DROP AS
SELECT unnest(ARRAY['faz','foto','desfaz','hist','own','pedlib','ver','conf','criar','tedit','tdup','toff','tdel',
                    'equipe','ecol','pin','arq','del','cargos','acesso','premio','regra','ajuste','contest',
                    'abre','dias','hor','loc','lib','dispensa','rel','exp','log']) AS chave;

CREATE TEMP TABLE _padrao ON COMMIT DROP AS
SELECT 'operadores'::text AS fixo_tipo, unnest(ARRAY['faz','foto','hist','own','pedlib']) AS chave
UNION ALL SELECT 'lider', unnest(ARRAY['faz','foto','hist','own','pedlib','ver','conf','criar'])
UNION ALL SELECT 'gerente', unnest(ARRAY['faz','foto','hist','own','pedlib','ver','conf','criar','premio','lib','dispensa','rel']);

-- Par antigo (modulo.acao) → chaves novas.
CREATE TEMP TABLE _conv (legado text, chave text) ON COMMIT DROP;
INSERT INTO _conv VALUES
  ('tarefas.executar','faz'), ('tarefas.executar','foto'), ('tarefas.executar','desfaz'),
  ('comissoes.ver_minhas','own'),
  ('tarefas.ver','ver'), ('tarefas.conferir','conf'),
  ('tarefas.criar','criar'), ('tarefas.criar','tdup'),
  ('tarefas.editar','tedit'), ('tarefas.editar','toff'), ('tarefas.arquivar','tdel'),
  ('equipe.criar','equipe'),
  ('equipe.editar','ecol'), ('equipe.editar','pin'), ('equipe.editar','acesso'), ('equipe.editar','regra'),
  ('equipe.arquivar','arq'),
  ('acessos.criar','cargos'), ('acessos.editar','cargos'),
  ('comissoes.ver_todas','premio'),
  ('unidades.editar','abre'), ('unidades.editar','dias'), ('unidades.editar','hor'),
  ('relatorios.ver','rel'), ('relatorios.exportar','exp');

-- Chaves que cada perfil do legado tem hoje.
CREATE TEMP TABLE _tem ON COMMIT DROP AS
SELECT DISTINCT pp.perfil_id, c.chave
FROM perfil_permissoes_legado pp JOIN _conv c ON c.legado = pp.modulo || '.' || pp.acao
WHERE pp.permitido = 1
UNION SELECT p.id, 'hist' FROM perfis p;
INSERT INTO _tem
SELECT DISTINCT perfil_id, 'ver' FROM _tem
WHERE chave IN ('conf','criar','tedit','tdup','toff','tdel') AND (perfil_id, 'ver') NOT IN (SELECT perfil_id, chave FROM _tem);

-- 1. Fixos por empresa.
INSERT INTO perfis_acesso (empresa_id, nome, tipo, fixo, fixo_tipo)
SELECT e.id, f.nome, f.tipo, true, f.fixo_tipo
FROM empresas e
CROSS JOIN (VALUES ('Gerente', 'c', 'gerente'), ('Líder', 'c', 'lider'), ('Operadores', 'o', 'operadores')) AS f(nome, tipo, fixo_tipo);

INSERT INTO perfil_permissoes (perfil_id, chave, permitido)
SELECT pa.id, k.chave, EXISTS (SELECT 1 FROM _padrao p WHERE p.fixo_tipo = pa.fixo_tipo AND p.chave = k.chave)
FROM perfis_acesso pa CROSS JOIN _chaves k
WHERE pa.fixo;

-- Pessoas da equipe com empresa válida e o perfil do legado que vale para
-- cada uma (mesma regra de adminLojas.perfilDoUsuario: o de sistema ganha).
CREATE TEMP TABLE _pessoa_perfil ON COMMIT DROP AS
SELECT u.id AS usuario_id, l.admin_id AS empresa_id, u.perfil AS slug,
       (SELECT p.id FROM perfis p
         WHERE p.nome = u.perfil AND p.ativo = 1 AND (p.sistema = 1 OR p.admin_id = l.admin_id)
         ORDER BY p.sistema DESC, p.id LIMIT 1) AS perfil_id
FROM usuarios u
JOIN lojas l ON l.id = u.loja_id
JOIN empresas e ON e.id = l.admin_id
WHERE COALESCE(u.perfil, '') <> 'super_admin';

-- 2. D9: "Gerente (atual)" / "Líder (atual)".
CREATE TEMP TABLE _atual ON COMMIT DROP AS
SELECT DISTINCT pp.empresa_id, pp.perfil_id, pp.slug,
       CASE pp.slug WHEN 'gerente' THEN 'gerente' ELSE 'lider' END AS fixo_tipo
FROM _pessoa_perfil pp
JOIN perfis p ON p.id = pp.perfil_id AND p.sistema = 1
WHERE pp.slug IN ('gerente', 'fiscal')
  AND EXISTS (SELECT 1 FROM _tem t WHERE t.perfil_id = pp.perfil_id
              AND NOT EXISTS (SELECT 1 FROM _padrao d WHERE d.fixo_tipo = CASE pp.slug WHEN 'gerente' THEN 'gerente' ELSE 'lider' END AND d.chave = t.chave));

INSERT INTO perfis_acesso (empresa_id, nome, tipo, legado_perfil_id, legado_slug)
SELECT a.empresa_id, CASE a.fixo_tipo WHEN 'gerente' THEN 'Gerente (atual)' ELSE 'Líder (atual)' END, 'x', a.perfil_id, a.slug
FROM _atual a;

INSERT INTO perfil_permissoes (perfil_id, chave, permitido)
SELECT pa.id, k.chave,
       EXISTS (SELECT 1 FROM _padrao d WHERE d.fixo_tipo = a.fixo_tipo AND d.chave = k.chave)
       OR EXISTS (SELECT 1 FROM _tem t WHERE t.perfil_id = a.perfil_id AND t.chave = k.chave)
FROM _atual a
JOIN perfis_acesso pa ON pa.empresa_id = a.empresa_id AND pa.legado_perfil_id = a.perfil_id
CROSS JOIN _chaves k;

-- 3. Personalizados do legado em uso (sistema = 0).
CREATE TEMP TABLE _pers ON COMMIT DROP AS
SELECT DISTINCT p.id AS perfil_id, p.admin_id AS empresa_id, p.nome AS slug, p.rotulo,
       CASE WHEN p.perfil_acesso = 'coordenador' THEN 'lider' ELSE 'operadores' END AS fixo_tipo
FROM perfis p
JOIN _pessoa_perfil pp ON pp.perfil_id = p.id
WHERE p.sistema = 0;

INSERT INTO perfis_acesso (empresa_id, nome, tipo, legado_perfil_id, legado_slug)
SELECT x.empresa_id, x.rotulo, 'x', x.perfil_id, x.slug
FROM _pers x
WHERE EXISTS (  -- diferente do fixo do mesmo tipo (nos dois sentidos)
  SELECT chave FROM _tem WHERE perfil_id = x.perfil_id
  EXCEPT SELECT chave FROM _padrao WHERE fixo_tipo = x.fixo_tipo
) OR EXISTS (
  SELECT chave FROM _padrao WHERE fixo_tipo = x.fixo_tipo
  EXCEPT SELECT chave FROM _tem WHERE perfil_id = x.perfil_id
);

INSERT INTO perfil_permissoes (perfil_id, chave, permitido)
SELECT pa.id, k.chave, EXISTS (SELECT 1 FROM _tem t WHERE t.perfil_id = x.perfil_id AND t.chave = k.chave)
FROM _pers x
JOIN perfis_acesso pa ON pa.empresa_id = x.empresa_id AND pa.legado_perfil_id = x.perfil_id
CROSS JOIN _chaves k;

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '027', 'perfis personalizados órfãos (admin_id sem super_admin)', COUNT(*), 'órfão: fica só no legado'
FROM perfis p WHERE p.sistema = 0 AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = p.admin_id)
UNION ALL
SELECT '027', 'perfis personalizados sem ninguém usando (ou inativos)', COUNT(*), 'fica só no legado'
FROM perfis p WHERE p.sistema = 0 AND EXISTS (SELECT 1 FROM empresas e WHERE e.id = p.admin_id)
  AND NOT EXISTS (SELECT 1 FROM _pers x WHERE x.perfil_id = p.id)
UNION ALL
SELECT '027', 'perfis "(atual)" criados pelo D9', COUNT(*), 'informativo: o admin revisa em Acessos'
FROM perfis_acesso WHERE legado_slug IN ('gerente', 'fiscal')
UNION ALL
SELECT '027', 'pessoas de perfil operador que perdem "desfazer a própria"', COUNT(*), 'informativo: Operadores (§8) não tem desfaz'
FROM _pessoa_perfil pp JOIN perfis p ON p.id = pp.perfil_id AND p.sistema = 1 WHERE pp.slug = 'operador'
  AND EXISTS (SELECT 1 FROM _tem t WHERE t.perfil_id = pp.perfil_id AND t.chave = 'desfaz');
