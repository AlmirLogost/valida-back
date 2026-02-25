const express = require('express')
const router = express.Router()
const perfilController = require('../controllers/perfilController')
const auth = require('../middlewares/auth')

router.get('/perfis', auth, perfilController.listar)
router.post('/perfis', auth, perfilController.criar)
router.put('/perfis/:id', auth, perfilController.atualizar)
router.delete('/perfis/:id', auth, perfilController.deletar)

module.exports = router
