const { withTransaction } = require('./database')
const modelos = require('../data/templatesModelos')

// Número arbitrário (só precisa ser o mesmo em toda chamada) pro
// pg_advisory_xact_lock — serializa chamadas concorrentes desta função
// (ex.: dois processos subindo o servidor quase ao mesmo tempo) numa
// fila, em vez de duas checagens "já existe?" rodarem em paralelo sem se
// ver e cada uma inserir a própria cópia (foi exatamente isso que
// aconteceu sem o lock, ao testar — por isso ele é essencial aqui, não
// só uma cautela extra).
const LOCK_ID = 7340125

// Semeia a biblioteca de modelos prontos (Experiência do Cliente, bloco
// 2) — roda sozinha a cada subida do servidor (diferente de seed.js, que
// só roda manualmente via src/config/init.js), pra sempre existir mesmo
// sem ninguém lembrar de rodar nada à parte. Idempotente: cada tarefa do
// modelo é identificada por (titulo, categoria) — se já existe, não
// insere de novo nem duplica os itens.
async function seedTemplatesModelos() {
  await withTransaction(async ({ query, run }) => {
    await query('SELECT pg_advisory_xact_lock(?)', [LOCK_ID])

    for (const modelo of modelos) {
      for (const tarefa of modelo.tarefas) {
        const existentes = await query(
          'SELECT id FROM templates WHERE titulo = ? AND categoria = ? ORDER BY id',
          [tarefa.titulo, modelo.categoria]
        )

        // Auto-cura: se por algum motivo (ex.: versão anterior desta
        // função, sem o lock acima) já existir mais de uma cópia da
        // mesma tarefa, mantém a mais antiga e remove as duplicadas —
        // nunca mexe em templates de OUTRAS categorias/títulos.
        if (existentes.length > 1) {
          const duplicadas = existentes.slice(1).map(e => e.id)
          await run('DELETE FROM template_itens WHERE template_id = ANY(?)', [duplicadas])
          await run('DELETE FROM templates WHERE id = ANY(?)', [duplicadas])
        }

        if (existentes.length > 0) continue

        const result = await run(
          'INSERT INTO templates (titulo, descricao, categoria, recorrencia, horario_inicio, horario_fim) VALUES (?, ?, ?, ?, ?, ?)',
          [tarefa.titulo, modelo.descricao, modelo.categoria, tarefa.recorrencia || 'diario', tarefa.horario_inicio || null, tarefa.horario_fim || null]
        )
        for (let i = 0; i < tarefa.itens.length; i++) {
          await run(
            'INSERT INTO template_itens (template_id, titulo, ordem, critico) VALUES (?, ?, ?, ?)',
            [result.lastID, tarefa.itens[i], i + 1, tarefa.critico ? 1 : 0]
          )
        }
      }
    }
  })
}

module.exports = { seedTemplatesModelos }
