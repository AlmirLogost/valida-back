const express = require('express')
const router = express.Router()
const usuarioController = require('../controllers/usuarioController')
const auth = require('../middlewares/auth')

router.get('/usuarios', auth, usuarioController.listar)
router.post('/usuarios', auth, usuarioController.criar)
router.put('/usuarios/:id', auth, usuarioController.atualizar)
router.delete('/usuarios/:id', auth, usuarioController.deletar)

module.exports = router
