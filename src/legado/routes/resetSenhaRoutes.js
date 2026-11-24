const express = require('express')
const router = express.Router()
const ctrl = require('../controllers/resetSenhaController')

router.post('/auth/forgot-password', ctrl.solicitar)
router.post('/auth/reset-password', ctrl.redefinir)

module.exports = router
