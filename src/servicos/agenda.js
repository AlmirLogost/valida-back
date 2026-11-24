// Agendador (roteiro 1B item 2, §12, §15). Tudo recebe `agora` para os
// testes controlarem o relógio; em produção é a hora real do servidor.
//
// Por unidade, a cada rodada:
//   1. gera as execuções do dia (fuso da unidade) das tarefas que valem no
//      dia: tarefa de pessoa → 1 execução; tarefa de cargo → 1 para cada
//      pessoa ativa do cargo; sub-itens (pai_id) ganham a execução deles;
//   2. acerta os estados: dispensada em dia fechado (dia todo ou janela),
//      unidade fechada hoje ou dia sem funcionamento; cancelada se a tarefa
//      foi desativada/excluída ou a pessoa saiu; e volta para "a fazer" se a
//      causa sumiu (só mexe no que o próprio sistema marcou);
//   3. vence: passou de hora_prevista + nf_min sem fazer → nao_feita + ação "nf";
//   4. avisa o admin das ações com prazo vencido.
const db = require('../db')
const tempo = require('../lib/tempo')
const { registrar } = require('../lib/registro')
const { enviar } = require('../lib/envio')

const MOTIVOS_SISTEMA = ['unidade_fechada', 'dia_fechado', 'janela_fechada', 'fora_do_funcionamento', 'tarefa_desativada', 'pessoa_inativa']
const TRAVA = 7300112

// ---- regras de calendário ---------------------------------------------------
function tarefaValeNoDia(t, data) {
  if (t.valida_de && data < t.valida_de) return false
  if (t.valida_ate && data > t.valida_ate) return false
  switch (t.recorrencia) {
    case 'diario': return true
    case 'semanal': return (t.dias_semana || []).includes(tempo.diaDaSemana(data))
    case 'mensal': return Number(data.slice(8, 10)) === Math.min(t.dia_mes || 0, tempo.ultimoDiaDoMes(data))
    case 'pontual': return t.data_pontual === data
    default: return false
  }
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : null)

// Por que uma execução daquele dia não conta (ou null).
async function causasDoDia(dbx, unidade, data) {
  const fechadaHoje = unidade.aberta_hoje === false && unidade.aberta_hoje_data === data
  const dias = await dbx.q(
    `SELECT d.hora_ini, d.hora_fim FROM dias_fechados d
     WHERE d.empresa_id = $1
       AND (d.data = $3::date OR (d.repetir_anual AND to_char(d.data, 'MM-DD') = $4::text))
       AND (d.todas_unidades OR EXISTS (SELECT 1 FROM dias_fechados_unidades x WHERE x.dia_fechado_id = d.id AND x.unidade_id = $2))`,
    [unidade.empresa_id, unidade.id, data, data.slice(5, 10)])
  const turnos = await dbx.q('SELECT ativo FROM unidade_turnos WHERE unidade_id = $1 AND dia_semana = $2', [unidade.id, tempo.diaDaSemana(data)])
  const temHorario = (await dbx.um('SELECT 1 FROM unidade_turnos WHERE unidade_id = $1 LIMIT 1', [unidade.id])) !== null
  const semFuncionamento = temHorario && !turnos.some((x) => x.ativo)
  return (horaPrevista) => {
    if (fechadaHoje) return 'unidade_fechada'
    if (dias.some((d) => !d.hora_ini)) return 'dia_fechado'
    const h = hhmm(horaPrevista)
    if (h && dias.some((d) => d.hora_ini && h >= hhmm(d.hora_ini) && h < hhmm(d.hora_fim))) return 'janela_fechada'
    if (semFuncionamento) return 'fora_do_funcionamento'
    return null
  }
}

// Pessoas que recebem a tarefa no dia.
async function pessoasDaTarefa(dbx, t) {
  if (t.colaborador_id) {
    return dbx.q(
      `SELECT c.id FROM colaboradores c JOIN colaborador_unidades cu ON cu.colaborador_id = c.id AND cu.unidade_id = $2
       WHERE c.id = $1 AND c.situacao = 'ativo' AND c.excluido_em IS NULL`, [t.colaborador_id, t.unidade_id])
  }
  return dbx.q(
    `SELECT c.id FROM colaboradores c WHERE c.cargo_id = $1 AND c.situacao = 'ativo' AND c.excluido_em IS NULL`, [t.cargo_id])
}

// ---- 1. gerar ---------------------------------------------------------------
async function gerarDia(dbx, unidade, data) {
  const tarefas = await dbx.q(
    `SELECT * FROM tarefas WHERE unidade_id = $1 AND ativa AND arquivado_em IS NULL AND pai_id IS NULL`, [unidade.id])
  let criadas = 0
  for (const t of tarefas) {
    if (!tarefaValeNoDia(t, data)) continue
    const filhas = await dbx.q('SELECT * FROM tarefas WHERE pai_id = $1 AND ativa AND arquivado_em IS NULL ORDER BY ordem, id', [t.id])
    for (const p of await pessoasDaTarefa(dbx, t)) {
      for (const x of [t, ...filhas]) {
        const n = await dbx.exec(
          `INSERT INTO execucoes (empresa_id, tarefa_id, colaborador_id, unidade_id, data, hora_prevista, estado)
           VALUES ($1, $2, $3, $4, $5, $6, 'a_fazer')
           ON CONFLICT (tarefa_id, colaborador_id, data) WHERE legado_execucao_id IS NULL DO NOTHING`,
          [unidade.empresa_id, x.id, p.id, unidade.id, data, x.hora_ini || t.hora_ini])
        criadas += n
      }
    }
  }
  return criadas
}

// ---- 2. acertar estados -----------------------------------------------------
async function acertarEstados(dbx, unidade, data) {
  const causa = await causasDoDia(dbx, unidade, data)
  const execs = await dbx.q(
    `SELECT e.id, e.estado, e.motivo_dispensa, e.hora_prevista, t.ativa, t.arquivado_em, c.situacao, c.excluido_em
     FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id JOIN colaboradores c ON c.id = e.colaborador_id
     WHERE e.unidade_id = $1 AND e.data = $2 AND e.legado_execucao_id IS NULL
       AND (e.estado = 'a_fazer' OR (e.estado IN ('dispensada', 'cancelada') AND e.motivo_dispensa = ANY($3)))`,
    [unidade.id, data, MOTIVOS_SISTEMA])
  let mudadas = 0
  for (const e of execs) {
    let estado = 'a_fazer', motivo = null
    if (!e.ativa || e.arquivado_em) { estado = 'cancelada'; motivo = 'tarefa_desativada' }
    else if (e.situacao !== 'ativo' || e.excluido_em) { estado = 'cancelada'; motivo = 'pessoa_inativa' }
    else { const c = causa(e.hora_prevista); if (c) { estado = 'dispensada'; motivo = c } }
    if (estado !== e.estado || motivo !== e.motivo_dispensa) {
      mudadas += await dbx.exec(
        `UPDATE execucoes SET estado = $2, motivo_dispensa = $3 WHERE id = $1 AND estado = $4`, [e.id, estado, motivo, e.estado])
    }
  }
  return mudadas
}

// ---- 3. vencer e ações ------------------------------------------------------
function limiteDe(exec, tarefa, fuso) {
  const base = tempo.momento(exec.data, hhmm(exec.hora_prevista) || '23:59', fuso)
  return new Date(base.getTime() + (tarefa.nf_min || 120) * 60000)
}

function prazoDaAcao(abertaEm, prazoMin, fuso) {
  if (!prazoMin) return tempo.momento(tempo.hoje(fuso, abertaEm), '23:59', fuso) // "Fim do dia"
  return new Date(abertaEm.getTime() + prazoMin * 60000)
}

// Responsável: o gerente da unidade (Coordenação com perfil de Gerente);
// sem gerente, o admin. Nunca a própria pessoa da tarefa.
async function responsavel(dbx, unidade, colaboradorId) {
  const g = await dbx.um(
    `SELECT c.id FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id
     JOIN perfis_acesso pa ON pa.id = COALESCE(c.perfil_acesso_id, cg.perfil_acesso_id)
     WHERE c.unidade_principal_id = $1 AND c.situacao = 'ativo' AND c.excluido_em IS NULL AND c.id <> $2
       AND cg.perfil = 'coordenador' AND (pa.fixo_tipo = 'gerente' OR pa.legado_slug = 'gerente' OR lower(cg.nome) = 'gerente')
     ORDER BY c.id LIMIT 1`, [unidade.id, colaboradorId])
  if (g) return { tipo: 'colaborador', id: g.id }
  const a = await dbx.um('SELECT id FROM admins WHERE empresa_id = $1 ORDER BY id LIMIT 1', [unidade.empresa_id])
  return { tipo: 'admin', id: a ? a.id : null }
}

async function criarAcao(dbx, { unidade, exec, tarefa, tipo, motivo, agora }) {
  const resp = await responsavel(dbx, unidade, exec.colaborador_id)
  const prazo = prazoDaAcao(agora, tarefa.prazo_acao_min, unidade.fuso)
  const a = await dbx.um(
    `INSERT INTO acoes (empresa_id, unidade_id, execucao_id, tipo, motivo, porque, aberta_em, prazo_ate, responsavel_tipo, responsavel_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (execucao_id, tipo) WHERE estado = 'aberta' DO NOTHING RETURNING id`,
    [unidade.empresa_id, unidade.id, exec.id, tipo, motivo, tarefa.porque, agora, prazo, resp.tipo, resp.id])
  if (a) {
    await registrar(dbx, { empresaId: unidade.empresa_id, unidadeId: unidade.id, ator: { tipo: 'sistema' }, acao: `acao.criada_${tipo}`, entidade: 'acao', entidadeId: a.id, detalhe: { execucao_id: exec.id, tarefa: tarefa.titulo, motivo } })
  }
  return a
}

// Marca como não feita (se ainda a fazer) e abre a ação "nf".
async function marcarNaoFeita(dbx, unidade, exec, tarefa, agora) {
  const n = await dbx.exec(`UPDATE execucoes SET estado = 'nao_feita' WHERE id = $1 AND estado = 'a_fazer'`, [exec.id])
  if (!n) return false
  const venceu = tempo.horaAgora(unidade.fuso, limiteDe(exec, tarefa, unidade.fuso))
  await criarAcao(dbx, { unidade, exec, tarefa, tipo: 'nf', motivo: `Não feita · venceu às ${venceu}`, agora })
  return true
}

async function vencer(dbx, unidade, agora) {
  const execs = await dbx.q(
    `SELECT e.*, t.nf_min, t.prazo_acao_min, t.porque, t.pai_id, t.titulo FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id
     WHERE e.unidade_id = $1 AND e.estado = 'a_fazer' AND e.data <= $2 AND e.legado_execucao_id IS NULL`,
    [unidade.id, tempo.hoje(unidade.fuso, agora)])
  let n = 0
  for (const e of execs) {
    if (e.pai_id) continue // sub-item vence junto com a tarefa principal (sem ação própria)
    if (agora > limiteDe(e, e, unidade.fuso)) {
      if (await marcarNaoFeita(dbx, unidade, e, e, agora)) n++
      await dbx.exec(
        `UPDATE execucoes f SET estado = 'nao_feita' FROM tarefas t
         WHERE f.tarefa_id = t.id AND t.pai_id = $1 AND f.colaborador_id = $2 AND f.data = $3 AND f.estado = 'a_fazer'`,
        [e.tarefa_id, e.colaborador_id, e.data])
    }
  }
  return n
}

// ---- 4. ações vencidas ------------------------------------------------------
async function avisarVencidas(dbx, empresaId, agora) {
  const vencidas = await dbx.q(
    `SELECT a.id, a.unidade_id, a.motivo FROM acoes a
     WHERE a.empresa_id = $1 AND a.estado = 'aberta' AND a.prazo_ate < $2 AND a.vencida_avisada_em IS NULL`, [empresaId, agora])
  if (!vencidas.length) return 0
  const admins = await dbx.q('SELECT email FROM admins WHERE empresa_id = $1', [empresaId])
  for (const a of vencidas) {
    await dbx.exec('UPDATE acoes SET vencida_avisada_em = $2 WHERE id = $1', [a.id, agora])
    await registrar(dbx, { empresaId, unidadeId: a.unidade_id, ator: { tipo: 'sistema' }, acao: 'acao.vencida', entidade: 'acao', entidadeId: a.id })
  }
  for (const ad of admins) {
    await enviar({ canal: 'email', destino: ad.email, assunto: `${vencidas.length} ação(ões) com prazo vencido`, texto: 'Há ações com prazo vencido no VALIDA. Abra o app em Ações.' })
  }
  return vencidas.length
}

// ---- rodada -----------------------------------------------------------------
async function processarUnidade(dbx, unidadeId, agora = tempo.agora()) {
  const u = await dbx.um('SELECT * FROM unidades WHERE id = $1 AND arquivado_em IS NULL', [unidadeId])
  if (!u) return null
  const hoje = tempo.hoje(u.fuso, agora)
  const r = {
    geradas: await gerarDia(dbx, u, hoje),
    estados: await acertarEstados(dbx, u, hoje),
    vencidas: await vencer(dbx, u, agora)
  }
  return r
}

// Uma rodada para todas as unidades, com trava (nunca roda duas vezes ao mesmo tempo).
async function rodada(agora = tempo.agora()) {
  const client = await db.pool.connect()
  try {
    const t = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [TRAVA])
    if (!t.rows[0].ok) return { pulada: true }
    try {
      const us = await db.q('SELECT id FROM unidades WHERE arquivado_em IS NULL ORDER BY id')
      for (const u of us) {
        try { await db.tx((x) => processarUnidade(x, u.id, agora)) } catch (e) { console.error(`[agendador] unidade ${u.id}: código ${e.code || '-'} ${e.message.split('\n')[0]}`) }
      }
      const es = await db.q('SELECT id FROM empresas')
      for (const e of es) await db.tx((x) => avisarVencidas(x, e.id, agora))
      return { unidades: us.length }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [TRAVA])
    }
  } finally {
    client.release()
  }
}

module.exports = { tarefaValeNoDia, gerarDia, acertarEstados, vencer, avisarVencidas, processarUnidade, rodada, limiteDe, prazoDaAcao, criarAcao, marcarNaoFeita, MOTIVOS_SISTEMA }
