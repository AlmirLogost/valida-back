require('dotenv').config()
const express = require('express')
const app = express()

app.use(express.json())

app.get('/test', (req, res) => {
  res.json({ message: 'OK' })
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`✅ Test server rodando na porta ${PORT}`)
})
