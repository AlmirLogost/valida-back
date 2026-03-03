const express = require('express')
const router = express.Router()
const usuarioChecklistController = require('../controllers/usuarioChecklistController')
const auth = require('../middlewares/auth')

router.get('/usuarios/:usuario_id/checklists', auth, usuarioChecklistController.listarChecklists)
router.get('/usuarios/:usuario_id/checklists-disponiveis', auth, usuarioChecklistController.listarDisponiveis)
router.get('/usuario-checklists', auth, usuarioChecklistController.listarTodos)
router.get('/loja/:loja_id/visao-fiscal', auth, usuarioChecklistController.listarChecklistsLoja)
router.post('/usuario-checklists', auth, usuarioChecklistController.vincular)
router.post('/usuario-checklists/mover', auth, usuarioChecklistController.mover)
router.delete('/usuario-checklists/:id', auth, usuarioChecklistController.desvincular)

module.exports = router
