const express = require('express')
const router = express.Router()
const checklistItemController = require('../controllers/checklistItemController')
const auth = require('../middlewares/auth')

router.get('/checklists/:checklist_id/itens', auth, checklistItemController.listar)
router.post('/checklists/:checklist_id/itens', auth, checklistItemController.criar)
router.put('/checklist-itens/:id', auth, checklistItemController.atualizar)
router.delete('/checklist-itens/:id', auth, checklistItemController.deletar)

module.exports = router
