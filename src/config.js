// Configuração lida do ambiente (.env). Nenhum segredo tem valor padrão aqui.
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

function obrigatoria(nome) {
  const v = process.env[nome]
  if (!v) throw new Error(`Variável ${nome} não configurada no .env.`)
  return v
}

module.exports = {
  obrigatoria,
  porta: parseInt(process.env.PORT) || 3001,
  jwtSegredo: () => obrigatoria('JWT_SECRET'),
  // Chave para cifrar o PIN que fica guardado até quem pediu ver uma vez (pedido "pin"/"cad").
  pinCifraChave: () => obrigatoria('PIN_CIFRA_CHAVE'),
  // CORS: só a origem do front. Vazio = só a mesma origem (o back serve o front).
  frontendUrl: process.env.FRONTEND_URL || '',
  // D17: envio de e-mail/WhatsApp/SMS sempre simulado até o piloto.
  envioSimulado: process.env.ENVIO_SIMULADO !== 'false',
  envioSimuladoArquivo: process.env.ENVIO_SIMULADO_ARQUIVO || '',
  // D14: webhook da Asaas desligado (404).
  webhookAsaasAtivo: process.env.WEBHOOK_ASAAS_ATIVO === 'true',
  fusoPadrao: 'America/Sao_Paulo',
  sessao: { equipe: '12h', admin: '7d' },
  tentativas: { maxFalhas: 5, janelaMin: 15, bloqueioMin: 15 },
  senhaTokenMin: 30,
  // Fotos: pasta fora do git (padrão FOTOS-VALIDA/ na raiz do projeto) e limite.
  fotosDir: process.env.FOTOS_DIR || path.join(__dirname, '..', '..', 'FOTOS-VALIDA'),
  fotoMaxMb: Number(process.env.FOTO_MAX_MB) || 5,
  // Envio offline: diferença de relógio acima disso fica marcada para o gerente.
  relogioAlertaS: 300,
  versaoMinimaBanco: 42
}
