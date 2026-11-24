-- 040 · índices únicos que dependem da qualidade dos dados e índices de
-- consulta por empresa. Se houver duplicado, esta migration FALHA de
-- propósito (e é desfeita inteira): o Almir resolve os casos (D19) e roda de novo.

CREATE UNIQUE INDEX colaboradores_celular_un ON colaboradores (empresa_id, celular) WHERE celular IS NOT NULL;
CREATE UNIQUE INDEX admins_email_un ON admins (lower(email));

CREATE INDEX unidades_empresa_idx      ON unidades (empresa_id);
CREATE INDEX cargos_unidade_idx        ON cargos (unidade_id);
CREATE INDEX colaboradores_empresa_idx ON colaboradores (empresa_id);
CREATE INDEX colaboradores_cargo_idx   ON colaboradores (cargo_id);
CREATE INDEX colab_unidades_unid_idx   ON colaborador_unidades (unidade_id);
CREATE INDEX tarefas_empresa_idx       ON tarefas (empresa_id);
CREATE INDEX tarefas_colaborador_idx   ON tarefas (colaborador_id) WHERE colaborador_id IS NOT NULL;
CREATE INDEX tarefas_cargo_idx         ON tarefas (cargo_id) WHERE cargo_id IS NOT NULL;
CREATE INDEX tarefas_pai_idx           ON tarefas (pai_id) WHERE pai_id IS NOT NULL;
CREATE INDEX execucoes_empresa_data_idx ON execucoes (empresa_id, data);
CREATE INDEX execucoes_colab_data_idx  ON execucoes (colaborador_id, data);
CREATE INDEX execucoes_unidade_data_idx ON execucoes (unidade_id, data);
CREATE INDEX acoes_unidade_estado_idx  ON acoes (unidade_id, estado);
CREATE INDEX pedidos_empresa_estado_idx ON pedidos (empresa_id, estado);
CREATE INDEX logins_colab_em_idx       ON logins (colaborador_id, em DESC);
CREATE INDEX regras_bonus_colab_idx    ON regras_bonus (colaborador_id, vigente_desde DESC);
CREATE INDEX dias_fechados_empresa_idx ON dias_fechados (empresa_id, data);
CREATE INDEX fotos_empresa_idx         ON fotos (empresa_id);
