// Feita sem internet, mas com o horário ainda por conferir (SQL; e = execucoes).
const PENDE_HORARIO = `(e.horario_conferir IS NOT NULL AND e.estado IN ('feita', 'na') AND e.conferencia IS DISTINCT FROM 'aprovada')`
module.exports = { PENDE_HORARIO }
