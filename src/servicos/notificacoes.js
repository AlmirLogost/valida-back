// Notificações da unidade (§18), disparadas pelo servidor a cada minuto:
//   hora     no horário da tarefa (ou antes_min antes) → a pessoa
//   repetir  a cada repetir_min depois do horário, enquanto atrasada → a pessoa
//   atraso   passou da tolerância (avisar_atraso) → gerente da unidade e admins
//   acao     ação nova → responsável
//   vencida  ação com prazo vencido → admins
//   resumo   22 h, WhatsApp SIMULADO, só o que ficou pendente → admins e gerentes,
//            cada um só das suas unidades, com opção de desligar
// "push" desligado na unidade = nenhum aviso por push dela. Cada aviso tem uma
// chave única (notificacoes_enviadas): reservar a chave é o que autoriza enviar,
// então nunca sai duas vezes, nem com dois servidores.
const db = require('../db')
const tempo = require('../lib/tempo')
const push = require('../lib/push')
const agenda = require('./agenda')
const { enviar } = require('../lib/envio')

const MIN = 60000
const JANELA = 30 * MIN   // não avisa coisa antiga (servidor que ficou parado)
const hm = (h) => String(h).slice(0, 5)
const primeiro = (n) => String(n || '').split(' ')[0]

// O que deveria ser avisado agora (sem enviar nem gravar nada).
async function candidatas(unidade, agora) {
  const cfg = await db.um('SELECT * FROM config_notificacoes WHERE unidade_id = $1', [unidade.id])
  if (!cfg || !cfg.push) return []
  const out = []
  const admins = (await db.q('SELECT id FROM admins WHERE empresa_id = $1 ORDER BY id', [unidade.empresa_id])).map((a) => ({ tipo: 'admin', id: a.id }))
  const ex = await db.q(
    `SELECT e.id, e.data, e.hora_prevista, e.colaborador_id, t.titulo, t.nf_min, c.nome,
            COALESCE(t.tolerancia_min, (emp.config->>'tol_atraso_min')::int, 10) AS tol
     FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id JOIN empresas emp ON emp.id = e.empresa_id
     WHERE e.unidade_id = $1 AND e.data = $2 AND e.estado = 'a_fazer' AND t.pai_id IS NULL AND e.hora_prevista IS NOT NULL
       AND c.situacao = 'ativo' AND c.excluido_em IS NULL ORDER BY e.hora_prevista, e.id`, [unidade.id, tempo.hoje(unidade.fuso, agora)])
  for (const e of ex) {
    const hora = tempo.momento(e.data, hm(e.hora_prevista), unidade.fuso)
    const atraso = new Date(hora.getTime() + e.tol * MIN)
    const limite = agenda.limiteDe(e, e, unidade.fuso)
    if (agora > limite) continue
    const pessoa = { tipo: 'colaborador', id: e.colaborador_id }
    const aviso = new Date(hora.getTime() - (cfg.antes_min || 0) * MIN)
    // No horário (ou antes): até virar atraso.
    if (agora >= aviso && agora <= atraso) {
      const falta = Math.ceil((hora - agora) / MIN)
      out.push({ chave: `hora:${e.id}`, tipo: 'hora', dono: pessoa, titulo: 'Hora da tarefa', corpo: `${e.titulo} · ${hm(e.hora_prevista)}${falta > 0 ? ` (em ${falta} min)` : ''}`, aba: 'hoje' })
    }
    if (agora > atraso) {
      // Lembrete repetido: um por intervalo (só o último, se o servidor ficou parado).
      const n = cfg.repetir_min ? Math.floor((agora - hora) / (cfg.repetir_min * MIN)) : 0
      if (n >= 1) out.push({ chave: `rep:${e.id}:${cfg.repetir_min}:${n}`, tipo: 'repetir', dono: pessoa, titulo: 'Tarefa atrasada', corpo: `${e.titulo} · era às ${hm(e.hora_prevista)}`, aba: 'hoje', agrupa: 'atrasadas' })
      if (cfg.avisar_atraso && agora - atraso <= JANELA) {
        const g = await agenda.responsavel(db, unidade, e.colaborador_id)
        const donos = [...(g.id ? [g] : []), ...admins].filter((d, i, l) => l.findIndex((x) => x.tipo === d.tipo && x.id === d.id) === i)
        for (const d of donos) out.push({ chave: `atraso:${e.id}:${d.tipo}:${d.id}`, tipo: 'atraso', dono: d, titulo: 'Tarefa atrasada', corpo: `${e.titulo} · ${primeiro(e.nome)} · ${unidade.nome}`, aba: 'conf', agrupa: 'atrasadas' })
      }
    }
  }
  const desde = new Date(agora.getTime() - JANELA)
  const acoes = await db.q(
    `SELECT a.id, a.motivo, a.aberta_em, a.prazo_ate, a.responsavel_tipo, a.responsavel_id, t.titulo, c.nome
     FROM acoes a JOIN execucoes e ON e.id = a.execucao_id JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id
     WHERE a.unidade_id = $1 AND a.estado = 'aberta' AND (a.aberta_em BETWEEN $2 AND $3 OR a.prazo_ate BETWEEN $2 AND $3) ORDER BY a.id`, [unidade.id, desde, agora])
  for (const a of acoes) {
    if (a.aberta_em >= desde && a.aberta_em <= agora && a.responsavel_id) {
      out.push({ chave: `acao:${a.id}:${a.responsavel_tipo}:${a.responsavel_id}`, tipo: 'acao', dono: { tipo: a.responsavel_tipo, id: a.responsavel_id }, titulo: 'Ação para resolver', corpo: `${a.titulo} · ${primeiro(a.nome)} · ${a.motivo || ''}`, aba: 'acoes', agrupa: 'acoes' })
    }
    if (a.prazo_ate && a.prazo_ate >= desde && a.prazo_ate < agora) {
      for (const d of admins) out.push({ chave: `vencida:${a.id}:${d.tipo}:${d.id}`, tipo: 'vencida', dono: d, titulo: 'Prazo vencido', corpo: `${a.titulo} · ${primeiro(a.nome)} · ${unidade.nome}`, aba: 'acoes', agrupa: 'vencidas' })
    }
  }
  return out.map((x) => ({ ...x, som: cfg.som, vibrar: cfg.vibrar }))
}

async function reservar(unidade, x) {
  return db.um(
    `INSERT INTO notificacoes_enviadas (empresa_id, unidade_id, chave, tipo, dono_tipo, dono_id) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (chave) DO NOTHING RETURNING id`, [unidade.empresa_id, unidade.id, x.chave, x.tipo, x.dono.tipo, x.dono.id])
}

const JUNTOS = { atrasadas: (n) => `${n} tarefas atrasadas`, acoes: (n) => `${n} ações para resolver`, vencidas: (n) => `${n} ações com prazo vencido` }

async function avisarUnidade(unidade, agora) {
  if (!push.podeEnviar()) return 0
  // Quem não tem aparelho inscrito não gasta reserva.
  const grupos = new Map(), temAparelho = new Map()
  for (const x of await candidatas(unidade, agora)) {
    const dk = `${x.dono.tipo}:${x.dono.id}`
    if (!temAparelho.has(dk)) temAparelho.set(dk, (await push.aparelhos(x.dono.tipo, x.dono.id)).length > 0)
    if (!temAparelho.get(dk)) continue
    const r = await reservar(unidade, x)
    if (!r) continue
    const k = x.agrupa ? `${dk}:${x.tipo}` : x.chave
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push({ ...x, id: r.id })
  }
  let n = 0
  for (const l of grupos.values()) {
    const x = l[0]
    const msg = l.length === 1
      ? { titulo: x.titulo, corpo: x.corpo }
      : { titulo: JUNTOS[x.agrupa](l.length), corpo: l.slice(0, 3).map((y) => y.corpo.split(' · ')[0]).join(', ') + (l.length > 3 ? ` e mais ${l.length - 3}` : '') }
    const s = await push.paraDono(x.dono.tipo, x.dono.id, { ...msg, aba: x.aba, tag: l.length === 1 ? x.chave : `${x.tipo}:${unidade.id}`, som: x.som, vibrar: x.vibrar })
    await db.exec('UPDATE notificacoes_enviadas SET aparelhos = $2, entregues = $3 WHERE id = ANY($1)', [l.map((y) => y.id), s.aparelhos, s.entregues])
    n++
  }
  return n
}

// Resumo das 22 h no WhatsApp: SIMULADO (cai na caixa local de lib/envio.js).
// Um por pessoa: admins (todas as unidades da empresa) e gerentes (só as deles),
// das unidades com o resumo ligado e algo pendente. Cada um pode desligar o seu.
async function resumos(agora, soEmpresa = null) {
  const us = await db.q(
    `SELECT u.* FROM unidades u JOIN empresas e ON e.id = u.empresa_id JOIN config_notificacoes cn ON cn.unidade_id = u.id
     WHERE u.arquivado_em IS NULL AND e.situacao <> 'bloqueada' AND cn.resumo_whatsapp AND ($1::bigint IS NULL OR u.empresa_id = $1) ORDER BY u.nome, u.id`, [soEmpresa])
  const porPessoa = new Map()
  for (const u of us) {
    const hora = tempo.minutos(tempo.horaAgora(u.fuso, agora))
    if (hora < 22 * 60 || hora >= 22 * 60 + 30) continue
    const hoje = tempo.hoje(u.fuso, agora)
    const pend = await db.q(
      `SELECT t.titulo, c.nome FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id
       WHERE e.unidade_id = $1 AND e.data = $2 AND e.estado IN ('a_fazer', 'nao_feita') AND t.pai_id IS NULL ORDER BY c.nome, e.hora_prevista`, [u.id, hoje])
    if (!pend.length) continue
    const quem = [
      ...(await db.q('SELECT id, celular FROM admins WHERE empresa_id = $1 AND resumo_whatsapp AND celular IS NOT NULL', [u.empresa_id])).map((x) => ({ ...x, tipo: 'admin' })),
      ...(await db.q(
        `SELECT c.id, c.celular FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id JOIN perfis_acesso pa ON pa.id = COALESCE(c.perfil_acesso_id, cg.perfil_acesso_id)
         WHERE c.empresa_id = $1 AND c.situacao = 'ativo' AND c.excluido_em IS NULL AND c.resumo_whatsapp AND c.celular IS NOT NULL AND ${agenda.EH_GERENTE}
           AND EXISTS (SELECT 1 FROM colaborador_unidades cu WHERE cu.colaborador_id = c.id AND cu.unidade_id = $2)`, [u.empresa_id, u.id])).map((x) => ({ ...x, tipo: 'colaborador' }))
    ]
    for (const p of quem) {
      const k = `resumo:${p.tipo}:${p.id}:${hoje}:${u.fuso}`
      if (!porPessoa.has(k)) porPessoa.set(k, { ...p, u, n: 0, partes: [] })
      const x = porPessoa.get(k)
      x.n += pend.length
      x.partes.push(`${u.nome}: ${pend.length} ${pend.length > 1 ? 'pendentes' : 'pendente'}\n` + pend.map((y) => `• ${y.titulo} (${primeiro(y.nome)})`).join('\n'))
    }
  }
  let n = 0
  for (const [chave, x] of porPessoa) {
    if (!await reservar(x.u, { chave, tipo: 'resumo', dono: { tipo: x.tipo, id: x.id } })) continue
    await enviar({ canal: 'whatsapp', destino: x.celular, assunto: `Resumo do dia (${x.n} ${x.n > 1 ? 'pendentes' : 'pendente'})`, texto: x.partes.join('\n\n') })
    n++
  }
  return n
}

async function rodada(agora = tempo.agora()) {
  const us = await db.q(
    `SELECT u.* FROM unidades u JOIN empresas e ON e.id = u.empresa_id WHERE u.arquivado_em IS NULL AND e.situacao <> 'bloqueada' ORDER BY u.id`)
  let avisos = 0
  for (const u of us) {
    try { avisos += await avisarUnidade(u, agora) } catch (e) { console.error(`[avisos] unidade ${u.id}: código ${e.code || '-'} ${String(e.message).split('\n')[0]}`) }
  }
  let enviados = 0
  try { enviados = await resumos(agora) } catch (e) { console.error(`[resumo] código ${e.code || '-'} ${String(e.message).split('\n')[0]}`) }
  return { avisos, resumos: enviados }
}

module.exports = { candidatas, avisarUnidade, resumos, rodada }
