const express = require('express')
const router = express.Router()
const perfilController = require('../controllers/perfilController')
const auth = require('../middlewares/auth')
const { requirePlanoAtivo, bloquearEscritaSeSomenteLeitura } = require('../middlewares/planos')
const { requirePermissao } = require('../middlewares/permissoes')

// GET /perfis não exige "acessos.ver": é preciso listar os cargos pra
// atribuir um deles a um colaborador (Equipe), não só pra administrar
// cargos (Acessos) — quem decide se mostra a TELA de Acessos é o front,
// com base em "acessos.ver". Criar/editar/arquivar um cargo continua
// exigindo a permissão certa.
router.get('/perfis', auth, perfilController.listar)
router.post('/perfis', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('acessos.criar'), perfilController.criar)
router.put('/perfis/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('acessos.editar'), perfilController.atualizar)
router.delete('/perfis/:id', auth, requirePlanoAtivo, bloquearEscritaSeSomenteLeitura, requirePermissao('acessos.arquivar'), perfilController.deletar)

module.exports = router
