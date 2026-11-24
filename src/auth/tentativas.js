// Limite de tentativas de login guardado no banco (Segurança item 1).
// A chave é o hash do que foi digitado (celular ou e-mail), nunca o valor.
const db = require('../db')
const config = require('../config')
const { sha256 } = require('../lib/segredos')
const { muitas } = require('../lib/erros')

const chaveDe = (tipo, identificador) => sha256(`${tipo}:${String(identificador).toLowerCase()}`)

async function conferirBloqueio(tipo, identificador) {
  const r = await db.um('SELECT bloqueado_ate FROM login_tentativas WHERE chave_hash = $1', [chaveDe(tipo, identificador)])
  if (r && r.bloqueado_ate && r.bloqueado_ate > new Date()) {
    const min = Math.max(1, Math.ceil((r.bloqueado_ate - new Date()) / 60000))
    throw muitas(`Muitas tentativas erradas. Tente de novo em ${min} min.`, { bloqueado_min: min })
  }
}

async function falhou(tipo, identificador, limite = {}) {
  const { maxFalhas, janelaMin, bloqueioMin } = { ...config.tentativas, ...limite }
  await db.exec(
    `INSERT INTO login_tentativas (chave_hash, tipo, falhas, primeira_falha_em)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (chave_hash) DO UPDATE SET
       falhas = CASE WHEN login_tentativas.primeira_falha_em < now() - make_interval(mins => $3)
                     THEN 1 ELSE login_tentativas.falhas + 1 END,
       primeira_falha_em = CASE WHEN login_tentativas.primeira_falha_em < now() - make_interval(mins => $3)
                     THEN now() ELSE login_tentativas.primeira_falha_em END`,
    [chaveDe(tipo, identificador), tipo, janelaMin]
  )
  await db.exec(
    `UPDATE login_tentativas SET bloqueado_ate = now() + make_interval(mins => $2), falhas = 0, primeira_falha_em = now()
     WHERE chave_hash = $1 AND falhas >= $3`,
    [chaveDe(tipo, identificador), bloqueioMin, maxFalhas]
  )
}

async function acertou(tipo, identificador) {
  await db.exec('DELETE FROM login_tentativas WHERE chave_hash = $1', [chaveDe(tipo, identificador)])
}

module.exports = { conferirBloqueio, falhou, acertou }
