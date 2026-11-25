// Conferência DEPOIS da migração (mapa §6.3): compara contagens do legado com
// as tabelas novas e confere o isolamento por empresa. SÓ LEITURA, só números.
//
// Cada linha: esperado (calculado do legado com as mesmas regras da
// migração) × obtido (tabela nova) → ok ou DIFERENTE. No fim, o que ficou
// só no legado (tabela migracao_relatorio: motivo e quantidade).
//
// Uso (dentro de back/):  node scripts/conferir_migracao.js
// Banco não local: --banco-remoto (continua só leitura).

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Client } = require('pg')

const args = process.argv.slice(2)
if (args.some((a) => a !== '--banco-remoto')) {
  console.error('Uso: node scripts/conferir_migracao.js [--banco-remoto]')
  process.exit(1)
}
const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal && !args.includes('--banco-remoto')) {
  console.error('Recusado: banco não local. Use --banco-remoto (só leitura).')
  process.exit(1)
}

const EMPRESA_DA_PESSOA = `(SELECT l.admin_id FROM lojas l JOIN empresas e ON e.id = l.admin_id WHERE l.id = u.loja_id)`

// [título, SQL que devolve esperado e obtido]
const CONFERENCIAS = [
  ['empresas = donos (super_admin)',
    `SELECT (SELECT COUNT(*) FROM usuarios WHERE perfil = 'super_admin') AS esperado, (SELECT COUNT(*) FROM empresas) AS obtido`],
  ['admins = donos',
    `SELECT (SELECT COUNT(*) FROM usuarios WHERE perfil = 'super_admin') AS esperado, (SELECT COUNT(*) FROM admins) AS obtido`],
  ['unidades = lojas de empresa válida',
    `SELECT (SELECT COUNT(*) FROM lojas l JOIN empresas e ON e.id = l.admin_id) AS esperado, (SELECT COUNT(*) FROM unidades) AS obtido`],
  ['unidades ativas = lojas ativas (ativo = 1) de empresa válida',
    `SELECT (SELECT COUNT(*) FROM lojas l JOIN empresas e ON e.id = l.admin_id WHERE l.ativo = 1) AS esperado,
            (SELECT COUNT(*) FROM unidades WHERE arquivado_em IS NULL) AS obtido`],
  ['turnos ativos = horários válidos das unidades migradas (até 3 por dia)',
    `SELECT (SELECT COUNT(*) FROM (SELECT ROW_NUMBER() OVER (PARTITION BY h.loja_id, h.dia_semana ORDER BY h.hora_abertura, h.id) AS o
               FROM loja_horarios h JOIN unidades un ON un.id = h.loja_id
               WHERE h.dia_semana BETWEEN 0 AND 6
                 AND h.hora_abertura ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
                 AND h.hora_fechamento ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') x WHERE o <= 3) AS esperado,
            (SELECT COUNT(*) FROM unidade_turnos WHERE ativo) AS obtido`],
  ['dias fechados (datas válidas, a mesma regra da 026)',
    `SELECT (SELECT COUNT(*) FROM loja_fechamentos f JOIN unidades un ON un.id = f.loja_id
               WHERE CASE WHEN f.data ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                          THEN substring(f.data, 9, 2)::int <= extract(day FROM (make_date(substring(f.data, 1, 4)::int, substring(f.data, 6, 2)::int, 1) + interval '1 month - 1 day'))
                          ELSE false END) AS esperado, (SELECT COUNT(*) FROM dias_fechados) AS obtido`],
  ['pessoas = equipe de empresa válida',
    `SELECT (SELECT COUNT(*) FROM usuarios u WHERE COALESCE(u.perfil, '') <> 'super_admin' AND ${EMPRESA_DA_PESSOA} IS NOT NULL) AS esperado,
            (SELECT COUNT(*) FROM colaboradores) AS obtido`],
  ['pessoas ativas',
    `SELECT (SELECT COUNT(*) FROM usuarios u WHERE COALESCE(u.perfil, '') <> 'super_admin' AND u.ativo = 1 AND ${EMPRESA_DA_PESSOA} IS NOT NULL) AS esperado,
            (SELECT COUNT(*) FROM colaboradores WHERE situacao = 'ativo') AS obtido`],
  ['PINs em hash',
    `SELECT (SELECT COUNT(*) FROM usuarios u WHERE COALESCE(u.perfil, '') <> 'super_admin' AND u.pin LIKE '$2%' AND ${EMPRESA_DA_PESSOA} IS NOT NULL) AS esperado,
            (SELECT COUNT(*) FROM colaboradores WHERE pin_hash IS NOT NULL) AS obtido`],
  ['regras de bônus = pessoas',
    `SELECT (SELECT COUNT(*) FROM colaboradores) AS esperado, (SELECT COUNT(*) FROM regras_bonus) AS obtido`],
  ['perfis fixos = 3 × empresas',
    `SELECT (SELECT 3 * COUNT(*) FROM empresas) AS esperado, (SELECT COUNT(*) FROM perfis_acesso WHERE fixo) AS obtido`],
  ['permissões = 33 × perfis de acesso',
    `SELECT (SELECT 33 * COUNT(*) FROM perfis_acesso) AS esperado, (SELECT COUNT(*) FROM perfil_permissoes) AS obtido`],
  ['unidades com 1 cargo padrão de Coordenação e 1 de Operador',
    `SELECT (SELECT 2 * COUNT(*) FROM unidades) AS esperado, (SELECT COUNT(*) FROM cargos WHERE padrao AND arquivado_em IS NULL) AS obtido`],
  ['tarefas-mãe por pessoa = vínculos válidos (usuario_checklists)',
    `SELECT (SELECT COUNT(*) FROM usuario_checklists uc JOIN checklists c ON c.id = uc.checklist_id
               JOIN colaboradores co ON co.id = uc.usuario_id JOIN unidades un ON un.id = c.loja_id AND un.empresa_id = co.empresa_id) AS esperado,
            (SELECT COUNT(*) FROM tarefas WHERE pai_id IS NULL AND colaborador_id IS NOT NULL) AS obtido`],
  ['tarefas-mãe por cargo = vínculos por cargo (checklist_cargos)',
    `SELECT (SELECT COUNT(*) FROM checklist_cargos cc JOIN checklists c ON c.id = cc.checklist_id JOIN unidades un ON un.id = c.loja_id) AS esperado,
            (SELECT COUNT(*) FROM tarefas WHERE pai_id IS NULL AND cargo_id IS NOT NULL) AS obtido`],
  ['tarefas filhas = sub-itens × tarefas-mãe',
    `SELECT (SELECT COUNT(*) FROM tarefas t JOIN checklist_itens i ON i.checklist_id = t.legado_checklist_id WHERE t.pai_id IS NULL) AS esperado,
            (SELECT COUNT(*) FROM tarefas WHERE pai_id IS NOT NULL) AS obtido`],
  ['execuções feitas (mãe) = concluídas com tarefa da pessoa',
    `SELECT (SELECT COUNT(*) FROM execucoes_legado e WHERE e.status = 'concluido'
               AND EXISTS (SELECT 1 FROM tarefas t WHERE t.legado_checklist_id = e.checklist_id AND t.colaborador_id = e.usuario_id AND t.pai_id IS NULL)) AS esperado,
            (SELECT COUNT(*) FROM execucoes x JOIN tarefas t ON t.id = x.tarefa_id WHERE t.pai_id IS NULL AND x.estado = 'feita') AS obtido`],
  ['execuções de sub-item = sub-itens concluídos das execuções migradas',
    `SELECT (SELECT COUNT(*) FROM execucoes_itens_legado i JOIN execucoes m ON m.id = i.execucao_id AND m.legado_execucao_id = i.execucao_id
               JOIN tarefas f ON f.pai_id = m.tarefa_id AND f.legado_item_id = i.checklist_item_id
               WHERE i.checklist_item_id <> 0 AND i.concluido = 1) AS esperado,
            (SELECT COUNT(*) FROM execucoes x JOIN tarefas t ON t.id = x.tarefa_id WHERE t.pai_id IS NOT NULL) AS obtido`],
  ['fotos = base64 das execuções migradas',
    `SELECT (SELECT COUNT(*) FILTER (WHERE i.evidencia_url LIKE 'data:%') + COUNT(*) FILTER (WHERE i.foto_url LIKE 'data:%')
               FROM execucoes_itens_legado i WHERE EXISTS (SELECT 1 FROM execucoes m WHERE m.legado_item_id = i.id)) AS esperado,
            (SELECT COUNT(*) FROM fotos) AS obtido`],
  ['execuções com foto ligada = execuções migradas que tinham foto',
    `SELECT (SELECT COUNT(DISTINCT m.id) FROM execucoes m JOIN execucoes_itens_legado i ON i.id = m.legado_item_id
               WHERE i.evidencia_url LIKE 'data:%' OR i.foto_url LIKE 'data:%') AS esperado,
            (SELECT COUNT(*) FROM execucoes WHERE foto_id IS NOT NULL) AS obtido`],
  ['registro de atividades = auditoria de empresa válida',
    `SELECT (SELECT COUNT(*) FROM auditoria a JOIN empresas e ON e.id = a.admin_id) AS esperado, (SELECT COUNT(*) FROM registro_atividades) AS obtido`],
  ['assinaturas = empresas',
    `SELECT (SELECT COUNT(*) FROM empresas) AS esperado, (SELECT COUNT(*) FROM assinaturas) AS obtido`],
  ['notificações = unidades',
    `SELECT (SELECT COUNT(*) FROM unidades) AS esperado, (SELECT COUNT(*) FROM config_notificacoes) AS obtido`],
  // Isolamento: tudo deve dar zero.
  ['isolamento: cargo de outra empresa que a da unidade',
    `SELECT 0 AS esperado, (SELECT COUNT(*) FROM cargos c JOIN unidades u ON u.id = c.unidade_id WHERE u.empresa_id <> c.empresa_id) AS obtido`],
  ['isolamento: pessoa com cargo fora da unidade principal',
    `SELECT 0 AS esperado, (SELECT COUNT(*) FROM colaboradores co JOIN cargos c ON c.id = co.cargo_id WHERE c.unidade_id <> co.unidade_principal_id) AS obtido`],
  ['isolamento: pessoa em unidade de outra empresa',
    `SELECT 0 AS esperado, (SELECT COUNT(*) FROM colaborador_unidades cu JOIN colaboradores co ON co.id = cu.colaborador_id
                            JOIN unidades u ON u.id = cu.unidade_id WHERE u.empresa_id <> co.empresa_id) AS obtido`],
  ['isolamento: tarefa com pessoa/unidade de outra empresa',
    `SELECT 0 AS esperado, (SELECT COUNT(*) FROM tarefas t JOIN unidades u ON u.id = t.unidade_id LEFT JOIN colaboradores co ON co.id = t.colaborador_id
                            WHERE u.empresa_id <> t.empresa_id OR co.empresa_id <> t.empresa_id) AS obtido`],
  ['isolamento: execução de outra empresa que a da tarefa',
    `SELECT 0 AS esperado, (SELECT COUNT(*) FROM execucoes x JOIN tarefas t ON t.id = x.tarefa_id
                            JOIN colaboradores co ON co.id = x.colaborador_id WHERE t.empresa_id <> x.empresa_id OR co.empresa_id <> x.empresa_id) AS obtido`],
  ['isolamento: perfil de acesso de outra empresa (cargos e pessoas)',
    `SELECT 0 AS esperado, (SELECT COUNT(*) FROM cargos c JOIN perfis_acesso p ON p.id = c.perfil_acesso_id WHERE p.empresa_id <> c.empresa_id)
                         + (SELECT COUNT(*) FROM colaboradores co JOIN perfis_acesso p ON p.id = co.perfil_acesso_id WHERE p.empresa_id <> co.empresa_id) AS obtido`],
  ['legado intacto: execucoes_legado = execuções antigas',
    `SELECT (SELECT COUNT(*) FROM execucoes_legado) AS esperado, (SELECT COUNT(*) FROM execucoes_legado) AS obtido`]
]

async function main() {
  const client = new Client({
    host,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'valida_v2',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    statement_timeout: 30000,
    options: '-c default_transaction_read_only=on'
  })
  try {
    await client.connect()
  } catch (e) {
    console.error(`Não consegui conectar (código ${e.code || 'desconhecido'}).`)
    process.exit(1)
  }
  let diferencas = 0
  try {
    console.log('VALIDA · conferência pós-migração (só leitura, só números)\n')
    for (const [titulo, sql] of CONFERENCIAS) {
      try {
        const r = (await client.query(sql)).rows[0]
        const ok = Number(r.esperado) === Number(r.obtido)
        if (!ok) diferencas++
        console.log(`  ${ok ? 'ok        ' : 'DIFERENTE '} ${titulo}: esperado ${r.esperado} · obtido ${r.obtido}`)
      } catch (e) {
        diferencas++
        console.log(`  ERRO       ${titulo} (código ${e.code || 'desconhecido'})`)
      }
    }
    console.log(`\n${diferencas === 0 ? '✅ Tudo confere.' : `⚠️  ${diferencas} conferência(s) com diferença.`}\n`)

    const rel = await client.query(
      `SELECT migracao, item, quantidade, motivo FROM migracao_relatorio WHERE quantidade > 0 ORDER BY migracao, id`)
    console.log('## O que ficou só no legado (ou merece atenção)')
    for (const x of rel.rows) console.log(`  ${x.migracao} · ${x.item}: ${x.quantidade} (${x.motivo})`)
  } finally {
    await client.end().catch(() => {})
  }
  process.exitCode = diferencas === 0 ? 0 : 2
}

main().catch((e) => {
  console.error(`Falhou (código ${e && e.code ? e.code : 'desconhecido'}).`)
  process.exit(1)
})
