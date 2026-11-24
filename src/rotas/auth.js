// Login e sessão (§10, roteiro item 4, D11, D17, Segurança 1–3).
const express = require('express')
const db = require('../db')
const config = require('../config')
const v = require('../lib/validar')
const { confere, hashSenha, sha256, tokenAleatorio } = require('../lib/segredos')
const { distanciaM } = require('../lib/geo')
const tempo = require('../lib/tempo')
const { enviar } = require('../lib/envio')
const { registrar } = require('../lib/registro')
const { naoAutenticado, proibido, naoEncontrado, invalido, conflito } = require('../lib/erros')
const tentativas = require('../auth/tentativas')
const { assinar, autenticar, carregarAtor } = require('../auth/sessao')
const pedidos = require('../pedidos/servico')
const agenda = require('../servicos/agenda')

const r = express.Router()

function respostaSessao(ator, acesso, extra = {}) {
  return {
    token: assinar(ator),
    expira_em: ator.tipo === 'admin' ? config.sessao.admin : config.sessao.equipe,
    quem: {
      tipo: ator.tipo, id: ator.id, nome: ator.nome, empresa_id: ator.empresaId,
      perfil: acesso.admin ? 'admin' : acesso.perfilCargo,
      permissoes: [...acesso.chaves].sort(),
      unidades: [...acesso.unidades]
    },
    ...extra
  }
}

// Quem pode liberar a entrada na unidade (Coordenação com "lib"); só nome e cargo.
async function aprovadores(unidadeId, menosId) {
  return db.q(
    `SELECT c.nome, cg.nome AS cargo FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id
     JOIN perfil_permissoes pp ON pp.perfil_id = COALESCE(c.perfil_acesso_id, cg.perfil_acesso_id) AND pp.chave = 'lib' AND pp.permitido
     WHERE c.situacao = 'ativo' AND c.excluido_em IS NULL AND c.id <> $2
       AND EXISTS (SELECT 1 FROM colaborador_unidades cu WHERE cu.colaborador_id = c.id AND cu.unidade_id = $1)
     ORDER BY (lower(cg.nome) = 'gerente') DESC, c.nome LIMIT 5`, [unidadeId, menosId])
}

// ---- Admin: e-mail + senha --------------------------------------------------
r.post('/auth/admin/entrar', async (req, res) => {
  const email = v.email(req.body.email, { obrigatorio: true })
  const senha = v.texto(req.body.senha, 'a senha', { obrigatorio: true, max: 200 })
  await tentativas.conferirBloqueio('admin', email)
  const a = await db.um('SELECT id, senha_hash FROM admins WHERE lower(email) = $1', [email])
  if (!a || !(await confere(senha, a.senha_hash))) {
    await tentativas.falhou('admin', email)
    throw naoAutenticado('E-mail ou senha incorretos.')
  }
  await tentativas.acertou('admin', email)
  await db.exec('UPDATE admins SET ultimo_login_em = now() WHERE id = $1', [a.id])
  const { ator, acesso } = await carregarAtor('admin', a.id)
  if (ator.situacaoEmpresa === 'bloqueada') throw proibido('A conta está bloqueada. Fale com o responsável pela assinatura.')
  await registrar(db, { empresaId: ator.empresaId, ator, acao: 'login.admin' })
  res.json(respostaSessao(ator, acesso))
})

// Motivos da liberação (§10).
const MOTIVOS = { cheguei_antes: 'cheguei antes', cobrir_outra_unidade: 'vou cobrir outra unidade', gps_nao_achou: 'o GPS não achou o local' }

// ---- Cadastro de cliente novo (§21) -----------------------------------------
// 1) /cadastro/codigo: manda um código de 6 números ao WhatsApp (envio
//    SIMULADO nesta fase: vai para a caixa local, nunca para fora).
// 2) /cadastro: confere o código e cria empresa (trial de 30 dias, sem dados de
//    pagamento), admin, primeira unidade, cargos e perfis; já devolve a sessão.
const { randomInt } = require('crypto')
r.get('/planos', async (req, res) => {
  res.json(await db.q('SELECT slug, nome, preco_mensal, unidades_inclusas, max_unidades, max_colaboradores, preco_unidade_extra, meses_cobrados_no_anual FROM planos_catalogo WHERE ativo ORDER BY preco_mensal'))
})
r.post('/cadastro/codigo', async (req, res) => {
  const celular = v.celular(req.body.celular, { obrigatorio: true })
  const chave = `cadastro:${req.ip}`
  await tentativas.conferirBloqueio('admin', chave)
  await tentativas.falhou('admin', chave, { maxFalhas: 10 })   // cada envio conta: no máximo 10 por janela
  const codigo = String(randomInt(0, 1000000)).padStart(6, '0')
  await db.exec(`INSERT INTO cadastro_codigos (celular, codigo_hash, expira_em) VALUES ($1, $2, now() + interval '15 minutes')`, [celular, sha256(`${celular}:${codigo}`)])
  await enviar({ canal: 'whatsapp', destino: celular, assunto: 'Código Valida', texto: `Seu código do Valida é ${codigo}. Vale por 15 minutos.` })
  res.json({ ok: true, expira_min: 15 })
})
r.post('/cadastro', async (req, res) => {
  const b = req.body
  const nome = v.texto(b.nome, 'seu nome', { obrigatorio: true, max: 80 })
  const celular = v.celular(b.celular, { obrigatorio: true })
  const email = v.email(b.email, { obrigatorio: true })
  const senha = v.texto(b.senha, 'a senha', { obrigatorio: true, max: 200 })
  if (senha.length < 8) throw invalido('A senha precisa ter 8 caracteres ou mais.')
  if (b.aceite_termos !== true) throw invalido('Aceite os termos para continuar.')
  const plano = b.plano == null ? null : v.umDe(b.plano, 'o plano', ['ess', 'pro', 'rede'])
  const ciclo = v.umDe(b.ciclo ?? 'mensal', 'o ciclo', ['mensal', 'anual'])
  const empresa = v.texto(b.empresa, 'o nome da empresa', { obrigatorio: true, max: 120 })
  const segmento = v.texto(b.segmento, 'o segmento', { max: 40 })
  const unidadeNome = v.texto(b.unidade, 'o nome da unidade', { obrigatorio: true, max: 80 })
  const cidade = v.texto(b.cidade, 'a cidade', { max: 80 })
  const dias = [...new Set(v.lista(b.dias ?? [1, 2, 3, 4, 5, 6], 'os dias').map((d) => v.inteiro(d, 'o dia', { obrigatorio: true, min: 0, max: 6 })))]
  const codigo = String(b.codigo || '').replace(/\D/g, '')
  await tentativas.conferirBloqueio('admin', `cadcod:${celular}`)
  const c = await db.um(`SELECT id, codigo_hash FROM cadastro_codigos WHERE celular = $1 AND usado_em IS NULL AND expira_em > now() ORDER BY criado_em DESC LIMIT 1`, [celular])
  if (!c || c.codigo_hash !== sha256(`${celular}:${codigo}`)) {
    await tentativas.falhou('admin', `cadcod:${celular}`)
    throw invalido('Código incorreto ou vencido. Peça outro.')
  }
  if (await db.um('SELECT 1 FROM admins WHERE lower(email) = $1', [email])) throw conflito('Esse e-mail já tem conta. Use "Já tenho conta".')
  const pc = plano ? await db.um('SELECT * FROM planos_catalogo WHERE slug = $1', [plano]) : null
  const { garantirPerfisFixos, criarCargosPadrao } = require('../servicos/padroes')
  const servUnid = require('../servicos/unidades')
  const adminId = await db.tx(async (t) => {
    await t.exec('UPDATE cadastro_codigos SET usado_em = now() WHERE id = $1', [c.id])
    const e = await t.um(
      `INSERT INTO empresas (nome, segmento, plano, ciclo, situacao, trial_ate, config) VALUES ($1, $2, $3, $4, 'teste', $6,
         '{"nf_padrao_min": 120, "tol_atraso_min": 10, "raio_padrao_m": 100}'::jsonb || jsonb_build_object('trial_completo', $5::boolean)) RETURNING id`,
      [empresa, segmento, plano, ciclo, !plano, new Date(tempo.agora().getTime() + 30 * 86400000)])
    await t.exec(`INSERT INTO assinaturas (empresa_id, plano, ciclo, valor, situacao) VALUES ($1, $2, $3, $4, 'teste')`, [e.id, plano, ciclo, pc ? pc.preco_mensal : null])
    const a = await t.um('INSERT INTO admins (empresa_id, nome, email, celular, senha_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id', [e.id, nome, email, celular, await hashSenha(senha)])
    await garantirPerfisFixos(t, e.id)
    const u = await t.um(`INSERT INTO unidades (empresa_id, nome, cidade, raio_m) VALUES ($1, $2, $3, 100) RETURNING id`, [e.id, unidadeNome, cidade])
    await criarCargosPadrao(t, e.id, u.id)
    await t.exec('INSERT INTO config_notificacoes (unidade_id) VALUES ($1)', [u.id])
    // Horário inicial 08:00–18:00 nos dias escolhidos (ajustável em Horário e local).
    await servUnid.gravarDias(t, u.id, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, ativo: dias.includes(d), turnos: dias.includes(d) ? [{ abre: '08:00', fecha: '18:00' }] : [] })))
    await registrar(t, { empresaId: e.id, ator: { tipo: 'admin', id: a.id, nome }, acao: 'empresa.criada', entidade: 'empresa', entidadeId: e.id, detalhe: { plano, ciclo, segmento } })
    return a.id
  })
  await tentativas.acertou('admin', `cadcod:${celular}`)
  const { ator, acesso } = await carregarAtor('admin', adminId)
  res.status(201).json(respostaSessao(ator, acesso))
})

// ---- Equipe: celular + PIN + localização ------------------------------------
// Respostas além do token: estado = escolher_unidade | localizacao_necessaria |
// fora_do_local | aguardando_liberacao | fora_do_horario.
r.post('/auth/entrar', async (req, res) => {
  const celular = v.celular(req.body.celular, { obrigatorio: true })
  const pin = v.pin(req.body.pin)
  await tentativas.conferirBloqueio('equipe', celular)

  const candidatos = await db.q(
    `SELECT c.id, c.pin_hash, c.situacao FROM colaboradores c
     WHERE c.celular = $1 AND c.excluido_em IS NULL AND c.situacao <> 'arquivado'`, [celular])
  // Erro sempre genérico: não revela se o celular existe (decisão 5, Parte B).
  const GENERICO = 'Celular ou PIN incorretos.'
  if (!candidatos.length) {
    await tentativas.falhou('equipe', celular)
    throw naoAutenticado(GENERICO)
  }
  let achado = null
  for (const c of candidatos) if (await confere(pin, c.pin_hash)) { achado = c; break }
  if (!achado) {
    await tentativas.falhou('equipe', celular)
    throw naoAutenticado(GENERICO)
  }
  await tentativas.acertou('equipe', celular)
  if (achado.situacao === 'aguardando') throw proibido('Seu cadastro ainda está aguardando aprovação.')

  const { ator, acesso } = await carregarAtor('colaborador', achado.id)
  if (ator.situacaoEmpresa === 'bloqueada') throw proibido('A conta está bloqueada. Fale com o responsável pela empresa.')

  // Unidade de entrada.
  const minhas = await db.q(
    `SELECT u.* FROM unidades u JOIN colaborador_unidades cu ON cu.unidade_id = u.id
     WHERE cu.colaborador_id = $1 AND u.arquivado_em IS NULL ORDER BY (u.id = $2) DESC, u.nome`, [ator.id, ator.unidadePrincipalId])
  if (!minhas.length) throw proibido('Você não está em nenhuma unidade ativa. Fale com o admin.')
  let unidade
  if (req.body.unidade_id !== undefined && req.body.unidade_id !== null) {
    unidade = minhas.find((u) => u.id === Number(req.body.unidade_id))
    if (!unidade) throw naoEncontrado('Unidade não encontrada.')
  } else if (minhas.length > 1) {
    return res.json({ estado: 'escolher_unidade', unidades: minhas.map((u) => ({ id: u.id, nome: u.nome })) })
  } else {
    unidade = minhas[0]
  }

  // Horário de login da pessoa (janela + tolerância). Livre se não definido.
  const me = await db.um('SELECT login_ini, login_fim, login_tol_min FROM colaboradores WHERE id = $1', [ator.id])
  if (me.login_ini && me.login_fim) {
    const agora = tempo.minutos(tempo.horaAgora(unidade.fuso, tempo.agora()))
    const ini = tempo.minutos(me.login_ini) - (me.login_tol_min || 0)
    const fim = tempo.minutos(me.login_fim)
    if (agora < ini || agora > fim) {
      return res.status(403).json({ estado: 'fora_do_horario', erro: `Seu horário de entrada é das ${String(me.login_ini).slice(0, 5)} às ${String(me.login_fim).slice(0, 5)}.` })
    }
  }

  // Localização (só no login). "dispensa" pula a conferência.
  let lat = null, lng = null, distancia = null, dentro = null, liberadoPor = null
  const dispensa = acesso.chaves.has('dispensa')
  if (!dispensa && unidade.lat !== null && unidade.lng !== null) {
    if (req.body.lat === undefined || req.body.lng === undefined || req.body.lat === null || req.body.lng === null) {
      return res.status(400).json({ estado: 'localizacao_necessaria', unidade: unidade.nome, erro: 'Pedimos a localização só agora. Não acompanhamos você durante o dia.' })
    }
    lat = v.numero(req.body.lat, 'a latitude', { obrigatorio: true, min: -90, max: 90 })
    lng = v.numero(req.body.lng, 'a longitude', { obrigatorio: true, min: -180, max: 180 })
    distancia = distanciaM(lat, lng, unidade.lat, unidade.lng)
    dentro = distancia <= unidade.raio_m

    if (!dentro) {
      // Liberação aprovada e ainda não usada: vale UMA entrada.
      const lib = await db.tx(async (t) => {
        const p = await t.um(
          `SELECT id, resultado->>'codigo_hash' AS codigo_hash FROM pedidos WHERE empresa_id = $1 AND tipo = 'lib' AND estado = 'ok' AND solicitante_tipo = 'colaborador'
             AND solicitante_id = $2 AND unidade_id = $3 AND (resultado->>'usado_em') IS NULL
             AND decidido_em > now() - interval '24 hours'
           ORDER BY decidido_em DESC LIMIT 1 FOR UPDATE`, [ator.empresaId, ator.id, unidade.id])
        // Com código digitado, ele precisa conferir.
        if (p && req.body.codigo_liberacao !== undefined && req.body.codigo_liberacao !== null) {
          const cod = String(req.body.codigo_liberacao).replace(/\D/g, '')
          if (p.codigo_hash !== sha256(`${p.id}:${cod}`)) throw invalido('Código incorreto.')
        }
        if (p) await t.exec(`UPDATE pedidos SET resultado = jsonb_set(resultado, '{usado_em}', to_jsonb(now())) WHERE id = $1`, [p.id])
        return p
      })
      if (lib) {
        liberadoPor = lib.id
      } else if (req.body.pedir_liberacao) {
        const motivo = v.umDe(req.body.pedir_liberacao, 'o motivo', ['cheguei_antes', 'cobrir_outra_unidade', 'gps_nao_achou', 'outro'])
        // "Outro" pede o texto (§10).
        const motivoTexto = motivo === 'outro' ? v.texto(req.body.motivo_texto, 'o motivo', { obrigatorio: true, max: 140 }) : null
        const pendente = await db.um(
          `SELECT id FROM pedidos WHERE empresa_id = $1 AND tipo = 'lib' AND estado = 'pend' AND solicitante_id = $2 AND solicitante_tipo = 'colaborador' AND unidade_id = $3`,
          [ator.empresaId, ator.id, unidade.id])
        const pedido = pendente || await pedidos.criarPedido(db, ator, 'lib', {
          unidadeId: unidade.id,
          titulo: `Liberar entrada · ${ator.nome}`,
          detalhe: `${unidade.nome} · a ${distancia} m (raio ${unidade.raio_m} m) · motivo: ${motivoTexto || MOTIVOS[motivo]}`,
          payload: { colaborador_id: ator.id, unidade_id: unidade.id, motivo, motivo_texto: motivoTexto, distancia_m: distancia }
        })
        return res.status(202).json({ estado: 'aguardando_liberacao', pedido_id: pedido.id, distancia_m: distancia, raio_m: unidade.raio_m, unidade: unidade.nome, aprovadores: await aprovadores(unidade.id, ator.id) })
      } else {
        return res.status(403).json({ estado: 'fora_do_local', distancia_m: distancia, raio_m: unidade.raio_m, unidade: unidade.nome, aprovadores: await aprovadores(unidade.id, ator.id), erro: 'Você está fora do local da unidade.' })
      }
    }
  }

  // Atraso de chegada: login × primeira tarefa do dia (vale o primeiro login do dia no bônus).
  await db.tx((x) => agenda.processarUnidade(x, unidade.id))
  const primeira = await db.um(
    `SELECT MIN(e.hora_prevista) AS h FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id
     WHERE e.colaborador_id = $1 AND e.unidade_id = $2 AND e.data = $3 AND t.pai_id IS NULL AND e.estado IN ('a_fazer', 'feita', 'nao_feita')`,
    [ator.id, unidade.id, tempo.hoje(unidade.fuso, tempo.agora())])
  const atraso = primeira && primeira.h ? Math.max(0, tempo.minutos(tempo.horaAgora(unidade.fuso, tempo.agora())) - tempo.minutos(primeira.h)) : null
  await db.exec(
    `INSERT INTO logins (empresa_id, colaborador_id, unidade_id, lat, lng, distancia_m, dentro_raio, liberado_por_pedido_id, atraso_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ator.empresaId, ator.id, unidade.id, lat, lng, distancia, dentro, liberadoPor, atraso])
  await registrar(db, { empresaId: ator.empresaId, unidadeId: unidade.id, ator, acao: 'login.equipe', detalhe: { dentro_raio: dentro, liberado_por_pedido_id: liberadoPor, dispensa } })
  const quemLiberou = liberadoPor ? await db.um(
    `SELECT COALESCE(c.nome, a.nome) AS nome, cg.nome AS cargo FROM pedidos p
     LEFT JOIN colaboradores c ON (p.resultado->>'decidido_por_tipo') = 'colaborador' AND c.id = p.decidido_por
     LEFT JOIN cargos cg ON cg.id = c.cargo_id
     LEFT JOIN admins a ON (p.resultado->>'decidido_por_tipo') = 'admin' AND a.id = p.decidido_por
     WHERE p.id = $1`, [liberadoPor]) : null
  res.json(respostaSessao(ator, acesso, {
    estado: liberadoPor ? 'liberado' : 'no_local',
    unidade_id: unidade.id,
    // Para a tela "Presença confirmada" / "Liberado".
    entrada: {
      em: tempo.agora(), unidade: unidade.nome, distancia_m: distancia, raio_m: unidade.raio_m, dispensa,
      primeira_tarefa: primeira && primeira.h ? String(primeira.h).slice(0, 5) : null,
      atraso_min: atraso, tolerancia_min: me.login_tol_min || 0,
      // Desconto de atraso da regra de bônus vigente (se a entrada passou da tolerância).
      desconto_atraso: await (async () => {
        const rg = await db.um(
          `SELECT atraso_ativo, atraso_tol_min, atraso_desconto FROM regras_bonus WHERE colaborador_id = $1 AND vigente_desde <= $2
           ORDER BY vigente_desde DESC LIMIT 1`, [ator.id, tempo.hoje(unidade.fuso, tempo.agora())])
        return rg && rg.atraso_ativo && atraso !== null && atraso > (rg.atraso_tol_min || 0) ? Number(rg.atraso_desconto) : null
      })(),
      liberado_por: quemLiberou
    }
  }))
})

// Renova a sessão enquanto ela ainda vale (equipe 12 h, admin 7 dias).
r.post('/auth/renovar', autenticar, async (req, res) => {
  res.json(respostaSessao(req.ator, req.acesso))
})

// Sair de todos os aparelhos: muda a versão do token.
r.post('/auth/sair', autenticar, async (req, res) => {
  const tabela = req.ator.tipo === 'admin' ? 'admins' : 'colaboradores'
  await db.exec(`UPDATE ${tabela} SET token_versao = token_versao + 1 WHERE id = $1`, [req.ator.id])
  await registrar(db, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'sessao.sair_de_todos' })
  res.json({ ok: true })
})

// ---- Esqueci a senha (admin): token só em hash, validade curta, uso único ---
r.post('/auth/admin/esqueci', async (req, res) => {
  const email = v.email(req.body.email, { obrigatorio: true })
  const a = await db.um('SELECT id, empresa_id, nome, email FROM admins WHERE lower(email) = $1', [email])
  if (a) {
    const token = tokenAleatorio()
    await db.exec(`UPDATE senha_tokens SET usado_em = now() WHERE admin_id = $1 AND usado_em IS NULL`, [a.id])
    await db.exec(
      `INSERT INTO senha_tokens (admin_id, token_hash, expira_em) VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [a.id, sha256(token), config.senhaTokenMin])
    const base = config.frontendUrl || ''
    await enviar({
      canal: 'email', destino: a.email, assunto: 'Redefinir sua senha do VALIDA',
      texto: `Olá, ${a.nome}. Para criar uma senha nova, abra: ${base}/redefinir-senha?token=${token} (vale ${config.senhaTokenMin} minutos).`
    })
    await registrar(db, { empresaId: a.empresa_id, ator: { tipo: 'admin', id: a.id, nome: a.nome }, acao: 'senha.pedido_redefinicao' })
  }
  // Mesma resposta exista ou não o e-mail.
  res.json({ ok: true, mensagem: 'Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.' })
})

r.post('/auth/admin/redefinir', async (req, res) => {
  const token = v.texto(req.body.token, 'o link', { obrigatorio: true, max: 200 })
  const senha = v.texto(req.body.senha, 'a senha nova', { obrigatorio: true, min: 8, max: 200 })
  const ok = await db.tx(async (t) => {
    const s = await t.um(
      `SELECT st.id, st.admin_id, a.empresa_id, a.nome FROM senha_tokens st JOIN admins a ON a.id = st.admin_id
       WHERE st.token_hash = $1 AND st.usado_em IS NULL AND st.expira_em > now() FOR UPDATE`, [sha256(token)])
    if (!s) return false
    await t.exec('UPDATE senha_tokens SET usado_em = now() WHERE id = $1', [s.id])
    await t.exec('UPDATE admins SET senha_hash = $2, token_versao = token_versao + 1, atualizado_em = now() WHERE id = $1', [s.admin_id, await hashSenha(senha)])
    await registrar(t, { empresaId: s.empresa_id, ator: { tipo: 'admin', id: s.admin_id, nome: s.nome }, acao: 'senha.redefinida' })
    return true
  })
  if (!ok) throw invalido('Link inválido ou vencido. Peça outro.')
  res.json({ ok: true })
})

// Trocar a própria senha (admin) ou o próprio PIN (equipe).
r.put('/auth/admin/senha', autenticar, async (req, res) => {
  if (req.ator.tipo !== 'admin') throw proibido()
  const atual = v.texto(req.body.senha_atual, 'a senha atual', { obrigatorio: true, max: 200 })
  const nova = v.texto(req.body.senha_nova, 'a senha nova', { obrigatorio: true, min: 8, max: 200 })
  const a = await db.um('SELECT senha_hash FROM admins WHERE id = $1', [req.ator.id])
  if (!(await confere(atual, a.senha_hash))) throw invalido('A senha atual não confere.')
  await db.exec('UPDATE admins SET senha_hash = $2, token_versao = token_versao + 1 WHERE id = $1', [req.ator.id, await hashSenha(nova)])
  await registrar(db, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'senha.trocada' })
  res.json({ ok: true, mensagem: 'Senha trocada. Entre de novo nos outros aparelhos.' })
})

r.put('/auth/pin', autenticar, async (req, res) => {
  if (req.ator.tipo !== 'colaborador') throw proibido()
  const atual = v.pin(req.body.pin_atual)
  const novo = v.pin(req.body.pin_novo)
  if (atual === novo) throw invalido('O PIN novo precisa ser diferente do atual.')
  const c = await db.um('SELECT pin_hash FROM colaboradores WHERE id = $1', [req.ator.id])
  if (!(await confere(atual, c.pin_hash))) throw invalido('O PIN atual não confere.')
  const { hashPin } = require('../lib/segredos')
  await db.exec('UPDATE colaboradores SET pin_hash = $2, pin_trocado_em = now(), token_versao = token_versao + 1 WHERE id = $1', [req.ator.id, await hashPin(novo)])
  await registrar(db, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'pin.trocado' })
  res.json({ ok: true })
})

// Quem sou eu.
r.get('/eu', autenticar, async (req, res) => {
  const e = await db.um('SELECT nome, plano, situacao, trial_ate FROM empresas WHERE id = $1', [req.ator.empresaId])
  const pend = req.acesso.admin ? await db.um(`SELECT COUNT(*)::int AS n FROM pedidos WHERE empresa_id = $1 AND estado = 'pend'`, [req.ator.empresaId]) : null
  // Colaborador: cargo e unidade principal (Início do gerente, §3).
  const eu = req.ator.tipo === 'colaborador' ? await db.um(
    `SELECT cg.nome AS cargo, c.unidade_principal_id, COALESCE(c.perfil_acesso_id, cg.perfil_acesso_id) AS perfil_acesso_id,
            (SELECT nome FROM perfis_acesso WHERE id = COALESCE(c.perfil_acesso_id, cg.perfil_acesso_id)) AS perfil_acesso_nome
     FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id WHERE c.id = $1`, [req.ator.id]) : null
  // Alerta "Hora da tarefa" (§13, §18): configuração da unidade principal.
  if (eu) {
    eu.alerta = await db.um(
      `SELECT push, antes_min, modo, som, vibrar, repetir_min FROM config_notificacoes WHERE unidade_id = $1`, [eu.unidade_principal_id]) ||
      { push: true, antes_min: 0, modo: 2, som: true, vibrar: true, repetir_min: 0 }
  }
  res.json({
    agora: tempo.agora(),
    empresa: e,
    pedidos_pendentes: pend ? pend.n : null,
    tipo: req.ator.tipo, id: req.ator.id, nome: req.ator.nome, empresa_id: req.ator.empresaId,
    situacao_empresa: req.ator.situacaoEmpresa,
    perfil: req.acesso.admin ? 'admin' : req.acesso.perfilCargo,
    permissoes: [...req.acesso.chaves].sort(),
    unidades: [...req.acesso.unidades],
    ...(eu || {})
  })
})

module.exports = r
