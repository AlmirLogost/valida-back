const express = require('express')
const router = express.Router()
const checklistItemController = require('../controllers/checklistItemController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/checklists/:checklist_id/itens', auth, checklistItemController.listar)
router.post('/checklists/:checklist_id/itens', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checklistItemController.criar)
router.put('/checklist-itens/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checklistItemController.atualizar)
router.delete('/checklist-itens/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, checklistItemController.deletar)

module.exports = router
