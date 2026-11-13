const { query, run } = require('../config/database')

// Progresso do onboarding é por CONTA (admin_id), nunca por usuário — o
// Dono e qualquer pessoa da equipe que complete um passo (ex.: o primeiro
// colaborador concluindo a primeira tarefa) contam pra mesma conta.

// Garante que existe uma linha pra essa conta, sem nunca sobrescrever uma
// que já existe. O default aqui é sempre concluido = 1 (contas "achadas"
// por este caminho — nunca pela migration 019 nem pelo cadastro novo — são
// tratadas como já existentes, pra nunca mostrar o passo a passo de
// surpresa pra ninguém). Só o cadastro novo (registroController.js) insere
// a linha com concluido = 0 explicitamente.
async function garantirLinha(adminId) {
  if (!adminId) return null
  await run(
    `INSERT INTO onboarding_progresso (admin_id, passo_unidade, passo_tarefa, passo_pessoa, passo_execucao, concluido, wizard_visto_em)
     VALUES (?, 1, 1, 1, 1, 1, NOW())
     ON CONFLICT (admin_id) DO NOTHING`,
    [adminId]
  )
  const rows = await query('SELECT * FROM onboarding_progresso WHERE admin_id = ?', [adminId])
  return rows[0] || null
}

async function obterProgresso(adminId) {
  return garantirLinha(adminId)
}

const COLUNAS_VALIDAS = ['passo_unidade', 'passo_tarefa', 'passo_pessoa', 'passo_execucao']

// Marca um passo como feito (idempotente — não falha nem regride se já
// estava marcado) e, se os 4 passos ficarem completos, marca concluido = 1
// também. Nunca "desmarca" um passo (ex.: arquivar a pessoa adicionada não
// desfaz passo_pessoa) — uma vez alcançado, o progresso não regride.
async function marcarPasso(adminId, coluna) {
  if (!adminId || !COLUNAS_VALIDAS.includes(coluna)) return
  await garantirLinha(adminId)
  await run(`UPDATE onboarding_progresso SET ${coluna} = 1 WHERE admin_id = ? AND ${coluna} = 0`, [adminId])
  const rows = await query(
    'SELECT passo_unidade, passo_tarefa, passo_pessoa, passo_execucao FROM onboarding_progresso WHERE admin_id = ?',
    [adminId]
  )
  const p = rows[0]
  if (p && p.passo_unidade && p.passo_tarefa && p.passo_pessoa && p.passo_execucao) {
    await run('UPDATE onboarding_progresso SET concluido = 1 WHERE admin_id = ? AND concluido = 0', [adminId])
  }
}

module.exports = { obterProgresso, marcarPasso }
