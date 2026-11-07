-- Migration 012 (Reforma de Acessos, Fase 3, item 1): seletor de alcance do
-- cargo — própria unidade (padrão, igual já era), unidades escolhidas
-- (lista fixa, perfil_lojas) ou todas as unidades da conta.
--
-- Seguro rodar mais de uma vez: ADD COLUMN IF NOT EXISTS e CREATE TABLE IF
-- NOT EXISTS. O padrão 'propria_unidade' preserva o comportamento atual
-- pra todo cargo já existente — nada muda sem o dono escolher outro alcance.

ALTER TABLE perfis ADD COLUMN IF NOT EXISTS escopo TEXT NOT NULL DEFAULT 'propria_unidade';

CREATE TABLE IF NOT EXISTS perfil_lojas (
  id SERIAL PRIMARY KEY,
  perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (perfil_id, loja_id)
);
CREATE INDEX IF NOT EXISTS idx_perfil_lojas_perfil ON perfil_lojas(perfil_id);
