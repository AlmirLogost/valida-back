// Rotas antigas (/api/...) durante a transição até a Etapa 2.
//
// Continuam respondendo, sobre as tabelas novas: login do admin, renovar,
// "me", lista de unidades e "esqueci a senha". O webhook da Asaas fica
// desligado (404, D14). Todas as outras rotas antigas respondem 410 com
// a explicação; a lista completa está em docs/valida/ETAPA_1_PARTE_3.md.
const express = require('express')
const db = require('../db')
const config = require('../config')
const { autenticar } = require('../auth/sessao')

const r = express.Router()

// Repassa para a rota nova trocando só o caminho.
function repassar(app, novoCaminho) {
  return (req, res, next) => {
    req.url = novoCaminho
    app(req, res, next)
  }
}

module.exports = (appV2) => {
  r.post('/login', (req, res, next) => {
    req.body = { email: req.body.email, senha: req.body.senha }
    repassar(appV2, '/auth/admin/entrar')(req, res, next)
  })
  r.post('/token/renovar', repassar(appV2, '/auth/renovar'))
  r.post('/auth/forgot-password', repassar(appV2, '/auth/admin/esqueci'))
  r.post('/auth/reset-password', (req, res, next) => {
    req.body = { token: req.body.token, senha: req.body.senha || req.body.novaSenha || req.body.password }
    repassar(appV2, '/auth/admin/redefinir')(req, res, next)
  })
  r.get('/me', autenticar, async (req, res) => {
    res.json({ id: req.ator.id, nome: req.ator.nome, perfil: req.acesso.admin ? 'super_admin' : req.acesso.perfilCargo, empresa_id: req.ator.empresaId })
  })
  r.get('/lojas', autenticar, async (req, res) => {
    const us = await db.q(
      `SELECT id, nome, endereco, cidade, uf AS estado, telefone, CASE WHEN aberta_hoje THEN 1 ELSE 0 END AS aberta, 1 AS ativo
       FROM unidades WHERE empresa_id = $1 AND id = ANY($2) AND arquivado_em IS NULL ORDER BY nome`,
      [req.ator.empresaId, [...req.acesso.unidades]])
    res.json(us)
  })

  // D14: Asaas não será usada. Desligado = 404. Só seria religado com
  // WEBHOOK_ASAAS_ATIVO=true e conferência do token (código em src/legado).
  r.post('/webhooks/asaas', (req, res, next) => {
    if (!config.webhookAsaasAtivo) return res.status(404).json({ erro: 'Não encontrado.' })
    const esperado = process.env.ASAAS_WEBHOOK_TOKEN
    if (!esperado || req.headers['asaas-access-token'] !== esperado) return res.status(401).json({ erro: 'Não autorizado.' })
    return res.status(501).json({ erro: 'Integração Asaas desativada (código em legado).' })
  })

  r.all('/{*resto}', (req, res) => {
    res.status(410).json({ erro: 'Esta rota antiga foi desativada na reforma (Etapa 1). As telas voltam na Etapa 2, sobre /api/v2.' })
  })
  return r
}
