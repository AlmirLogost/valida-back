const express = require('express')
const router = express.Router()
const meController = require('../controllers/meController')
const auth = require('../middlewares/auth')

router.get('/me', auth, meController.obter)
router.put('/me', auth, meController.atualizar)

module.exports = router
