const express = require('express')
const router = express.Router()
const controller = require('../controllers/checklistDataController')
const auth = require('../middlewares/auth')

router.get('/checklist-datas', auth, controller.listar)
router.post('/checklist-datas', auth, controller.criar)
router.post('/checklist-datas/lote', auth, controller.criarLote)
router.delete('/checklist-datas/:id', auth, controller.deletar)
router.delete('/checklist-datas/checklist/:checklist_id', auth, controller.deletarPorChecklist)

module.exports = router
