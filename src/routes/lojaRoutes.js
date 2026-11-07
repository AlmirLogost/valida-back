const express = require('express')
const router = express.Router()
const lojaController = require('../controllers/lojaController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, checkLimite, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/lojas', auth, lojaController.listar)
router.get('/lojas/:id', auth, lojaController.obterPorId)
router.post('/lojas', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checkLimite('lojas'), lojaController.criar)
router.put('/lojas/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, lojaController.atualizar)
router.delete('/lojas/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, lojaController.deletar)

// Horários e funcionamento
router.put('/lojas/:id/toggle', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, lojaController.toggleAberta)
router.put('/lojas/:id/reset', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, lojaController.atualizarReset)
router.get('/lojas/:id/horarios', auth, lojaController.listarHorarios)
router.put('/lojas/:id/horarios', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, lojaController.salvarHorarios)
router.get('/lojas/:id/fechamentos', auth, lojaController.listarFechamentos)
router.post('/lojas/:id/fechamentos', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, lojaController.adicionarFechamento)
router.delete('/lojas/:id/fechamentos/:fid', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, lojaController.removerFechamento)

module.exports = router
