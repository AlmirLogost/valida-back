// PIN, senha e tokens. Nada daqui vai para log.
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const config = require('../config')

const CUSTO = 10

// Segurança item 2: gerador seguro.
function gerarPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0')
}

const hashPin = (pin) => bcrypt.hash(pin, CUSTO)
const hashSenha = (senha) => bcrypt.hash(senha, CUSTO)
const confere = (valor, hash) => (hash ? bcrypt.compare(String(valor), hash) : Promise.resolve(false))

// Hash rápido para chaves de busca (tentativas de login, token de senha).
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

const tokenAleatorio = () => crypto.randomBytes(32).toString('base64url')

// PIN cifrado (AES-256-GCM) para quem pediu ver UMA vez; depois é apagado.
function chave() {
  return crypto.createHash('sha256').update(config.pinCifraChave()).digest()
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv)
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.')
}
function decifrar(pacote) {
  const [iv, tag, enc] = String(pacote).split('.').map((s) => Buffer.from(s, 'base64url'))
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

module.exports = { gerarPin, hashPin, hashSenha, confere, sha256, tokenAleatorio, cifrar, decifrar }
