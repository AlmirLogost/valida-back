const bcrypt = require('bcrypt')
const { query, run } = require('../config/database')
const jwt = require('jsonwebtoken')

// ============================================================================
// Limite de tentativas no login por PIN: 5 erros seguidos bloqueiam por 15
// minutos. PIN de 4 dígitos tem só 10.000 combinações — sem esse limite,
// seria fácil de adivinhar na força bruta.
//
// A trava é por CELULAR (o que o atacante está tentando acertar), não por IP
// — assim, mesmo trocando de IP, o mesmo celular continua bloqueado depois
// de 5 erros. Guardado em memória (reinicia o contador se o servidor reiniciar,
// o que é um risco aceitável aqui).
// ============================================================================
const MAX_TENTATIVAS = 5
const BLOQUEIO_MS = 15 * 60 * 1000
const tentativasPin = new Map() // celular normalizado -> { falhas, bloqueadoAte }

function verificarBloqueio(chave) {
  const estado = tentativasPin.get(chave)
  if (estado?.bloqueadoAte && estado.bloqueadoAte > Date.now()) {
    return Math.ceil((estado.bloqueadoAte - Date.now()) / 60000)
  }
  return null
}

function registrarFalha(chave) {
  const estado = tentativasPin.get(chave) || { falhas: 0, bloqueadoAte: null }
  estado.falhas += 1
  if (estado.falhas >= MAX_TENTATIVAS) {
    estado.bloqueadoAte = Date.now() + BLOQUEIO_MS
  }
  tentativasPin.set(chave, estado)
}

function limparTentativas(chave) {
  tentativasPin.delete(chave)
}

function normalizarCelular(valor) {
  const digitos = String(valor || '').replace(/\D/g, '')
  return digitos || null
}

// Login por celular + PIN
exports.loginPin = async (req, res) => {
  try {
    const { celular, pin } = req.body

    if (!celular || !pin) {
      return res.status(400).json({ erro: 'Informe celular e PIN' })
    }

    const chave = normalizarCelular(celular)
    if (!chave) {
      return res.status(400).json({ erro: 'Celular inválido' })
    }

    const minutosBloqueio = verificarBloqueio(chave)
    if (minutosBloqueio !== null) {
      return res.status(429).json({
        erro: `Muitas tentativas com esse celular. Tente de novo em ${minutosBloqueio} minuto(s).`
      })
    }

    // Buscar perfis que usam PIN como método de login
    const perfisPin = await query(
      `SELECT nome FROM perfis WHERE metodo_login = 'pin' AND ativo = 1`
    )
    const slugsPin = perfisPin.map(p => p.nome)

    // Fallback: se tabela perfis vazia, usar padrão
    const perfilFilter = slugsPin.length > 0
      ? `AND perfil IN (${slugsPin.map(() => '?').join(',')})`
      : `AND perfil IN ('operador', 'fiscal')`

    // Busca por celular — o PIN só vale dentro da conta de quem cadastrou o
    // celular; dois colaboradores de empresas diferentes podem ter o mesmo
    // PIN sem conflito, porque o celular (normalmente único por pessoa) é
    // que decide qual usuário (e qual conta) está entrando.
    const users = await query(
      `SELECT * FROM usuarios
       WHERE whatsapp = ? AND ativo = 1 ${perfilFilter}`,
      [chave, ...(slugsPin.length > 0 ? slugsPin : [])]
    )

    if (users.length === 0) {
      registrarFalha(chave)
      return res.status(401).json({ erro: 'Celular não encontrado' })
    }

    // Se mais de um usuário tiver o mesmo celular (não deveria, mas por
    // segurança), testa o PIN (hash) de cada um até achar o que bate.
    let user = null
    for (const u of users) {
      if (u.pin && await bcrypt.compare(pin, u.pin)) {
        user = u
        break
      }
    }

    if (!user) {
      registrarFalha(chave)
      if (!users[0].pin) {
        return res.status(401).json({ erro: 'PIN não configurado. Procure o administrador.' })
      }
      return res.status(401).json({ erro: 'PIN incorreto' })
    }

    limparTentativas(chave)

    // JWT_SECRET vem só do .env — o servidor nem inicia sem ela (ver server.js)
    const token = jwt.sign(
      { id: user.id, perfil: user.perfil },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )

    // Buscar permissoes do perfil
    const perfilData = await query(
      'SELECT * FROM perfis WHERE nome = ? AND ativo = 1 LIMIT 1',
      [user.perfil]
    )
    const permissoes = perfilData.length > 0 ? {
      perm_dashboard: !!perfilData[0].perm_dashboard,
      perm_criar_tarefas: !!perfilData[0].perm_criar_tarefas,
      perm_executar_tarefas: !!perfilData[0].perm_executar_tarefas,
      perm_conferir: !!perfilData[0].perm_conferir,
      perm_gerenciar_equipe: !!perfilData[0].perm_gerenciar_equipe,
      perm_gerenciar_lojas: !!perfilData[0].perm_gerenciar_lojas,
      perm_relatorios: !!perfilData[0].perm_relatorios,
      perm_configuracoes: !!perfilData[0].perm_configuracoes
    } : null

    res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil,
        loja_id: user.loja_id,
        tipo_comissao: user.tipo_comissao,
        valor_tarefa_feita: user.valor_tarefa_feita,
        valor_desconto: user.valor_desconto,
        valor_mensal_fixo: user.valor_mensal_fixo,
        desconto_mensal: user.desconto_mensal,
        periodo_comissao: user.periodo_comissao || 'mensal',
        periodo_inicio: user.periodo_inicio || null,
        periodo_fim: user.periodo_fim || null,
        rotulo_perfil: perfilData.length > 0 ? perfilData[0].rotulo : user.perfil,
        permissoes
      }
    })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Alterar o PRÓPRIO PIN (protegida). Nunca aceita usuario_id do corpo da
// requisição — isso permitia trocar o PIN de qualquer usuário de qualquer
// conta, bastando acertar o PIN atual dele. Só o próprio usuário logado
// pode trocar o próprio PIN por aqui.
exports.alterarPin = async (req, res) => {
  try {
    const { pin_atual, pin_novo } = req.body
    const usuario_id = req.userId

    const users = await query('SELECT pin FROM usuarios WHERE id = ?', [usuario_id])
    if (users.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' })

    const pinAtualHash = users[0].pin
    if (pinAtualHash) {
      const bate = await bcrypt.compare(pin_atual || '', pinAtualHash)
      if (!bate) return res.status(401).json({ erro: 'PIN atual incorreto' })
    }

    if (!/^\d{4}$/.test(pin_novo)) {
      return res.status(400).json({ erro: 'PIN deve ter 4 dígitos numéricos' })
    }

    const novoHash = await bcrypt.hash(pin_novo, 10)
    await run('UPDATE usuarios SET pin = ? WHERE id = ?', [novoHash, usuario_id])
    res.json({ message: 'PIN atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
