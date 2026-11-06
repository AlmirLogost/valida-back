-- Migration 003: Cadastro do dono com nome da empresa
-- Guarda o nome da empresa informado no cadastro (usado também pela tela
-- "Minha Conta" / meController, que já esperava esta coluna).
--
-- Seguro rodar mais de uma vez (IF NOT EXISTS) e seguro rodar num banco que
-- já tenha essa coluna criada manualmente.
--
-- Executar: psql -U postgres -d valida_v2 -f migrations/003_cadastro_dono.sql

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS razao_social TEXT;
