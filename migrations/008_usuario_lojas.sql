-- Migration 008 (Reforma de Acessos, Passo 2d): usuario_lojas — permite um
-- gerente (ou qualquer colaborador) ter acesso a VÁRIAS unidades, não só a
-- uma (usuarios.loja_id continua existindo e funcionando como "unidade
-- principal", por compatibilidade com código que ainda não migrou).
--
-- Preenche a partir do loja_id atual de cada usuário — todo mundo que já
-- tinha uma loja continua com acesso exatamente a ela; ninguém perde nem
-- ganha acesso a unidade nenhuma só por essa migration.
--
-- Seguro rodar mais de uma vez: CREATE TABLE/INDEX IF NOT EXISTS, e o
-- INSERT usa ON CONFLICT DO NOTHING (não duplica vínculo já existente).

CREATE TABLE IF NOT EXISTS usuario_lojas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (usuario_id, loja_id)
);
CREATE INDEX IF NOT EXISTS idx_usuario_lojas_usuario ON usuario_lojas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_lojas_loja ON usuario_lojas(loja_id);

INSERT INTO usuario_lojas (usuario_id, loja_id)
SELECT id, loja_id FROM usuarios WHERE loja_id IS NOT NULL
ON CONFLICT (usuario_id, loja_id) DO NOTHING;
