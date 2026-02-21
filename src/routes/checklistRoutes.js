const express = require('express')
const router = express.Router()
const checklistController = require('../controllers/checklistController')
const auth = require('../middlewares/auth')

router.get('/checklists', auth, checklistController.listar)
router.post('/checklists', auth, checklistController.criar)
router.put('/checklists/:id', auth, checklistController.atualizar)
router.delete('/checklists/:id', auth, checklistController.deletar)
router.patch('/checklists/:id/toggle', auth, checklistController.toggleStatus)

module.exports = router
