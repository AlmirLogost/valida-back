// Tarefas: só o necessário para os executores de pedidos (tsave, tset,
// tdel, toff, ttog, tdup) e uma listagem. O resto (agendador, execução,
// ações, bônus) é a Etapa 1B.
const v = require('../lib/validar')
const { invalido, naoEncontrado } = require('../lib/erros')
const buscar = require('./buscar')

const TIPOS = ['feito', 'numero', 'nota', 'escolha', 'texto', 'conjunto']
const RECORRENCIAS = ['diario', 'semanal', 'mensal', 'pontual']

// Valida e monta os campos de uma tarefa (nova ou editada). `atual` = a
// tarefa existente na edição (campos não enviados ficam como estão).
async function montarCampos(db, empresaId, entrada, atual = null) {
  const e = entrada || {}
  const pega = (k) => (k in e ? e[k] : atual ? atual[k] : undefined)

  const c = {}
  c.titulo = v.texto(pega('titulo'), 'o título', { obrigatorio: true, max: 120 })
  c.porque = v.texto(pega('porque'), 'o "por que é importante"', { max: 500 })
  c.unidade_id = v.id(pega('unidade_id'), 'a unidade')
  await buscar.unidade(db, empresaId, c.unidade_id)

  c.colaborador_id = v.inteiro(pega('colaborador_id'), 'a pessoa', { min: 1 })
  c.cargo_id = v.inteiro(pega('cargo_id'), 'o cargo', { min: 1 })
  if (!!c.colaborador_id === !!c.cargo_id) throw invalido('A tarefa é de uma pessoa ou de um cargo (um dos dois).')
  if (c.colaborador_id) {
    const p = await buscar.colaborador(db, empresaId, c.colaborador_id)
    const naUnidade = await db.um('SELECT 1 FROM colaborador_unidades WHERE colaborador_id = $1 AND unidade_id = $2', [p.id, c.unidade_id])
    if (!naUnidade) throw invalido('Essa pessoa não trabalha nessa unidade.')
  } else {
    const cg = await buscar.cargo(db, empresaId, c.cargo_id)
    if (cg.unidade_id !== c.unidade_id) throw invalido('O cargo é de outra unidade.')
  }

  c.recorrencia = v.umDe(pega('recorrencia') ?? 'diario', 'a repetição', RECORRENCIAS, { obrigatorio: true })
  const dias = pega('dias_semana')
  c.dias_semana = c.recorrencia === 'semanal'
    ? [...new Set(v.lista(dias, 'os dias').map((d) => v.inteiro(d, 'o dia', { obrigatorio: true, min: 0, max: 6 })))].sort()
    : null
  if (c.recorrencia === 'semanal' && !c.dias_semana.length) throw invalido('Escolha ao menos um dia da semana.')
  c.dia_mes = c.recorrencia === 'mensal' ? v.inteiro(pega('dia_mes'), 'o dia do mês', { obrigatorio: true, min: 1, max: 31 }) : null
  c.data_pontual = c.recorrencia === 'pontual' ? v.data(pega('data_pontual'), 'a data', { obrigatorio: true }) : null
  c.hora_ini = v.hora(pega('hora_ini'), 'o início', { obrigatorio: true })
  c.hora_fim = v.hora(pega('hora_fim'), 'o fim')
  if (c.hora_fim && c.hora_fim.slice(0, 5) <= c.hora_ini.slice(0, 5)) throw invalido('O fim precisa ser depois do início.')

  c.tipo_resposta = v.umDe(pega('tipo_resposta') ?? 'feito', 'como responde', TIPOS, { obrigatorio: true })
  c.faixa_min = v.numero(pega('faixa_min'), 'o mínimo')
  c.faixa_max = v.numero(pega('faixa_max'), 'o máximo')
  if (c.faixa_min !== null && c.faixa_max !== null && c.faixa_max < c.faixa_min) throw invalido('O máximo precisa ser maior que o mínimo.')
  c.unidade_medida = v.texto(pega('unidade_medida'), 'a unidade de medida', { max: 20 })
  const opcoes = pega('opcoes')
  c.opcoes = opcoes == null ? null : v.lista(opcoes, 'as opções').map((o) => ({
    rotulo: v.texto(o && o.rotulo, 'a opção', { obrigatorio: true, max: 60 }),
    abre_acao: o && o.abre_acao === true
  }))
  if (c.tipo_resposta === 'escolha' && (!c.opcoes || c.opcoes.length < 2)) throw invalido('Escolha precisa de ao menos 2 opções.')
  c.pede_foto = pega('pede_foto') === true
  c.nf_min = v.umDe(pega('nf_min') ?? 120, '"vira Não feita depois de"', [60, 120, 180, 240])
  c.prazo_acao_min = v.umDe(pega('prazo_acao_min') ?? 120, 'o prazo da ação', [0, 60, 120, 240])
  c.valor_feita = v.numero(pega('valor_feita'), 'o valor por feita', { min: 0 })
  c.valor_nao_feita = v.numero(pega('valor_nao_feita'), 'o desconto', { min: 0 })
  c.pai_id = v.inteiro(pega('pai_id'), 'a tarefa principal', { min: 1 })
  if (c.pai_id) await buscar.tarefa(db, empresaId, c.pai_id)
  c.secao = v.texto(pega('secao'), 'a seção', { max: 60 })
  c.conjunto_id = v.inteiro(pega('conjunto_id'), 'o conjunto', { min: 1 })
  return c
}

const COLUNAS = ['titulo', 'porque', 'unidade_id', 'colaborador_id', 'cargo_id', 'recorrencia', 'dias_semana', 'dia_mes',
  'data_pontual', 'hora_ini', 'hora_fim', 'tipo_resposta', 'faixa_min', 'faixa_max', 'unidade_medida', 'opcoes',
  'pede_foto', 'nf_min', 'prazo_acao_min', 'valor_feita', 'valor_nao_feita', 'pai_id', 'secao', 'conjunto_id']

function valorColuna(c, k) {
  return k === 'opcoes' && c[k] !== null ? JSON.stringify(c[k]) : c[k]
}

async function criar(db, empresaId, campos, criadoPor) {
  const vals = COLUNAS.map((k) => valorColuna(campos, k))
  const r = await db.um(
    `INSERT INTO tarefas (empresa_id, criado_por, ${COLUNAS.join(', ')})
     VALUES ($1, $2, ${COLUNAS.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING *`,
    [empresaId, criadoPor, ...vals])
  return r
}

async function atualizar(db, empresaId, id, campos) {
  const sets = COLUNAS.map((k, i) => `${k} = $${i + 3}`).join(', ')
  return db.um(
    `UPDATE tarefas SET ${sets}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 AND arquivado_em IS NULL RETURNING *`,
    [id, empresaId, ...COLUNAS.map((k) => valorColuna(campos, k))])
}

async function ativa(db, empresaId, id) {
  const t = await buscar.tarefa(db, empresaId, id)
  if (t.arquivado_em) throw naoEncontrado()
  return t
}

module.exports = { montarCampos, criar, atualizar, ativa, COLUNAS }
