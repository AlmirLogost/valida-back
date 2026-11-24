const { query, run } = require('../config/database')

exports.listar = async (req, res) => {
  try {
    const templates = await query('SELECT * FROM templates WHERE ativo = 1')
    for (var t of templates) {
      t.itens = await query('SELECT * FROM template_itens WHERE template_id = ? ORDER BY ordem', [t.id])
    }
    res.json(templates)
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Modelos prontos (Experiência do Cliente, bloco 2) — agrupa os templates
// por categoria usando a biblioteca de dados (src/data/templatesModelos.js)
// como fonte do nome/descrição do modelo e do banco como fonte da
// contagem real de tarefas (sempre bate, mesmo se algum template virar
// inativo depois).
exports.listarModelos = async (req, res) => {
  try {
    const modelos = require('../data/templatesModelos')
    const resultado = []
    for (const m of modelos) {
      const count = await query('SELECT COUNT(*)::int AS c FROM templates WHERE categoria = ? AND ativo = 1', [m.categoria])
      resultado.push({ categoria: m.categoria, titulo: m.titulo, descricao: m.descricao, qtd_tarefas: count[0]?.c || 0 })
    }
    res.json(resultado.filter(m => m.qtd_tarefas > 0))
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.obter = async (req, res) => {
  try {
    const t = await query('SELECT * FROM templates WHERE id = ? AND ativo = 1', [req.params.id])
    if (!t[0]) return res.status(404).json({ erro: 'Template não encontrado' })
    t[0].itens = await query('SELECT * FROM template_itens WHERE template_id = ? ORDER BY ordem', [t[0].id])
    res.json(t[0])
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.criar = async (req, res) => {
  try {
    const { titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim, itens } = req.body
    const result = await run(
      'INSERT INTO templates (titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim) VALUES (?, ?, ?, ?, ?, ?)',
      [titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim]
    )
    if (itens && itens.length > 0) {
      for (var i = 0; i < itens.length; i++) {
        await run(
          'INSERT INTO template_itens (template_id, titulo, descricao, ordem, critico) VALUES (?, ?, ?, ?, ?)',
          [result.lastID, itens[i].titulo, itens[i].descricao || '', itens[i].ordem || i + 1, itens[i].critico ? 1 : 0]
        )
      }
    }
    res.json({ id: result.lastID, message: 'Template criado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.atualizar = async (req, res) => {
  try {
    const { titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim, itens } = req.body
    await run(
      'UPDATE templates SET titulo = ?, descricao = ?, categoria = ?, recorrencia = ?, horario_inicio = ?, horario_fim = ? WHERE id = ?',
      [titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim, req.params.id]
    )
    if (itens) {
      await run('DELETE FROM template_itens WHERE template_id = ?', [req.params.id])
      for (var i = 0; i < itens.length; i++) {
        await run(
          'INSERT INTO template_itens (template_id, titulo, descricao, ordem, critico) VALUES (?, ?, ?, ?, ?)',
          [req.params.id, itens[i].titulo, itens[i].descricao || '', itens[i].ordem || i + 1, itens[i].critico ? 1 : 0]
        )
      }
    }
    res.json({ message: 'Template atualizado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

exports.deletar = async (req, res) => {
  try {
    await run('UPDATE templates SET ativo = 0 WHERE id = ?', [req.params.id])
    res.json({ message: 'Template removido!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Cria um checklist (+ itens) numa loja a partir de UM template — usado
// tanto por aplicar() quanto por aplicarModelo() (que chama isso várias
// vezes, uma por tarefa do modelo).
async function criarChecklistDeTemplate(template, lojaId, criadoPor) {
  const itens = await query('SELECT * FROM template_itens WHERE template_id = ? ORDER BY ordem', [template.id])
  const result = await run(
    'INSERT INTO checklists (titulo, descricao, categoria, loja_id, criado_por, horario_inicio, horario_fim, recorrencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [template.titulo, template.descricao, template.categoria, lojaId, criadoPor, template.horario_inicio, template.horario_fim, template.recorrencia]
  )
  for (const item of itens) {
    await run(
      'INSERT INTO checklist_itens (checklist_id, titulo, descricao, ordem, critico) VALUES (?, ?, ?, ?, ?)',
      [result.lastID, item.titulo, item.descricao, item.ordem, item.critico]
    )
  }
  return result.lastID
}

exports.aplicar = async (req, res) => {
  try {
    const { template_id, loja_id } = req.body
    const { lojaPertenceAConta, getAdminId } = require('../helpers/adminLojas')
    if (!(await lojaPertenceAConta(loja_id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const t = await query('SELECT * FROM templates WHERE id = ?', [template_id])
    if (!t[0]) return res.status(404).json({ erro: 'Template não encontrado' })
    const checklistId = await criarChecklistDeTemplate(t[0], loja_id, req.userId)
    const { marcarPasso } = require('../helpers/onboarding')
    const adminId = await getAdminId(req.userId, req.userPerfil)
    await marcarPasso(adminId, 'passo_tarefa')
    res.json({ id: checklistId, message: 'Template aplicado!' })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}

// Aplica TODAS as tarefas de um modelo (categoria) de uma vez — "Biblioteca
// de modelos prontos" (Experiência do Cliente, bloco 2). Cada tarefa do
// modelo já é um template normal (mesma tabela "templates"); "modelo" aqui
// é só o agrupamento por categoria pra aplicar tudo junto.
exports.aplicarModelo = async (req, res) => {
  try {
    const { categoria, loja_id } = req.body
    if (!categoria) return res.status(400).json({ erro: 'Informe a categoria do modelo' })
    const { lojaPertenceAConta, getAdminId } = require('../helpers/adminLojas')
    if (!(await lojaPertenceAConta(loja_id, req.userId, req.userPerfil))) {
      return res.status(404).json({ erro: 'Loja não encontrada' })
    }
    const templates = await query('SELECT * FROM templates WHERE categoria = ? AND ativo = 1', [categoria])
    if (templates.length === 0) return res.status(404).json({ erro: 'Modelo não encontrado' })
    const ids = []
    for (const t of templates) {
      ids.push(await criarChecklistDeTemplate(t, loja_id, req.userId))
    }
    const { marcarPasso } = require('../helpers/onboarding')
    const adminId = await getAdminId(req.userId, req.userPerfil)
    await marcarPasso(adminId, 'passo_tarefa')
    res.json({ ids, message: `${ids.length} tarefa(s) criada(s) a partir do modelo!` })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
