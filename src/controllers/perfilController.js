const { query, run } = require('../config/database')
const { registrarAuditoria } = require('../middlewares/permissoes')

// Mapeia as 8 colunas antigas pra matriz nova (mesma lógica das migrations
// 006/007) — usado aqui pra todo cargo personalizado criado a partir de
// agora já nascer com linhas em perfil_permissoes, e requirePermissao nunca
// encontrar "nenhuma linha" (que seria tratado como sem permissão).
async function seedMatrizPermissoes(perfilId, permValues) {
  const [dash, criarTarefas, executar, conferir, equipe, lojas, relatorios, config] = permValues
  const linhas = [
    ['painel', 'ver', dash],
    ['tarefas', 'ver', criarTarefas || executar ? 1 : 0],
    ['tarefas', 'criar', criarTarefas],
    ['tarefas', 'editar', criarTarefas],
    ['tarefas', 'arquivar', criarTarefas],
    ['tarefas', 'executar', executar],
    ['unidades', 'ver', lojas],
    ['unidades', 'criar', lojas],
    ['unidades', 'editar', lojas],
    ['unidades', 'arquivar', lojas],
    ['equipe', 'ver', equipe],
    ['equipe', 'criar', equipe],
    ['equipe', 'editar', equipe],
    ['equipe', 'arquivar', equipe],
    ['relatorios', 'ver', relatorios || conferir ? 1 : 0],
    ['comissoes', 'ver_todas', equipe],
    ['comissoes', 'ver_minhas', 1],
    ['configuracoes', 'ver', config],
    ['configuracoes', 'editar', config],
    ['acessos', 'ver', 0],
    ['acessos', 'criar', 0],
    ['acessos', 'editar', 0],
    ['acessos', 'arquivar', 0],
    ['plano', 'ver', 0]
  ]
  for (const [modulo, acao, permitido] of linhas) {
    await run(
      'INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, ?) ON CONFLICT (perfil_id, modulo, acao) DO NOTHING',
      [perfilId, modulo, acao, permitido ? 1 : 0]
    )
  }
}

// Mesma lógica de seedMatrizPermissoes, mas sobrescrevendo — usado quando o
// dono edita as 8 colunas antigas pela tela atual (antes do editor de
// matriz do Passo 4 existir), pra matriz nova não ficar desatualizada.
async function sincronizarMatrizPermissoes(perfilId, permValues) {
  const [dash, criarTarefas, executar, conferir, equipe, lojas, relatorios, config] = permValues
  const linhas = [
    ['painel', 'ver', dash],
    ['tarefas', 'ver', criarTarefas || executar ? 1 : 0],
    ['tarefas', 'criar', criarTarefas],
    ['tarefas', 'editar', criarTarefas],
    ['tarefas', 'arquivar', criarTarefas],
    ['tarefas', 'executar', executar],
    ['unidades', 'ver', lojas],
    ['unidades', 'criar', lojas],
    ['unidades', 'editar', lojas],
    ['unidades', 'arquivar', lojas],
    ['equipe', 'ver', equipe],
    ['equipe', 'criar', equipe],
    ['equipe', 'editar', equipe],
    ['equipe', 'arquivar', equipe],
    ['relatorios', 'ver', relatorios || conferir ? 1 : 0],
    ['comissoes', 'ver_todas', equipe],
    ['configuracoes', 'ver', config],
    ['configuracoes', 'editar', config]
  ]
  for (const [modulo, acao, permitido] of linhas) {
    await run(
      `INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, ?)
       ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = EXCLUDED.permitido`,
      [perfilId, modulo, acao, permitido ? 1 : 0]
    )
  }
}

const PERM_COLS = [
  'perm_dashboard', 'perm_criar_tarefas', 'perm_executar_tarefas',
  'perm_conferir', 'perm_gerenciar_equipe', 'perm_gerenciar_lojas',
  'perm_relatorios', 'perm_configuracoes'
]

// Listar perfis ativos: os "de sistema" (sistema=1, ex. Dono/Gerente/Fiscal/
// Operador) são globais e sempre aparecem; os cargos personalizados só
// aparecem se forem da CONTA (admin_id) de quem está logado — nunca de
// outra empresa.
exports.listar = async (req, res) => {
  try {
    const { getAdminId, getLojaIds } = require('../helpers/adminLojas')
    const { loja_id } = req.query
    const adminId = await getAdminId(req.userId, req.userPerfil)
    // "admin_id = ?" cobre os cargos criados depois da migration 005; o
    // "OR" com loja_id cobre cargos antigos que nunca tiveram admin_id
    // preenchido (não deveria sobrar nenhum, mas sem isso qualquer um
    // ficaria invisível pra sempre pra quem o criou).
    const lojaIds = await getLojaIds(req.userId, req.userPerfil)
    let sql = 'SELECT * FROM perfis WHERE ativo = 1 AND (sistema = 1 OR admin_id = ? OR (admin_id IS NULL AND loja_id = ANY(?)))'
    const params = [adminId, lojaIds]
    if (loja_id) {
      sql += ' AND (loja_id = ? OR loja_id IS NULL)'
      params.push(loja_id)
    }
    sql += ' ORDER BY ordem ASC, rotulo ASC'
    const perfis = await query(sql, params)

    // "X pessoas usam este cargo" (Fase 3, item 1) — só dentro da própria
    // conta, mesmo pra cargo de sistema (nome "operador" de uma conta não
    // deve contar gente de outra conta).
    for (const p of perfis) {
      if (p.nome === 'super_admin') { p.usuarios_count = 1; continue }
      const contagem = await query(
        'SELECT COUNT(*) AS total FROM usuarios WHERE perfil = ? AND ativo = 1 AND loja_id = ANY(?)',
        [p.nome, lojaIds]
      )
      p.usuarios_count = Number(contagem[0]?.total || 0)
    }

    res.json(perfis)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Criar novo perfil com permissoes
exports.criar = async (req, res) => {
  try {
    const { nome, rotulo, metodo_login, pode_acessar_painel, cor, loja_id } = req.body

    if (!rotulo) {
      return res.status(400).json({ erro: 'Nome do cargo e obrigatorio' })
    }

    const { lojaPertenceAConta, getAdminId } = require('../helpers/adminLojas')
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.status(403).json({ erro: 'Conta não encontrada.' })

    if (loja_id) {
      if (!(await lojaPertenceAConta(loja_id, req.userId, req.userPerfil))) {
        return res.status(404).json({ erro: 'Loja não encontrada' })
      }
    }

    const slug = (nome || rotulo).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

    const RESERVADOS = ['super_admin', 'fiscal', 'operador', 'gerente']
    if (RESERVADOS.includes(slug)) {
      return res.status(400).json({ erro: 'Esse nome de cargo é reservado para um cargo do sistema. Escolha outro nome.' })
    }

    // Cargo agora é da CONTA (admin_id), não mais de uma loja específica —
    // duas contas podem ter cada uma um cargo com o mesmo nome sem se
    // misturar (era o bug corrigido na migration 005).
    const existente = await query('SELECT id, nome FROM perfis WHERE nome = ? AND admin_id = ? AND ativo = 1', [slug, adminId])
    if (existente.length > 0) {
      // Já existe — retorna o existente em vez de erro
      return res.json({ id: existente[0].id, nome: existente[0].nome, message: 'Cargo já existia' })
    }

    const maxOrdem = await query('SELECT MAX(ordem) as max FROM perfis')
    const proximaOrdem = (maxOrdem[0]?.max || 0) + 1

    const permValues = PERM_COLS.map(col => req.body[col] ? 1 : 0)

    const temAcessoPainel = pode_acessar_painel ||
      req.body.perm_dashboard || req.body.perm_criar_tarefas ||
      req.body.perm_conferir || req.body.perm_gerenciar_equipe ||
      req.body.perm_gerenciar_lojas || req.body.perm_relatorios ||
      req.body.perm_configuracoes

    const result = await run(
      `INSERT INTO perfis (nome, rotulo, loja_id, admin_id, metodo_login, pode_acessar_painel, cor, ordem,
        ${PERM_COLS.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${PERM_COLS.map(() => '?').join(', ')})`,
      [
        slug, rotulo.trim(), loja_id || null, adminId,
        metodo_login || 'pin', temAcessoPainel ? 1 : 0,
        cor || '#3483fa', proximaOrdem,
        ...permValues
      ]
    )

    await seedMatrizPermissoes(result.lastID, permValues)
    await registrarAuditoria(req, { acao: 'criar', entidade: 'perfil', entidade_id: result.lastID, detalhes: { rotulo: rotulo.trim() } })
    res.json({ id: result.lastID, nome: slug, message: 'Cargo criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Atualizar perfil com permissoes
exports.atualizar = async (req, res) => {
  try {
    const { id } = req.params
    const { rotulo, metodo_login, pode_acessar_painel, cor } = req.body

    const { perfilPertenceAConta } = require('../helpers/adminLojas')
    if (!(await perfilPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }

    const perfil = await query('SELECT * FROM perfis WHERE id = ?', [id])
    if (perfil.length === 0) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }

    const permValues = PERM_COLS.map(col => 
      req.body[col] !== undefined ? (req.body[col] ? 1 : 0) : perfil[0][col]
    )

    const temAcessoPainel = pode_acessar_painel ||
      permValues[0] || permValues[1] || permValues[3] || 
      permValues[4] || permValues[5] || permValues[6] || permValues[7]

    if (perfil[0].sistema) {
      const permUpdate = PERM_COLS.map(col => `${col} = ?`).join(', ')
      await run(
        `UPDATE perfis SET rotulo = ?, cor = ?, pode_acessar_painel = ?, ${permUpdate} WHERE id = ?`,
        [rotulo || perfil[0].rotulo, cor || perfil[0].cor, temAcessoPainel ? 1 : 0, ...permValues, id]
      )
      await sincronizarMatrizPermissoes(id, permValues)
      await registrarAuditoria(req, { acao: 'editar', entidade: 'perfil', entidade_id: id })
      return res.json({ message: 'Perfil atualizado!' })
    }

    const permUpdate = PERM_COLS.map(col => `${col} = ?`).join(', ')
    await run(
      `UPDATE perfis SET rotulo = ?, metodo_login = ?, pode_acessar_painel = ?, cor = ?, ${permUpdate} WHERE id = ?`,
      [
        rotulo || perfil[0].rotulo,
        metodo_login || perfil[0].metodo_login,
        temAcessoPainel ? 1 : 0,
        cor || perfil[0].cor,
        ...permValues, id
      ]
    )
    await sincronizarMatrizPermissoes(id, permValues)
    await registrarAuditoria(req, { acao: 'editar', entidade: 'perfil', entidade_id: id })
    res.json({ message: 'Perfil atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Deletar perfil (soft delete)
exports.deletar = async (req, res) => {
  try {
    const { id } = req.params

    const { perfilPertenceAConta } = require('../helpers/adminLojas')
    if (!(await perfilPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }

    const perfil = await query('SELECT * FROM perfis WHERE id = ?', [id])
    if (perfil.length === 0) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }
    if (perfil[0].sistema) {
      return res.status(403).json({ erro: 'Nao e possivel excluir perfis do sistema' })
    }

    const { substituto_id } = req.body || {}
    const usuarios = await query(
      'SELECT COUNT(*) as total FROM usuarios WHERE perfil = ? AND ativo = 1',
      [perfil[0].nome]
    )
    if (usuarios[0].total > 0) {
      if (!substituto_id) {
        return res.status(400).json({
          erro: `Existem ${usuarios[0].total} usuario(s) com este perfil. Escolha um cargo substituto para reatribuí-los antes de arquivar.`,
          usuarios_afetados: Number(usuarios[0].total)
        })
      }
      const substituto = await query('SELECT nome FROM perfis WHERE id = ? AND ativo = 1', [substituto_id])
      if (!substituto.length) {
        return res.status(404).json({ erro: 'Cargo substituto não encontrado.' })
      }
      await run('UPDATE usuarios SET perfil = ? WHERE perfil = ? AND ativo = 1', [substituto[0].nome, perfil[0].nome])
    }

    await run('UPDATE perfis SET ativo = 0 WHERE id = ?', [id])
    await registrarAuditoria(req, { acao: 'arquivar', entidade: 'perfil', entidade_id: id, detalhes: substituto_id ? { substituto_id } : undefined })
    res.json({ message: 'Perfil excluido!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Lista os módulos x ações válidos, pra validar o corpo de salvarPermissoes
// e pra popular o editor de matriz no front.
const MODULOS_ACOES = {
  painel: ['ver'],
  tarefas: ['ver', 'criar', 'editar', 'arquivar', 'executar', 'conferir'],
  unidades: ['ver', 'criar', 'editar', 'arquivar'],
  equipe: ['ver', 'criar', 'editar', 'arquivar'],
  acessos: ['ver', 'criar', 'editar', 'arquivar'],
  relatorios: ['ver'],
  comissoes: ['ver_todas', 'ver_minhas'],
  plano: ['ver'],
  configuracoes: ['ver', 'editar']
}
exports.MODULOS_ACOES = MODULOS_ACOES

// Duplicar um perfil (de sistema ou personalizado) — sempre cria um cargo
// personalizado novo na conta de quem está logado, copiando a matriz de
// permissões inteira. Perfis de sistema só podem ser duplicados, nunca
// editados na matriz; duplicar é como o dono "destrava" um ponto de
// partida editável a partir de um cargo padrão.
exports.duplicar = async (req, res) => {
  try {
    const { id } = req.params
    const { getAdminId } = require('../helpers/adminLojas')
    const adminId = await getAdminId(req.userId, req.userPerfil)
    if (!adminId) return res.status(403).json({ erro: 'Conta não encontrada.' })

    const { perfilPertenceAConta } = require('../helpers/adminLojas')
    if (!(await perfilPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }
    const origem = await query('SELECT * FROM perfis WHERE id = ? AND ativo = 1', [id])
    if (!origem.length) return res.status(404).json({ erro: 'Perfil nao encontrado' })
    const p = origem[0]

    const rotuloBase = `${p.rotulo} (cópia)`
    let rotulo = rotuloBase
    let slug = rotulo.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    let tentativa = 1
    while ((await query('SELECT id FROM perfis WHERE nome = ? AND admin_id = ? AND ativo = 1', [slug, adminId])).length > 0) {
      tentativa++
      rotulo = `${rotuloBase} ${tentativa}`
      slug = rotulo.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    }

    const maxOrdem = await query('SELECT MAX(ordem) as max FROM perfis')
    const proximaOrdem = (maxOrdem[0]?.max || 0) + 1

    const novo = await run(
      `INSERT INTO perfis (nome, rotulo, admin_id, metodo_login, pode_acessar_painel, cor, ordem, sistema, escopo,
        ${PERM_COLS.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ${PERM_COLS.map(() => '?').join(', ')})`,
      [
        slug, rotulo, adminId, p.metodo_login, p.pode_acessar_painel, p.cor, proximaOrdem, p.escopo || 'propria_unidade',
        ...PERM_COLS.map(col => p[col])
      ]
    )

    const matriz = await query('SELECT modulo, acao, permitido FROM perfil_permissoes WHERE perfil_id = ?', [id])
    for (const linha of matriz) {
      await run(
        'INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, ?) ON CONFLICT (perfil_id, modulo, acao) DO NOTHING',
        [novo.lastID, linha.modulo, linha.acao, linha.permitido]
      )
    }

    // Se o cargo original tinha alcance "unidades escolhidas", a cópia
    // começa com a mesma lista (o dono pode ajustar depois).
    const lojasEscolhidasOrigem = await query('SELECT loja_id FROM perfil_lojas WHERE perfil_id = ?', [id])
    for (const l of lojasEscolhidasOrigem) {
      await run('INSERT INTO perfil_lojas (perfil_id, loja_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [novo.lastID, l.loja_id])
    }

    await registrarAuditoria(req, { acao: 'criar', entidade: 'perfil', entidade_id: novo.lastID, detalhes: { duplicado_de: Number(id), rotulo } })
    res.json({ id: novo.lastID, nome: slug, rotulo, message: 'Cargo duplicado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Editor de matriz de permissões (Passo 4/5d) — só pra cargos
// personalizados; cargos de sistema não são editáveis na matriz, só
// duplicáveis (duplique pra ter uma versão própria e editável).
exports.obterPermissoes = async (req, res) => {
  try {
    const { id } = req.params
    const { perfilPertenceAConta } = require('../helpers/adminLojas')
    if (!(await perfilPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }
    const perfil = await query('SELECT escopo FROM perfis WHERE id = ?', [id])
    const linhas = await query('SELECT modulo, acao, permitido FROM perfil_permissoes WHERE perfil_id = ?', [id])
    const lojasEscolhidas = await query('SELECT loja_id FROM perfil_lojas WHERE perfil_id = ?', [id])
    res.json({
      modulos: MODULOS_ACOES,
      permissoes: linhas.map(l => ({ modulo: l.modulo, acao: l.acao, permitido: l.permitido === 1 })),
      escopo: perfil[0]?.escopo || 'propria_unidade',
      loja_ids: lojasEscolhidas.map(l => l.loja_id)
    })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

const ESCOPOS_VALIDOS = ['propria_unidade', 'unidades_escolhidas', 'todas']

exports.salvarPermissoes = async (req, res) => {
  try {
    const { id } = req.params
    const { permissoes, escopo, loja_ids } = req.body

    const { perfilPertenceAConta, lojaPertenceAConta } = require('../helpers/adminLojas')
    if (!(await perfilPertenceAConta(id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Perfil nao encontrado' })
    }
    const perfil = await query('SELECT * FROM perfis WHERE id = ? AND ativo = 1', [id])
    if (!perfil.length) return res.status(404).json({ erro: 'Perfil nao encontrado' })
    if (perfil[0].sistema) {
      return res.status(403).json({ erro: 'Cargos do sistema não podem ter a matriz editada — duplique o cargo para criar uma versão própria.' })
    }
    if (permissoes !== undefined && !Array.isArray(permissoes)) {
      return res.status(400).json({ erro: 'Envie a lista de permissões.' })
    }

    for (const item of (permissoes || [])) {
      const acoesValidas = MODULOS_ACOES[item?.modulo]
      if (!acoesValidas || !acoesValidas.includes(item?.acao)) {
        return res.status(400).json({ erro: `Módulo/ação inválido: ${item?.modulo}.${item?.acao}` })
      }
      await run(
        `INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, ?)
         ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = EXCLUDED.permitido`,
        [id, item.modulo, item.acao, item.permitido ? 1 : 0]
      )
    }

    // Alcance do cargo (Fase 3, item 1): própria unidade (padrão) / unidades
    // escolhidas (lista fixa) / todas as unidades da conta.
    if (escopo !== undefined) {
      if (!ESCOPOS_VALIDOS.includes(escopo)) {
        return res.status(400).json({ erro: `Alcance inválido: ${escopo}` })
      }
      await run('UPDATE perfis SET escopo = ? WHERE id = ?', [escopo, id])
      if (escopo === 'unidades_escolhidas') {
        if (!Array.isArray(loja_ids)) {
          return res.status(400).json({ erro: 'Escolha pelo menos uma unidade para esse alcance.' })
        }
        for (const lojaId of loja_ids) {
          if (!(await lojaPertenceAConta(lojaId, req.userId, req.userPerfil))) {
            return res.status(404).json({ erro: 'Unidade não encontrada' })
          }
        }
        await run('DELETE FROM perfil_lojas WHERE perfil_id = ?', [id])
        for (const lojaId of loja_ids) {
          await run('INSERT INTO perfil_lojas (perfil_id, loja_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, lojaId])
        }
      } else {
        // "propria_unidade" ou "todas" não usam lista fixa — limpa qualquer
        // seleção anterior pra não sobrar lixo se o dono trocar de alcance.
        await run('DELETE FROM perfil_lojas WHERE perfil_id = ?', [id])
      }
    }

    await registrarAuditoria(req, { acao: 'editar', entidade: 'perfil_permissoes', entidade_id: id })
    res.json({ message: 'Permissões atualizadas!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
