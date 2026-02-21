const express = require('express')
const router = express.Router()
const usuarioChecklistController = require('../controllers/usuarioChecklistController')
const auth = require('../middlewares/auth')

router.get('/usuarios/:usuario_id/checklists', auth, usuarioChecklistController.listarChecklists)
router.get('/usuarios/:usuario_id/checklists-disponiveis', auth, usuarioChecklistController.listarDisponiveis)
router.get('/usuario-checklists', auth, usuarioChecklistController.listarTodos)
router.post('/usuario-checklists', auth, usuarioChecklistController.vincular)
router.delete('/usuario-checklists/:id', auth, usuarioChecklistController.desvincular)

module.exports = router
