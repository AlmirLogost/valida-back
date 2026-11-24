-- 021 · desfaz: remove só o relatório da migração.
-- password_resets NÃO é removida: ela já existia antes (criada à mão) e pode
-- ter dados.
DROP TABLE IF EXISTS migracao_relatorio;
