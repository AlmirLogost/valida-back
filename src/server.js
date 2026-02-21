require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')

const authRoutes = require('./src/routes/authRoutes')
const lojaRoutes = require('./src/routes/lojaRoutes')
const usuarioRoutes = require('./src/routes/usuarioRoutes')
const checklistRoutes = require('./src/routes/checklistRoutes')
const checklistItemRoutes = require('./src/routes/checklistItemRoutes')
const execucaoRoutes = require('./src/routes/execucaoRoutes')
const usuarioChecklistRoutes = require('./src/routes/usuarioChecklistRoutes')
const templateRoutes = require('./src/routes/templateRoutes')

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())

app.use('/api', authRoutes)
app.use('/api', lojaRoutes)
app.use('/api', usuarioRoutes)
app.use('/api', checklistRoutes)
app.use('/api', checklistItemRoutes)
app.use('/api', execucaoRoutes)
app.use('/api', usuarioChecklistRoutes)
app.use('/api', templateRoutes)

app.get('/', (req, res) => res.json({ message: 'VALIDA API' }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 VALIDA na porta ${PORT}`))
