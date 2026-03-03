require('dotenv').config()
const express = require('express')
const cors = require('cors')

// Inicializar banco de dados
console.log('🔄 Carregando banco de dados...')
const { db } = require('./src/config/database')
console.log('✅ Banco de dados carregado')

const authRoutes = require('./src/routes/authRoutes')
const lojaRoutes = require('./src/routes/lojaRoutes')
const usuarioRoutes = require('./src/routes/usuarioRoutes')
const checklistRoutes = require('./src/routes/checklistRoutes')
const checklistItemRoutes = require('./src/routes/checklistItemRoutes')
const usuarioChecklistRoutes = require('./src/routes/usuarioChecklistRoutes')
const execucaoRoutes = require('./src/routes/execucaoRoutes')
const templateRoutes = require('./src/routes/templateRoutes')
const checklistDataRoutes = require('./src/routes/checklistDataRoutes')
const authPinRoutes = require('./src/routes/authPinRoutes')
const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.use('/api', authRoutes)
app.use('/api', lojaRoutes)
app.use('/api', usuarioRoutes)
app.use('/api', checklistRoutes)
app.use('/api', checklistItemRoutes)
app.use('/api', usuarioChecklistRoutes)
app.use('/api', execucaoRoutes)
app.use('/api', templateRoutes)
app.use('/api', checklistDataRoutes)
app.use('/api', authPinRoutes)

// Servir frontend — sem cache em HTML para sempre servir versão atualizada
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  next()
})
app.use(express.static(require("path").join(__dirname, "../front/dist")))
app.get('/{*splat}', (req, res) => {
  res.sendFile(require("path").join(__dirname, "../front/dist/index.html"))
})
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
})
