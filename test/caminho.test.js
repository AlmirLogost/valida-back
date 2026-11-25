// Publicação num caminho (APP_BASE): o mesmo app na raiz e em /valida/.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const h = require('./ajuda')
const config = require('../src/config')
const { criarApp } = require('../src/app')
const { caixa } = require('../src/lib/envio')

const original = { appBase: config.appBase, frontDist: config.frontDist, frontendUrl: config.frontendUrl, piloto: config.piloto }
const abertos = []
let dist
async function subirEm(base) {
  config.appBase = config.caminhoBase(base)
  const s = await new Promise((ok) => { const x = criarApp().listen(0, '127.0.0.1', () => ok(x)) })
  abertos.push(s)
  return (c, o = {}) => fetch(`http://127.0.0.1:${s.address().port}${c}`, { redirect: 'manual', ...o })
}
before(async () => {
  await h.subir()
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-dist-'))
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>')
  fs.writeFileSync(path.join(dist, 'sw.js'), '// sw')
  fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), '{}')
  fs.writeFileSync(path.join(dist, 'assets', 'a.js'), '// a')
  config.frontDist = dist
})
after(async () => {
  Object.assign(config, original)
  for (const s of abertos) await new Promise((ok) => s.close(ok))
  await h.descer()
})

test('APP_BASE: aceita as formas comuns e recusa o que não é caminho', () => {
  for (const v of [undefined, '', '/', ' / ']) assert.equal(config.caminhoBase(v), '/')
  for (const v of ['valida', '/valida', 'valida/', '/valida/']) assert.equal(config.caminhoBase(v), '/valida/')
  assert.equal(config.caminhoBase('/a/b'), '/a/b/')
  for (const v of ['/va lida/', 'https://x.com/valida', '/../x', '/a//b', '/:id/', '/*']) assert.throws(() => config.caminhoBase(v), /APP_BASE/)
})

test('na raiz: app, API e arquivos como sempre', async () => {
  const g = await subirEm('/')
  assert.match(await (await g('/')).text(), /<title>app/)
  assert.match(await (await g('/qualquer/tela')).text(), /<title>app/)
  assert.equal((await g('/assets/a.js')).status, 200)
  assert.equal((await g('/api/v2/eu')).status, 401)
  assert.equal((await g('/sw.js')).headers.get('cache-control'), 'no-cache')
})

test('em /valida/: tudo embaixo do caminho e nada fora dele', async () => {
  const g = await subirEm('/valida/')
  assert.match(await (await g('/valida/')).text(), /<title>app/)
  assert.match(await (await g('/valida/?aba=hoje')).text(), /<title>app/)
  assert.match(await (await g('/valida/qualquer/tela')).text(), /<title>app/)
  assert.equal((await g('/valida/')).headers.get('cache-control'), 'no-store')
  assert.equal((await g('/valida/assets/a.js')).status, 200)
  assert.equal((await g('/valida/sw.js')).headers.get('cache-control'), 'no-cache')
  assert.equal((await g('/valida/manifest.webmanifest')).headers.get('cache-control'), 'no-cache')
  assert.equal((await g('/valida/api/v2/eu')).status, 401)
  assert.equal((await g('/valida/api/v2/nao-existe')).status, 401)
  assert.equal((await g('/valida/api/tarefas')).status, 410, 'rota antiga')
  // sem a barra: redireciona (fica dentro do escopo do service worker) e mantém a busca
  const r = await g('/valida?aba=conf')
  assert.equal(r.status, 301); assert.equal(r.headers.get('location'), '/valida/?aba=conf')
  assert.equal((await g('/valida')).headers.get('location'), '/valida/')
  // fora do caminho: nada do Valida
  for (const c of ['/', '/api/v2/eu', '/sw.js', '/assets/a.js', '/pedidos/', '/validax', '/validax/', '/valida2/api/v2/eu']) assert.equal((await g(c)).status, 404, c)
  assert.equal((await g('/api/v2/auth/admin/entrar', { method: 'POST' })).status, 404)
})

test('em /valida/: login e sessão funcionam, e o link de senha leva ao caminho certo', async () => {
  const E = await h.criarEmpresa('Empresa Caminho')
  const g = await subirEm('/valida/')
  const json = (c, corpo) => g('/valida/api/v2' + c, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
  const l = await json('/auth/admin/entrar', { email: E.email, senha: E.senha })
  assert.equal(l.status, 200)
  const eu = await g('/valida/api/v2/eu', { headers: { authorization: `Bearer ${(await l.json()).token}` } })
  assert.equal(eu.status, 200)
  for (const [url, base, espera] of [['https://exemplo.teste', '/valida/', 'https://exemplo.teste/valida/redefinir-senha?token='], ['https://exemplo.teste/', '/', 'https://exemplo.teste/redefinir-senha?token=']]) {
    config.frontendUrl = url; config.appBase = base
    caixa.length = 0
    assert.equal((await json('/auth/admin/esqueci', { email: E.email })).status, 200)
    assert.ok(caixa[0].texto.includes(espera), base)
  }
})

test('PILOTO: /config é público e diz se o login esconde as opções', async () => {
  const ler = async () => { const r = await h.chamar('GET', '/api/v2/config'); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); return r.corpo }
  config.appBase = original.appBase
  config.piloto = false
  assert.deepEqual(await ler(), { piloto: false }, 'sem a variável')
  config.piloto = true
  assert.deepEqual(await ler(), { piloto: true }, 'só isso, nada interno')
})
test('PILOTO: só "true" liga', () => {
  const { execFileSync } = require('node:child_process')
  const valor = (v) => execFileSync(process.execPath, ['-e', "console.log(require('./src/config').piloto)"], { cwd: path.join(__dirname, '..'), env: { ...process.env, PILOTO: v } }).toString().trim()
  assert.equal(valor('true'), 'true')
  for (const v of ['', 'false', '0', 'sim']) assert.equal(valor(v), 'false', v)
})
