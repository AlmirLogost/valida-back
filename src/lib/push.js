// Web Push (§18). Envia para os aparelhos inscritos de uma pessoa.
//  - Chaves VAPID só do ambiente; sem elas, fica desligado.
//  - O endereço (endpoint) vem do navegador: só aceitamos os serviços de push
//    conhecidos, senão o servidor viraria ponte para qualquer endereço.
//  - A inscrição vale só para a sessão em que foi feita (token_versao): trocar
//    PIN/senha, sair ou ser arquivado para os avisos naquele aparelho.
const db = require('../db')
const config = require('../config')

const SERVICOS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/]
function endpointValido(endpoint) {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443') && SERVICOS.some((r) => r.test(u.hostname))
  } catch { return false }
}
const ligado = () => !!(config.vapid.publica && config.vapid.privada)

async function enviarReal(inscricao, corpo, opcoes) {
  return require('web-push').sendNotification(inscricao, corpo, {
    ...opcoes, timeout: 10000,
    vapidDetails: { subject: config.vapid.contato, publicKey: config.vapid.publica, privateKey: config.vapid.privada }
  })
}
let enviador = null   // os testes trocam o envio (nada sai do computador)
const usarEnviador = (fn) => { enviador = fn }
const podeEnviar = () => !!enviador || ligado()

// Aparelhos válidos: a pessoa continua ativa e a sessão é a mesma.
async function aparelhos(donoTipo, donoId) {
  return donoTipo === 'admin'
    ? db.q(`SELECT p.* FROM push_inscricoes p JOIN admins a ON a.id = p.dono_id AND a.empresa_id = p.empresa_id
            WHERE p.dono_tipo = 'admin' AND p.dono_id = $1 AND p.invalida_em IS NULL AND p.token_versao = a.token_versao`, [donoId])
    : db.q(`SELECT p.* FROM push_inscricoes p JOIN colaboradores c ON c.id = p.dono_id AND c.empresa_id = p.empresa_id
            WHERE p.dono_tipo = 'colaborador' AND p.dono_id = $1 AND p.invalida_em IS NULL AND p.token_versao = c.token_versao
              AND c.situacao = 'ativo' AND c.excluido_em IS NULL`, [donoId])
}

// msg = { titulo, corpo, aba, tag, som, vibrar, validadeS }
async function paraDono(donoTipo, donoId, msg) {
  if (!podeEnviar()) return { aparelhos: 0, entregues: 0 }
  const lista = await aparelhos(donoTipo, donoId)
  const corpo = JSON.stringify({ titulo: msg.titulo, corpo: msg.corpo, aba: msg.aba || '', tag: msg.tag, som: msg.som !== false, vibrar: msg.vibrar !== false })
  let entregues = 0
  await Promise.all(lista.map(async (p) => {
    try {
      await (enviador || enviarReal)({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, corpo, { TTL: msg.validadeS || 1800, urgency: 'high' })
      entregues++
    } catch (e) {
      // 404/410: o aparelho cancelou. Marca (não apaga) e não tenta mais.
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await db.exec('UPDATE push_inscricoes SET invalida_em = now() WHERE id = $1', [p.id])
        console.log(`[push] aparelho cancelado pelo serviço: código ${e.statusCode}`)
      } else console.error(`[push] falha ao enviar: código ${(e && (e.statusCode || e.code)) || '-'}`)
    }
  }))
  return { aparelhos: lista.length, entregues }
}

module.exports = { endpointValido, ligado, podeEnviar, paraDono, aparelhos, usarEnviador }
