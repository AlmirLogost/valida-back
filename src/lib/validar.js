// Validação simples de entrada. Cada função devolve o valor limpo ou lança 400.
const { invalido } = require('./erros')

function texto(v, nome, { obrigatorio = false, max = 200, min = 0 } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (obrigatorio) throw invalido(`Informe ${nome}.`)
    return null
  }
  const s = String(v).trim()
  if (s.length < min) throw invalido(`${nome} precisa ter ao menos ${min} caracteres.`)
  if (s.length > max) throw invalido(`${nome} pode ter no máximo ${max} caracteres.`)
  return s
}

function inteiro(v, nome, { obrigatorio = false, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw invalido(`Informe ${nome}.`)
    return null
  }
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw invalido(`${nome} inválido.`)
  return n
}

function numero(v, nome, { obrigatorio = false, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw invalido(`Informe ${nome}.`)
    return null
  }
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) throw invalido(`${nome} inválido.`)
  return n
}

function id(v, nome = 'o registro') {
  return inteiro(v, nome, { obrigatorio: true, min: 1 })
}

function bool(v, nome, { obrigatorio = false } = {}) {
  if (v === undefined || v === null) {
    if (obrigatorio) throw invalido(`Informe ${nome}.`)
    return null
  }
  if (typeof v !== 'boolean') throw invalido(`${nome} inválido.`)
  return v
}

function hora(v, nome, { obrigatorio = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw invalido(`Informe ${nome}.`)
    return null
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(v))) throw invalido(`${nome} precisa estar no formato HH:MM.`)
  return String(v).slice(0, 5)
}

function data(v, nome, { obrigatorio = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw invalido(`Informe ${nome}.`)
    return null
  }
  const s = String(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw invalido(`${nome} precisa estar no formato AAAA-MM-DD.`)
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw invalido(`${nome} não existe.`)
  return s
}

// Celular brasileiro: só dígitos, DDD + número (10 ou 11 dígitos).
function celular(v, { obrigatorio = false } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (obrigatorio) throw invalido('Informe o celular com DDD.')
    return null
  }
  const d = String(v).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (!/^\d{10,11}$/.test(d)) throw invalido('Celular inválido. Use DDD + número (11 dígitos).')
  return d
}

function email(v, { obrigatorio = false } = {}) {
  const s = texto(v, 'o e-mail', { obrigatorio, max: 200 })
  if (s === null) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw invalido('E-mail inválido.')
  return s.toLowerCase()
}

function pin(v) {
  if (!/^\d{4}$/.test(String(v ?? ''))) throw invalido('O PIN tem 4 números.')
  return String(v)
}

function umDe(v, nome, opcoes, { obrigatorio = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw invalido(`Informe ${nome}.`)
    return null
  }
  if (!opcoes.includes(v)) throw invalido(`${nome} inválido.`)
  return v
}

function lista(v, nome) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw invalido(`${nome} precisa ser uma lista.`)
  return v
}

module.exports = { texto, inteiro, numero, id, bool, hora, data, celular, email, pin, umDe, lista }
