const express = require('express')
const router = express.Router()
const checklistController = require('../controllers/checklistController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, checkLimite, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/checklists', auth, checklistController.listar)
router.post('/checklists', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checkLimite('tarefas'), checklistController.criar)
router.put('/checklists/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checklistController.atualizar)
router.delete('/checklists/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checklistController.deletar)
router.patch('/checklists/:id/toggle', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checklistController.toggleStatus)
router.patch('/checklists/:id/pausar', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checklistController.togglePausado)

module.exports = router
