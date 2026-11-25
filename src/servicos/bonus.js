// Cálculo do bônus (§16, roteiro 1B item 7).
//
// Para cada dia vale a regra vigente NAQUELE dia (regras_bonus.vigente_desde):
// regra nova não muda o passado.
//   tarefa: + valor por feita; − valor por não feita (valor próprio da tarefa substitui)
//   fixo:   valor do mês (regra vigente no último dia do mês dentro do período);
//           − desconto por não feita
//   depois: nada
// Atraso de chegada (opcional): primeiro login do dia com atraso acima da
// tolerância → desconto. Dispensadas, canceladas e N/A não contam. Sub-itens
// não contam (conta a tarefa principal). Líquido nunca fica negativo.
const tempo = require('../lib/tempo')

const { PENDE_HORARIO } = require('../lib/horario')
const r2 = (n) => Math.round(n * 100) / 100

function regraNoDia(regras, data) {
  let r = null
  for (const x of regras) if (x.vigente_desde <= data) r = x
  return r
}

async function calcular(dbx, colaboradorId, de, ate, agora = tempo.agora(), fuso = 'America/Sao_Paulo') {
  const regras = await dbx.q('SELECT * FROM regras_bonus WHERE colaborador_id = $1 ORDER BY vigente_desde', [colaboradorId])
  const hoje = tempo.hoje(fuso, agora)
  const execs = await dbx.q(
    `SELECT e.estado, e.data, t.valor_feita, t.valor_nao_feita, ${PENDE_HORARIO} AS pende_horario FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id
     WHERE e.colaborador_id = $1 AND e.data BETWEEN $2 AND $3 AND t.pai_id IS NULL AND e.estado IN ('feita', 'nao_feita', 'a_fazer')`,
    [colaboradorId, de, ate])

  let bruto = 0, descontos = 0, atrasos = 0, ganhoHoje = 0, aReceber = 0, aConferir = 0, feitas = 0, naoFeitas = 0
  for (const e of execs) {
    const r = regraNoDia(regras, e.data)
    if (!r || r.tipo === 'depois') continue
    const vf = e.valor_feita ?? (r.tipo === 'tarefa' ? r.valor_feita : 0) ?? 0
    const vn = e.valor_nao_feita ?? r.valor_nao_feita ?? 0
    if (e.estado === 'feita') {
      feitas++
      // Horário por conferir: não soma (nem desconta) até aprovarem.
      if (e.pende_horario) { if (r.tipo === 'tarefa' || e.valor_feita !== null) aConferir += vf; continue }
      if (r.tipo === 'tarefa' || e.valor_feita !== null) { bruto += vf; if (e.data === hoje) ganhoHoje += vf }
    } else if (e.estado === 'nao_feita') {
      naoFeitas++
      descontos += vn
    } else if (r.tipo === 'tarefa' || e.valor_feita !== null) {
      aReceber += vf
    }
  }

  // Valor fixo: um por mês do período.
  let m = de.slice(0, 7)
  while (m <= ate.slice(0, 7)) {
    const fimMes = `${m}-${String(tempo.ultimoDiaDoMes(`${m}-01`)).padStart(2, '0')}`
    const r = regraNoDia(regras, fimMes < ate ? fimMes : ate)
    if (r && r.tipo === 'fixo') bruto += r.valor_mes || 0
    const [y, mm] = m.split('-').map(Number)
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`
  }

  // Atraso de chegada: primeiro login de cada dia.
  const logins = await dbx.q(
    `SELECT DISTINCT ON (dia) dia, atraso_min FROM (
       SELECT (l.em AT TIME ZONE $4)::date::text AS dia, l.atraso_min, l.em FROM logins l WHERE l.colaborador_id = $1
     ) x WHERE dia BETWEEN $2 AND $3 ORDER BY dia, em`, [colaboradorId, de, ate, fuso])
  for (const l of logins) {
    const r = regraNoDia(regras, l.dia)
    if (r && r.tipo !== 'depois' && r.atraso_ativo && (l.atraso_min || 0) > (r.atraso_tol_min || 0)) atrasos += r.atraso_desconto || 0
  }

  const liquido = Math.max(0, r2(bruto - descontos - atrasos))
  const atual = regraNoDia(regras, hoje)
  return {
    de, ate,
    bruto: r2(bruto), descontos: r2(descontos), atrasos: r2(atrasos), liquido,
    hoje: r2(ganhoHoje), a_receber: r2(aReceber), a_conferir: r2(aConferir), feitas, nao_feitas: naoFeitas,
    regra_atual: atual ? { tipo: atual.tipo, vigente_desde: atual.vigente_desde } : null
  }
}

// 'AAAA-MM' → período do mês.
function periodoDoMes(mes) {
  return { de: `${mes}-01`, ate: `${mes}-${String(tempo.ultimoDiaDoMes(`${mes}-01`)).padStart(2, '0')}` }
}

module.exports = { calcular, periodoDoMes, regraNoDia }
