// Datas e horas no fuso da unidade (padrão America/Sao_Paulo).
const config = require('../config')

function partes(fuso, agora = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso || config.fusoPadrao,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  })
  const p = Object.fromEntries(f.formatToParts(agora).map((x) => [x.type, x.value]))
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, diaSemana: dias[p.weekday] }
}

const hoje = (fuso, agora) => partes(fuso, agora).data
const horaAgora = (fuso, agora) => partes(fuso, agora).hora
const minutos = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

// Momento (Date) de "data HH:MM" no fuso dado. Ex.: momento('2031-03-10', '09:00', 'America/Sao_Paulo').
function momento(data, hhmm, fuso) {
  const [y, m, d] = data.split('-').map(Number)
  const [h, mi] = String(hhmm).slice(0, 5).split(':').map(Number)
  const alvo = Date.UTC(y, m - 1, d, h, mi)
  let t = alvo
  for (let i = 0; i < 3; i++) {
    const p = partes(fuso, new Date(t))
    const [py, pm, pd] = p.data.split('-').map(Number)
    const [ph, pmi] = p.hora.split(':').map(Number)
    const visto = Date.UTC(py, pm - 1, pd, ph, pmi)
    if (visto === alvo) break
    t += alvo - visto
  }
  return new Date(t)
}

// Soma dias a 'AAAA-MM-DD'.
function somarDias(data, n) {
  const [y, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const diaDaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay()
const ultimoDiaDoMes = (data) => {
  const [y, m] = data.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

module.exports = { partes, hoje, horaAgora, minutos, momento, somarDias, diaDaSemana, ultimoDiaDoMes }
