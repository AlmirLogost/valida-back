-- 034 · desfaz: apaga a execucoes nova e devolve os nomes antigos (tabelas,
-- índices e sequências).
DELETE FROM migracao_relatorio WHERE migracao = '034';
ALTER TABLE contestacoes DROP CONSTRAINT IF EXISTS contestacoes_execucao_fk;
DROP TABLE IF EXISTS execucoes;
ALTER TABLE execucoes_legado RENAME TO execucoes;
ALTER TABLE execucoes_itens_legado RENAME TO execucoes_itens;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'
           AND tablename IN ('execucoes', 'execucoes_itens') LOOP
    IF r.tablename = 'execucoes' AND r.indexname LIKE 'execucoes_legado%' THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'execucoes' || substring(r.indexname FROM length('execucoes_legado') + 1));
    ELSIF r.tablename = 'execucoes_itens' AND r.indexname LIKE 'execucoes_itens_legado%' THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'execucoes_itens' || substring(r.indexname FROM length('execucoes_itens_legado') + 1));
    END IF;
  END LOOP;
  IF to_regclass('public.execucoes_legado_id_seq') IS NOT NULL THEN ALTER SEQUENCE execucoes_legado_id_seq RENAME TO execucoes_id_seq; END IF;
  IF to_regclass('public.execucoes_itens_legado_id_seq') IS NOT NULL THEN ALTER SEQUENCE execucoes_itens_legado_id_seq RENAME TO execucoes_itens_id_seq; END IF;
END $$;
