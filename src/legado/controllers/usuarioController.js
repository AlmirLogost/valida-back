const bcrypt = require('bcrypt')
const { query, run } = require('../config/database')
const { registrarAuditoria } = require('../middlewares/permissoes')

// Guarda só dígitos (ex.: "(11) 99999-9999" -> "11999999999"), ou null se vazio.
// Usado tanto pra salvar o celular do colaborador quanto pra buscar no login por PIN.
function normalizarCelular(valor) {
  if (!valor) return null
  const digitos = String(valor).replace(/\D/g, '')
  return digitos || null
}

exports.listar = async (req, res) => {
  try {
    const { loja_id } = req.query
    const arquivados = req.query.arquivados === '1'
    const { getLojaIdsVisiveis, getLojaIds } = require('../helpers/adminLojas')
    // "pin" nunca é devolvido pro front — ele guarda um hash, não serve pra exibir,
    // e nem o hash deveria sair da API sem necessidade.
    const colunas = `id, nome, email, perfil, loja_id, ativo, whatsapp AS celular, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim, score`
    let sql, params
    if (arquivados) {
      // Restaurar é ação do dono (equipe.arquivar) — lista por toda a
      // conta, não só pelas unidades do próprio usuário.
      const lojaIds = await getLojaIds(req.userId, req.userPerfil)
      sql = `SELECT ${colunas} FROM usuarios WHERE ativo = 0 AND (loja_id = ANY(?) OR (perfil = 'super_admin' AND id = ?))`
      params = [lojaIds, req.userId]
    } else {
      // Dono vê a equipe de todas as lojas da conta; qualquer outro perfil
      // só vê quem está nas unidades vinculadas a ele.
      const lojaIds = await getLojaIdsVisiveis(req.userId, req.userPerfil)
      sql = `SELECT ${colunas} FROM usuarios WHERE ativo = 1 AND (loja_id = ANY(?) OR (perfil = 'super_admin' AND id = ?))`
      params = [lojaIds, req.userId]
    }
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
    const { nome, email, senha, perfil, loja_id, loja_ids, pin, celular, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim } = req.body

    // Ninguém se torna Proprietário por esta tela (Fase 5, bloco D) — cada
    // conta já nasce com exatamente um Dono (super_admin), criado só no
    // cadastro (registroController.js); não existe fluxo de "promover a
    // Proprietário" por aqui.
    if (perfil === 'super_admin') {
      return res.status(403).json({ erro: 'Não é possível criar outro Proprietário por esta tela.' })
    }

    // A loja do novo colaborador (e qualquer unidade extra em loja_ids,
    // pra gerente com mais de uma unidade) precisa pertencer à conta de
    // quem está criando.
    const { getLojaIds, getAdminId, resolverPerfilPorNome } = require('../helpers/adminLojas')
    const lojaIds = await getLojaIds(req.userId, req.userPerfil)
    if (loja_id && !lojaIds.includes(parseInt(loja_id))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    if (Array.isArray(loja_ids) && loja_ids.some(lid => !lojaIds.includes(parseInt(lid)))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }

    // Buscar configuração do perfil (escopado pela conta de quem está
    // criando) para determinar método de login
    const adminIdCriar = await getAdminId(req.userId, req.userPerfil)
    const perfilConfig = await resolverPerfilPorNome(perfil, adminIdCriar)
    const metodoLogin = perfilConfig?.metodo_login || 'email_senha'

    if (metodoLogin === 'pin') {
      // Perfis com login por PIN: PIN e celular obrigatórios, email opcional.
      // Celular é o que o colaborador usa pra entrar — sem ele, ninguém
      // consegue logar com esse perfil.
      if (!pin || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ erro: 'PIN de 4 dígitos é obrigatório para este perfil' })
      }
      const celularNormalizado = normalizarCelular(celular)
      if (!celularNormalizado || celularNormalizado.length < 10 || celularNormalizado.length > 11) {
        return res.status(400).json({ erro: 'Celular é obrigatório e deve ter DDD + número (10 ou 11 dígitos)' })
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
    // PIN nunca fica em texto puro no banco — só o hash, igual senha.
    const pinHash = pin ? await bcrypt.hash(pin, 10) : null

    const result = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id, pin, whatsapp, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, emailFinal, senhaHash, perfil, loja_id || null, pinHash, normalizarCelular(celular), tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0, periodo_comissao || 'mensal', periodo_inicio || null, periodo_fim || null]
    )
    // Mantém usuario_lojas em dia pra quem é criado a partir de agora
    // (migration 008 só cobriu quem já existia antes da reforma).
    const todasAsUnidades = [...new Set([loja_id, ...(Array.isArray(loja_ids) ? loja_ids : [])].filter(Boolean))]
    for (const lid of todasAsUnidades) {
      await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [result.lastID, lid])
    }
    await registrarAuditoria(req, { acao: 'criar', entidade: 'usuario', entidade_id: result.lastID, detalhes: { nome, perfil } })
    const { marcarPasso } = require('../helpers/onboarding')
    await marcarPasso(adminIdCriar, 'passo_pessoa')
    res.json({ id: result.lastID, message: 'Usuário criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const { nome, email, perfil, loja_id, loja_ids, pin, celular, tipo_comissao, valor_tarefa_feita, valor_desconto, valor_mensal_fixo, desconto_mensal, periodo_comissao, periodo_inicio, periodo_fim } = req.body

    const { usuarioPertenceAConta, getLojaIds, getAdminId, resolverPerfilPorNome } = require('../helpers/adminLojas')
    if (!(await usuarioPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Usuário não encontrado' })
    }

    // Cada conta tem exatamente UM Dono (super_admin) — ele É a raiz da
    // conta (getAdminId devolve o próprio id pra ele, não existe "outro
    // Dono" pra assumir o lugar). Rebaixar o Dono deixaria a conta sem
    // ninguém com acesso total, então essa troca é sempre recusada.
    // Na outra direção (Fase 5, bloco D): "ninguém se torna Proprietário
    // por esta tela" — promover outra pessoa pra super_admin por aqui
    // criaria um segundo Dono sem passar por nenhum fluxo de transferência
    // de propriedade (que não existe no sistema). Só é permitido mandar
    // perfil='super_admin' quando o ALVO já é o Dono (reenvio idempotente
    // do próprio valor atual, ex.: editar nome/telefone sem tocar no cargo).
    if (perfil !== undefined) {
      const alvoAtual = await query('SELECT perfil FROM usuarios WHERE id = ?', [id])
      if (perfil === 'super_admin' && alvoAtual[0]?.perfil !== 'super_admin') {
        return res.status(403).json({ erro: 'Não é possível tornar alguém Proprietário por esta tela.' })
      }
      if (perfil !== 'super_admin' && alvoAtual[0]?.perfil === 'super_admin') {
        return res.status(403).json({ erro: 'O Dono da conta não pode ser rebaixado para outro cargo.' })
      }
    }

    const lojaIds = await getLojaIds(req.userId, req.userPerfil)
    if (loja_id && !lojaIds.includes(parseInt(loja_id))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    if (Array.isArray(loja_ids) && loja_ids.some(lid => !lojaIds.includes(parseInt(lid)))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }

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
    const adminIdAtualizar = await getAdminId(req.userId, req.userPerfil)
    const perfilConfig = await resolverPerfilPorNome(perfil, adminIdAtualizar)
    const metodoLogin = perfilConfig?.metodo_login || 'email_senha'

    let emailFinal = email
    if (!email && metodoLogin === 'pin') {
      const current = await query('SELECT email FROM usuarios WHERE id = ?', [id])
      emailFinal = current[0] ? current[0].email : (nome.toLowerCase().replace(/\s+/g, '.') + '@func.valida.local')
    }

    // PIN é opcional na edição: só troca o hash se um PIN novo foi digitado.
    // Se vier em branco, mantém o PIN atual (nunca "limpa" o PIN por engano).
    let pinFinal
    if (pin) {
      pinFinal = await bcrypt.hash(pin, 10)
    } else {
      const atual = await query('SELECT pin FROM usuarios WHERE id = ?', [id])
      pinFinal = atual[0]?.pin ?? null
    }

    // Celular é opcional: se não vier no corpo, mantém o que já estava salvo.
    let celularFinal
    if (celular !== undefined) {
      celularFinal = normalizarCelular(celular)
    } else {
      const atual = await query('SELECT whatsapp FROM usuarios WHERE id = ?', [id])
      celularFinal = atual[0]?.whatsapp ?? null
    }

    await run(
      `UPDATE usuarios SET nome = ?, email = ?, perfil = ?, loja_id = ?, pin = ?, whatsapp = ?,
       tipo_comissao = ?, valor_tarefa_feita = ?, valor_desconto = ?, valor_mensal_fixo = ?, desconto_mensal = ?, periodo_comissao = ?, periodo_inicio = ?, periodo_fim = ?
       WHERE id = ?`,
      [nome, emailFinal, perfil, loja_id || null, pinFinal, celularFinal, tipo_comissao || null, valor_tarefa_feita || 0, valor_desconto || 0, valor_mensal_fixo || 0, desconto_mensal || 0, periodo_comissao || 'mensal', periodo_inicio || null, periodo_fim || null, id]
    )
    if (Array.isArray(loja_ids)) {
      // loja_ids veio explícito: substitui o conjunto completo de unidades
      // (é o que a tela de editar unidades da pessoa manda).
      await run('DELETE FROM usuario_lojas WHERE usuario_id = ?', [id])
      const todasAsUnidades = [...new Set([loja_id, ...loja_ids].filter(Boolean))]
      for (const lid of todasAsUnidades) {
        await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, lid])
      }
    } else if (loja_id) {
      // Só o campo único antigo: garante que essa unidade está presente,
      // sem remover outras que a pessoa já tivesse.
      await run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, loja_id])
    }
    await registrarAuditoria(req, { acao: 'editar', entidade: 'usuario', entidade_id: id, detalhes: { nome, perfil } })
    res.json({ message: 'Usuário atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    const { id } = req.params
    const { usuarioPertenceAConta } = require('../helpers/adminLojas')
    if (!(await usuarioPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Usuário não encontrado' })
    }

    // O Dono da conta nunca pode ser arquivado — é a raiz da conta, não
    // existe outro Dono pra assumir o lugar (ver mesma regra em atualizar).
    const alvoAtual = await query('SELECT perfil FROM usuarios WHERE id = ?', [id])
    if (alvoAtual[0]?.perfil === 'super_admin') {
      return res.status(403).json({ erro: 'O Dono da conta não pode ser arquivado.' })
    }

    // Mantém ativo = 0 (como já era — mudar esse valor exigiria revisar todo
    // filtro "ativo = 1" do sistema, fora do escopo deste passo). Só soma
    // data/quem arquivou, que são novos e não afetam nenhuma consulta ainda.
    await run('UPDATE usuarios SET ativo = 0, arquivado_em = NOW(), arquivado_por = ? WHERE id = ?', [req.userId, id])
    await registrarAuditoria(req, { acao: 'arquivar', entidade: 'usuario', entidade_id: id })
    res.json({ message: 'Usuário desativado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.relatorioComissao = async (req, res) => {
  try {
    const { id } = req.params
    const { usuarioPertenceAConta } = require('../helpers/adminLojas')
    if (!(await usuarioPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Usuário não encontrado' })
    }
    const { mes, ano } = req.query
    const hoje = new Date()
    const mesRef = parseInt(mes || hoje.getMonth() + 1)
    const anoRef = parseInt(ano || hoje.getFullYear())

    const [usuario] = await query('SELECT * FROM usuarios WHERE id = ?', [id])
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' })

    // Período de navegação (sempre mensal para o calendário)
    const mesStr = String(mesRef).padStart(2, '0')
    const dataInicioMes = `${anoRef}-${mesStr}-01`
    const ultimoDia = new Date(anoRef, mesRef, 0).getDate()
    const dataFimMes = `${anoRef}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`

    // Período real de comissão do usuário (personalizado respeita as datas definidas)
    let dataInicioComissao = dataInicioMes
    let dataFimComissao = dataFimMes
    if (usuario.periodo_comissao === 'personalizado' && usuario.periodo_inicio && usuario.periodo_fim) {
      dataInicioComissao = usuario.periodo_inicio
      dataFimComissao    = usuario.periodo_fim
    }

    // Vinculos enriquecidos com dados do checklist (dias_semana, recorrencia, peso)
    const vinculos = await query(
      `SELECT uc.*, c.titulo, c.dias_semana, c.recorrencia, c.data_mensal, c.data_pontual, c.peso
       FROM usuario_checklists uc
       LEFT JOIN checklists c ON uc.checklist_id = c.id
       WHERE uc.usuario_id = ? AND uc.ativo = 1`,
      [id]
    )

    // Execuções concluídas no mês navegado
    const execucoes = await query(
      `SELECT e.checklist_id, e.iniciado_em
       FROM execucoes e
       WHERE e.usuario_id = ? AND e.status = 'concluido'
       AND DATE(e.iniciado_em) >= ? AND DATE(e.iniciado_em) <= ?`,
      [id, dataInicioMes, dataFimMes]
    )

    // Dias em que a loja ficou fechada (no mês navegado)
    const diasFechados = new Set()
    if (usuario.loja_id) {
      const fechamentos = await query(
        'SELECT data FROM loja_fechamentos WHERE loja_id = ? AND data >= ? AND data <= ?',
        [usuario.loja_id, dataInicioMes, dataFimMes]
      )
      fechamentos.forEach(f => diasFechados.add(f.data))
    }

    // Lookup execuções: 'YYYY-MM-DD:checklist_id'
    const execLookup = new Set()
    for (const e of execucoes) {
      const dt = new Date(e.iniciado_em)
      const dStr = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0')
      execLookup.add(dStr + ':' + e.checklist_id)
    }

    function tarefaAgendadaNoDia(v, dateStr) {
      const rec = v.recorrencia || 'diario'
      if (rec === 'pontual') return v.data_pontual === dateStr
      if (rec === 'diario')  return true
      if (rec === 'semanal') {
        if (!v.dias_semana) return true
        const dias = String(v.dias_semana).split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d))
        const d = new Date(dateStr + 'T12:00:00')
        return dias.includes(d.getDay())
      }
      if (rec === 'mensal') {
        if (!v.data_mensal) return false
        const d = new Date(dateStr + 'T12:00:00')
        return d.getDate() === parseInt(v.data_mensal)
      }
      return true
    }

    const hojeStr = hoje.getFullYear() + '-' + String(hoje.getMonth()+1).padStart(2,'0') + '-' + String(hoje.getDate()).padStart(2,'0')

    // Agrupa por dia
    const porDia = {}
    let totalFeitasGlobal = 0
    let totalEsperadasGlobal = 0
    let acumulado = usuario.tipo_comissao === 'mensal' ? (Number(usuario.valor_mensal_fixo) || 0) : 0

    for (let d = 1; d <= ultimoDia; d++) {
      const dStr = `${anoRef}-${mesStr}-${String(d).padStart(2, '0')}`
      const isFuture = dStr > hojeStr
      const isFechado = diasFechados.has(dStr)
      const dentroDoperiodo = dStr >= dataInicioComissao && dStr <= dataFimComissao

      const tarefasDia = vinculos
        .filter(v => tarefaAgendadaNoDia(v, dStr))
        .map(v => {
          const feita = execLookup.has(dStr + ':' + v.checklist_id)
          const peso  = parseInt(v.peso) || 1

          let bonus = 0, desconto = 0
          if (!isFechado && !isFuture && dentroDoperiodo) {
            if (feita) {
              if (usuario.tipo_comissao === 'por_tarefa') {
                bonus = (v.bonus_override != null ? v.bonus_override : (usuario.valor_tarefa_feita ?? 0)) * peso
              }
            } else {
              desconto = (v.desconto_override != null
                ? v.desconto_override
                : (usuario.tipo_comissao === 'por_tarefa' ? (usuario.valor_desconto ?? 0) : (usuario.desconto_mensal ?? 0))
              ) * peso
            }
          }
          return { checklist_id: v.checklist_id, titulo: v.titulo, feita, bonus: Number(bonus), desconto: Number(desconto), peso }
        })

      const feitasDia    = tarefasDia.filter(t => t.feita).length
      const esperadasDia = tarefasDia.length
      const descontoDia  = tarefasDia.reduce((s, t) => s + t.desconto, 0)
      const bonusDia     = tarefasDia.reduce((s, t) => s + t.bonus, 0)

      if (!isFuture && !isFechado && dentroDoperiodo) {
        totalFeitasGlobal    += feitasDia
        totalEsperadasGlobal += esperadasDia
        acumulado += bonusDia - descontoDia
      }

      porDia[d] = {
        data: dStr,
        tarefas: tarefasDia,
        feitas: feitasDia,
        total: esperadasDia,
        desconto: descontoDia,
        bonus: bonusDia,
        fechado: isFechado,
        futuro: isFuture
      }
    }

    const aPagar = Math.max(0, acumulado)
    const base   = Number(usuario.valor_mensal_fixo) || 0
    const totalDescontos = Object.values(porDia).reduce((s, d) => s + d.desconto, 0)

    res.json({
      usuario: {
        id: usuario.id, nome: usuario.nome,
        tipo_comissao: usuario.tipo_comissao,
        valor_mensal_fixo: usuario.valor_mensal_fixo,
        valor_tarefa_feita: usuario.valor_tarefa_feita,
        valor_desconto: usuario.valor_desconto,
        desconto_mensal: usuario.desconto_mensal,
        periodo_comissao: usuario.periodo_comissao,
        periodo_inicio: usuario.periodo_inicio,
        periodo_fim: usuario.periodo_fim
      },
      periodo: { mes: mesRef, ano: anoRef, dataInicio: dataInicioMes, dataFim: dataFimMes, ultimoDia, dataInicioComissao, dataFimComissao },
      resumo: { totalFeitas: totalFeitasGlobal, totalEsperadas: totalEsperadasGlobal, totalDescontos, base, aPagar },
      dias: porDia
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ erro: 'Erro ao gerar relatório' })
  }
}

// Gera um PIN novo pra um colaborador (Experiência do Cliente, bloco 3 —
// "Reenviar convite") e já salva o hash — o PIN antigo some na hora,
// nenhum dos dois fica valendo ao mesmo tempo. O PIN em texto puro só
// existe nesta resposta, uma vez só; o back nunca guarda nem devolve de
// novo depois disso.
exports.gerarNovoPin = async (req, res) => {
  try {
    const { id } = req.params
    const { usuarioPertenceAConta } = require('../helpers/adminLojas')
    if (!(await usuarioPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Usuário não encontrado' })
    }
    const alvo = await query('SELECT whatsapp FROM usuarios WHERE id = ?', [id])
    if (!alvo.length) return res.status(404).json({ erro: 'Usuário não encontrado' })
    if (!alvo[0].whatsapp) {
      return res.status(400).json({ erro: 'Esse colaborador não tem celular cadastrado — cadastre o celular antes de gerar um PIN novo.' })
    }
    const pinNovo = String(Math.floor(1000 + Math.random() * 9000))
    const hash = await bcrypt.hash(pinNovo, 10)
    await run('UPDATE usuarios SET pin = ? WHERE id = ?', [hash, id])
    await registrarAuditoria(req, { acao: 'editar', entidade: 'usuario', entidade_id: id, detalhes: { acao_especifica: 'gerar_novo_pin' } })
    res.json({ pin: pinNovo })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Restaura um colaborador arquivado (ativo = 0 -> 1), limpando quem/quando
// arquivou. usuarioPertenceAConta não filtra pelo ativo da pessoa, então
// funciona igual pra alguém já arquivado.
exports.restaurar = async (req, res) => {
  try {
    const { id } = req.params
    const { usuarioPertenceAConta } = require('../helpers/adminLojas')
    if (!(await usuarioPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Usuário não encontrado' })
    }
    await run('UPDATE usuarios SET ativo = 1, arquivado_em = NULL, arquivado_por = NULL WHERE id = ?', [id])
    await registrarAuditoria(req, { acao: 'restaurar', entidade: 'usuario', entidade_id: id })
    res.json({ message: 'Usuário restaurado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
