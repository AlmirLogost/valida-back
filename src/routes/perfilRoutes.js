const express = require('express')
const router = express.Router()
const perfilController = require('../controllers/perfilController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/perfis', auth, perfilController.listar)
router.post('/perfis', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, perfilController.criar)
router.put('/perfis/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, perfilController.atualizar)
router.delete('/perfis/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, perfilController.deletar)

module.exports = router
