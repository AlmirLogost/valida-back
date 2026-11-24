-- 043 · Pedido pode vir da plataforma (tipo "sup": o suporte pede acesso e o
-- admin libera por 1 hora, §9/§20). Antes só colaborador ou admin.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_solicitante_tipo_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_solicitante_tipo_check CHECK (solicitante_tipo IN ('colaborador', 'admin', 'plataforma'));
