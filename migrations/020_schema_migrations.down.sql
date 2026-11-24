-- 020 · Desfaz a tabela de controle das migrations.
--
-- Só tira o registro de quais migrations foram aplicadas; não mexe em
-- nenhuma tabela de dados. Depois disso o runner volta a ver tudo como
-- pendente (as 001–019 são idempotentes e podem rodar de novo).

DROP TABLE IF EXISTS schema_migrations;
