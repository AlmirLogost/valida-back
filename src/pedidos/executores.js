// Um executor por tipo de pedido (§9). Cada executor tem:
//   chaves(p)            permissões que dispensam o pedido (quem tem, faz direto)
//   aprovador            'admin' (só o admin aprova) ou 'lib' (admin ou quem tem "lib" na unidade)
//   preparar(db, req, e) valida a entrada e o alcance de quem pede;
//                        devolve { payload, unidadeId, titulo, detalhe }
//   executar(db, ctx, p) faz a mudança (direto ou ao aprovar) e devolve o resultado.
//                        ctx = { empresaId, ator, viaPedido }
// O mesmo executar roda nos dois caminhos: aprovar = fazer de fato.
const v = require('../lib/validar')
const { invalido, conflito, proibido, naoEncontrado } = require('../lib/erros')
const buscar = require('../servicos/buscar')
const tarefas = require('../servicos/tarefas')
const unidades = require('../servicos/unidades')
const { gerarPin, hashPin } = require('../lib/segredos')
const { enviar } = require('../lib/envio')
const tempo = require('../lib/tempo')
const { conferirUnidade, tem } = require('../auth/sessao')

// ---- ajudas -------------------------------------------------------------
async function tarefaNoAlcance(db, req, id) {
  const t = await tarefas.ativa(db, req.ator.empresaId, v.id(id, 'a tarefa'))
  conferirUnidade(req, t.unidade_id)
  // Tarefa de outra pessoa exige ver as tarefas da equipe.
  if (!req.acesso.admin && t.colaborador_id !== req.ator.id && !tem(req, 'ver')) throw naoEncontrado()
  return t
}

async function pessoaNoAlcance(db, req, id) {
  const p = await buscar.colaborador(db, req.ator.empresaId, v.id(id, 'a pessoa'))
  const u = await db.q('SELECT unidade_id FROM colaborador_unidades WHERE colaborador_id = $1', [p.id])
  if (!req.acesso.admin) {
    if (!u.some((x) => req.acesso.unidades.has(x.unidade_id))) throw naoEncontrado()
    if (p.id !== req.ator.id && !tem(req, 'ver')) throw naoEncontrado()
  }
  return p
}

async function celularLivre(db, empresaId, celular, menosId = 0) {
  if (!celular) return
  const r = await db.um(
    'SELECT 1 FROM colaboradores WHERE empresa_id = $1 AND celular = $2 AND id <> $3 AND excluido_em IS NULL', [empresaId, celular, menosId])
  if (r) throw conflito('Já existe alguém com esse celular na empresa.')
}

async function novoPin(db, colaboradorId) {
  const pin = gerarPin()
  await db.exec(
    'UPDATE colaboradores SET pin_hash = $2, pin_trocado_em = now(), token_versao = token_versao + 1, atualizado_em = now() WHERE id = $1',
    [colaboradorId, await hashPin(pin)])
  return pin
}

async function convite(p) {
  if (!p.celular) return
  await enviar({
    canal: 'whatsapp', destino: p.celular, assunto: 'Convite VALIDA',
    texto: `Olá, ${p.nome}! Seu acesso ao VALIDA está pronto. Entre com este celular e o PIN de 4 números que seu gestor vai te passar.`
  })
}

const resumoHora = (t) => `${t.hora_ini}${t.hora_fim ? '–' + t.hora_fim : ''}`

// ---- executores ---------------------------------------------------------
const E = {}

// Tarefas
E.tsave = {
  chaves: (p) => [p.tarefa_id ? 'tedit' : 'criar'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    let atual = null
    if (e.tarefa_id) atual = await tarefaNoAlcance(db, req, e.tarefa_id)
    const campos = await tarefas.montarCampos(db, req.ator.empresaId, e.campos, atual)
    conferirUnidade(req, campos.unidade_id)
    return {
      payload: { tarefa_id: atual ? atual.id : null, campos },
      unidadeId: campos.unidade_id,
      titulo: atual ? `Editar tarefa · ${atual.titulo}` : `Nova tarefa · ${campos.titulo}`,
      detalhe: `${campos.titulo} · ${resumoHora(campos)}`
    }
  },
  async executar(db, ctx, p) {
    const campos = await tarefas.montarCampos(db, ctx.empresaId, p.campos)
    if (p.tarefa_id) {
      const t = await tarefas.atualizar(db, ctx.empresaId, p.tarefa_id, campos)
      if (!t) throw naoEncontrado('A tarefa não existe mais.')
      return { tarefa_id: t.id }
    }
    const t = await tarefas.criar(db, ctx.empresaId, campos, ctx.ator.id)
    return { tarefa_id: t.id }
  }
}

E.tset = {
  chaves: () => ['tedit'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const t = await tarefaNoAlcance(db, req, e.tarefa_id)
    const hora_ini = v.hora(e.hora_ini, 'o início', { obrigatorio: true })
    const hora_fim = v.hora(e.hora_fim, 'o fim')
    if (hora_fim && hora_fim <= hora_ini) throw invalido('O fim precisa ser depois do início.')
    return { payload: { tarefa_id: t.id, hora_ini, hora_fim }, unidadeId: t.unidade_id, titulo: `Mudar horário · ${t.titulo}`, detalhe: `${resumoHora(t)} → ${resumoHora({ hora_ini, hora_fim })}` }
  },
  async executar(db, ctx, p) {
    const n = await db.exec(
      'UPDATE tarefas SET hora_ini = $3, hora_fim = $4, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 AND arquivado_em IS NULL',
      [p.tarefa_id, ctx.empresaId, p.hora_ini, p.hora_fim])
    if (!n) throw naoEncontrado('A tarefa não existe mais.')
    return { tarefa_id: p.tarefa_id }
  }
}

E.tdel = {
  chaves: () => ['tdel'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const t = await tarefaNoAlcance(db, req, e.tarefa_id)
    return { payload: { tarefa_id: t.id }, unidadeId: t.unidade_id, titulo: `Excluir tarefa · ${t.titulo}`, detalhe: 'Remove a tarefa. O histórico fica.' }
  },
  async executar(db, ctx, p) {
    const n = await db.exec(
      `UPDATE tarefas SET ativa = false, arquivado_em = now(), atualizado_em = now()
       WHERE empresa_id = $2 AND (id = $1 OR pai_id = $1) AND arquivado_em IS NULL`, [p.tarefa_id, ctx.empresaId])
    if (!n) throw naoEncontrado('A tarefa não existe mais.')
    return { tarefa_id: p.tarefa_id }
  }
}

E.toff = {
  chaves: () => ['toff'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const t = await tarefaNoAlcance(db, req, e.tarefa_id)
    return { payload: { tarefa_id: t.id }, unidadeId: t.unidade_id, titulo: `Desativar tarefa · ${t.titulo}`, detalhe: 'Sai do dia sem apagar.' }
  },
  async executar(db, ctx, p) {
    const n = await db.exec('UPDATE tarefas SET ativa = false, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 AND arquivado_em IS NULL', [p.tarefa_id, ctx.empresaId])
    if (!n) throw naoEncontrado('A tarefa não existe mais.')
    return { tarefa_id: p.tarefa_id, ativa: false }
  }
}

E.ttog = {
  chaves: () => ['toff'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const t = await tarefaNoAlcance(db, req, e.tarefa_id)
    return { payload: { tarefa_id: t.id, ativa: !t.ativa }, unidadeId: t.unidade_id, titulo: `${t.ativa ? 'Desativar' : 'Reativar'} tarefa · ${t.titulo}`, detalhe: t.ativa ? 'Sai do dia sem apagar.' : 'Volta para o dia.' }
  },
  async executar(db, ctx, p) {
    const n = await db.exec('UPDATE tarefas SET ativa = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 AND arquivado_em IS NULL', [p.tarefa_id, ctx.empresaId, p.ativa])
    if (!n) throw naoEncontrado('A tarefa não existe mais.')
    return { tarefa_id: p.tarefa_id, ativa: p.ativa }
  }
}

E.tdup = {
  chaves: () => ['tdup'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const t = await tarefaNoAlcance(db, req, e.tarefa_id)
    return { payload: { tarefa_id: t.id }, unidadeId: t.unidade_id, titulo: `Duplicar tarefa · ${t.titulo}`, detalhe: `${t.titulo} (cópia)` }
  },
  async executar(db, ctx, p) {
    const t = await tarefas.ativa(db, ctx.empresaId, p.tarefa_id)
    const copiar = async (orig, paiId) => {
      const campos = Object.fromEntries(tarefas.COLUNAS.map((k) => [k, orig[k]]))
      if (!paiId) campos.titulo = `${orig.titulo} (cópia)`.slice(0, 120)
      campos.pai_id = paiId
      return tarefas.criar(db, ctx.empresaId, campos, ctx.ator.id)
    }
    const nova = await copiar(t, null)
    const filhas = await db.q('SELECT * FROM tarefas WHERE pai_id = $1 AND arquivado_em IS NULL ORDER BY ordem, id', [t.id])
    for (const f of filhas) await copiar(f, nova.id)
    return { tarefa_id: nova.id }
  }
}

// Dias fechados
async function validarDiaFechado(db, req, e) {
  const data = v.data(e.data, 'a data', { obrigatorio: true })
  const motivo = v.texto(e.motivo, 'o motivo', { obrigatorio: true, max: 120 })
  const todas = e.todas_unidades === true
  if (todas && !req.acesso.admin) throw proibido('Só o admin cadastra dia fechado para todas as unidades.')
  const lista = todas ? [] : [...new Set(v.lista(e.unidades, 'as unidades').map((x) => v.id(x, 'a unidade')))]
  if (!todas && !lista.length) throw invalido('Escolha ao menos uma unidade.')
  for (const u of lista) { await buscar.unidade(db, req.ator.empresaId, u); conferirUnidade(req, u) }
  const hora_ini = v.hora(e.hora_ini, 'o início')
  const hora_fim = v.hora(e.hora_fim, 'a volta')
  if (!!hora_ini !== !!hora_fim) throw invalido('Informe o início e a volta, ou deixe o dia todo.')
  if (hora_ini && hora_fim <= hora_ini) throw invalido('A volta precisa ser depois do fechamento.')
  return { data, motivo, todas_unidades: todas, unidades: lista, repetir_anual: e.repetir_anual === true, hora_ini, hora_fim }
}

async function inserirDiaFechado(db, ctx, p) {
  const d = await db.um(
    `INSERT INTO dias_fechados (empresa_id, data, motivo, todas_unidades, repetir_anual, hora_ini, hora_fim, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [ctx.empresaId, p.data, p.motivo, p.todas_unidades, p.repetir_anual, p.hora_ini, p.hora_fim, ctx.ator.id])
  for (const u of p.unidades) {
    await buscar.unidade(db, ctx.empresaId, u)
    await db.exec('INSERT INTO dias_fechados_unidades (dia_fechado_id, unidade_id) VALUES ($1, $2)', [d.id, u])
  }
  return d.id
}

E.dia = {
  chaves: () => ['dias'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await validarDiaFechado(db, req, e)
    return { payload: p, unidadeId: p.unidades[0] || null, titulo: 'Cadastrar dia fechado', detalhe: `${p.data} · ${p.motivo} · ${p.hora_ini ? `das ${p.hora_ini} às ${p.hora_fim}` : 'o dia todo'}` }
  },
  async executar(db, ctx, p) {
    return { dia_fechado_id: await inserirDiaFechado(db, ctx, p) }
  }
}

E.diarm = {
  chaves: () => ['dias'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const d = await buscar.diaFechado(db, req.ator.empresaId, v.id(e.dia_fechado_id, 'o dia fechado'))
    const us = await db.q('SELECT unidade_id FROM dias_fechados_unidades WHERE dia_fechado_id = $1', [d.id])
    if (!req.acesso.admin) {
      if (d.todas_unidades || us.length > 1) throw proibido('Um dia que vale para várias unidades só pode ser removido na visão "Todas as unidades".')
      for (const u of us) conferirUnidade(req, u.unidade_id)
    }
    if (e.unidade_id && (d.todas_unidades || us.length > 1)) {
      throw conflito('Um dia que vale para várias unidades só pode ser removido na visão "Todas as unidades".')
    }
    return { payload: { dia_fechado_id: d.id }, unidadeId: us[0]?.unidade_id || null, titulo: 'Remover dia fechado', detalhe: `${d.data} · ${d.motivo || ''}` }
  },
  async executar(db, ctx, p) {
    const n = await db.exec('DELETE FROM dias_fechados WHERE id = $1 AND empresa_id = $2', [p.dia_fechado_id, ctx.empresaId])
    if (!n) throw naoEncontrado('O dia fechado não existe mais.')
    return { dia_fechado_id: p.dia_fechado_id }
  }
}

E.diapre = {
  chaves: () => ['dias'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const todas = req.acesso.admin && e.todas_unidades !== false
    const lista = todas ? [] : [...new Set(v.lista(e.unidades, 'as unidades').map((x) => v.id(x, 'a unidade')))]
    if (!todas && !lista.length) throw invalido('Escolha ao menos uma unidade.')
    for (const u of lista) { await buscar.unidade(db, req.ator.empresaId, u); conferirUnidade(req, u) }
    return { payload: { todas_unidades: todas, unidades: lista }, unidadeId: lista[0] || null, titulo: 'Adicionar feriados nacionais', detalhe: 'Próximos 12 meses' }
  },
  async executar(db, ctx, p) {
    const fuso = 'America/Sao_Paulo'
    let criados = 0
    for (const f of unidades.proximosFeriados(tempo.hoje(fuso))) {
      const ja = await db.um(
        `SELECT 1 FROM dias_fechados d WHERE d.empresa_id = $1 AND d.data = $2
           AND (d.todas_unidades OR ($3::bigint[] <> '{}' AND EXISTS (SELECT 1 FROM dias_fechados_unidades x WHERE x.dia_fechado_id = d.id AND x.unidade_id = ANY($3))))`,
        [ctx.empresaId, f.data, p.unidades])
      if (ja) continue
      await inserirDiaFechado(db, ctx, { ...f, todas_unidades: p.todas_unidades, unidades: p.unidades, hora_ini: null, hora_fim: null })
      criados++
    }
    return { criados }
  }
}

// Unidade
E.udom = {
  chaves: () => ['hor'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const u = await buscar.unidade(db, req.ator.empresaId, v.id(e.unidade_id, 'a unidade'))
    conferirUnidade(req, u.id)
    const dia = unidades.validarDia(e)
    const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
    return { payload: { unidade_id: u.id, ...dia }, unidadeId: u.id, titulo: `Alterar horário · ${u.nome}`, detalhe: `${nomes[dia.dia_semana]}: ${dia.ativo ? dia.turnos.map((t) => `${t.abre}–${t.fecha}`).join(', ') : 'fechado'}` }
  },
  async executar(db, ctx, p) {
    await buscar.unidade(db, ctx.empresaId, p.unidade_id)
    await unidades.gravarDias(db, p.unidade_id, [unidades.validarDia(p)])
    return { unidade_id: p.unidade_id }
  }
}

E.usem = {
  chaves: (p) => (p.local && Object.keys(p.local).length ? ['hor', 'loc'] : ['hor']),
  aprovador: 'admin',
  async preparar(db, req, e) {
    const u = await buscar.unidade(db, req.ator.empresaId, v.id(e.unidade_id, 'a unidade'))
    conferirUnidade(req, u.id)
    const semana = e.semana ? unidades.validarSemana(e.semana) : []
    const local = unidades.validarLocal(e)
    if (!semana.length && !Object.keys(local).length) throw invalido('Nada para alterar.')
    return { payload: { unidade_id: u.id, semana, local }, unidadeId: u.id, titulo: `Alterar horário e local · ${u.nome}`, detalhe: local.raio_m ? `raio ${local.raio_m} m` : 'horário da semana' }
  },
  async executar(db, ctx, p) {
    await buscar.unidade(db, ctx.empresaId, p.unidade_id)
    if (p.semana.length) await unidades.gravarDias(db, p.unidade_id, unidades.validarSemana(p.semana))
    const l = p.local || {}
    if (Object.keys(l).length) {
      await db.exec(
        `UPDATE unidades SET lat = COALESCE($3, lat), lng = COALESCE($4, lng), raio_m = COALESCE($5, raio_m), atualizado_em = now()
         WHERE id = $1 AND empresa_id = $2`, [p.unidade_id, ctx.empresaId, l.lat ?? null, l.lng ?? null, l.raio_m ?? null])
    }
    return { unidade_id: p.unidade_id }
  }
}

E.gutog = {
  chaves: () => ['abre'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const u = await buscar.unidade(db, req.ator.empresaId, v.id(e.unidade_id, 'a unidade'))
    conferirUnidade(req, u.id)
    if (u.arquivado_em) throw invalido('A unidade está arquivada.')
    const aberta = v.bool(e.aberta, 'aberta', { obrigatorio: true })
    return { payload: { unidade_id: u.id, aberta }, unidadeId: u.id, titulo: `${aberta ? 'Abrir' : 'Fechar'} a unidade`, detalhe: `${u.nome} · ${aberta ? 'as tarefas voltam a contar' : 'as tarefas deixam de contar'}` }
  },
  async executar(db, ctx, p) {
    const u = await buscar.unidade(db, ctx.empresaId, p.unidade_id)
    await db.exec('UPDATE unidades SET aberta_hoje = $3, aberta_hoje_data = $4, atualizado_em = now() WHERE id = $1 AND empresa_id = $2',
      [u.id, ctx.empresaId, p.aberta, tempo.hoje(u.fuso)])
    return { unidade_id: u.id, aberta: p.aberta }
  }
}

// Pessoas
E.plhs = {
  chaves: () => ['hor'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    let h = { login_ini: null, login_fim: null, login_tol_min: null }
    if (e.livre !== true) {
      h = {
        login_ini: v.hora(e.login_ini, 'a entrada', { obrigatorio: true }),
        login_fim: v.hora(e.login_fim, 'a saída', { obrigatorio: true }),
        login_tol_min: v.umDe(e.login_tol_min ?? 0, 'a tolerância', [0, 10, 15, 30])
      }
      if (h.login_fim <= h.login_ini) throw invalido('A saída precisa ser depois da entrada.')
    }
    return { payload: { colaborador_id: p.id, ...h }, unidadeId: p.unidade_principal_id, titulo: `Horário de login · ${p.nome}`, detalhe: h.login_ini ? `Entra das ${h.login_ini} às ${h.login_fim} · tolerância ${h.login_tol_min} min` : 'Livre, sem horário' }
  },
  async executar(db, ctx, p) {
    const n = await db.exec('UPDATE colaboradores SET login_ini = $3, login_fim = $4, login_tol_min = $5, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL',
      [p.colaborador_id, ctx.empresaId, p.login_ini, p.login_fim, p.login_tol_min])
    if (!n) throw naoEncontrado('A pessoa não existe mais.')
    return { colaborador_id: p.colaborador_id }
  }
}

E.pin = {
  chaves: () => ['pin'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    if (p.situacao !== 'ativo') throw invalido('Só dá para gerar PIN para quem está ativo.')
    // Pedido do próprio colaborador ("Alterar meu PIN") vem com o motivo.
    const motivo = v.texto(e.motivo, 'o motivo', { max: 140 })
    return { payload: { colaborador_id: p.id }, unidadeId: p.unidade_principal_id, titulo: `Novo PIN · ${p.nome}`, detalhe: (motivo ? motivo + ' · ' : '') + 'O PIN atual deixa de valer.' }
  },
  async executar(db, ctx, p) {
    const c = await buscar.colaborador(db, ctx.empresaId, p.colaborador_id)
    if (c.situacao !== 'ativo') throw invalido('A pessoa não está ativa.')
    const pin = await novoPin(db, c.id)
    await convite(c)
    return { colaborador_id: c.id, pin }
  }
}

E.lib = {
  chaves: () => ['lib'],
  aprovador: 'lib',
  async preparar() { throw invalido('A liberação é pedida no login.') },
  // Gera um código de 6 números para quem aprovou passar à pessoa (aparece
  // uma vez; no pedido fica só o hash). A pessoa pode entrar com o código ou
  // simplesmente tentando de novo.
  async executar(db, ctx, p) {
    const { randomInt } = require('crypto')
    const codigo = String(randomInt(0, 1000000)).padStart(6, '0')
    return { colaborador_id: p.colaborador_id, unidade_id: p.unidade_id, usado_em: null, codigo }
  }
}

E.sup = {
  chaves: () => [],
  aprovador: 'admin',
  async preparar() { throw invalido('O acesso de suporte é pedido pela plataforma.') },
  async executar(db, ctx, p) {
    if (ctx.ator.tipo !== 'admin') throw proibido('Só o admin libera o suporte.')
    const r = await db.um(
      `UPDATE acessos_suporte SET autorizado_por_admin_id = $3, inicio = now(), fim = now() + interval '1 hour'
       WHERE id = $1 AND empresa_id = $2 AND inicio IS NULL RETURNING fim`, [p.acesso_suporte_id, ctx.empresaId, ctx.ator.id])
    if (!r) throw naoEncontrado('O pedido de suporte não existe mais.')
    return { acesso_suporte_id: p.acesso_suporte_id, fim: r.fim }
  }
}

E.cad = {
  chaves: () => ['equipe'],
  aprovador: 'admin',
  async preparar() { throw invalido('O cadastro é feito pela rota de colaboradores.') },
  async executar(db, ctx, p) {
    const c = await buscar.colaborador(db, ctx.empresaId, p.colaborador_id)
    if (c.situacao !== 'aguardando') throw conflito('Esse cadastro já foi decidido.')
    await db.exec(`UPDATE colaboradores SET situacao = 'ativo', atualizado_em = now() WHERE id = $1`, [c.id])
    const pin = await novoPin(db, c.id)
    await convite(c)
    return { colaborador_id: c.id, pin }
  },
  // Negar o cadastro arquiva a pessoa.
  async negar(db, ctx, p) {
    await db.exec(
      `UPDATE colaboradores SET situacao = 'arquivado', arquivado_em = now(), arquivado_por = $3, token_versao = token_versao + 1
       WHERE id = $1 AND empresa_id = $2 AND situacao = 'aguardando'`, [p.colaborador_id, ctx.empresaId, ctx.ator.id])
  }
}

async function validarDadosPessoa(db, req, e, atual) {
  const d = {}
  if ('nome' in e) d.nome = v.texto(e.nome, 'o nome', { obrigatorio: true, max: 80 })
  if ('celular' in e) { d.celular = v.celular(e.celular, { obrigatorio: true }); await celularLivre(db, req.ator.empresaId, d.celular, atual.id) }
  if ('unidade_principal_id' in e) {
    d.unidade_principal_id = v.id(e.unidade_principal_id, 'a unidade')
    await buscar.unidade(db, req.ator.empresaId, d.unidade_principal_id)
    conferirUnidade(req, d.unidade_principal_id)
  }
  if ('cargo_id' in e) {
    d.cargo_id = v.id(e.cargo_id, 'o cargo')
    const cg = await buscar.cargo(db, req.ator.empresaId, d.cargo_id)
    if (cg.arquivado_em) throw invalido('O cargo está arquivado.')
    if (cg.unidade_id !== (d.unidade_principal_id || atual.unidade_principal_id)) throw invalido('O cargo precisa ser da unidade principal.')
  } else if (d.unidade_principal_id && d.unidade_principal_id !== atual.unidade_principal_id) {
    throw invalido('Ao trocar a unidade, escolha também o cargo dela.')
  }
  if (!Object.keys(d).length) throw invalido('Nada para alterar.')
  return d
}

E.pedit = {
  chaves: () => ['ecol'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    const dados = await validarDadosPessoa(db, req, e, p)
    const mud = Object.keys(dados).map((k) => `${k}: ${p[k] ?? '—'} → ${dados[k]}`).join(' · ')
    return { payload: { colaborador_id: p.id, dados }, unidadeId: p.unidade_principal_id, titulo: `Editar dados · ${p.nome}`, detalhe: mud }
  },
  async executar(db, ctx, p) {
    const c = await buscar.colaborador(db, ctx.empresaId, p.colaborador_id)
    const d = p.dados
    if (d.celular) await celularLivre(db, ctx.empresaId, d.celular, c.id)
    if (d.cargo_id) {
      const cg = await buscar.cargo(db, ctx.empresaId, d.cargo_id)
      if (cg.unidade_id !== (d.unidade_principal_id || c.unidade_principal_id)) throw invalido('O cargo precisa ser da unidade principal.')
    }
    const cols = Object.keys(d)
    await db.exec(
      `UPDATE colaboradores SET ${cols.map((k, i) => `${k} = $${i + 3}`).join(', ')}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2`,
      [c.id, ctx.empresaId, ...cols.map((k) => d[k])])
    if (d.unidade_principal_id) {
      await db.exec('INSERT INTO colaborador_unidades (colaborador_id, unidade_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [c.id, d.unidade_principal_id])
    }
    return { colaborador_id: c.id }
  }
}

E.cel = {
  chaves: () => ['ecol'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    const celular = v.celular(e.celular, { obrigatorio: true })
    await celularLivre(db, req.ator.empresaId, celular, p.id)
    return { payload: { colaborador_id: p.id, celular }, unidadeId: p.unidade_principal_id, titulo: `Completar celular · ${p.nome}`, detalhe: `Celular: ${celular}` }
  },
  async executar(db, ctx, p) {
    await buscar.colaborador(db, ctx.empresaId, p.colaborador_id)
    await celularLivre(db, ctx.empresaId, p.celular, p.colaborador_id)
    await db.exec('UPDATE colaboradores SET celular = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2', [p.colaborador_id, ctx.empresaId, p.celular])
    return { colaborador_id: p.colaborador_id }
  }
}

function validarRegra(e) {
  if (e.regra === null || (e.regra && e.regra.tipo === 'depois')) return { tipo: 'depois' }
  const r = e.regra || {}
  const tipo = v.umDe(r.tipo, 'o tipo de bônus', ['tarefa', 'fixo'], { obrigatorio: true })
  const regra = {
    tipo,
    valor_feita: tipo === 'tarefa' ? v.numero(r.valor_feita, 'o valor por feita', { obrigatorio: true, min: 0, max: 100000 }) : null,
    valor_nao_feita: v.numero(r.valor_nao_feita ?? 0, 'o desconto por não feita', { min: 0, max: 100000 }),
    valor_mes: tipo === 'fixo' ? v.numero(r.valor_mes, 'o valor do mês', { obrigatorio: true, min: 0, max: 1000000 }) : null,
    atraso_ativo: r.atraso_ativo === true
  }
  if (regra.atraso_ativo) {
    regra.atraso_tol_min = v.inteiro(r.atraso_tol_min, 'a tolerância do atraso', { obrigatorio: true, min: 0, max: 120 })
    regra.atraso_desconto = v.numero(r.atraso_desconto, 'o desconto do atraso', { obrigatorio: true, min: 0, max: 100000 })
  }
  return regra
}

E.rg = {
  chaves: () => ['regra'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    const regra = validarRegra(e)
    const txt = regra.tipo === 'tarefa' ? `por tarefa +${regra.valor_feita} / −${regra.valor_nao_feita}`
      : regra.tipo === 'fixo' ? `fixo ${regra.valor_mes} / −${regra.valor_nao_feita}` : 'definir depois'
    return { payload: { colaborador_id: p.id, regra }, unidadeId: p.unidade_principal_id, titulo: `Regra do bônus · ${p.nome}`, detalhe: txt }
  },
  // Regra nova vale de hoje em diante (não muda o passado).
  async executar(db, ctx, p) {
    const c = await buscar.colaborador(db, ctx.empresaId, p.colaborador_id)
    const u = await buscar.unidade(db, ctx.empresaId, c.unidade_principal_id)
    const r = p.regra
    const desde = tempo.hoje(u.fuso)
    await db.exec(
      `INSERT INTO regras_bonus (colaborador_id, tipo, valor_feita, valor_nao_feita, valor_mes, atraso_ativo, atraso_tol_min, atraso_desconto, vigente_desde, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (colaborador_id, vigente_desde) DO UPDATE SET tipo = EXCLUDED.tipo, valor_feita = EXCLUDED.valor_feita,
         valor_nao_feita = EXCLUDED.valor_nao_feita, valor_mes = EXCLUDED.valor_mes, atraso_ativo = EXCLUDED.atraso_ativo,
         atraso_tol_min = EXCLUDED.atraso_tol_min, atraso_desconto = EXCLUDED.atraso_desconto, criado_por = EXCLUDED.criado_por`,
      [c.id, r.tipo, r.valor_feita ?? null, r.tipo === 'depois' ? null : r.valor_nao_feita ?? 0, r.valor_mes ?? null,
        !!r.atraso_ativo, r.atraso_tol_min ?? null, r.atraso_desconto ?? null, desde, ctx.ator.id])
    return { colaborador_id: c.id, vigente_desde: desde }
  }
}

E.arq = {
  chaves: () => ['arq'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    if (p.id === req.ator.id && req.ator.tipo === 'colaborador') throw invalido('Você não pode arquivar a si mesmo.')
    if (p.situacao === 'arquivado') throw conflito('Essa pessoa já está arquivada.')
    return { payload: { colaborador_id: p.id }, unidadeId: p.unidade_principal_id, titulo: `Arquivar · ${p.nome}`, detalhe: 'Deixa de entrar e sai das listas. Pode restaurar.' }
  },
  async executar(db, ctx, p) {
    const n = await db.exec(
      `UPDATE colaboradores SET situacao = 'arquivado', arquivado_em = now(), arquivado_por = $3, token_versao = token_versao + 1, atualizado_em = now()
       WHERE id = $1 AND empresa_id = $2 AND situacao <> 'arquivado' AND excluido_em IS NULL`, [p.colaborador_id, ctx.empresaId, ctx.ator.id])
    if (!n) throw conflito('Essa pessoa já está arquivada.')
    return { colaborador_id: p.colaborador_id }
  }
}

E.rest = {
  chaves: () => ['arq'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    if (p.situacao !== 'arquivado') throw conflito('Essa pessoa não está arquivada.')
    return { payload: { colaborador_id: p.id }, unidadeId: p.unidade_principal_id, titulo: `Restaurar · ${p.nome}`, detalhe: 'Volta para a equipe.' }
  },
  async executar(db, ctx, p) {
    const n = await db.exec(
      `UPDATE colaboradores SET situacao = 'ativo', arquivado_em = NULL, arquivado_por = NULL, atualizado_em = now()
       WHERE id = $1 AND empresa_id = $2 AND situacao = 'arquivado' AND excluido_em IS NULL`, [p.colaborador_id, ctx.empresaId])
    if (!n) throw conflito('Essa pessoa não está arquivada.')
    return { colaborador_id: p.colaborador_id }
  }
}

E.del = {
  chaves: () => ['del'],
  aprovador: 'admin',
  async preparar(db, req, e) {
    const p = await pessoaNoAlcance(db, req, e.colaborador_id)
    if (p.situacao !== 'arquivado') throw conflito('Só dá para excluir quem já foi arquivado.')
    return { payload: { colaborador_id: p.id }, unidadeId: p.unidade_principal_id, titulo: `Excluir · ${p.nome}`, detalhe: 'Tira a pessoa da equipe. O histórico de tarefas fica.' }
  },
  // Não apaga a linha: o histórico de execuções continua ligado a ela.
  async executar(db, ctx, p) {
    const n = await db.exec(
      `UPDATE colaboradores SET excluido_em = now(), excluido_por = $3, celular = NULL, pin_hash = NULL, token_versao = token_versao + 1
       WHERE id = $1 AND empresa_id = $2 AND situacao = 'arquivado' AND excluido_em IS NULL`, [p.colaborador_id, ctx.empresaId, ctx.ator.id])
    if (!n) throw conflito('Só dá para excluir quem já foi arquivado.')
    return { colaborador_id: p.colaborador_id }
  }
}

module.exports = E
