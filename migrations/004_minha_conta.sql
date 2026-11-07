-- Migration 004: campos da tela "Minha Conta" (dados do dono/empresa)
-- usados por src/controllers/meController.js.
--
-- Seguro rodar mais de uma vez (IF NOT EXISTS) e seguro rodar num banco que
-- já tenha essas colunas criadas manualmente.
--
-- Executar: psql -U postgres -d valida_v2 -f migrations/004_minha_conta.sql

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS documento TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_cobranca TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estado TEXT;
