-- 026 · dias_fechados + dias_fechados_unidades (de loja_fechamentos).
-- Cada fechamento antigo vira um dia de uma unidade só, dia todo, sem
-- repetir todo ano. Data inválida fica só no legado.

CREATE TABLE dias_fechados (
  id                    BIGSERIAL   PRIMARY KEY,
  empresa_id            BIGINT      NOT NULL REFERENCES empresas(id),
  data                  DATE        NOT NULL,
  motivo                TEXT,
  todas_unidades        BOOLEAN     NOT NULL DEFAULT false,
  repetir_anual         BOOLEAN     NOT NULL DEFAULT false,
  hora_ini              TIME,                 -- null = dia todo
  hora_fim              TIME,
  criado_por            BIGINT,
  legado_fechamento_id  INTEGER     UNIQUE,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((hora_ini IS NULL AND hora_fim IS NULL) OR (hora_ini IS NOT NULL AND hora_fim IS NOT NULL AND hora_fim > hora_ini))
);

CREATE TABLE dias_fechados_unidades (
  dia_fechado_id BIGINT NOT NULL REFERENCES dias_fechados(id) ON DELETE CASCADE,
  unidade_id     BIGINT NOT NULL REFERENCES unidades(id),
  PRIMARY KEY (dia_fechado_id, unidade_id)
);

INSERT INTO dias_fechados (empresa_id, data, motivo, legado_fechamento_id)
SELECT un.empresa_id, f.data::date, f.motivo, f.id
FROM loja_fechamentos f
JOIN unidades un ON un.id = f.loja_id
WHERE CASE WHEN f.data ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
           -- dia cabe no mês (descarta 2026-02-31) sem converter texto inválido
           THEN substring(f.data, 9, 2)::int <= extract(day FROM (make_date(substring(f.data, 1, 4)::int, substring(f.data, 6, 2)::int, 1) + interval '1 month - 1 day'))
           ELSE false END;

INSERT INTO dias_fechados_unidades (dia_fechado_id, unidade_id)
SELECT d.id, f.loja_id FROM dias_fechados d JOIN loja_fechamentos f ON f.id = d.legado_fechamento_id;

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '026', 'dias fechados com data inválida ou de unidade órfã', COUNT(*), 'fica só no legado'
FROM loja_fechamentos f WHERE NOT EXISTS (SELECT 1 FROM dias_fechados d WHERE d.legado_fechamento_id = f.id);
