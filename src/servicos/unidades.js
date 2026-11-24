// Unidades: turnos (1 a 3 por dia), local/raio e feriados nacionais.
const v = require('../lib/validar')
const { invalido } = require('../lib/erros')

// semana: [{ dia_semana 0–6, ativo, turnos: [{ abre, fecha }] }]
function validarDia(d) {
  const dia = v.inteiro(d && d.dia_semana, 'o dia da semana', { obrigatorio: true, min: 0, max: 6 })
  const ativo = d.ativo === true
  const turnos = ativo ? v.lista(d.turnos, 'os turnos') : []
  if (ativo && (turnos.length < 1 || turnos.length > 3)) throw invalido('Cada dia aberto tem de 1 a 3 turnos.')
  const limpos = turnos.map((t) => {
    const abre = v.hora(t && t.abre, 'a abertura', { obrigatorio: true })
    const fecha = v.hora(t && t.fecha, 'o fechamento', { obrigatorio: true })
    if (fecha <= abre) throw invalido('O fechamento precisa ser depois da abertura.')
    return { abre, fecha }
  }).sort((a, b) => a.abre.localeCompare(b.abre))
  for (let i = 1; i < limpos.length; i++) {
    if (limpos[i].abre < limpos[i - 1].fecha) throw invalido('Os turnos do mesmo dia não podem se sobrepor.')
  }
  return { dia_semana: dia, ativo, turnos: limpos }
}

function validarSemana(semana) {
  const lista = v.lista(semana, 'a semana').map(validarDia)
  if (new Set(lista.map((d) => d.dia_semana)).size !== lista.length) throw invalido('Dia da semana repetido.')
  return lista
}

// Troca os turnos dos dias enviados (os outros dias ficam como estão).
async function gravarDias(db, unidadeId, dias) {
  for (const d of dias) {
    await db.exec('DELETE FROM unidade_turnos WHERE unidade_id = $1 AND dia_semana = $2', [unidadeId, d.dia_semana])
    if (!d.ativo) {
      await db.exec('INSERT INTO unidade_turnos (unidade_id, dia_semana, ativo, ordem) VALUES ($1, $2, false, 1)', [unidadeId, d.dia_semana])
      continue
    }
    let ordem = 1
    for (const t of d.turnos) {
      await db.exec(
        'INSERT INTO unidade_turnos (unidade_id, dia_semana, ativo, ordem, abre, fecha) VALUES ($1, $2, true, $3, $4, $5)',
        [unidadeId, d.dia_semana, ordem++, t.abre, t.fecha])
    }
  }
}

function validarLocal(p) {
  const r = {}
  if ('lat' in p || 'lng' in p) {
    r.lat = v.numero(p.lat, 'a latitude', { obrigatorio: true, min: -90, max: 90 })
    r.lng = v.numero(p.lng, 'a longitude', { obrigatorio: true, min: -180, max: 180 })
  }
  if ('raio_m' in p) r.raio_m = v.inteiro(p.raio_m, 'o raio', { obrigatorio: true, min: 50, max: 500 })
  return r
}

// Feriados nacionais (lei 662/1949, 6.802/1980, 14.759/2023 e Sexta-feira
// da Paixão pela lei 9.093/1995). Municipais são manuais (§5).
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(ano, mes - 1, dia))
}

function feriadosNacionais(ano) {
  const iso = (d) => d.toISOString().slice(0, 10)
  const sexta = pascoa(ano); sexta.setUTCDate(sexta.getUTCDate() - 2)
  const fixos = [
    ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'], ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'], ['12-25', 'Natal']
  ].map(([md, nome]) => ({ data: `${ano}-${md}`, motivo: nome, repetir_anual: true }))
  return [...fixos, { data: iso(sexta), motivo: 'Paixão de Cristo', repetir_anual: false }]
    .sort((a, b) => a.data.localeCompare(b.data))
}

// Próximos feriados a partir de hoje (12 meses).
function proximosFeriados(hojeIso) {
  const ano = Number(hojeIso.slice(0, 4))
  const fim = `${ano + 1}${hojeIso.slice(4)}`
  return [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)].filter((f) => f.data >= hojeIso && f.data < fim)
}

module.exports = { validarSemana, validarDia, gravarDias, validarLocal, feriadosNacionais, proximosFeriados }
