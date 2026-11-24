const jwt = require('jsonwebtoken')

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ erro: 'Token não fornecido' })
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = decoded.id
    req.userPerfil = decoded.perfil
    next()
  } catch (erro) {
    res.status(401).json({ erro: 'Token inválido' })
  }
}
