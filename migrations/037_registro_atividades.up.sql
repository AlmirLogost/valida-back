-- 037 · registro_atividades (cópia de auditoria; auditoria fica intacta).
-- quem_tipo/quem_nome resolvidos pelas tabelas novas. Do detalhe saem
-- quaisquer chaves de senha, PIN ou token (nunca gravar segredos).
-- Auditoria de empresa órfã fica só no legado.

CREATE TABLE registro_atividades (
  id                   BIGSERIAL   PRIMARY KEY,
  empresa_id           BIGINT      NOT NULL REFERENCES empresas(id),
  unidade_id           BIGINT      REFERENCES unidades(id),
  quem_tipo            TEXT        CHECK (quem_tipo IN ('colaborador', 'admin', 'plataforma', 'sistema')),
  quem_id              BIGINT,
  quem_nome            TEXT,
  acao                 TEXT        NOT NULL,
  entidade             TEXT,
  entidade_id          BIGINT,
  detalhe              JSONB,
  em                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  legado_auditoria_id  INTEGER     UNIQUE
);
CREATE INDEX registro_atividades_empresa_em_idx ON registro_atividades (empresa_id, em DESC);

INSERT INTO registro_atividades (empresa_id, quem_tipo, quem_id, quem_nome, acao, entidade, entidade_id, detalhe, em, legado_auditoria_id)
SELECT a.admin_id,
       CASE WHEN ad.id IS NOT NULL THEN 'admin' WHEN co.id IS NOT NULL THEN 'colaborador' END,
       a.usuario_id,
       COALESCE(ad.nome, co.nome),
       a.acao, a.entidade, a.entidade_id,
       CASE WHEN a.detalhes IS NULL THEN NULL
            ELSE a.detalhes - 'pin' - 'novo_pin' - 'pin_novo' - 'senha' - 'nova_senha' - 'senha_nova' - 'token' - 'password' END,
       COALESCE(a.criado_em::timestamptz, now()),
       a.id
FROM auditoria a
JOIN empresas e ON e.id = a.admin_id
LEFT JOIN admins ad ON ad.id = a.usuario_id AND ad.empresa_id = a.admin_id
LEFT JOIN colaboradores co ON co.id = a.usuario_id AND co.empresa_id = a.admin_id;

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '037', 'registros de auditoria de empresa órfã', COUNT(*), 'órfão: fica só no legado'
FROM auditoria a WHERE NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = a.admin_id);
