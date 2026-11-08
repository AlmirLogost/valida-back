-- Migration 014 (Reforma de Acessos, Fase 3, item 6): nova ação na matriz
-- de permissões, "relatorios.exportar" — controla o botão "Exportar CSV" do
-- relatório. Mapeada a partir da mesma coluna antiga (perm_relatorios) que
-- já libera "relatorios.ver" pros perfis de sistema; cargo personalizado
-- não ganha nada aqui (fica desligado por padrão, dono liga manualmente).
INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
SELECT id, 'relatorios', 'exportar', perm_relatorios FROM perfis WHERE sistema = 1
ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = EXCLUDED.permitido;
