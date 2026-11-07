const express = require('express')
const router = express.Router()
const usuarioController = require('../controllers/usuarioController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, requireFeature, checkLimite, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/usuarios', auth, usuarioController.listar)
router.post('/usuarios', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checkLimite('usuarios'), usuarioController.criar)
router.put('/usuarios/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, usuarioController.atualizar)
router.delete('/usuarios/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, usuarioController.deletar)
router.get('/usuarios/:id/relatorio-comissao', auth, requirePlanoAtivo, requireFeature('comissoes'), usuarioController.relatorioComissao)

module.exports = router
