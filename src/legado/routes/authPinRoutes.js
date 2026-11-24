const express = require('express')
const router = express.Router()
const authPinController = require('../controllers/authPinController')
const auth = require('../middlewares/auth')

router.post('/login-pin', authPinController.loginPin)
router.put('/login-pin/alterar', auth, authPinController.alterarPin)

module.exports = router
