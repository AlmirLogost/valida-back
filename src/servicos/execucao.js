// Execução, conferência e desfazer (roteiro 1B itens 3 e 5, §12–§14, §19).
const db = require('../db')
const config = require('../config')
const v = require('../lib/validar')
const tempo = require('../lib/tempo')
const agenda = require('./agenda')
const { registrar } = require('../lib/registro')
const { tem, conferirUnidade } = require('../auth/sessao')
const { invalido, proibido, conflito, naoEncontrado } = require('../lib/erros')

const num = (n) => String(Number(n)).replace('.', ',')

function motivoFaixa(t, valor) {
  const u = t.unidade_medida ? ` ${t.unidade_medida}` : ''
  let certo
  if (t.faixa_min !== null && t.faixa_max !== null) certo = `${num(t.faixa_min)} a ${num(t.faixa_max)}${u}`
  else if (t.faixa_min !== null) certo = `a partir de ${num(t.faixa_min)}${u}`
  else certo = `até ${num(t.faixa_max)}${u}`
  return `Fora da faixa: ${num(valor)}${u} (certo: ${certo})`
}

// Valida a resposta conforme o tipo; devolve { campos, fora, motivo, na }.
async function lerResposta(dbx, t, b) {
  const r = { resposta_texto: null, resposta_num: null }
  let fora = false, motivo = null, na = false
  switch (t.tipo_resposta) {
    case 'feito':
      break
    case 'numero': {
      r.resposta_num = v.numero(b.resposta_num, 'o valor', { obrigatorio: true, min: -1e9, max: 1e9 })
      if ((t.faixa_min !== null && r.resposta_num < t.faixa_min) || (t.faixa_max !== null && r.resposta_num > t.faixa_max)) {
        fora = true; motivo = motivoFaixa(t, r.resposta_num)
      }
      break
    }
    case 'nota':
      r.resposta_num = v.inteiro(b.resposta_num, 'a nota', { obrigatorio: true, min: 1, max: 5 })
      if (r.resposta_num <= 2) { fora = true; motivo = `Nota ${r.resposta_num} de 5` }
      break
    case 'escolha': {
      const op = (t.opcoes || []).find((o) => o.rotulo === b.opcao)
      if (!op) throw invalido('Escolha uma das opções.')
      r.resposta_texto = op.rotulo
      if (op.abre_acao) { fora = true; motivo = `Resposta: ${op.rotulo}` }
      break
    }
    case 'conjunto': {
      const c = t.conjunto_id ? await dbx.um('SELECT opcoes FROM conjuntos_resposta WHERE id = $1', [t.conjunto_id]) : null
      const op = c && (c.opcoes || []).find((o) => o.rotulo === b.opcao)
      if (!op) throw invalido('Escolha uma das opções.')
      r.resposta_texto = op.rotulo
      if (op.na) na = true
      if (op.abre_acao) { fora = true; motivo = `Resposta: ${op.rotulo}` }
      break
    }
    case 'texto':
      r.resposta_texto = v.texto(b.resposta_texto, 'a resposta', { obrigatorio: true, max: 1000 })
      break
  }
  return { campos: r, fora, motivo, na }
}

async function carregar(dbx, empresaId, execId, trava = false) {
  const e = await dbx.um(`SELECT * FROM execucoes WHERE id = $1 AND empresa_id = $2 ${trava ? 'FOR UPDATE' : ''}`, [execId, empresaId])
  if (!e) throw naoEncontrado()
  const t = await dbx.um('SELECT * FROM tarefas WHERE id = $1', [e.tarefa_id])
  const u = await dbx.um('SELECT * FROM unidades WHERE id = $1', [e.unidade_id])
  return { e, t, u }
}

// Concluir. Devolve { status, corpo } (409 de "venceu" só depois de gravar a ação).
async function concluir(req, execId, b) {
  if (req.ator.tipo !== 'colaborador') throw proibido('O admin não executa tarefas.')
  if (!tem(req, 'faz')) throw proibido('Sem a permissão "Fazer as tarefas", você não conclui tarefas.')
  const chave = v.texto(b.chave_envio, 'a chave do envio', { max: 100 })
  const agora = tempo.agora()

  // Horário real do celular (envio sem internet) e diferença de relógio.
  let feitaEm = agora, diferenca = null
  if (b.feita_em !== undefined && b.feita_em !== null) {
    feitaEm = new Date(b.feita_em)
    if (isNaN(feitaEm)) throw invalido('Horário da conclusão inválido.')
  }
  if (b.relogio_celular !== undefined && b.relogio_celular !== null) {
    const rc = new Date(b.relogio_celular)
    if (isNaN(rc)) throw invalido('Relógio do celular inválido.')
    diferenca = Math.round((agora - rc) / 1000)
  }
  // Horário no relógio do servidor: quando o celular diz a hora da conclusão
  // (fila sem internet), ela é corrigida pela diferença dos relógios e nunca
  // fica no futuro. Sem feita_em, vale a hora do servidor (o relógio do celular
  // só serve para marcar a diferença; nunca muda a hora da conclusão).
  let feitaReal = b.feita_em === undefined || b.feita_em === null ? agora : new Date(feitaEm.getTime() + (diferenca || 0) * 1000)
  if (feitaReal > agora) feitaReal = agora
  // Conclusão sem internet (a hora veio do celular): até 12 h depois e com os
  // relógios próximos vale normalmente. Fora disso entra como feita, marcada
  // "conferir horário", e só conta no prazo se quem confere aprovar.
  let horario = null
  if (b.feita_em !== undefined && b.feita_em !== null) {
    if (diferenca === null || Math.abs(diferenca) > config.relogioAlertaS) horario = 'relogio'
    else if (agora - feitaReal > config.envioTardeH * 3600e3) horario = 'tarde'
  }

  return db.tx(async (x) => {
    if (chave) {
      const ja = await x.um('SELECT id, colaborador_id, estado FROM execucoes WHERE chave_envio = $1', [chave])
      if (ja) {
        if (ja.id === execId && ja.colaborador_id === req.ator.id) return { status: 200, corpo: { ok: true, duplicado: true, execucao_id: ja.id, estado: ja.estado } }
        throw conflito('Esse envio já foi usado em outra tarefa.')
      }
    }
    const { e, t, u } = await carregar(x, req.ator.empresaId, execId, true)
    if (e.colaborador_id !== req.ator.id) throw naoEncontrado()
    const limite = agenda.limiteDe(e, t.pai_id ? await x.um('SELECT nf_min FROM tarefas WHERE id = $1', [t.pai_id]) : t, u.fuso)

    // Dois envios iguais ao mesmo tempo: o segundo esperou a trava da linha.
    if (chave && e.chave_envio === chave && e.estado !== 'a_fazer') return { status: 200, corpo: { ok: true, duplicado: true, execucao_id: e.id, estado: e.estado } }
    if (e.estado === 'feita' || e.estado === 'na') throw conflito('Essa tarefa já foi feita.')
    if (e.estado === 'dispensada' || e.estado === 'cancelada') throw conflito('Essa tarefa não conta hoje.')
    if (feitaReal > limite) {
      if (e.estado === 'a_fazer' && !t.pai_id) await agenda.marcarNaoFeita(x, u, e, t, agora)
      return { status: 409, corpo: { erro: 'Venceu. Não dá mais para concluir. O gerente recebeu uma ação.', estado: 'nao_feita' } }
    }
    // Chegou atrasado (sem internet), mas foi feita antes do limite: vale.
    const eraNaoFeita = e.estado === 'nao_feita'

    // Tarefa com itens: só conclui com todos os itens respondidos.
    const filhas = await x.q(
      `SELECT f.estado FROM execucoes f JOIN tarefas ft ON ft.id = f.tarefa_id
       WHERE ft.pai_id = $1 AND f.colaborador_id = $2 AND f.data = $3`, [t.id, e.colaborador_id, e.data])
    const faltam = filhas.filter((f) => !['feita', 'na'].includes(f.estado)).length
    if (faltam) throw conflito(`Faltam ${faltam} ${faltam === 1 ? 'item' : 'itens'} para concluir.`)

    const resp = await lerResposta(x, t, b)
    let fotoId = null
    if (b.foto_id !== undefined && b.foto_id !== null) {
      if (!tem(req, 'foto')) throw proibido('Sem a permissão "Enviar foto".')
      fotoId = v.id(b.foto_id, 'a foto')
      const f = await x.um(
        `SELECT id FROM fotos WHERE id = $1 AND empresa_id = $2 AND criado_por_tipo = 'colaborador' AND criado_por = $3
           AND NOT EXISTS (SELECT 1 FROM execucoes o WHERE o.foto_id = fotos.id)`, [fotoId, req.ator.empresaId, req.ator.id])
      if (!f) throw invalido('Foto inválida ou já usada.')
    }
    if (t.pede_foto && !fotoId) throw invalido('Esta tarefa pede foto.')

    await x.exec(
      `UPDATE execucoes SET estado = $2, feita_em = $3, recebida_em = now(), resposta_texto = $4, resposta_num = $5,
         resposta_fora = $6, foto_id = $7, chave_envio = $8, diferenca_relogio_s = $9, horario_conferir = $10, conferencia = NULL,
         conferencia_motivo = NULL, conferida_por = NULL, conferida_por_tipo = NULL, conferida_em = NULL
       WHERE id = $1`,
      [e.id, resp.na ? 'na' : 'feita', feitaReal, resp.campos.resposta_texto, resp.campos.resposta_num, resp.fora, fotoId, chave, diferenca, horario])
    // Com o horário por conferir, a ação da não feita continua aberta até aprovarem.
    if (eraNaoFeita && !horario) {
      await x.exec(
        `UPDATE acoes SET estado = 'resolvida', solucao = 'Concluída sem internet antes do prazo (envio atrasado).', resolvida_em = now()
         WHERE execucao_id = $1 AND tipo = 'nf' AND estado = 'aberta'`, [e.id])
    }
    let acao = null
    if (resp.fora) acao = await agenda.criarAcao(x, { unidade: u, exec: e, tarefa: t, tipo: 'fx', motivo: resp.motivo, agora })
    await registrar(x, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: 'execucao.concluida', entidade: 'execucao', entidadeId: e.id, detalhe: { tarefa: t.titulo, fora: resp.fora, offline: !!b.feita_em, diferenca_relogio_s: diferenca, horario_conferir: horario } })
    return {
      status: 200,
      corpo: {
        ok: true, execucao_id: e.id, estado: resp.na ? 'na' : 'feita', fora: resp.fora, acao_id: acao ? acao.id : null, conferir_horario: !!horario,
        relogio_suspeito: diferenca !== null && Math.abs(diferenca) > config.relogioAlertaS,
        mensagem: resp.fora ? 'Registrado. O gerente foi avisado.' : 'Feito!'
      }
    }
  })
}

// Volta a execução para a pessoa; depois do limite fica não feita (+ ação nf).
async function voltar(x, e, t, u, agora) {
  const tarefaLimite = t.pai_id ? await x.um('SELECT nf_min FROM tarefas WHERE id = $1', [t.pai_id]) : t
  if (agora > agenda.limiteDe(e, tarefaLimite, u.fuso)) {
    await x.exec(`UPDATE execucoes SET estado = 'a_fazer' WHERE id = $1`, [e.id])
    if (!t.pai_id) await agenda.marcarNaoFeita(x, u, { ...e, estado: 'a_fazer' }, t, agora)
    else await x.exec(`UPDATE execucoes SET estado = 'nao_feita' WHERE id = $1`, [e.id])
    return 'nao_feita'
  }
  await x.exec(`UPDATE execucoes SET estado = 'a_fazer' WHERE id = $1`, [e.id])
  return 'a_fazer'
}

// Conferir: aprovar ou reabrir com motivo. Ninguém confere o que ele mesmo fez.
async function conferir(req, execId, b) {
  if (!tem(req, 'conf')) throw proibido()
  const decisao = v.umDe(b.decisao, 'a decisão', ['aprovar', 'reabrir'], { obrigatorio: true })
  const motivo = decisao === 'reabrir' ? v.texto(b.motivo, 'o motivo', { obrigatorio: true, max: 300 }) : null
  const agora = tempo.agora()
  return db.tx(async (x) => {
    const { e, t, u } = await carregar(x, req.ator.empresaId, execId, true)
    conferirUnidade(req, e.unidade_id)
    if (!req.acesso.admin && !tem(req, 'ver')) throw naoEncontrado()
    if (req.ator.tipo === 'colaborador' && e.colaborador_id === req.ator.id) throw proibido('Ninguém confere o que ele mesmo fez.')
    if (!['feita', 'na'].includes(e.estado)) throw conflito('Só dá para conferir tarefa feita.')
    let estado = e.estado
    if (decisao === 'reabrir') estado = await voltar(x, e, t, u, agora)
    // Aprovar o horário: passa a contar no prazo e fecha a ação da não feita.
    else if (e.horario_conferir) {
      await x.exec(
        `UPDATE acoes SET estado = 'resolvida', solucao = 'Horário conferido e aprovado: foi feita sem internet, antes do prazo.', resolvida_por = $2, resolvida_por_tipo = $3, resolvida_em = now()
         WHERE execucao_id = $1 AND tipo = 'nf' AND estado = 'aberta'`, [e.id, req.ator.id, req.ator.tipo])
    }
    await x.exec(
      `UPDATE execucoes SET conferencia = $2, conferencia_motivo = $3, conferida_por = $4, conferida_por_tipo = $5, conferida_em = now() WHERE id = $1`,
      [e.id, decisao === 'aprovar' ? 'aprovada' : 'reaberta', motivo, req.ator.id, req.ator.tipo])
    await registrar(x, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: decisao === 'aprovar' ? 'execucao.aprovada' : 'execucao.reaberta', entidade: 'execucao', entidadeId: e.id, detalhe: { tarefa: t.titulo, motivo, estado } })
    return { ok: true, execucao_id: e.id, conferencia: decisao === 'aprovar' ? 'aprovada' : 'reaberta', estado }
  })
}

// Desfazer: nunca apaga; marca quem e quando e volta para a pessoa.
async function desfazer(req, execId) {
  if (!tem(req, 'desfaz')) throw proibido('Sem a permissão "Desfazer tarefa feita".')
  const agora = tempo.agora()
  return db.tx(async (x) => {
    const { e, t, u } = await carregar(x, req.ator.empresaId, execId, true)
    conferirUnidade(req, e.unidade_id)
    const propria = req.ator.tipo === 'colaborador' && e.colaborador_id === req.ator.id
    if (!propria && !req.acesso.admin && !tem(req, 'ver')) throw naoEncontrado()
    if (!['feita', 'na'].includes(e.estado)) throw conflito('Só dá para desfazer tarefa feita.')
    const estado = await voltar(x, e, t, u, agora)
    await x.exec(
      `UPDATE execucoes SET desfeita_por = $2, desfeita_por_tipo = $3, desfeita_em = now(), conferencia = NULL, conferencia_motivo = NULL WHERE id = $1`,
      [e.id, req.ator.id, req.ator.tipo])
    await registrar(x, { empresaId: req.ator.empresaId, unidadeId: u.id, ator: req.ator, acao: 'execucao.desfeita', entidade: 'execucao', entidadeId: e.id, detalhe: { tarefa: t.titulo, feita_em: e.feita_em, resposta_texto: e.resposta_texto, resposta_num: e.resposta_num, estado } })
    return { ok: true, execucao_id: e.id, estado }
  })
}

// Atrasada é calculada: a fazer e passou de hora_prevista + tolerância.
function atrasada(e, tolMin, fuso, agora = tempo.agora()) {
  if (e.estado !== 'a_fazer' || !e.hora_prevista) return false
  return agora > new Date(tempo.momento(e.data, String(e.hora_prevista).slice(0, 5), fuso).getTime() + tolMin * 60000)
}

module.exports = { concluir, conferir, desfazer, atrasada, motivoFaixa }
