// Rotas da Etapa 1B: execuções, ações, fotos, bônus, relatórios e exportação.
const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('../db')
const config = require('../config')
const v = require('../lib/validar')
const tempo = require('../lib/tempo')
const agenda = require('../servicos/agenda')
const exec = require('../servicos/execucao')
const bonus = require('../servicos/bonus')
const buscar = require('../servicos/buscar')
const { registrar } = require('../lib/registro')
const { tem, exigir, conferirUnidade } = require('../auth/sessao')
const { invalido, proibido, naoEncontrado, conflito } = require('../lib/erros')
const pedidos = require('../pedidos/servico')

const r = express.Router()

const CAMPOS = `e.id, e.tarefa_id, e.colaborador_id, e.unidade_id, e.data, e.hora_prevista, e.estado, e.motivo_dispensa,
  e.feita_em, e.recebida_em, e.resposta_texto, e.resposta_num, e.resposta_fora, e.foto_id, e.conferencia, e.conferencia_motivo,
  e.conferida_por, e.conferida_por_tipo, e.conferida_em, e.desfeita_por, e.desfeita_por_tipo, e.desfeita_em, e.diferenca_relogio_s,
  t.titulo, t.porque, t.tipo_resposta, t.pede_foto, t.pai_id, t.nf_min, t.tolerancia_min, t.faixa_min, t.faixa_max, t.unidade_medida, t.opcoes,
  t.recorrencia, t.hora_fim, t.valor_feita, t.valor_nao_feita,
  c.nome AS colaborador_nome, u.fuso, (emp.config->>'tol_atraso_min')::int AS tol_empresa,
  (SELECT json_build_object('estado', a.estado, 'tipo', a.tipo, 'prazo_ate', a.prazo_ate,
     'responsavel', CASE a.responsavel_tipo WHEN 'admin' THEN (SELECT nome FROM admins WHERE id = a.responsavel_id)
                    ELSE (SELECT nome FROM colaboradores WHERE id = a.responsavel_id) END,
     'resolvida_por', CASE a.resolvida_por_tipo WHEN 'admin' THEN (SELECT nome FROM admins WHERE id = a.resolvida_por)
                    ELSE (SELECT nome FROM colaboradores WHERE id = a.resolvida_por) END)
   FROM acoes a WHERE a.execucao_id = e.id ORDER BY a.id DESC LIMIT 1) AS acao`

function enfeitar(lista, agora = tempo.agora()) {
  return lista.map((e) => {
    const tol = e.tolerancia_min ?? e.tol_empresa ?? 10
    const limite = agenda.limiteDe(e, e, e.fuso)
    const { fuso, tol_empresa, ...resto } = e
    return {
      ...resto,
      atrasada: exec.atrasada(e, tol, e.fuso, agora),
      vence_em: limite,
      pode_concluir: e.estado === 'a_fazer' && agora <= limite,
      relogio_suspeito: e.diferenca_relogio_s !== null && Math.abs(e.diferenca_relogio_s) > config.relogioAlertaS
    }
  })
}

// Gera o dia sob demanda (além do agendador) ao abrir a lista de hoje.
async function garantirDia(unidadeId) {
  await db.tx((x) => agenda.processarUnidade(x, unidadeId))
}

// Minhas tarefas (operador): hoje, ou ?data=.
r.get('/minhas-tarefas', async (req, res) => {
  if (req.ator.tipo !== 'colaborador') throw proibido('O admin não executa tarefas.')
  const data = v.data(req.query.data, 'a data') || null
  for (const u of req.acesso.unidades) await garantirDia(u)
  const lista = await db.q(
    `SELECT ${CAMPOS} FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id
     JOIN unidades u ON u.id = e.unidade_id JOIN empresas emp ON emp.id = e.empresa_id
     WHERE e.colaborador_id = $1 AND e.data = COALESCE($2::date, (now() AT TIME ZONE u.fuso)::date)
     ORDER BY e.hora_prevista NULLS LAST, t.pai_id NULLS FIRST, t.ordem, e.id`, [req.ator.id, data])
  res.json(enfeitar(lista))
})

// Histórico da própria pessoa (§13): dias anteriores, com "hist".
// "atrasada" = feita depois do horário + tolerância.
r.get('/meu-historico', async (req, res) => {
  if (req.ator.tipo !== 'colaborador') throw proibido('O admin não tem histórico de tarefas.')
  if (!tem(req, 'hist')) throw proibido('Sem a permissão "Ver o próprio histórico".')
  const de = v.data(req.query.de, 'o início', { obrigatorio: true })
  const ate = v.data(req.query.ate, 'o fim', { obrigatorio: true })
  if (ate < de) throw invalido('O fim precisa ser depois do início.')
  const lista = await db.q(
    `SELECT e.id, e.data, e.hora_prevista, e.estado, e.feita_em, e.foto_id, e.resposta_fora, t.titulo, t.pede_foto, t.valor_feita,
            (e.estado = 'feita' AND e.hora_prevista IS NOT NULL AND e.feita_em >
              ((e.data + e.hora_prevista) AT TIME ZONE u.fuso) + make_interval(mins => COALESCE(t.tolerancia_min, (emp.config->>'tol_atraso_min')::int, 10))) AS atrasada
     FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN unidades u ON u.id = e.unidade_id JOIN empresas emp ON emp.id = e.empresa_id
     WHERE e.colaborador_id = $1 AND e.data BETWEEN $2 AND $3 AND t.pai_id IS NULL AND e.estado IN ('feita', 'nao_feita', 'na', 'a_fazer')
     ORDER BY e.data DESC, e.hora_prevista NULLS LAST, e.id`, [req.ator.id, de, ate])
  res.json(lista)
})

// Pedido de liberação feito pelo Início (§10): vale para a próxima entrada
// fora do local (até 24 h depois de aprovado). Precisa de "pedlib".
r.post('/liberacao', async (req, res) => {
  if (req.ator.tipo !== 'colaborador') throw proibido()
  if (!tem(req, 'pedlib')) throw proibido('Sem a permissão "Pedir liberação".')
  const motivo = v.umDe(req.body.motivo, 'o motivo', ['cheguei_antes', 'cobrir_outra_unidade', 'gps_nao_achou', 'outro'], { obrigatorio: true })
  const motivoTexto = motivo === 'outro' ? v.texto(req.body.motivo_texto, 'o motivo', { obrigatorio: true, max: 140 }) : null
  const me = await db.um('SELECT c.unidade_principal_id, u.nome, u.lat, u.lng, u.raio_m FROM colaboradores c JOIN unidades u ON u.id = c.unidade_principal_id WHERE c.id = $1', [req.ator.id])
  let distancia = null
  if (req.body.lat != null && req.body.lng != null && me.lat != null) {
    const { distanciaM } = require('../lib/geo')
    distancia = distanciaM(v.numero(req.body.lat, 'a latitude', { min: -90, max: 90 }), v.numero(req.body.lng, 'a longitude', { min: -180, max: 180 }), me.lat, me.lng)
  }
  const pendente = await db.um(`SELECT id FROM pedidos WHERE empresa_id = $1 AND tipo = 'lib' AND estado = 'pend' AND solicitante_tipo = 'colaborador' AND solicitante_id = $2`, [req.ator.empresaId, req.ator.id])
  if (pendente) throw conflito('Você já tem um pedido de liberação aguardando.')
  const TXT = { cheguei_antes: 'cheguei antes', cobrir_outra_unidade: 'vou cobrir outra unidade', gps_nao_achou: 'o GPS não achou o local' }
  const pedido = await pedidos.criarPedido(db, req.ator, 'lib', {
    unidadeId: me.unidade_principal_id,
    titulo: `Liberação de login · ${req.ator.nome}`,
    detalhe: `${me.nome}${distancia !== null ? ` · a ${distancia} m (raio ${me.raio_m} m)` : ''} · motivo: ${motivoTexto || TXT[motivo]}`,
    payload: { colaborador_id: req.ator.id, unidade_id: me.unidade_principal_id, motivo, motivo_texto: motivoTexto, distancia_m: distancia }
  })
  res.status(201).json({ ok: true, pedido })
})

// Conferência: execuções da unidade num dia ou intervalo (precisa de "ver"; sem ele, só as próprias).
r.get('/execucoes', async (req, res) => {
  const unidadeId = v.id(req.query.unidade_id, 'a unidade')
  conferirUnidade(req, unidadeId)
  const u = await buscar.unidade(db, req.ator.empresaId, unidadeId)
  const hoje = tempo.hoje(u.fuso)
  const de = v.data(req.query.de, 'o início') || hoje
  const ate = v.data(req.query.ate, 'o fim') || de
  if (ate < de) throw invalido('O fim precisa ser depois do início.')
  if (de <= hoje && hoje <= ate) await garantirDia(unidadeId)
  const soMinhas = !tem(req, 'ver')
  const pessoa = v.inteiro(req.query.colaborador_id, 'a pessoa', { min: 1 })
  const lista = await db.q(
    `SELECT ${CAMPOS} FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id
     JOIN unidades u ON u.id = e.unidade_id JOIN empresas emp ON emp.id = e.empresa_id
     WHERE e.empresa_id = $1 AND e.unidade_id = $2 AND e.data BETWEEN $3 AND $4
       AND ($5::bigint IS NULL OR e.colaborador_id = $5) AND ($6 = false OR e.colaborador_id = $7)
     ORDER BY e.data, e.hora_prevista NULLS LAST, e.id`,
    [req.ator.empresaId, unidadeId, de, ate, pessoa, soMinhas, req.ator.tipo === 'colaborador' ? req.ator.id : 0])
  res.json(enfeitar(lista))
})

r.post('/execucoes/:id/concluir', async (req, res) => {
  const out = await exec.concluir(req, v.id(req.params.id), req.body || {})
  res.status(out.status).json(out.corpo)
})
r.post('/execucoes/:id/conferir', async (req, res) => res.json(await exec.conferir(req, v.id(req.params.id), req.body || {})))
r.post('/execucoes/:id/desfazer', async (req, res) => res.json(await exec.desfazer(req, v.id(req.params.id))))

// ---- Ações ------------------------------------------------------------------
r.get('/acoes', exigir('conf'), async (req, res) => {
  const unidadeId = v.inteiro(req.query.unidade_id, 'a unidade', { min: 1 })
  if (unidadeId) conferirUnidade(req, unidadeId)
  const estado = v.umDe(req.query.estado ?? 'aberta', 'o estado', ['aberta', 'resolvida'])
  const unidades = unidadeId ? [unidadeId] : [...req.acesso.unidades]
  const lista = await db.q(
    `SELECT a.*, (a.estado = 'aberta' AND a.prazo_ate < $4) AS prazo_vencido,
            e.colaborador_id, c.nome AS colaborador_nome, cg.perfil AS colaborador_perfil, t.titulo AS tarefa_titulo, e.data,
            CASE a.responsavel_tipo WHEN 'admin' THEN 'Admin' ELSE (SELECT split_part(r.nome, ' ', 1) FROM colaboradores r WHERE r.id = a.responsavel_id) END AS responsavel_nome,
            (SELECT nome FROM colaboradores r WHERE r.id = a.resolvida_por AND a.resolvida_por_tipo = 'colaborador'
             UNION ALL SELECT split_part(nome, ' ', 1) FROM admins d WHERE d.id = a.resolvida_por AND a.resolvida_por_tipo = 'admin' LIMIT 1) AS resolvida_por_nome,
            (a.resolvida_em > a.prazo_ate) AS resolvida_fora_do_prazo
     FROM acoes a JOIN execucoes e ON e.id = a.execucao_id JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id
     JOIN cargos cg ON cg.id = c.cargo_id
     WHERE a.empresa_id = $1 AND a.unidade_id = ANY($2) AND a.estado = $3
     ORDER BY ${estado === 'aberta' ? 'a.prazo_ate' : 'a.resolvida_em DESC'}`, [req.ator.empresaId, unidades, estado, tempo.agora()])
  res.json(lista)
})

r.post('/acoes/:id/resolver', exigir('conf'), async (req, res) => {
  const a = await db.um('SELECT * FROM acoes WHERE id = $1 AND empresa_id = $2', [v.id(req.params.id), req.ator.empresaId])
  if (!a) throw naoEncontrado()
  conferirUnidade(req, a.unidade_id)
  if (a.estado !== 'aberta') throw conflito('Essa ação já foi resolvida.')
  const solucao = v.texto(req.body.solucao, 'o que foi feito', { obrigatorio: true, max: 1000 })
  let fotoId = null
  if (req.body.foto_id !== undefined && req.body.foto_id !== null) {
    fotoId = v.id(req.body.foto_id, 'a foto')
    const f = await db.um(`SELECT 1 FROM fotos WHERE id = $1 AND empresa_id = $2 AND criado_por_tipo = $3 AND criado_por = $4`,
      [fotoId, req.ator.empresaId, req.ator.tipo, req.ator.id])
    if (!f) throw invalido('Foto inválida.')
  }
  await db.tx(async (x) => {
    await x.exec(
      `UPDATE acoes SET estado = 'resolvida', solucao = $2, foto_id = $3, resolvida_por = $4, resolvida_por_tipo = $5, resolvida_em = now() WHERE id = $1`,
      [a.id, solucao, fotoId, req.ator.id, req.ator.tipo])
    await registrar(x, { empresaId: req.ator.empresaId, unidadeId: a.unidade_id, ator: req.ator, acao: 'acao.resolvida', entidade: 'acao', entidadeId: a.id, detalhe: { solucao } })
  })
  res.json({ ok: true })
})

// ---- Fotos ------------------------------------------------------------------
const TIPOS = {
  'image/jpeg': { ext: 'jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', confere: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', confere: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' }
}

// Upload: corpo binário (Content-Type image/jpeg|png|webp), até FOTO_MAX_MB.
r.post('/fotos', express.raw({ type: Object.keys(TIPOS), limit: `${config.fotoMaxMb}mb` }), async (req, res) => {
  if (!req.acesso.admin && !tem(req, 'foto') && !tem(req, 'conf')) throw proibido('Sem a permissão "Enviar foto".')
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim()
  const tipo = TIPOS[mime]
  if (!tipo || !Buffer.isBuffer(req.body) || req.body.length < 16) throw invalido('Envie uma imagem JPEG, PNG ou WEBP.')
  if (!tipo.confere(req.body)) throw invalido('O arquivo não é uma imagem válida.')
  const sha = crypto.createHash('sha256').update(req.body).digest('hex')
  const relativo = path.join(String(req.ator.empresaId), tempo.hoje().slice(0, 7), `${sha}.${tipo.ext}`)
  const absoluto = path.join(config.fotosDir, relativo)
  fs.mkdirSync(path.dirname(absoluto), { recursive: true, mode: 0o700 })
  if (!fs.existsSync(absoluto)) {
    const tmp = `${absoluto}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, req.body, { mode: 0o600 })
    fs.renameSync(tmp, absoluto)
  }
  const f = await db.um(
    `INSERT INTO fotos (empresa_id, caminho, tamanho, mime, sha256, criado_por_tipo, criado_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.ator.empresaId, relativo, req.body.length, mime, sha, req.ator.tipo, req.ator.id])
  res.status(201).json({ foto_id: f.id, tamanho: req.body.length })
})

// Ver foto: só a empresa; dentro dela, quem enviou, o admin ou quem vê a equipe da unidade.
r.get('/fotos/:id', async (req, res) => {
  const f = await db.um('SELECT * FROM fotos WHERE id = $1 AND empresa_id = $2', [v.id(req.params.id), req.ator.empresaId])
  if (!f) throw naoEncontrado()
  if (!req.acesso.admin && !(f.criado_por_tipo === req.ator.tipo && f.criado_por === req.ator.id)) {
    const ligada = await db.um(
      `SELECT unidade_id FROM execucoes WHERE foto_id = $1 UNION SELECT unidade_id FROM acoes WHERE foto_id = $1 LIMIT 1`, [f.id])
    if (!ligada || !tem(req, 'ver') || !req.acesso.unidades.has(ligada.unidade_id)) throw naoEncontrado()
  }
  const absoluto = path.join(config.fotosDir, f.caminho)
  if (!absoluto.startsWith(path.resolve(config.fotosDir) + path.sep) || !fs.existsSync(absoluto)) throw naoEncontrado()
  res.setHeader('Content-Type', f.mime)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(absoluto).pipe(res)
})

// ---- Bônus ------------------------------------------------------------------
function periodo(req) {
  if (req.query.de || req.query.ate) {
    const de = v.data(req.query.de, 'o início', { obrigatorio: true })
    const ate = v.data(req.query.ate, 'o fim', { obrigatorio: true })
    if (ate < de) throw invalido('O fim precisa ser depois do início.')
    return { de, ate }
  }
  const mes = req.query.mes || tempo.hoje().slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw invalido('Mês no formato AAAA-MM.')
  return bonus.periodoDoMes(mes)
}

r.get('/bonus/colaboradores/:id', async (req, res) => {
  const p = await buscar.colaborador(db, req.ator.empresaId, v.id(req.params.id))
  const propria = req.ator.tipo === 'colaborador' && p.id === req.ator.id
  // Fora do alcance → 404 (antes de olhar a permissão, para não revelar que existe).
  if (!propria) conferirUnidade(req, p.unidade_principal_id)
  if (propria ? !tem(req, 'own') : !tem(req, 'premio')) throw proibido()
  const { de, ate } = periodo(req)
  res.json({ colaborador_id: p.id, nome: p.nome, ...(await bonus.calcular(db, p.id, de, ate)) })
})

r.get('/bonus/unidades/:id', exigir('premio'), async (req, res) => {
  const u = await buscar.unidade(db, req.ator.empresaId, v.id(req.params.id))
  conferirUnidade(req, u.id)
  const { de, ate } = periodo(req)
  const pessoas = await db.q(`SELECT id, nome FROM colaboradores WHERE unidade_principal_id = $1 AND excluido_em IS NULL AND situacao <> 'aguardando' ORDER BY nome`, [u.id])
  const lista = []
  for (const p of pessoas) lista.push({ colaborador_id: p.id, nome: p.nome, ...(await bonus.calcular(db, p.id, de, ate, tempo.agora(), u.fuso)) })
  const soma = (k) => Math.round(lista.reduce((s, x) => s + x[k], 0) * 100) / 100
  res.json({ unidade_id: u.id, de, ate, pessoas: lista, total: { bruto: soma('bruto'), descontos: soma('descontos'), atrasos: soma('atrasos'), liquido: soma('liquido') } })
})

// ---- Relatórios (§17) e exportação ------------------------------------------
async function dadosRelatorio(req) {
  const unidadeId = v.inteiro(req.query.unidade_id, 'a unidade', { min: 1 })
  if (unidadeId) conferirUnidade(req, unidadeId)
  const { de, ate } = periodo(req)
  const unidades = unidadeId ? [unidadeId] : [...req.acesso.unidades]
  const base = `FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id
    WHERE e.empresa_id = $1 AND e.unidade_id = ANY($2) AND e.data BETWEEN $3 AND $4 AND t.pai_id IS NULL AND e.estado IN ('feita', 'nao_feita')`
  const p = [req.ator.empresaId, unidades, de, ate]
  const cont = `COUNT(*) FILTER (WHERE e.estado = 'feita')::int AS feitas, COUNT(*) FILTER (WHERE e.estado = 'nao_feita')::int AS nao_feitas`
  const resumo = await db.um(`SELECT ${cont} ${base}`, p)
  const pct = (x) => (x.feitas + x.nao_feitas ? Math.round((100 * x.feitas) / (x.feitas + x.nao_feitas)) : null)
  return {
    de, ate, unidades,
    resumo: { ...resumo, percentual: pct(resumo) },
    dia_a_dia: (await db.q(`SELECT e.data, ${cont} ${base} GROUP BY e.data ORDER BY e.data`, p)).map((x) => ({ ...x, percentual: pct(x) })),
    pessoas: (await db.q(`SELECT e.colaborador_id, c.nome, ${cont} ${base} GROUP BY e.colaborador_id, c.nome ORDER BY c.nome`, p)).map((x) => ({ ...x, percentual: pct(x) })),
    tarefas: (await db.q(`SELECT e.tarefa_id, t.titulo, ${cont} ${base} GROUP BY e.tarefa_id, t.titulo ORDER BY t.titulo`, p)).map((x) => ({ ...x, percentual: pct(x) }))
  }
}

r.get('/relatorios', exigir('rel'), async (req, res) => res.json(await dadosRelatorio(req)))

// CSV (separador ";" e BOM, abre direto no Excel). xlsx precisaria de biblioteca nova.
function csv(linhas, colunas) {
  const esc = (x) => {
    if (x === null || x === undefined) return ''
    const s = x instanceof Date ? x.toISOString() : typeof x === 'object' ? JSON.stringify(x) : String(x)
    return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => esc(l[c])).join(';'))].join('\r\n')
}

r.get('/relatorios/exportar', exigir('exp'), async (req, res) => {
  const conteudo = v.umDe(req.query.conteudo ?? 'execucoes', 'o conteúdo', ['execucoes', 'pessoas', 'tarefas', 'bonus', 'registro'])
  const formato = v.umDe(req.query.formato ?? 'csv', 'o formato', ['csv', 'xlsx'])
  if (formato === 'xlsx') throw invalido('Por enquanto a exportação é em CSV (abre no Excel).')
  const unidadeId = v.inteiro(req.query.unidade_id, 'a unidade', { min: 1 })
  if (unidadeId) conferirUnidade(req, unidadeId)
  const unidades = unidadeId ? [unidadeId] : [...req.acesso.unidades]
  const { de, ate } = periodo(req)
  let linhas, colunas
  if (conteudo === 'execucoes') {
    colunas = ['data', 'hora_prevista', 'unidade', 'pessoa', 'tarefa', 'estado', 'feita_em', 'resposta_texto', 'resposta_num', 'fora', 'conferencia']
    linhas = await db.q(
      `SELECT e.data, e.hora_prevista, u.nome AS unidade, c.nome AS pessoa, t.titulo AS tarefa, e.estado, e.feita_em, e.resposta_texto,
              e.resposta_num, e.resposta_fora AS fora, e.conferencia
       FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id JOIN unidades u ON u.id = e.unidade_id
       WHERE e.empresa_id = $1 AND e.unidade_id = ANY($2) AND e.data BETWEEN $3 AND $4 ORDER BY e.data, e.hora_prevista`,
      [req.ator.empresaId, unidades, de, ate])
  } else if (conteudo === 'pessoas') {
    colunas = ['nome', 'celular', 'unidade', 'cargo', 'perfil', 'situacao']
    linhas = await db.q(
      `SELECT c.nome, c.celular, u.nome AS unidade, cg.nome AS cargo, cg.perfil, c.situacao
       FROM colaboradores c JOIN unidades u ON u.id = c.unidade_principal_id JOIN cargos cg ON cg.id = c.cargo_id
       WHERE c.empresa_id = $1 AND c.unidade_principal_id = ANY($2) AND c.excluido_em IS NULL ORDER BY u.nome, c.nome`,
      [req.ator.empresaId, unidades])
  } else if (conteudo === 'tarefas') {
    colunas = ['unidade', 'titulo', 'pessoa_ou_cargo', 'recorrencia', 'hora_ini', 'hora_fim', 'tipo_resposta', 'ativa']
    linhas = await db.q(
      `SELECT u.nome AS unidade, t.titulo, COALESCE(c.nome, cg.nome) AS pessoa_ou_cargo, t.recorrencia, t.hora_ini, t.hora_fim, t.tipo_resposta, t.ativa
       FROM tarefas t JOIN unidades u ON u.id = t.unidade_id LEFT JOIN colaboradores c ON c.id = t.colaborador_id LEFT JOIN cargos cg ON cg.id = t.cargo_id
       WHERE t.empresa_id = $1 AND t.unidade_id = ANY($2) AND t.arquivado_em IS NULL AND t.pai_id IS NULL ORDER BY u.nome, t.hora_ini`,
      [req.ator.empresaId, unidades])
  } else if (conteudo === 'bonus') {
    if (!tem(req, 'premio')) throw proibido()
    colunas = ['pessoa', 'de', 'ate', 'bruto', 'descontos', 'atrasos', 'liquido', 'feitas', 'nao_feitas']
    const ps = await db.q(`SELECT id, nome FROM colaboradores WHERE empresa_id = $1 AND unidade_principal_id = ANY($2) AND excluido_em IS NULL ORDER BY nome`, [req.ator.empresaId, unidades])
    linhas = []
    for (const p of ps) linhas.push({ pessoa: p.nome, ...(await bonus.calcular(db, p.id, de, ate)) })
  } else {
    if (!tem(req, 'log')) throw proibido()
    colunas = ['em', 'quem_tipo', 'quem_nome', 'acao', 'entidade', 'entidade_id', 'detalhe']
    linhas = await db.q(
      `SELECT em, quem_tipo, quem_nome, acao, entidade, entidade_id, detalhe FROM registro_atividades
       WHERE empresa_id = $1 AND (unidade_id IS NULL OR unidade_id = ANY($2)) AND (em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $3 AND $4 ORDER BY em`,
      [req.ator.empresaId, unidades, de, ate])
  }
  await registrar(db, { empresaId: req.ator.empresaId, unidadeId: unidadeId || null, ator: req.ator, acao: 'dados.exportados', detalhe: { conteudo, de, ate } })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="valida_${conteudo}_${de}_${ate}.csv"`)
  res.send(csv(linhas, colunas))
})

module.exports = r
