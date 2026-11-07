const express = require('express')
const router = express.Router()
const lojaController = require('../controllers/lojaController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, checkLimite, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/lojas', auth, lojaController.listar)
router.get('/lojas/:id', auth, lojaController.obterPorId)
router.post('/lojas', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checkLimite('lojas'), lojaController.criar)
router.put('/lojas/:id', auth, lojaController.atualizar)
router.delete('/lojas/:id', auth, lojaController.deletar)

// Horários e funcionamento
router.put('/lojas/:id/toggle', auth, lojaController.toggleAberta)
router.put('/lojas/:id/reset', auth, lojaController.atualizarReset)
router.get('/lojas/:id/horarios', auth, lojaController.listarHorarios)
router.put('/lojas/:id/horarios', auth, lojaController.salvarHorarios)
router.get('/lojas/:id/fechamentos', auth, lojaController.listarFechamentos)
router.post('/lojas/:id/fechamentos', auth, lojaController.adicionarFechamento)
router.delete('/lojas/:id/fechamentos/:fid', auth, lojaController.removerFechamento)

module.exports = router