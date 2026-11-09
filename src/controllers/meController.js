const { query, run } = require('../config/database')
const bcrypt = require('bcrypt')

const SENHA_MIN = 8

exports.obter = async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, nome, email, perfil, whatsapp, documento, razao_social, email_cobranca, cep, endereco, cidade, estado FROM usuarios WHERE id = ?',
      [req.userId]
    )
    if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' })

    // perfil_acesso e permissoes resolvidas (Fase 5, bloco B9): mesmo
    // cálculo usado no login, escopado pela conta do usuário.
    const { getAdminId, resolverPerfilPorNome, matrizDoPerfil } = require('../helpers/adminLojas')
    const adminIdMe = await getAdminId(req.userId, rows[0].perfil)
    const perfilRow = await resolverPerfilPorNome(rows[0].perfil, adminIdMe)
    const matriz = await matrizDoPerfil(perfilRow?.id)

    res.json({
      ...rows[0],
      rotulo_perfil: perfilRow ? perfilRow.rotulo : rows[0].perfil,
      perfil_acesso: perfilRow ? perfilRow.perfil_acesso : null,
      matriz
    })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}

exports.atualizar = async (req, res) => {
  try {
    const { nome, email, senha, senhaAtual, whatsapp, documento, razao_social, email_cobranca, cep, endereco, cidade, estado } = req.body

    const rows = await query('SELECT * FROM usuarios WHERE id = ?', [req.userId])
    if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' })
    const user = rows[0]

    // Troca de senha (opcional, pelo mesmo endpoint) — exige a senha atual.
    // Pode vir junto com o resto do perfil ou sozinha (como a tela "Trocar
    // senha" manda, só com senha/senhaAtual).
    let novaSenha = user.senha
    if (senha) {
      if (!senhaAtual) {
        return res.status(400).json({ erro: 'Informe a senha atual para trocar a senha.' })
      }
      const confere = await bcrypt.compare(senhaAtual, user.senha)
      if (!confere) return res.status(400).json({ erro: 'Senha atual incorreta' })
      if (senha.length < SENHA_MIN) {
        return res.status(400).json({ erro: `A nova senha deve ter no mínimo ${SENHA_MIN} caracteres.` })
      }
      novaSenha = await bcrypt.hash(senha, 10)
    }

    // Qualquer outro campo não enviado mantém o valor atual — nunca "limpa"
    // nome/email/etc. por engano só porque essa chamada não os incluiu
    // (ex.: a tela de trocar senha manda só senha+senhaAtual).
    const manterSeAusente = (valor, atual) => valor !== undefined ? valor : atual

    await run(
      `UPDATE usuarios SET nome=?, email=?, senha=?, whatsapp=?, documento=?, razao_social=?, email_cobranca=?, cep=?, endereco=?, cidade=?, estado=? WHERE id=?`,
      [
        manterSeAusente(nome, user.nome),
        manterSeAusente(email, user.email),
        novaSenha,
        manterSeAusente(whatsapp, user.whatsapp),
        manterSeAusente(documento, user.documento),
        manterSeAusente(razao_social, user.razao_social),
        manterSeAusente(email_cobranca, user.email_cobranca),
        manterSeAusente(cep, user.cep),
        manterSeAusente(endereco, user.endereco),
        manterSeAusente(cidade, user.cidade),
        manterSeAusente(estado, user.estado),
        req.userId
      ]
    )
    res.json({ message: 'Conta atualizada!' })
  } catch (e) { res.status(500).json({ erro: e.message }) }
}
