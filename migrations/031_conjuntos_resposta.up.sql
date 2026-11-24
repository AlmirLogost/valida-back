-- 031 · conjuntos_resposta (Fase 2, criada já) com os 4 padrões do sistema.
-- cor usa nomes de token (ok | atencao | ruim | neutro), não cor fixa (P6).

CREATE TABLE conjuntos_resposta (
  id         BIGSERIAL   PRIMARY KEY,
  empresa_id BIGINT      REFERENCES empresas(id),     -- null = padrão do sistema
  nome       TEXT        NOT NULL,
  opcoes     JSONB       NOT NULL,                     -- [{rotulo, cor, abre_acao, na}]
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO conjuntos_resposta (empresa_id, nome, opcoes) VALUES
 (NULL, 'Conforme / Não conforme / N/A', '[{"rotulo":"Conforme","cor":"ok","abre_acao":false,"na":false},{"rotulo":"Não conforme","cor":"ruim","abre_acao":true,"na":false},{"rotulo":"N/A","cor":"neutro","abre_acao":false,"na":true}]'),
 (NULL, 'Bom / Regular / Ruim / N/A',    '[{"rotulo":"Bom","cor":"ok","abre_acao":false,"na":false},{"rotulo":"Regular","cor":"atencao","abre_acao":false,"na":false},{"rotulo":"Ruim","cor":"ruim","abre_acao":true,"na":false},{"rotulo":"N/A","cor":"neutro","abre_acao":false,"na":true}]'),
 (NULL, 'Sim / Não / N/A',               '[{"rotulo":"Sim","cor":"ok","abre_acao":false,"na":false},{"rotulo":"Não","cor":"ruim","abre_acao":true,"na":false},{"rotulo":"N/A","cor":"neutro","abre_acao":false,"na":true}]'),
 (NULL, 'Aprovado / Reprovado / N/A',    '[{"rotulo":"Aprovado","cor":"ok","abre_acao":false,"na":false},{"rotulo":"Reprovado","cor":"ruim","abre_acao":true,"na":false},{"rotulo":"N/A","cor":"neutro","abre_acao":false,"na":true}]');
