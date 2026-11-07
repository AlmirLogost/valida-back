const bcrypt = require('bcrypt')
const { query, run } = require('../config/database')
const jwt = require('jsonwebtoken')

// ============================================================================
// Limite de tentativas no login por PIN: 5 erros seguidos bloqueiam por 15
// minutos. PIN de 4 dígitos tem só 10.000 combinações — sem esse limite,
// seria fácil de adivinhar na força bruta.
//
// A trava é pelo TEXTO DIGITADO no campo celular (celular ou, no fallback,
// o nome) — assim, mesmo trocando de IP, a mesma tentativa continua
// bloqueada depois de 5 erros. Guardado em memória (reinicia o contador se
// o servidor reiniciar, risco aceitável aqui). Vale tanto pro login normal
// quanto pro fallback por nome (ponto 3 da 1.4).
// ============================================================================
const MAX_TENTATIVAS = 5
const BLOQUEIO_MS = 15 * 60 * 1000
const tentativasPin = new Map() // texto digitado (normalizado) -> { falhas, bloqueadoAte }

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

// LOGIN_POR_NOME: liga/desliga o fallback de login por nome (ponto 3 da 1.4).
// Ligado por padrão enquanto colaboradores antigos (sem celular cadastrado)
// ainda existem em produção — ver back/DEPLOY.md. Só "false" desliga.
function loginPorNomeHabilitado() {
  return process.env.LOGIN_POR_NOME !== 'false'
}

// Compara o PIN digitado com o que está salvo, aceitando os dois formatos:
// hash bcrypt (o normal, a partir da 1.4) ou texto puro (colaborador antigo
// cujo PIN ainda não passou por scripts/migrar_pins_para_hash.js). Isso
// garante que o fallback por nome funciona mesmo que a migração de dados
// ainda não tenha rodado nesse colaborador específico.
async function pinCorresponde(pinDigitado, pinArmazenado) {
  if (!pinArmazenado) return false
  if (pinArmazenado.startsWith('$2')) {
    return bcrypt.compare(pinDigitado, pinArmazenado)
  }
  return pinArmazenado === pinDigitado
}

// Login por celular + PIN (com fallback por nome pra quem ainda não tem
// celular cadastrado — ver LOGIN_POR_NOME acima e back/DEPLOY.md)
exports.loginPin = async (req, res) => {
  try {
    const { celular, pin } = req.body

    if (!celular || !pin) {
      return res.status(400).json({ erro: 'Informe celular e PIN' })
    }

    const textoDigitado = String(celular).trim()
    const celularNormalizado = normalizarCelular(textoDigitado)
    // Chave do limite de tentativas: o texto como foi digitado (minúsculo),
    // serve tanto pra celular quanto pra nome no fallback.
    const chaveTentativa = textoDigitado.toLowerCase()

    const minutosBloqueio = verificarBloqueio(chaveTentativa)
    if (minutosBloqueio !== null) {
      return res.status(429).json({
        erro: `Muitas tentativas. Tente de novo em ${minutosBloqueio} minuto(s).`
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
    const perfilParams = slugsPin.length > 0 ? slugsPin : []

    // 1) Busca por celular — o PIN só vale dentro da conta de quem cadastrou
    // o celular; dois colaboradores de empresas diferentes podem ter o mesmo
    // PIN sem conflito, porque o celular (normalmente único por pessoa) é
    // que decide qual usuário (e qual conta) está entrando.
    if (celularNormalizado) {
      const usersCelular = await query(
        `SELECT * FROM usuarios WHERE whatsapp = ? AND ativo = 1 ${perfilFilter}`,
        [celularNormalizado, ...perfilParams]
      )

      if (usersCelular.length > 0) {
        let encontrado = null
        for (const u of usersCelular) {
          if (await pinCorresponde(pin, u.pin)) { encontrado = u; break }
        }
        if (encontrado) {
          limparTentativas(chaveTentativa)
          return responderLogin(res, encontrado)
        }
        registrarFalha(chaveTentativa)
        if (!usersCelular[0].pin) {
          return res.status(401).json({ erro: 'PIN não configurado. Procure o administrador.' })
        }
        return res.status(401).json({ erro: 'PIN incorreto' })
      }
    }

    // 2) Fallback por nome — só pra quem ainda NÃO tem celular cadastrado.
    // Assim que o dono preenche o celular de alguém, essa pessoa some desta
    // busca e passa a usar só o celular, igual todo mundo novo.
    if (loginPorNomeHabilitado()) {
      const usersNome = await query(
        `SELECT * FROM usuarios WHERE LOWER(nome) = LOWER(?) AND whatsapp IS NULL AND ativo = 1 ${perfilFilter}`,
        [textoDigitado, ...perfilParams]
      )

      if (usersNome.length > 1) {
        // Mais de um colaborador sem celular com esse nome (em qualquer
        // conta) — nunca adivinha qual é. Recusa sem nem olhar o PIN.
        registrarFalha(chaveTentativa)
        return res.status(401).json({
          erro: 'Encontramos mais de um colaborador com esse nome. Peça pro dono cadastrar seu celular pra você conseguir entrar.'
        })
      }

      if (usersNome.length === 1) {
        const u = usersNome[0]
        if (await pinCorresponde(pin, u.pin)) {
          limparTentativas(chaveTentativa)
          // Log sem dado sensível (nunca PIN/senha) — ajuda o dono a saber
          // quem ainda está entrando pelo nome em vez do celular.
          console.log(`[login-pin] login via fallback de nome (sem celular cadastrado) — usuario_id=${u.id} em ${new Date().toISOString()}`)
          return responderLogin(res, u)
        }
        registrarFalha(chaveTentativa)
        if (!u.pin) {
          return res.status(401).json({ erro: 'PIN não configurado. Procure o administrador.' })
        }
        return res.status(401).json({ erro: 'PIN incorreto' })
      }
    }

    // 3) Nada encontrado nem por celular nem (se habilitado) por nome
    registrarFalha(chaveTentativa)
    return res.status(401).json({ erro: 'Celular não encontrado' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

async function responderLogin(res, user) {
  // JWT_SECRET vem só do .env — o servidor nem inicia sem ela (ver server.js)
  const token = jwt.sign(
    { id: user.id, perfil: user.perfil },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  )

  // Buscar permissoes do perfil — escopado pela CONTA (admin_id), nunca
  // pegando por engano o cargo de mesmo nome de outra empresa.
  const { getAdminId, resolverPerfilPorNome, matrizDoPerfil } = require('../helpers/adminLojas')
  const adminIdPin = await getAdminId(user.id, user.perfil)
  const perfilData = await resolverPerfilPorNome(user.perfil, adminIdPin)
  const matriz = await matrizDoPerfil(perfilData?.id)
  const permissoes = perfilData ? {
    perm_dashboard: !!perfilData.perm_dashboard,
    perm_criar_tarefas: !!perfilData.perm_criar_tarefas,
    perm_executar_tarefas: !!perfilData.perm_executar_tarefas,
    perm_conferir: !!perfilData.perm_conferir,
    perm_gerenciar_equipe: !!perfilData.perm_gerenciar_equipe,
    perm_gerenciar_lojas: !!perfilData.perm_gerenciar_lojas,
    perm_relatorios: !!perfilData.perm_relatorios,
    perm_configuracoes: !!perfilData.perm_configuracoes
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
      rotulo_perfil: perfilData ? perfilData.rotulo : user.perfil,
      permissoes,
      matriz
    }
  })
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

    const pinAtualSalvo = users[0].pin
    if (pinAtualSalvo) {
      const bate = await pinCorresponde(pin_atual || '', pinAtualSalvo)
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
