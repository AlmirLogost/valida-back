// Testes da Etapa 2 · Parte C: empresa, plano (sem cobrança), conta, pedido de
// exclusão, manual da marca, notificações, relatório com itens e o cadastro
// de cliente novo (trial de 30 dias). Rodam no valida_teste.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./ajuda')
const { caixa } = require('../src/lib/envio')

const S = {}
before(async () => {
  await h.subir()
  S.E = await h.criarEmpresa('Empresa C')
  S.B = await h.criarEmpresa('Outra C')
  S.u = await h.criarUnidade(S.E.token, 'UC', -26.8, -52.9)
  S.g = await h.criarPessoa(S.E.token, S.u.id, 'Gerente', 'Gerente C')
  S.g.token = (await h.entrar(S.g)).corpo.token
})
after(async () => { await h.descer() })

test('dados da empresa: só o admin edita; CNPJ com 14 números', async () => {
  const a = h.api(S.E.token)
  assert.equal((await a.put('/empresa', { cnpj: '123' })).status, 400)
  const r = await a.put('/empresa', { razao_social: 'Empresa C Ltda', cnpj: '12.345.678/0001-90', cidade: 'Xaxim', uf: 'sc' })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  assert.equal(r.corpo.uf, 'SC')
  assert.equal((await h.api(S.g.token).get('/empresa')).status, 403)
})

test('plano: escolher registra plano/ciclo/forma e NÃO cria cobrança', async () => {
  const a = h.api(S.E.token)
  const antes = (await h.db.um('SELECT COUNT(*)::int AS n FROM faturas WHERE empresa_id = $1', [S.E.id])).n
  const r = await a.post('/plano/escolher', { plano: 'pro', ciclo: 'anual', forma_pagamento: 'boleto' })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  assert.equal(r.corpo.cobranca, false)
  const p = (await a.get('/plano')).corpo
  assert.equal(p.empresa.plano, 'pro'); assert.equal(p.empresa.ciclo, 'anual'); assert.equal(p.empresa.forma_pagamento, 'boleto')
  assert.equal((await h.db.um('SELECT COUNT(*)::int AS n FROM faturas WHERE empresa_id = $1', [S.E.id])).n, antes)
  assert.equal((await h.api(S.g.token).post('/plano/escolher', { plano: 'rede' })).status, 403)
})

test('minha conta e pedido de exclusão (só com EXCLUIR, nada é apagado)', async () => {
  const a = h.api(S.E.token)
  assert.equal((await a.put('/conta', { nome: 'Admin Novo Nome' })).status, 200)
  assert.equal((await a.get('/conta')).corpo.nome, 'Admin Novo Nome')
  assert.equal((await a.put('/conta', { email: S.B.email })).status, 409, 'e-mail de outra conta')
  assert.equal((await a.post('/conta/excluir', { confirmacao: 'excluir' })).status, 400)
  const r = await a.post('/conta/excluir', { confirmacao: 'EXCLUIR' })
  assert.equal(r.status, 200)
  const e = await h.db.um('SELECT exclusao_pedida_em FROM empresas WHERE id = $1', [S.E.id])
  assert.ok(e.exclusao_pedida_em)
  assert.equal((await h.db.um('SELECT COUNT(*)::int AS n FROM unidades WHERE empresa_id = $1', [S.E.id])).n >= 1, true)
})

test('manual da marca: admin escreve e arquiva; equipe só lê; outra empresa não vê', async () => {
  const a = h.api(S.E.token)
  const d = await a.post('/manual', { titulo: 'Padrão', texto: 'Uniforme limpo.' })
  assert.equal(d.status, 201)
  assert.equal((await h.api(S.g.token).post('/manual', { titulo: 'X' })).status, 403)
  assert.ok((await h.api(S.g.token).get('/manual')).corpo.some((x) => x.titulo === 'Padrão'))
  assert.ok(!(await h.api(S.B.token).get('/manual')).corpo.some((x) => x.titulo === 'Padrão'))
  assert.equal((await h.api(S.B.token).put(`/manual/${d.corpo.id}`, { titulo: 'Y' })).status, 404)
  assert.equal((await a.post(`/manual/${d.corpo.id}/arquivar`)).status, 200)
  assert.ok(!(await a.get('/manual')).corpo.some((x) => x.id === d.corpo.id))
})

test('notificações por unidade: admin muda; valores fora da lista são recusados; vai no /eu', async () => {
  const a = h.api(S.E.token)
  assert.equal((await a.put(`/unidades/${S.u.id}/notificacoes`, { antes_min: 7 })).status, 400)
  const r = await a.put(`/unidades/${S.u.id}/notificacoes`, { antes_min: 15, modo: 1, som: false })
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  assert.equal(r.corpo.antes_min, 15)
  assert.equal((await h.api(S.g.token).put(`/unidades/${S.u.id}/notificacoes`, { som: true })).status, 403)
  const eu = (await h.api(S.g.token).get('/eu')).corpo
  assert.equal(eu.alerta.modo, 1)
  assert.equal((await h.api(S.B.token).get(`/unidades/${S.u.id}/notificacoes`)).status, 404)
})

test('relatório com itens traz cada execução e marca "atrasada"', async () => {
  const r = await h.api(S.E.token).get(`/relatorios?unidade_id=${S.u.id}&itens=1&colaborador_id=${S.g.id}`)
  assert.equal(r.status, 200, JSON.stringify(r.corpo))
  assert.ok(Array.isArray(r.corpo.itens))
  assert.equal(typeof r.corpo.entradas_atrasadas, 'number')
})

test('cadastro de cliente novo: código do WhatsApp (simulado), trial de 30 dias, sessão de admin', async () => {
  const cel = h.celular()
  const c = await h.chamar('POST', '/api/v2/cadastro/codigo', { corpo: { celular: cel } })
  assert.equal(c.status, 200, JSON.stringify(c.corpo))
  const msg = caixa.filter((m) => m.destino === cel).pop()
  const codigo = /(\d{6})/.exec(msg.texto)[1]
  const base = { nome: 'Maria Nova', celular: cel, email: `maria.${cel}@teste.valida`, senha: 'senha-forte-1', aceite_termos: true, plano: null, empresa: 'Nova Ltda', segmento: 'Loja', unidade: 'Nova Centro', cidade: 'Chapecó', dias: [1, 2, 3, 4, 5] }
  assert.equal((await h.chamar('POST', '/api/v2/cadastro', { corpo: { ...base, codigo: '000000' === codigo ? '111111' : '000000' } })).status, 400, 'código errado')
  assert.equal((await h.chamar('POST', '/api/v2/cadastro', { corpo: { ...base, codigo, aceite_termos: false } })).status, 400, 'sem aceite')
  const r = await h.chamar('POST', '/api/v2/cadastro', { corpo: { ...base, codigo } })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  assert.ok(r.corpo.token)
  const eu = (await h.api(r.corpo.token).get('/eu')).corpo
  assert.equal(eu.tipo, 'admin')
  assert.equal(eu.empresa.situacao, 'teste')
  const dias = Math.round((new Date(eu.empresa.trial_ate) - Date.now()) / 864e5)
  assert.ok(dias >= 29 && dias <= 30, `trial de 30 dias (${dias})`)
  const us = (await h.api(r.corpo.token).get('/unidades')).corpo
  assert.equal(us.length, 1); assert.equal(us[0].nome, 'Nova Centro')
  assert.equal(us[0].semana.find((d) => d.dia_semana === 0).ativo, false)
  assert.equal((await h.chamar('POST', '/api/v2/cadastro', { corpo: { ...base, codigo } })).status, 400, 'o código vale uma vez')
  assert.equal((await h.db.um('SELECT COUNT(*)::int AS n FROM faturas f JOIN admins a ON a.empresa_id = f.empresa_id WHERE a.email = $1', [base.email])).n, 0, 'sem cobrança')
})
