const express = require('express')
const router = express.Router()
const checklistController = require('../controllers/checklistController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, checkLimite, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao } = require('../middlewares/permissoes')

router.get('/checklists', auth, requirePermissao('tarefas.ver'), checklistController.listar)
router.post('/checklists', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.criar'), checkLimite('tarefas'), checklistController.criar)
router.put('/checklists/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), checklistController.atualizar)
router.delete('/checklists/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.arquivar'), checklistController.deletar)
router.patch('/checklists/:id/toggle', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), checklistController.toggleStatus)
router.patch('/checklists/:id/pausar', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), checklistController.togglePausado)

module.exports = router
