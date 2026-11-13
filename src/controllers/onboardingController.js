const { run } = require('../config/database')
const { getAdminId } = require('../helpers/adminLojas')
const { obterProgresso } = require('../helpers/onboarding')

exports.obter = async (req, res) => {
  try {
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.json({ concluido: true })
    const progresso = await obterProgresso(adminId)
    res.json(progresso || { concluido: true })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.dispensarCartao = async (req, res) => {
  try {
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.json({ message: 'ok' })
    await run('UPDATE onboarding_progresso SET dispensado_em = NOW() WHERE admin_id = ?', [adminId])
    res.json({ message: 'ok' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.marcarWizardVisto = async (req, res) => {
  try {
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.json({ message: 'ok' })
    await run('UPDATE onboarding_progresso SET wizard_visto_em = NOW() WHERE admin_id = ?', [adminId])
    res.json({ message: 'ok' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
