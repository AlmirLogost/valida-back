const { query, run } = require('../config/database')
const jwt = require('jsonwebtoken')

// Login por nome + PIN
exports.loginPin = async (req, res) => {
  try {
    const { nome, pin } = req.body
    
    if (!nome || !pin) {
      return res.status(400).json({ erro: 'Informe nome e PIN' })
    }
    
    // Buscar perfis que usam PIN como método de login
    const perfisPin = await query(
      `SELECT nome FROM perfis WHERE metodo_login = 'pin' AND ativo = 1`
    )
    const slugsPin = perfisPin.map(p => p.nome)
    
    // Fallback: se tabela perfis vazia, usar padrão
    const perfilFilter = slugsPin.length > 0
      ? `AND perfil IN (${slugsPin.map(() => '?').join(',')})`
      : `AND perfil IN ('funcionario', 'gerente')`
    
    // Busca por nome (case insensitive)
    const users = await query(
      `SELECT * FROM usuarios 
       WHERE LOWER(nome) = LOWER(?) AND ativo = 1 ${perfilFilter}`,
      [nome.trim(), ...(slugsPin.length > 0 ? slugsPin : [])]
    )
    
    if (users.length === 0) {
      return res.status(401).json({ erro: 'Usuário não encontrado' })
    }
    
    // Se encontrou mais de um com mesmo nome, tenta match exato com PIN
    let user = null
    for (const u of users) {
      if (u.pin === pin) {
        user = u
        break
      }
    }
    
    if (!user) {
      // Se nenhum bateu o PIN, verifica se o primeiro tem PIN configurado
      if (!users[0].pin) {
        return res.status(401).json({ erro: 'PIN não configurado. Procure o administrador.' })
      }
      return res.status(401).json({ erro: 'PIN incorreto' })
    }
    
    const token = jwt.sign(
      { id: user.id, perfil: user.perfil },
      process.env.JWT_SECRET || 'sua_chave_secreta_aqui',
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
        valor_mensal_fixo: user.valor_mensal_fixo,
        rotulo_perfil: perfilData.length > 0 ? perfilData[0].rotulo : user.perfil,
        permissoes
      }
    })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Alterar PIN (protegida)
exports.alterarPin = async (req, res) => {
  try {
    const { usuario_id, pin_atual, pin_novo } = req.body
    
    const users = await query('SELECT pin FROM usuarios WHERE id = ?', [usuario_id])
    if (users.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' })
    
    if (users[0].pin && users[0].pin !== pin_atual) {
      return res.status(401).json({ erro: 'PIN atual incorreto' })
    }
    
    if (!/^\d{4}$/.test(pin_novo)) {
      return res.status(400).json({ erro: 'PIN deve ter 4 dígitos numéricos' })
    }
    
    await run('UPDATE usuarios SET pin = ? WHERE id = ?', [pin_novo, usuario_id])
    res.json({ message: 'PIN atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
