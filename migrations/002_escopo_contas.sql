-- Migration 002: Modelo de conta/escopo (multiempresa)
-- Garante as colunas que a resolução "de qual conta é este usuário/loja/tarefa"
-- precisa para funcionar em todas as consultas.
--
-- Seguro rodar mais de uma vez (tudo com IF NOT EXISTS) e seguro rodar num banco
-- que já teve lojas.admin_id / checklists.data_pontual adicionados manualmente
-- (ex.: produção) — nesse caso o ALTER simplesmente não faz nada.
--
-- Executar: psql -U postgres -d valida_v2 -f migrations/002_escopo_contas.sql

ALTER TABLE lojas      ADD COLUMN IF NOT EXISTS admin_id     INTEGER;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS data_pontual TEXT;

-- Índice para acelerar o filtro "lojas desta conta", usado agora em quase toda consulta.
CREATE INDEX IF NOT EXISTS idx_lojas_admin_id ON lojas(admin_id);
