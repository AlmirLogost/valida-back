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

module.exports = { partes, hoje, horaAgora, minutos }
