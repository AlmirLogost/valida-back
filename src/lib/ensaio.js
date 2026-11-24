// Bancos de ENSAIO (cópias descartáveis do banco local). Lista fechada: os
// scripts que apagam/recriam banco, o seed e o relógio fixo só aceitam estes.
//   valida_ensaio  → demonstração (npm run demo) e ensaio de migrations
//   valida_visual  → teste visual e testes de fluxo (front)
//   valida_teste   → npm test (back)
// Cada uso tem o seu, para um não apagar os dados do outro.
const BANCOS_ENSAIO = ['valida_ensaio', 'valida_visual', 'valida_teste']
const ehEnsaio = (nome) => BANCOS_ENSAIO.includes(nome)
module.exports = { BANCOS_ENSAIO, ehEnsaio }
