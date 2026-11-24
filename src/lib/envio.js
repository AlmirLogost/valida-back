// Envio de e-mail e WhatsApp: SEMPRE simulado nesta fase (D17).
// Nada sai para fora. A mensagem completa vai para:
//   - a memória do processo (os testes leem daqui);
//   - o arquivo ENVIO_SIMULADO_ARQUIVO, se configurado (caixa de saída
//     local, fora do git), para o Almir abrir o link de teste.
// No console sai só uma linha sem o conteúdo (sem link, sem PIN, sem token).
const fs = require('fs')
const config = require('../config')

const caixa = []

function mascarar(destino) {
  const s = String(destino || '')
  if (s.includes('@')) return s.replace(/^(.).*(@.*)$/, '$1***$2')
  return s.replace(/\d(?=\d{2})/g, '•')
}

async function enviar({ canal, destino, assunto, texto }) {
  if (!config.envioSimulado) {
    // Não existe envio real ligado no código desta fase.
    throw new Error('Envio real não está habilitado (ENVIO_SIMULADO).')
  }
  const msg = { canal, destino, assunto, texto, em: new Date().toISOString() }
  caixa.push(msg)
  if (caixa.length > 200) caixa.shift()
  if (config.envioSimuladoArquivo) {
    fs.appendFileSync(config.envioSimuladoArquivo, JSON.stringify(msg) + '\n', { mode: 0o600 })
  }
  console.log(`[envio simulado] ${canal} para ${mascarar(destino)}: ${assunto}`)
  return { simulado: true }
}

module.exports = { enviar, caixa }
