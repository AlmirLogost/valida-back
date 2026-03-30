const express = require('express')
const router = express.Router()
const execucaoController = require('../controllers/execucaoController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo } = require('../middlewares/planos')

router.get('/execucoes', auth, requirePlanoAtivo, execucaoController.listar)
router.get('/execucoes/dashboard', auth, execucaoController.dashboard)
router.get('/execucoes/:id', auth, execucaoController.buscarExecucao)
router.post('/execucoes', auth, execucaoController.iniciar)
router.post('/execucoes/responder', auth, execucaoController.responderItem)
router.post('/execucoes/validar', auth, execucaoController.validarItem)
router.put('/execucoes/:id/concluir', auth, execucaoController.concluir)
router.delete('/execucoes/:id/reverter', auth, execucaoController.reverter)

module.exports = router
