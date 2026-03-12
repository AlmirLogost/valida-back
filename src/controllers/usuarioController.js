const bcrypt = require('bcrypt')
const { query, run } = require('../config/database')

exports.listar = async (req, res) => {
  try {
    const { loja_id } = req.query
    const { lojaSubquery } = require('../helpers/adminLojas')
    let sql = `SELECT id, nome, email, perfil, loja_id, ativo, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim, score FROM usuarios WHERE ativo = 1 AND (loja_id IN ${lojaSubquery(req.userId)} OR (perfil = 'super_admin' AND id = ${req.userId}))`
    const params = []
    if (loja_id) { sql += ' AND loja_id = ?'; params.push(loja_id) }
    sql += ' ORDER BY nome'
    const usuarios = await query(sql, params)
    res.json(usuarios)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criar = async (req, res) => {
  try {
    const { nome, email, senha, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim } = req.body

    // Buscar configuração do perfil para determinar método de login
    const perfilConfig = await query('SELECT * FROM perfis WHERE nome = ? AND ativo = 1', [perfil])
    const metodoLogin = perfilConfig.length > 0 ? perfilConfig[0].metodo_login : 'email_senha'

    if (metodoLogin === 'pin') {
      // Perfis com login por PIN: PIN obrigatório, email opcional
      if (!pin || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ erro: 'PIN de 4 dígitos é obrigatório para este perfil' })
      }
    } else {
      // Perfis com login por email/senha
      if (!email) return res.status(400).json({ erro: 'Email é obrigatório para este perfil' })
      if (!senha) return res.status(400).json({ erro: 'Senha é obrigatória para este perfil' })
    }

    // Verificar nome duplicado apenas na mesma loja
    let dupNome = []
    if (loja_id) {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id = ? AND ativo = 1',
        [nome.trim(), loja_id]
      )
    } else {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id IS NULL AND ativo = 1',
        [nome.trim()]
      )
    }
    if (dupNome.length > 0) {
      return res.status(400).json({ erro: 'Já existe um colaborador com este nome nesta loja.' })
    }

    const emailFinal = email || (nome.toLowerCase().replace(/\s+/g, '.') + '.' + Date.now() + '@func.valida.local')
    const senhaHash = await bcrypt.hash(senha || pin, 10)

    const result = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, emailFinal, senhaHash, perfil, loja_id || null, pin || null, tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0, periodo_comissao || 'mensal', periodo_inicio || null, periodo_fim || null]
    )
    res.json({ id: result.lastID, message: 'Usuário criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const { nome, email, perfil, loja_id, pin, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim } = req.body

    if (pin && !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ erro: 'PIN deve ter 4 dígitos numéricos' })
    }

    // Verificar nome duplicado na mesma loja (excluindo o próprio)
    let dupNome = []
    if (loja_id) {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id = ? AND ativo = 1 AND id != ?',
        [nome.trim(), loja_id, id]
      )
    } else {
      dupNome = await query(
        'SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND loja_id IS NULL AND ativo = 1 AND id != ?',
        [nome.trim(), id]
      )
    }
    if (dupNome.length > 0) {
      return res.status(400).json({ erro: 'Já existe um colaborador com este nome nesta loja.' })
    }

    // Buscar configuração do perfil para determinar se email é opcional
    const perfilConfig = await query('SELECT * FROM perfis WHERE nome = ? AND ativo = 1', [perfil])
    const metodoLogin = perfilConfig.length > 0 ? perfilConfig[0].metodo_login : 'email_senha'

    let emailFinal = email
    if (!email && metodoLogin === 'pin') {
      const current = await query('SELECT email FROM usuarios WHERE id = ?', [id])
      emailFinal = current[0] ? current[0].email : (nome.toLowerCase().replace(/\s+/g, '.') + '@func.valida.local')
    }

    await run(
      `UPDATE usuarios SET nome = ?, email = ?, perfil = ?, loja_id = ?, pin = ?, 
       tipo_comissao = ?, valor_tarefa_feita = ?, valor_desconto = ?, valor_mensal_fixo = ?, desconto_mensal = ?, periodo_comissao = ?, periodo_inicio = ?, periodo_fim = ? 
       WHERE id = ?`,
      [nome, emailFinal, perfil, loja_id || null, pin || null, tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0, periodo_comissao || 'mensal', periodo_inicio || null, periodo_fim || null, id]
    )
    res.json({ message: 'Usuário atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    await run('UPDATE usuarios SET ativo = 0 WHERE id = ?', [id])
    res.json({ message: 'Usuário desativado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.relatorioComissao = async (req, res) => {
  try {
    const { id } = req.params
    const { mes, ano } = req.query
    const hoje = new Date()
    const mesRef = parseInt(mes || hoje.getMonth() + 1)
    const anoRef = parseInt(ano || hoje.getFullYear())

    const mesStr = String(mesRef).padStart(2, '0')
    const dataInicio = `${anoRef}-${mesStr}-01`
    const ultimoDia = new Date(anoRef, mesRef, 0).getDate()
    const dataFim = `${anoRef}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`

    const [usuario] = await query('SELECT * FROM usuarios WHERE id = ?', [id])
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' })

    const vinculos = await query(
      'SELECT uc.*, c.titulo FROM usuario_checklists uc LEFT JOIN checklists c ON uc.checklist_id = c.id WHERE uc.usuario_id = ? AND uc.ativo = 1',
      [id]
    )

    const execucoes = await query(
      `SELECT e.*, c.titulo as checklist_titulo
       FROM execucoes e
       LEFT JOIN checklists c ON e.checklist_id = c.id
       WHERE e.usuario_id = ? AND e.status = 'concluido'
       AND DATE(e.iniciado_em) >= ? AND DATE(e.iniciado_em) <= ?`,
      [id, dataInicio, dataFim]
    )

    // Agrupa execuções por dia
    const porDia = {}
    for (let d = 1; d <= ultimoDia; d++) {
      const dStr = `${anoRef}-${mesStr}-${String(d).padStart(2, '0')}`
      const execDia = execucoes.filter(e => {
        const dt = new Date(e.iniciado_em)
        const local = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0')
        return local === dStr
      })

      const feitasIds = new Set(execDia.map(e => e.checklist_id))
      const tarefasDia = vinculos.map(v => {
        const feita = feitasIds.has(v.checklist_id)
        const bonus = feita ? (v.bonus_override ?? usuario.valor_tarefa_feita ?? 0) : 0
        const desconto = !feita ? (v.desconto_override ?? usuario.valor_desconto ?? usuario.desconto_mensal ?? 0) : 0
        return {
          checklist_id: v.checklist_id,
          titulo: v.titulo,
          feita,
          bonus: Number(bonus),
          desconto: Number(desconto)
        }
      })

      const descontoDia = tarefasDia.reduce((s, t) => s + t.desconto, 0)
      const valorBase = usuario.tipo_comissao === 'mensal' ? 0 : (usuario.valor_mensal_fixo || 0)

      porDia[d] = {
        data: dStr,
        tarefas: tarefasDia,
        feitas: tarefasDia.filter(t => t.feita).length,
        total: vinculos.length,
        desconto: descontoDia
      }
    }

    const totalFeitas = execucoes.length
    const totalEsperadas = vinculos.length * ultimoDia
    const totalDescontos = Object.values(porDia).reduce((s, d) => s + d.desconto, 0)
    const base = usuario.valor_mensal_fixo || 0
    const aPagar = Math.max(0, base - totalDescontos)

    res.json({
      usuario: { id: usuario.id, nome: usuario.nome, tipo_comissao: usuario.tipo_comissao, valor_mensal_fixo: usuario.valor_mensal_fixo, valor_desconto: usuario.valor_desconto, desconto_mensal: usuario.desconto_mensal, periodo_comissao: usuario.periodo_comissao },
      periodo: { mes: mesRef, ano: anoRef, dataInicio, dataFim, ultimoDia },
      resumo: { totalFeitas, totalEsperadas, totalDescontos, base, aPagar },
      dias: porDia
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ erro: 'Erro ao gerar relatório' })
  }
}
