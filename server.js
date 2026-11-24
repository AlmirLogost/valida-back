// VALIDA · servidor (Etapa 1: só as tabelas novas).
// O código antigo está em src/legado (não é carregado).
const config = require('./src/config')

for (const nome of ['JWT_SECRET', 'PIN_CIFRA_CHAVE']) {
  if (!process.env[nome]) {
    console.error(`❌ Variável ${nome} não configurada no .env — o servidor não pode iniciar.`)
    process.exit(1)
  }
}

const db = require('./src/db')
const { criarApp } = require('./src/app')

async function iniciar() {
  // Uma fonte só de esquema (Segurança item 6): o banco precisa estar com as
  // migrations aplicadas; o servidor não cria tabela nenhuma.
  const r = await db.um(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`)
  const versao = r.ok ? (await db.um('SELECT COALESCE(MAX(versao), 0) AS v FROM schema_migrations')).v : 0
  if (versao < config.versaoMinimaBanco) {
    console.error(`❌ O banco está na migration ${versao}; o servidor precisa da ${config.versaoMinimaBanco}. Rode: node scripts/migrar.js --status`)
    process.exit(1)
  }
  criarApp().listen(config.porta, '0.0.0.0', () => console.log(`🚀 VALIDA na porta ${config.porta}`))
  // Agendador: a cada minuto (com trava no banco: nunca roda duas vezes ao mesmo tempo).
  const agenda = require('./src/servicos/agenda')
  const rodar = () => agenda.rodada().catch((e) => console.error(`[agendador] código ${e.code || '-'}`))
  setTimeout(rodar, 5000)
  setInterval(rodar, 60000)
}

iniciar().catch((e) => {
  console.error(`❌ Não foi possível iniciar (código ${e.code || 'desconhecido'}).`)
  process.exit(1)
})
