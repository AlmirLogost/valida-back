// Teste visual da Etapa 3: deixa o dia do Pedro igual ao "Minhas tarefas" da
// v45 (as 4 tarefas do operador, nenhuma feita; "Abertura" já venceu).
// Na v45 a Conferência mostra o Pedro com 3 de 6 feitas e a tela do operador
// mostra 4 tarefas sem nenhuma feita; por isso este ajuste roda só antes das
// telas do operador. SÓ no banco de ensaio. Uso: DB_NAME=valida_ensaio node scripts/seed_v45_operador.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
if (!require('../src/lib/ensaio').ehEnsaio(process.env.DB_NAME)) { console.error('❌ Só num banco de ensaio.'); process.exit(1) }
const db = require('../src/db')
const tempo = require('../src/lib/tempo')
const agenda = require('../src/servicos/agenda')

async function main() {
  const p = await db.um(`SELECT c.id, c.unidade_principal_id, u.fuso FROM colaboradores c JOIN unidades u ON u.id = c.unidade_principal_id
                          WHERE c.celular = '49991110003' AND c.excluido_em IS NULL ORDER BY c.id DESC LIMIT 1`)
  if (!p) throw new Error('Pedro não encontrado (rode o seed_v45 antes).')
  const hoje = tempo.hoje(p.fuso)
  await db.tx(async (t) => {
    // Fora do dia: as duas últimas tarefas do Pedro (a v45 mostra só as 4 primeiras).
    await t.exec(`UPDATE tarefas SET ativa = false WHERE colaborador_id = $1 AND titulo IN ('Limpeza de bancadas', 'Fechamento · Caixa')`, [p.id])
    await t.exec(
      `UPDATE execucoes SET estado = 'a_fazer', feita_em = NULL, recebida_em = NULL, resposta_texto = NULL, resposta_num = NULL,
         resposta_fora = false, foto_id = NULL, conferencia = NULL
       WHERE colaborador_id = $1 AND data = $2 AND estado IN ('feita', 'na')`, [p.id, hoje])
  })
  await db.tx((x) => agenda.processarUnidade(x, p.unidade_principal_id, tempo.agora()))
  const n = await db.um(`SELECT COUNT(*) FILTER (WHERE estado = 'a_fazer')::int AS a, COUNT(*) FILTER (WHERE estado = 'nao_feita')::int AS nf
                         FROM execucoes WHERE colaborador_id = $1 AND data = $2`, [p.id, hoje])
  console.log(`✅ Dia do Pedro como na v45: ${n.a} a fazer, ${n.nf} não feita.`)
  await db.fechar()
}
main().catch(async (e) => { console.error(`❌ ${e.message}`); await db.fechar().catch(() => {}); process.exit(1) })
