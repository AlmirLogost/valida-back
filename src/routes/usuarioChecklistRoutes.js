const express = require('express')
const router = express.Router()
const usuarioChecklistController = require('../controllers/usuarioChecklistController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/usuarios/:usuario_id/checklists', auth, usuarioChecklistController.listarChecklists)
router.get('/usuarios/:usuario_id/checklists-disponiveis', auth, usuarioChecklistController.listarDisponiveis)
router.get('/usuario-checklists', auth, usuarioChecklistController.listarTodos)
router.put('/usuario-checklists/overrides', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, usuarioChecklistController.salvarOverrides)
router.get('/loja/:loja_id/visao-fiscal', auth, usuarioChecklistController.listarChecklistsLoja)
router.post('/usuario-checklists', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, usuarioChecklistController.vincular)
router.post('/usuario-checklists/mover', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, usuarioChecklistController.mover)
router.delete('/usuario-checklists/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, usuarioChecklistController.desvincular)

module.exports = router
