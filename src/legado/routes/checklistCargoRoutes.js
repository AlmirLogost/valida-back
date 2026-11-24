const express = require('express')
const router = express.Router()
const checklistCargoController = require('../controllers/checklistCargoController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao } = require('../middlewares/permissoes')

router.get('/checklist-cargos', auth, requirePermissao('tarefas.ver'), checklistCargoController.listarTodos)
router.post('/checklist-cargos', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), checklistCargoController.vincular)
router.delete('/checklist-cargos/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), checklistCargoController.desvincular)

module.exports = router
