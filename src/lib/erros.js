// Erros com status HTTP e mensagem em português para quem usa o app.
class ErroHttp extends Error {
  constructor(status, mensagem, extra) {
    super(mensagem)
    this.status = status
    this.extra = extra
  }
}

module.exports = {
  ErroHttp,
  invalido: (msg, extra) => new ErroHttp(400, msg, extra),
  naoAutenticado: (msg = 'Sessão expirada. Entre de novo.') => new ErroHttp(401, msg),
  proibido: (msg = 'Você não tem permissão para isso.', extra) => new ErroHttp(403, msg, extra),
  naoEncontrado: (msg = 'Não encontrado.') => new ErroHttp(404, msg),
  conflito: (msg, extra) => new ErroHttp(409, msg, extra),
  muitas: (msg, extra) => new ErroHttp(429, msg, extra)
}
