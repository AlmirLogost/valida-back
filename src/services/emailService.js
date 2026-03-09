const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

exports.enviarResetSenha = async (email, nome, token) => {
  const link = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`
  
  await resend.emails.send({
    from: 'VALIDA <onboarding@resend.dev>',
    to: email,
    subject: 'Redefinição de senha - VALIDA',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="color:#1a237e;margin-bottom:8px">Redefinir senha</h2>
        <p style="color:#555">Olá, <strong>${nome}</strong>!</p>
        <p style="color:#555">Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo:</p>
        <a href="${link}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#ff6600;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
          Redefinir senha
        </a>
        <p style="color:#aaa;font-size:0.8rem">Este link expira em 1 hora. Se não foi você, ignore este email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#bbb;font-size:0.75rem">VALIDA — Sistema de gestão de tarefas</p>
      </div>
    `
  })
}
