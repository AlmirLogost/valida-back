-- 027 · desfaz: apaga as tabelas novas e devolve o nome (e os índices) da
-- perfil_permissoes antiga.
DELETE FROM migracao_relatorio WHERE migracao = '027';
DROP TABLE IF EXISTS perfil_permissoes;
DROP TABLE IF EXISTS perfis_acesso;
ALTER TABLE perfil_permissoes_legado RENAME TO perfil_permissoes;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'perfil_permissoes'
           AND indexname LIKE 'perfil_permissoes_legado%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, replace(r.indexname, 'perfil_permissoes_legado', 'perfil_permissoes'));
  END LOOP;
  IF to_regclass('public.perfil_permissoes_legado_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE perfil_permissoes_legado_id_seq RENAME TO perfil_permissoes_id_seq;
  END IF;
END $$;
