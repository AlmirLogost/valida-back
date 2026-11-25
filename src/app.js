// Monta o app Express (usado pelo server.js e pelos testes).
const path = require('path')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const config = require('./config')
const { ErroHttp } = require('./lib/erros')
const { autenticar } = require('./auth/sessao')

function criarApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false }))
  // Segurança item 4: CORS só para FRONTEND_URL (vazio = só a mesma origem).
  // Modo demonstração na rede local (DEMO_REDE=1, só no ensaio): aceita também
  // origens http de endereços locais (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x).
  const REDE_LOCAL = /^http:\/\/(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/
  const origens = config.frontendUrl ? [config.frontendUrl] : []
  app.use(cors({
    origin: config.demoRede ? (o, ok) => ok(null, !o || origens.includes(o) || REDE_LOCAL.test(o)) : (origens.length ? origens : false)
  }))
  // Segurança item 5: corpo pequeno (fotos vêm por upload de arquivo na Etapa 1B).
  app.use(express.json({ limit: '100kb' }))

  // Tudo fica embaixo de APP_BASE ("" na raiz, "/valida" no endereço dividido).
  const raiz = config.appBase.slice(0, -1)
  if (raiz) {
    // "/valida" sem a barra ficaria fora do escopo do service worker.
    app.use((req, res, next) => {
      if (req.path !== raiz || !['GET', 'HEAD'].includes(req.method)) return next()
      const i = req.originalUrl.indexOf('?')
      res.redirect(301, config.appBase + (i < 0 ? '' : req.originalUrl.slice(i)))
    })
  }

  // API nova.
  const v2 = express.Router()
  v2.use(require('./rotas/auth'))
  v2.use(autenticar)
  v2.use(require('./rotas/unidades'))
  v2.use(require('./rotas/acessos').rotas)
  v2.use(require('./rotas/equipe'))
  v2.use(require('./rotas/execucao'))
  v2.use(require('./rotas/conta'))
  v2.use(require('./rotas/push'))
  v2.use((req, res) => res.status(404).json({ erro: 'Não encontrado.' }))
  app.use(raiz + '/api/v2', v2)

  // Rotas antigas (transição).
  app.use(raiz + '/api', require('./rotas/compat')(v2))

  // Front compilado.
  const dist = config.frontDist
  app.use(config.appBase, express.static(dist, {
    setHeaders: (res, p) => {
      if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
      // O service worker e o manifest precisam ser conferidos sempre (atualização do app).
      if (p.endsWith('sw.js') || p.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache')
    }
  }))
  app.get(raiz + '/{*splat}', (req, res, next) => res.sendFile(path.join(dist, 'index.html'), (e) => e && next()))
  if (raiz) app.use((req, res) => res.status(404).json({ erro: 'Não encontrado.' }))

  // Erros: mensagem em português; nada de dados internos para fora.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message, ...(err.extra || {}) })
    if (err && err.type === 'entity.too.large') return res.status(413).json({ erro: 'Envio grande demais.' })
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' })
    if (err && err.code === '23505') return res.status(409).json({ erro: 'Já existe um registro igual.' })
    console.error(`[erro] ${req.method} ${req.path}: ${err && err.code ? `código ${err.code}` : ''} ${err && err.message ? err.message.split('\n')[0] : ''}`)
    res.status(500).json({ erro: 'Erro interno. Tente de novo.' })
  })
  return app
}

module.exports = { criarApp }
