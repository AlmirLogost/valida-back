const express = require('express')
const router = express.Router()
const onboardingController = require('../controllers/onboardingController')
const auth = require('../middlewares/auth')

router.get('/onboarding', auth, onboardingController.obter)
router.put('/onboarding/dispensar', auth, onboardingController.dispensarCartao)
router.put('/onboarding/wizard-visto', auth, onboardingController.marcarWizardVisto)

module.exports = router
