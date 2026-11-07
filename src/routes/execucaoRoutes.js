const express = require('express')
const router = express.Router()
const execucaoController = require('../controllers/execucaoController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/execucoes', auth, requirePlanoAtivo, execucaoController.listar)
router.get('/execucoes/dashboard', auth, execucaoController.dashboard)
router.get('/execucoes/:id', auth, execucaoController.buscarExecucao)
router.post('/execucoes', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, execucaoController.iniciar)
router.post('/execucoes/responder', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, execucaoController.responderItem)
router.post('/execucoes/validar', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, execucaoController.validarItem)
router.put('/execucoes/:id/concluir', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, execucaoController.concluir)
router.delete('/execucoes/:id/reverter', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, execucaoController.reverter)

module.exports = router
