// Ajudas dos testes: sobe o app numa porta livre, cria empresas de teste
// direto no banco de ensaio e faz chamadas HTTP. Senhas e PINs de teste são
// gerados na hora (aleatórios) e ficam só na memória.
const crypto = require('crypto')
const assert = require('node:assert/strict')

if (process.env.DB_NAME !== 'valida_teste') {
  throw new Error('Os testes só rodam no valida_teste (use npm test).')
}

const db = require('../src/db')
const { criarApp } = require('../src/app')
const { hashSenha } = require('../src/lib/segredos')
const { garantirPerfisFixos } = require('../src/servicos/padroes')

let servidor, base

async function subir() {
  await new Promise((ok) => { servidor = criarApp().listen(0, '127.0.0.1', ok) })
  base = `http://127.0.0.1:${servidor.address().port}`
}

async function descer() {
  await new Promise((ok) => servidor.close(ok))
  await db.fechar()
}

async function chamar(metodo, caminho, { token, corpo, cabecalhos = {} } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  })
  const texto = await r.text()
  let json = null
  try { json = texto ? JSON.parse(texto) : null } catch { json = texto }
  return { status: r.status, corpo: json, headers: r.headers }
}

const api = (token) => ({
  get: (c) => chamar('GET', '/api/v2' + c, { token }),
  post: (c, corpo = {}) => chamar('POST', '/api/v2' + c, { token, corpo }),
  put: (c, corpo = {}) => chamar('PUT', '/api/v2' + c, { token, corpo }),
  del: (c) => chamar('DELETE', '/api/v2' + c, { token })
})

const sufixo = () => crypto.randomBytes(4).toString('hex')

// Celular de teste único (DDD 49 + 9 + 8 dígitos aleatórios).
const celular = () => `499${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`

async function criarEmpresa(nome) {
  const email = `admin.${sufixo()}@teste.valida`
  const senha = crypto.randomBytes(12).toString('base64url')
  const e = await db.um(
    `INSERT INTO empresas (nome, plano, situacao) VALUES ($1, 'rede', 'ativa') RETURNING id`, [`${nome} ${sufixo()}`])
  const a = await db.um(
    `INSERT INTO admins (empresa_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [e.id, `Admin ${nome}`, email, await hashSenha(senha)])
  await garantirPerfisFixos(db, e.id)
  const login = await chamar('POST', '/api/v2/auth/admin/entrar', { corpo: { email, senha } })
  assert.equal(login.status, 200, JSON.stringify(login.corpo))
  return { id: e.id, adminId: a.id, email, senha, token: login.corpo.token }
}

async function criarUnidade(adminToken, nome, lat, lng) {
  const r = await api(adminToken).post('/unidades', { nome, cidade: 'Teste', uf: 'SC', lat, lng, raio_m: 100 })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  return r.corpo
}

async function cargoDe(adminToken, unidadeId, nome) {
  const r = await api(adminToken).get(`/unidades/${unidadeId}/cargos`)
  const c = r.corpo.find((x) => x.nome === nome)
  assert.ok(c, `cargo ${nome} não encontrado`)
  return c
}

// Cadastra direto pelo admin: devolve id, celular e o PIN (mostrado uma vez).
async function criarPessoa(adminToken, unidadeId, cargoNome, nome, extra = {}) {
  const cargo = await cargoDe(adminToken, unidadeId, cargoNome)
  const cel = celular()
  const r = await api(adminToken).post('/colaboradores', { nome, celular: cel, unidade_principal_id: unidadeId, cargo_id: cargo.id, ...extra })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  assert.match(r.corpo.pin, /^\d{4}$/)
  return { id: r.corpo.colaborador_id, celular: cel, pin: r.corpo.pin, unidadeId }
}

async function entrar(pessoa, extra = {}) {
  return chamar('POST', '/api/v2/auth/entrar', { corpo: { celular: pessoa.celular, pin: pessoa.pin, ...extra } })
}

async function enviarFoto(token, bytes, tipo = 'image/jpeg') {
  const r = await fetch(base + '/api/v2/fotos', { method: 'POST', headers: { 'content-type': tipo, authorization: `Bearer ${token}` }, body: bytes })
  return { status: r.status, corpo: await r.json().catch(() => null) }
}

async function baixar(token, caminho) {
  const r = await fetch(base + '/api/v2' + caminho, { headers: { authorization: `Bearer ${token}` } })
  return { status: r.status, tipo: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()) }
}

module.exports = { enviarFoto, baixar, db, subir, descer, chamar, api, criarEmpresa, criarUnidade, cargoDe, criarPessoa, entrar, celular }
