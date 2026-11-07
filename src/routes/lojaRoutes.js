const express = require('express')
const router = express.Router()
const lojaController = require('../controllers/lojaController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, checkLimite, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao } = require('../middlewares/permissoes')

router.get('/lojas', auth, requirePermissao('unidades.ver'), lojaController.listar)
router.get('/lojas/:id', auth, requirePermissao('unidades.ver'), lojaController.obterPorId)
router.post('/lojas', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.criar'), checkLimite('lojas'), lojaController.criar)
router.put('/lojas/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.editar'), lojaController.atualizar)
router.delete('/lojas/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.arquivar'), lojaController.deletar)
router.get('/lojas/:id/impacto-arquivamento', auth, requirePermissao('unidades.ver'), lojaController.impactoArquivamento)
router.put('/lojas/:id/restaurar', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.arquivar'), lojaController.restaurar)

// Horários e funcionamento
router.put('/lojas/:id/toggle', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.editar'), lojaController.toggleAberta)
router.put('/lojas/:id/reset', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.editar'), lojaController.atualizarReset)
router.get('/lojas/:id/horarios', auth, requirePermissao('unidades.ver'), lojaController.listarHorarios)
router.put('/lojas/:id/horarios', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.editar'), lojaController.salvarHorarios)
router.get('/lojas/:id/fechamentos', auth, requirePermissao('unidades.ver'), lojaController.listarFechamentos)
router.post('/lojas/:id/fechamentos', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.editar'), lojaController.adicionarFechamento)
router.delete('/lojas/:id/fechamentos/:fid', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('unidades.editar'), lojaController.removerFechamento)

module.exports = router
