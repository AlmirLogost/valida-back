// Inscrição do aparelho para Web Push (§18). Cada um mexe só na própria.
const express = require('express')
const db = require('../db')
const config = require('../config')
const v = require('../lib/validar')
const push = require('../lib/push')
const { registrar } = require('../lib/registro')
const { invalido, muitas, conflito } = require('../lib/erros')

const r = express.Router()
const tamanho = (s) => { try { return Buffer.from(s, 'base64url').length } catch { return 0 } }

r.get('/push/chave', (req, res) => res.json({ ativo: push.ligado(), chave: push.ligado() ? config.vapid.publica : null }))

r.post('/push/inscrever', async (req, res) => {
  const endpoint = v.texto(req.body.endpoint, 'o endereço do aparelho', { obrigatorio: true, max: 1000 })
  const k = req.body.chaves || {}
  const p256dh = v.texto(k.p256dh, 'a chave do aparelho', { obrigatorio: true, max: 200 })
  const auth = v.texto(k.auth, 'a chave do aparelho', { obrigatorio: true, max: 100 })
  if (!push.endpointValido(endpoint)) throw invalido('Esse navegador usa um serviço de avisos que não reconhecemos.')
  if (tamanho(p256dh) !== 65 || tamanho(auth) !== 16) throw invalido('Chaves do aparelho inválidas.')
  const aparelho = v.texto(req.body.aparelho, 'o aparelho', { max: 80 })
  // Endereço que já foi cancelado (pelo serviço de push ou pela pessoa) não volta
  // a valer: o app precisa criar uma inscrição nova.
  if (await db.um('SELECT 1 FROM push_inscricoes WHERE endpoint = $1 AND invalida_em IS NOT NULL', [endpoint])) throw conflito('Refaça a inscrição deste aparelho.', { refazer: true })
  await db.tx(async (t) => {
    // Um aparelho (endpoint) é de uma pessoa por vez: quem entrou por último.
    await t.exec(
      `INSERT INTO push_inscricoes (empresa_id, dono_tipo, dono_id, endpoint, p256dh, auth, aparelho, token_versao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (endpoint) DO UPDATE SET empresa_id = EXCLUDED.empresa_id, dono_tipo = EXCLUDED.dono_tipo, dono_id = EXCLUDED.dono_id,
         p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, aparelho = EXCLUDED.aparelho, token_versao = EXCLUDED.token_versao, invalida_em = NULL`,
      [req.ator.empresaId, req.ator.tipo, req.ator.id, endpoint, p256dh, auth, aparelho, req.ator.tokenVersao])
    // No máximo 10 aparelhos por pessoa (os mais antigos deixam de valer).
    await t.exec(
      `UPDATE push_inscricoes SET invalida_em = now() WHERE id IN (
         SELECT id FROM push_inscricoes WHERE dono_tipo = $1 AND dono_id = $2 AND invalida_em IS NULL ORDER BY id DESC OFFSET 10)`, [req.ator.tipo, req.ator.id])
    await registrar(t, { empresaId: req.ator.empresaId, ator: req.ator, acao: 'push.inscrito', detalhe: { aparelho } })
  })
  res.status(201).json({ ok: true })
})

r.post('/push/remover', async (req, res) => {
  const endpoint = v.texto(req.body.endpoint, 'o endereço do aparelho', { obrigatorio: true, max: 1000 })
  await db.exec('UPDATE push_inscricoes SET invalida_em = now() WHERE endpoint = $1 AND dono_tipo = $2 AND dono_id = $3 AND invalida_em IS NULL', [endpoint, req.ator.tipo, req.ator.id])
  res.json({ ok: true })
})

// Aviso de teste, só para os próprios aparelhos (um a cada 10 s).
const ultimo = new Map(), refeitos = new Map()
r.post('/push/teste', async (req, res) => {
  const k = `${req.ator.tipo}:${req.ator.id}`
  // "de novo" (inscrição refeita): até 2 repetições, sem esperar os 10 s.
  const deNovo = req.body.de_novo === true, n = deNovo ? (refeitos.get(k) || 0) + 1 : 0
  const espera = deNovo && n <= 2 ? 0 : 10000
  if (Date.now() - (ultimo.get(k) || 0) < espera) throw muitas('Espere alguns segundos para testar de novo.')
  ultimo.set(k, Date.now())
  refeitos.set(k, n)
  if (ultimo.size > 1000) { ultimo.clear(); refeitos.clear() }
  res.json(await push.paraDono(req.ator.tipo, req.ator.id, { titulo: 'Aviso de teste', corpo: 'Os avisos estão funcionando neste aparelho.', tag: 'teste' }))
})

module.exports = r
