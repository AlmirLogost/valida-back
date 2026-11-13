require('dotenv').config()

// O servidor não pode iniciar sem uma chave de JWT própria vinda do .env.
// Antes, cada arquivo tinha sua própria chave "reserva" escrita no código
// (e todas diferentes entre si) — isso é inseguro e causa bugs estranhos de
// login. Agora existe uma única fonte: a variável JWT_SECRET.
if (!process.env.JWT_SECRET) {
  console.error('❌ Variável JWT_SECRET não configurada no .env — o servidor não pode iniciar.')
  console.error('   Defina JWT_SECRET no arquivo .env (veja .env.example) e suba o servidor de novo.')
  process.exit(1)
}

const express = require('express')
const cors = require('cors')
const helmet = require('helmet')

console.log('🔄 Carregando banco de dados...')
require('./src/config/database')
console.log('✅ Banco de dados carregado')

const authRoutes             = require('./src/routes/authRoutes')
const authPinRoutes          = require('./src/routes/authPinRoutes')
const lojaRoutes             = require('./src/routes/lojaRoutes')
const usuarioRoutes          = require('./src/routes/usuarioRoutes')
const checklistRoutes        = require('./src/routes/checklistRoutes')
const checklistItemRoutes    = require('./src/routes/checklistItemRoutes')
const execucaoRoutes         = require('./src/routes/execucaoRoutes')
const usuarioChecklistRoutes = require('./src/routes/usuarioChecklistRoutes')
const checklistCargoRoutes   = require('./src/routes/checklistCargoRoutes')
const templateRoutes         = require('./src/routes/templateRoutes')
const checklistDataRoutes    = require('./src/routes/checklistDataRoutes')
const perfilRoutes           = require('./src/routes/perfilRoutes')
const meRoutes               = require('./src/routes/meRoutes')
const resetSenhaRoutes       = require('./src/routes/resetSenhaRoutes')
const registroRoutes         = require('./src/routes/registroRoutes')
const subscriptionRoutes     = require('./src/routes/subscriptionRoutes')
const onboardingRoutes       = require('./src/routes/onboardingRoutes')

const app = express()
// O servidor roda atrás do Nginx (proxy reverso). Sem isso, o Express vê
// todas as requisições chegando do IP interno do Nginx — qualquer coisa que
// precise do IP real do visitante (limite de tentativas de login, logs)
// trataria todo mundo como "o mesmo usuário".
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

app.use('/api', authRoutes)
app.use('/api', meRoutes)
app.use('/api', resetSenhaRoutes)
app.use('/api', registroRoutes)
app.use('/api', authPinRoutes)
app.use('/api', lojaRoutes)
app.use('/api', usuarioRoutes)
app.use('/api', checklistRoutes)
app.use('/api', checklistItemRoutes)
app.use('/api', execucaoRoutes)
app.use('/api', usuarioChecklistRoutes)
app.use('/api', checklistCargoRoutes)
app.use('/api', templateRoutes)
app.use('/api', checklistDataRoutes)
app.use('/api', perfilRoutes)
app.use('/api', subscriptionRoutes)
app.use('/api', onboardingRoutes)

// Servir frontend buildado (produção)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  next()
})
app.use(express.static(require('path').join(__dirname, '../front/dist')))
app.get('/{*splat}', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../front/dist/index.html'))
})

const PORT = process.env.PORT || 3001

// Biblioteca de modelos prontos de tarefas — idempotente, confere antes
// de aceitar conexões (ver src/config/seedTemplatesModelos.js); diferente
// do seed.js principal, que só roda manualmente via src/config/init.js.
// Rodar ANTES do listen (não só "em paralelo") evita a janela de corrida
// em que uma segunda subida do servidor (ex.: dois terminais) poderia
// checar "já existe?" e inserir duplicado antes da primeira terminar.
require('./src/config/seedTemplatesModelos').seedTemplatesModelos()
  .then(() => {
    console.log('✅ Biblioteca de modelos de tarefas conferida')
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 VALIDA na porta ${PORT}`))
  })
  .catch((e) => {
    console.error('⚠️  Não foi possível conferir a biblioteca de modelos:', e.message)
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 VALIDA na porta ${PORT}`))
  })
