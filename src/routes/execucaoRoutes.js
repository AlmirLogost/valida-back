const express = require('express')
const router = express.Router()
const execucaoController = require('../controllers/execucaoController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao, temPermissao } = require('../middlewares/permissoes')

// Ver as PRÓPRIAS execuções (ex.: MinhasTarefas, pra calcular a comissão e
// achar o que reverter) é sempre permitido, mesmo sem "relatorios.ver" —
// é o mesmo princípio de "ver_minhas" nas comissões. Ver execuções de
// outras pessoas (relatório/dashboard geral) exige a permissão da matriz.
function soVeAsProprias(req) {
  return String(req.query.usuario_id || '') === String(req.userId)
}
async function requireVerExecucoes(req, res, next) {
  if (soVeAsProprias(req)) return next()
  if (await temPermissao(req.userId, req.userPerfil, 'relatorios.ver')) return next()
  return res.status(403).json({ erro: 'Seu perfil não tem permissão para isso.' })
}

router.get('/execucoes', auth, requirePlanoAtivo, requireVerExecucoes, execucaoController.listar)
router.get('/execucoes/dashboard', auth, requirePermissao('painel.ver'), execucaoController.dashboard)
router.get('/execucoes/:id', auth, requirePermissao('relatorios.ver'), execucaoController.buscarExecucao)
router.post('/execucoes', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.executar'), execucaoController.iniciar)
router.post('/execucoes/responder', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.executar'), execucaoController.responderItem)
router.post('/execucoes/validar', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('relatorios.ver'), execucaoController.validarItem)
router.put('/execucoes/:id/concluir', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.executar'), execucaoController.concluir)
router.delete('/execucoes/:id/reverter', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.executar'), execucaoController.reverter)

module.exports = router
