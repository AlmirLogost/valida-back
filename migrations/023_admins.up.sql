-- 023 · admins (D2, D3, D11). Só o admin usa e-mail e senha.
-- Mesmo id do usuário super_admin no legado. A senha já está em bcrypt.
-- token_versao: muda ao trocar senha ou sair de todos os aparelhos
-- (Segurança item 3); o token da sessão guarda a versão.

CREATE TABLE admins (
  id                BIGSERIAL   PRIMARY KEY,
  empresa_id        BIGINT      NOT NULL REFERENCES empresas(id),
  nome              TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  celular           TEXT,
  senha_hash        TEXT        NOT NULL,
  token_versao      INTEGER     NOT NULL DEFAULT 0,
  ultimo_login_em   TIMESTAMPTZ,
  legado_usuario_id INTEGER     UNIQUE,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO admins (id, empresa_id, nome, email, celular, senha_hash, legado_usuario_id, criado_em)
SELECT u.id, e.id, u.nome, lower(trim(u.email)),
       NULLIF(regexp_replace(COALESCE(u.whatsapp, ''), '[^0-9]', '', 'g'), ''),
       u.senha, u.id, COALESCE(u.criado_em::timestamptz, now())
FROM usuarios u
JOIN empresas e ON e.legado_admin_id = u.id
WHERE u.perfil = 'super_admin';

SELECT setval(pg_get_serial_sequence('admins', 'id'), GREATEST((SELECT MAX(id) FROM admins), 1));

INSERT INTO migracao_relatorio (migracao, item, quantidade, motivo)
SELECT '023', 'senhas de admin que não são bcrypt', COUNT(*), 'conferir: login do admin pode falhar'
FROM admins WHERE senha_hash NOT LIKE '$2%';
