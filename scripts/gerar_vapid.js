// Gera as chaves VAPID (Web Push) e grava DIRETO no .env, sem mostrar nada.
// Quem roda é o Almir. Se as chaves já existirem, não mexe em nada.
//
// Uso (dentro de back/):   node scripts/gerar_vapid.js
//   opcional: --contato=mailto:voce@dominio.com.br  (vai para o serviço de push
//   do navegador; sem isso fica https://example.com — o iPhone exige um contato real)
const fs = require('fs')
const path = require('path')
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=')
const arquivo = arg('arquivo') ? path.resolve(arg('arquivo')) : path.join(__dirname, '..', '.env')   // --arquivo: só para teste
const contato = arg('contato') || 'https://example.com'
if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(contato)) { console.error('❌ --contato precisa ser mailto:… ou https://…'); process.exit(1) }
const atual = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : ''
if (/^\s*(export\s+)?VAPID_(PUBLIC|PRIVATE)_KEY\s*=\s*\S/m.test(atual)) {
  console.log('As chaves VAPID já existem no .env. Nada foi alterado (trocar as chaves cancelaria os avisos de todos os aparelhos).')
  process.exit(0)
}
const { publicKey, privateKey } = require('web-push').generateVAPIDKeys()
const bloco = `${atual && !atual.endsWith('\n') ? '\n' : ''}\n# Web Push (scripts/gerar_vapid.js)\nVAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${contato}\n`
fs.appendFileSync(arquivo, bloco, { mode: 0o600 })
console.log('✅ Chaves VAPID gravadas no .env (não mostradas). Reinicie o servidor.')
