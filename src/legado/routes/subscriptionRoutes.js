const express = require('express')
const router = express.Router()
const subscriptionController = require('../controllers/subscriptionController')
const auth = require('../middlewares/auth')

router.get('/subscription/status', auth, subscriptionController.status)

// Webhook público — sem auth JWT (chamado pelo Asaas)
router.post('/webhooks/asaas', subscriptionController.webhookAsaas)

module.exports = router
