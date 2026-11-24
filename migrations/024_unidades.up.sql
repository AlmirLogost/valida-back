-- 024 · unidades (cópia de lojas, mesmo id).
--
-- Só entram lojas cujo admin_id é de uma empresa (super_admin existente).
-- As demais (órfãs) ficam só no legado e são contadas no relatório.
-- lojas.ativo: 1 = ativa · 0 = inativa · -1 = arquivada. Arquivada e inativa
-- entram como arquivadas (a especificação só tem ativa/arquivada); quem não
-- tem data de arquivamento (arquivadas antes da migration 010) recebe a data
-- da migração.
-- raio_m = 100 (P3); lat/lng vazios até o admin marcar no mapa.
-- setores e hora_reset ficam só no legado.

CREATE TABLE unidades (
  id               BIGSERIAL     PRIMARY KEY,
  empresa_id       BIGINT        NOT NULL REFERENCES empresas(id),
  nome             TEXT          NOT NULL,
  cidade           TEXT,
  uf               TEXT,
  endereco         TEXT,
  telefone         TEXT,
  lat              NUMERIC(9, 6),
  lng              NUMERIC(9, 6),
  raio_m           INTEGER       NOT NULL DEFAULT 100 CHECK (raio_m BETWEEN 50 AND 500),
  fuso             TEXT          NOT NULL DEFAULT 'America/Sao_Paulo',
  aberta_hoje      BOOLEAN       NOT NULL DEFAULT true,
  aberta_hoje_data DATE,
  arquivado_em     TIMESTAMPTZ,
  arquivado_por    BIGINT,
  legado_loja_id   INTEGER       UNIQUE,
  criado_em        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

INSERT INTO unidades (id, empresa_id, nome, cidade, uf, endereco, telefone, aberta_hoje,
                      arquivado_em, arquivado_por, legado_loja_id, criado_em)
SELECT l.id, e.id, l.nome, l.cidade, NULLIF(upper(trim(l.estado)), ''), l.endereco, l.telefone,
       COALESCE(l.aberta, 1) = 1,
       CASE WHEN COALESCE(l.ativo, 1) <> 1 THEN COALESCE(l.arquivado_em::timestamptz, now()) END,
       CASE WHEN COALESCE(l.ativo, 1) <> 1 THEN l.arquivado_por END,
       l.id, COALESCE(l.criado_em::timestamptz, now())
FROM lojas l
JOIN empresas e ON e.legado_admin_id = l.admin_id;

SELECT setval(pg_get_serial_sequence('unidades', 'id'), GREATEST((SELECT MAX(id) FROM unidades), 1));

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '024', 'unidades órfãs (admin_id sem super_admin)', COUNT(*), 'órfão: fica só no legado'
FROM lojas l WHERE NOT EXISTS (SELECT 1 FROM empresas e WHERE e.legado_admin_id = l.admin_id)
UNION ALL
SELECT '024', 'unidades arquivadas sem data (receberam a data da migração)', COUNT(*), 'informativo'
FROM lojas l JOIN empresas e ON e.legado_admin_id = l.admin_id WHERE l.ativo = -1 AND l.arquivado_em IS NULL
UNION ALL
SELECT '024', 'unidades inativas (ativo = 0) que entraram como arquivadas', COUNT(*), 'informativo'
FROM lojas l JOIN empresas e ON e.legado_admin_id = l.admin_id WHERE l.ativo = 0;
