const express = require('express')
const router = express.Router()
const usuarioController = require('../controllers/usuarioController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, requireFeature, checkLimite, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao, temPermissao } = require('../middlewares/permissoes')

router.get('/usuarios', auth, requirePermissao('equipe.ver'), usuarioController.listar)
router.post('/usuarios', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('equipe.criar'), checkLimite('usuarios'), usuarioController.criar)
router.put('/usuarios/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('equipe.editar'), usuarioController.atualizar)
router.delete('/usuarios/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('equipe.arquivar'), usuarioController.deletar)
router.put('/usuarios/:id/restaurar', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('equipe.arquivar'), usuarioController.restaurar)
router.post('/usuarios/:id/novo-pin', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('equipe.editar'), usuarioController.gerarNovoPin)

// Ver a própria comissão é sempre permitido (como já era); ver a comissão
// de outra pessoa exige a permissão "ver todas" da matriz.
router.get('/usuarios/:id/relatorio-comissao', auth, requirePlanoAtivo, requireFeature('comissoes'), async (req, res, next) => {
  if (String(req.params.id) === String(req.userId)) return next()
  if (await temPermissao(req.userId, req.userPerfil, 'comissoes.ver_todas')) return next()
  return res.status(403).json({ erro: 'Seu perfil não tem permissão para isso.' })
}, usuarioController.relatorioComissao)

module.exports = router
