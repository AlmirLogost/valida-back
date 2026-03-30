const express = require('express')
const router = express.Router()
const checklistController = require('../controllers/checklistController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, checkLimite } = require('../middlewares/planos')

router.get('/checklists', auth, checklistController.listar)
router.post('/checklists', auth, requirePlanoAtivo, checkLimite('tarefas'), checklistController.criar)
router.put('/checklists/:id', auth, checklistController.atualizar)
router.delete('/checklists/:id', auth, checklistController.deletar)
router.patch('/checklists/:id/toggle', auth, checklistController.toggleStatus)
router.patch('/checklists/:id/pausar', auth, checklistController.togglePausado)

module.exports = router
