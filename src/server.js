require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')

const authRoutes             = require('./routes/authRoutes')
const authPinRoutes          = require('./routes/authPinRoutes')
const lojaRoutes             = require('./routes/lojaRoutes')
const usuarioRoutes          = require('./routes/usuarioRoutes')
const checklistRoutes        = require('./routes/checklistRoutes')
const checklistItemRoutes    = require('./routes/checklistItemRoutes')
const execucaoRoutes         = require('./routes/execucaoRoutes')
const usuarioChecklistRoutes = require('./routes/usuarioChecklistRoutes')
const templateRoutes         = require('./routes/templateRoutes')
const checklistDataRoutes    = require('./routes/checklistDataRoutes')

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))

app.use('/api', authRoutes)
app.use('/api', authPinRoutes)
app.use('/api', lojaRoutes)
app.use('/api', usuarioRoutes)
app.use('/api', checklistRoutes)
app.use('/api', checklistItemRoutes)
app.use('/api', execucaoRoutes)
app.use('/api', usuarioChecklistRoutes)
app.use('/api', templateRoutes)
app.use('/api', checklistDataRoutes)

app.get('/', (req, res) => res.json({ message: 'VALIDA API' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 VALIDA na porta ${PORT}`))
