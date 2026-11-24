const express = require('express')
const router = express.Router()
const checklistItemController = require('../controllers/checklistItemController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao } = require('../middlewares/permissoes')

router.get('/checklists/:checklist_id/itens', auth, requirePermissao('tarefas.ver'), checklistItemController.listar)
router.post('/checklists/:checklist_id/itens', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.criar'), checklistItemController.criar)
router.put('/checklist-itens/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), checklistItemController.atualizar)
router.delete('/checklist-itens/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), checklistItemController.deletar)

module.exports = router
