const express = require('express')
const router = express.Router()
const controller = require('../controllers/checklistDataController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')

router.get('/checklist-datas', auth, controller.listar)
router.post('/checklist-datas', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, controller.criar)
router.post('/checklist-datas/lote', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, controller.criarLote)
router.delete('/checklist-datas/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, controller.deletar)
router.delete('/checklist-datas/checklist/:checklist_id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, controller.deletarPorChecklist)

module.exports = router
