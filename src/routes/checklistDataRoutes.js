const express = require('express')
const router = express.Router()
const controller = require('../controllers/checklistDataController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao } = require('../middlewares/permissoes')

router.get('/checklist-datas', auth, requirePermissao('tarefas.ver'), controller.listar)
router.post('/checklist-datas', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), controller.criar)
router.post('/checklist-datas/lote', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), controller.criarLote)
router.delete('/checklist-datas/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), controller.deletar)
router.delete('/checklist-datas/checklist/:checklist_id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), controller.deletarPorChecklist)

module.exports = router
