-- Volta a regra antiga. Falha (de propósito) se já existir pedido da plataforma.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_solicitante_tipo_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_solicitante_tipo_check CHECK (solicitante_tipo IN ('colaborador', 'admin'));
