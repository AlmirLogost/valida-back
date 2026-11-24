const express = require('express')
const router = express.Router()
const ctrl = require('../controllers/registroController')
router.post('/auth/register', ctrl.registrar)
module.exports = router
