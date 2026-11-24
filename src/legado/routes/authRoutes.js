const express = require('express')
const router = express.Router()
const authController = require('../controllers/authController')
const auth = require('../middlewares/auth')

router.post('/login', authController.login)
router.post('/token/renovar', auth, authController.renovarToken)

module.exports = router
