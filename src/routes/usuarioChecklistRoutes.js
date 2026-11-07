const express = require('express')
const router = express.Router()
const usuarioChecklistController = require('../controllers/usuarioChecklistController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao, temPermissao } = require('../middlewares/permissoes')

// Ver as PRÓPRIAS tarefas vinculadas (ex.: MinhasTarefas) é sempre
// permitido; ver as de outra pessoa exige "tarefas.ver".
async function requireVerProprioOuPermissao(req, res, next) {
  if (String(req.params.usuario_id) === String(req.userId)) return next()
  if (await temPermissao(req.userId, req.userPerfil, 'tarefas.ver')) return next()
  return res.status(403).json({ erro: 'Seu perfil não tem permissão para isso.' })
}

router.get('/usuarios/:usuario_id/checklists', auth, requireVerProprioOuPermissao, usuarioChecklistController.listarChecklists)
router.get('/usuarios/:usuario_id/checklists-disponiveis', auth, requireVerProprioOuPermissao, usuarioChecklistController.listarDisponiveis)
router.get('/usuario-checklists', auth, requirePermissao('tarefas.ver'), usuarioChecklistController.listarTodos)
router.put('/usuario-checklists/overrides', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), usuarioChecklistController.salvarOverrides)
router.get('/loja/:loja_id/visao-fiscal', auth, requirePermissao('tarefas.ver'), usuarioChecklistController.listarChecklistsLoja)
router.post('/usuario-checklists', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), usuarioChecklistController.vincular)
router.post('/usuario-checklists/mover', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), usuarioChecklistController.mover)
router.delete('/usuario-checklists/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('tarefas.editar'), usuarioChecklistController.desvincular)

module.exports = router
