const express = require('express')
const router = express.Router()
const templateController = require('../controllers/templateController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao } = require('../middlewares/permissoes')

router.get('/templates', auth, requirePermissao('tarefas.ver'), templateController.listar)
router.get('/templates/:id', auth, requirePermissao('tarefas.ver'), templateController.obter)
router.post('/templates', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.criar'), templateController.criar)
router.put('/templates/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), templateController.atualizar)
router.delete('/templates/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), templateController.deletar)
router.post('/templates/aplicar', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.criar'), templateController.aplicar)

module.exports = router
