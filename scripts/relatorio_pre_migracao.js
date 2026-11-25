// Relatório SÓ LEITURA antes da migração (mapa §6.3, resposta D22).
//
// O que ele faz:
//   - lê a conexão do .env (back/.env) sem imprimir nada dela;
//   - roda só consultas de contagem (SELECT COUNT/SUM/EXISTS), fixas aqui no
//     código; nenhuma consulta vem de fora;
//   - antes de conectar, confere todas as consultas e se recusa a rodar se
//     alguma não for um SELECT simples;
//   - a sessão do banco é aberta em modo somente leitura
//     (default_transaction_read_only=on), então mesmo um erro aqui não grava;
//   - imprime só números. Se alguma resposta vier com algo que não seja
//     número, o script para sem mostrar o valor.
//
// Nunca imprime nomes, celulares, e-mails, PINs, fotos, host, usuário,
// senha ou nome do banco. Em caso de erro, mostra só o código do erro.
//
// Como rodar (dentro da pasta back/):
//   node scripts/relatorio_pre_migracao.js
//
// Por padrão só aceita banco local. Para outro banco é preciso passar
// --banco-remoto de propósito (continua só leitura).

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Client } = require('pg')

// ---------------------------------------------------------------------------
// Argumentos: só os conhecidos.
const ARGS_VALIDOS = ['--banco-remoto']
const args = process.argv.slice(2)
const desconhecidos = args.filter((a) => !ARGS_VALIDOS.includes(a))
if (desconhecidos.length) {
  console.error('Argumento não reconhecido. Uso: node scripts/relatorio_pre_migracao.js [--banco-remoto]')
  process.exit(1)
}
const permitirRemoto = args.includes('--banco-remoto')

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal && !permitirRemoto) {
  console.error('Recusado: o banco configurado não é local. Para rodar mesmo assim (só leitura), use --banco-remoto.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Conta (empresa) de cada usuário: o super_admin é a própria conta; os demais
// pertencem à conta do dono da unidade em que estão (usuarios.loja_id ->
// lojas.admin_id), igual a src/helpers/adminLojas.js.
const CONTA_DO_USUARIO = `CASE WHEN u.perfil = 'super_admin' THEN u.id ELSE l.admin_id END`
const USUARIOS_COM_CONTA = `usuarios u LEFT JOIN lojas l ON l.id = u.loja_id`
const CELULAR = `NULLIF(regexp_replace(COALESCE(u.whatsapp, ''), '[^0-9]', '', 'g'), '')`
const EH_EQUIPE = `COALESCE(u.perfil, '') <> 'super_admin'`

// Cada consulta: título, tabelas de que depende e SQL que devolve UMA linha
// só com colunas numéricas. "depende": números que usam uma coluna criada pelas
// migrations 001–019. Num banco mais antigo a coluna entra como vazia só na
// leitura, e o número aparece como "coluna ausente" (os outros saem normalmente).
const CONSULTAS = [
  {
    titulo: 'Pessoas (usuarios)',
    depende: { arquivados: 'usuarios.arquivado_em' },
    tabelas: ['usuarios', 'lojas'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE u.ativo = 1) AS ativos,
      COUNT(*) FILTER (WHERE u.arquivado_em IS NOT NULL) AS arquivados,
      COUNT(*) FILTER (WHERE u.perfil = 'super_admin') AS donos_super_admin,
      COUNT(*) FILTER (WHERE u.perfil = 'gerente') AS gerentes,
      COUNT(*) FILTER (WHERE u.perfil = 'fiscal') AS lideres_fiscal,
      COUNT(*) FILTER (WHERE u.perfil = 'operador') AS operadores,
      COUNT(*) FILTER (WHERE u.perfil IS NULL OR u.perfil NOT IN ('super_admin','gerente','fiscal','operador')) AS outro_perfil,
      COUNT(*) FILTER (WHERE ${EH_EQUIPE} AND ${CONTA_DO_USUARIO} IS NULL) AS equipe_sem_conta_definida
    FROM ${USUARIOS_COM_CONTA}`
  },
  {
    titulo: 'Celular da equipe (D11, D19)',
    tabelas: ['usuarios', 'lojas'],
    sql: `SELECT
      COUNT(*) FILTER (WHERE ${EH_EQUIPE} AND ${CELULAR} IS NULL) AS equipe_sem_celular,
      COUNT(*) FILTER (WHERE ${EH_EQUIPE} AND u.ativo = 1 AND ${CELULAR} IS NULL) AS equipe_ativa_sem_celular,
      COUNT(*) FILTER (WHERE ${EH_EQUIPE} AND ${CELULAR} IS NOT NULL AND length(${CELULAR}) NOT IN (10, 11, 12, 13)) AS celular_tamanho_estranho
    FROM ${USUARIOS_COM_CONTA}`
  },
  {
    titulo: 'Celulares repetidos na mesma empresa (D19)',
    tabelas: ['usuarios', 'lojas'],
    sql: `SELECT
      COUNT(*) AS grupos_repetidos,
      COALESCE(SUM(qtd), 0) AS pessoas_envolvidas,
      COALESCE(MAX(qtd), 0) AS maior_grupo
    FROM (
      SELECT ${CONTA_DO_USUARIO} AS conta, ${CELULAR} AS cel, COUNT(*) AS qtd
      FROM ${USUARIOS_COM_CONTA}
      WHERE ${CELULAR} IS NOT NULL
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    ) x`
  },
  {
    titulo: 'Celulares repetidos entre empresas diferentes',
    tabelas: ['usuarios', 'lojas'],
    sql: `SELECT
      COUNT(*) AS celulares_em_mais_de_uma_empresa
    FROM (
      SELECT ${CELULAR} AS cel
      FROM ${USUARIOS_COM_CONTA}
      WHERE ${CELULAR} IS NOT NULL
      GROUP BY 1
      HAVING COUNT(DISTINCT ${CONTA_DO_USUARIO}) > 1
    ) x`
  },
  {
    titulo: 'PIN (D11)',
    tabelas: ['usuarios'],
    sql: `SELECT
      COUNT(*) FILTER (WHERE u.pin IS NOT NULL AND u.pin <> '' AND u.pin NOT LIKE '$2%') AS pin_texto_puro,
      COUNT(*) FILTER (WHERE u.pin LIKE '$2%') AS pin_em_hash,
      COUNT(*) FILTER (WHERE ${EH_EQUIPE} AND (u.pin IS NULL OR u.pin = '')) AS equipe_sem_pin,
      COUNT(*) FILTER (WHERE u.perfil = 'gerente' AND (u.pin IS NULL OR u.pin NOT LIKE '$2%')) AS gerentes_sem_pin_em_hash
    FROM usuarios u`
  },
  {
    titulo: 'E-mails repetidos (ignorando maiúsculas)',
    tabelas: ['usuarios'],
    sql: `SELECT
      COUNT(*) AS grupos_repetidos,
      COALESCE(SUM(qtd), 0) AS pessoas_envolvidas
    FROM (
      SELECT lower(trim(email)) AS e, COUNT(*) AS qtd
      FROM usuarios
      WHERE email IS NOT NULL AND trim(email) <> ''
      GROUP BY 1
      HAVING COUNT(*) > 1
    ) x`
  },
  {
    titulo: 'Unidades (lojas): ativo 1 = ativa, 0 = inativa, -1 = arquivada',
    depende: { arquivadas_sem_data: 'lojas.arquivado_em' },
    tabelas: ['lojas'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE ativo = 1) AS ativas,
      COUNT(*) FILTER (WHERE ativo = 0) AS inativas,
      COUNT(*) FILTER (WHERE ativo = -1) AS arquivadas,
      COUNT(*) FILTER (WHERE ativo = -1 AND arquivado_em IS NULL) AS arquivadas_sem_data,
      COUNT(*) FILTER (WHERE ativo IS NULL OR ativo NOT IN (1, 0, -1)) AS outro_valor,
      COUNT(*) FILTER (WHERE aberta = 1) AS abertas_hoje,
      COUNT(*) FILTER (WHERE admin_id IS NULL) AS sem_admin_id,
      COUNT(DISTINCT admin_id) AS empresas_com_unidade
    FROM lojas`
  },
  {
    titulo: 'Horários das unidades (loja_horarios)',
    tabelas: ['loja_horarios'],
    sql: `SELECT
      COALESCE(SUM(qtd), 0) AS linhas,
      COUNT(*) AS dias_com_horario,
      COUNT(DISTINCT loja_id) AS unidades_com_horario,
      COUNT(*) FILTER (WHERE qtd > 3) AS dias_com_mais_de_3_turnos,
      COALESCE(MAX(qtd), 0) AS maior_numero_de_turnos_no_dia,
      COALESCE(SUM(invalidos), 0) AS linhas_com_hora_invalida
    FROM (
      SELECT loja_id, dia_semana, COUNT(*) AS qtd,
        COUNT(*) FILTER (WHERE hora_abertura !~ '^([01][0-9]|2[0-3]):[0-5][0-9]' OR hora_fechamento !~ '^([01][0-9]|2[0-3]):[0-5][0-9]' OR hora_abertura IS NULL OR hora_fechamento IS NULL) AS invalidos
      FROM loja_horarios
      GROUP BY 1, 2
    ) x`
  },
  {
    titulo: 'Dias fechados (loja_fechamentos)',
    tabelas: ['loja_fechamentos'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE data !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') AS data_invalida
    FROM loja_fechamentos`
  },
  {
    titulo: 'Órfãos: admin_id que não é de nenhum super_admin (ficam só no legado)',
    depende: { perfis_orfaos: 'perfis.admin_id' },
    tabelas: ['usuarios', 'lojas', 'perfis', 'checklists'],
    sql: `SELECT
      (SELECT COUNT(*) FROM lojas l WHERE NOT EXISTS (SELECT 1 FROM usuarios d WHERE d.id = l.admin_id AND d.perfil = 'super_admin')) AS unidades_orfas,
      (SELECT COUNT(*) FROM perfis p WHERE (p.sistema = 0 OR p.sistema IS NULL) AND NOT EXISTS (SELECT 1 FROM usuarios d WHERE d.id = p.admin_id AND d.perfil = 'super_admin')) AS perfis_orfaos,
      (SELECT COUNT(*) FROM checklists c WHERE NOT EXISTS (SELECT 1 FROM lojas l JOIN usuarios d ON d.id = l.admin_id AND d.perfil = 'super_admin' WHERE l.id = c.loja_id)) AS tarefas_orfas,
      (SELECT COUNT(*) FROM usuarios u WHERE COALESCE(u.perfil, '') <> 'super_admin' AND NOT EXISTS (SELECT 1 FROM lojas l JOIN usuarios d ON d.id = l.admin_id AND d.perfil = 'super_admin' WHERE l.id = u.loja_id)) AS pessoas_orfas,
      (SELECT COUNT(*) FROM usuarios u WHERE u.loja_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lojas l WHERE l.id = u.loja_id)) AS pessoas_de_unidade_que_nao_existe`
  },
  {
    titulo: 'Cargos e perfis (perfis) (D1, D9, D16)',
    depende: { empresas_com_personalizado: 'perfis.admin_id', personalizados_sem_empresa: 'perfis.admin_id', alcance_todas: 'perfis.escopo', alcance_escolhidas: 'perfis.escopo', alcance_propria: 'perfis.escopo', alcance_outro: 'perfis.escopo' },
    tabelas: ['perfis'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE sistema = 1) AS do_sistema,
      COUNT(*) FILTER (WHERE sistema = 0 OR sistema IS NULL) AS personalizados,
      COUNT(DISTINCT admin_id) FILTER (WHERE sistema = 0 OR sistema IS NULL) AS empresas_com_personalizado,
      COUNT(*) FILTER (WHERE (sistema = 0 OR sistema IS NULL) AND admin_id IS NULL) AS personalizados_sem_empresa,
      COUNT(*) FILTER (WHERE escopo = 'todas') AS alcance_todas,
      COUNT(*) FILTER (WHERE escopo = 'escolhidas') AS alcance_escolhidas,
      COUNT(*) FILTER (WHERE escopo = 'propria_unidade') AS alcance_propria,
      COUNT(*) FILTER (WHERE escopo IS NULL OR escopo NOT IN ('todas','escolhidas','propria_unidade')) AS alcance_outro
    FROM perfis`
  },
  {
    titulo: 'Maior número de perfis personalizados numa empresa',
    depende: { maximo: 'perfis.admin_id' },
    tabelas: ['perfis'],
    sql: `SELECT COALESCE(MAX(qtd), 0) AS maximo
    FROM (
      SELECT admin_id, COUNT(*) AS qtd FROM perfis
      WHERE (sistema = 0 OR sistema IS NULL) AND admin_id IS NOT NULL
      GROUP BY 1
    ) x`
  },
  {
    titulo: 'Matriz de permissões antiga (perfil_permissoes, ou _legado depois da migração)',
    tabelas: ['{{perfil_permissoes}}'],
    sql: `SELECT
      COUNT(*) AS linhas,
      COUNT(*) FILTER (WHERE permitido = 1) AS permitidas,
      COUNT(DISTINCT perfil_id) AS perfis_com_matriz,
      COUNT(DISTINCT modulo || '.' || acao) AS chaves_distintas
    FROM {{perfil_permissoes}}`
  },
  {
    titulo: 'Vínculos de unidade (usuario_lojas, perfil_lojas)',
    tabelas: ['usuario_lojas', 'perfil_lojas'],
    sql: `SELECT
      (SELECT COUNT(*) FROM usuario_lojas) AS usuario_lojas,
      (SELECT COUNT(DISTINCT usuario_id) FROM usuario_lojas) AS pessoas_com_vinculo,
      (SELECT COUNT(*) FROM (SELECT usuario_id FROM usuario_lojas GROUP BY 1 HAVING COUNT(*) > 1) x) AS pessoas_com_mais_de_uma_unidade,
      (SELECT COUNT(*) FROM perfil_lojas) AS perfil_lojas`
  },
  {
    titulo: 'Tarefas (checklists) (D3, D4, D8)',
    depende: { tipo_lider: 'checklists.tipo', tipo_operador: 'checklists.tipo' },
    tabelas: ['checklists', 'usuarios'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE c.ativo = 1) AS ativas,
      COUNT(*) FILTER (WHERE c.pausado = 1) AS pausadas,
      COUNT(*) FILTER (WHERE c.loja_id IS NULL) AS sem_unidade,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM usuarios d WHERE d.id = c.criado_por AND d.perfil = 'super_admin')) AS criadas_por_dono,
      COUNT(*) FILTER (WHERE c.tipo = 'lider') AS tipo_lider,
      COUNT(*) FILTER (WHERE c.tipo = 'operador') AS tipo_operador
    FROM checklists c`
  },
  {
    titulo: 'Sub-itens (checklist_itens) (P4)',
    tabelas: ['checklist_itens'],
    sql: `SELECT
      COUNT(*) AS itens,
      COUNT(DISTINCT checklist_id) AS tarefas_com_itens,
      COALESCE(MAX(qtd), 0) AS maior_numero_de_itens
    FROM checklist_itens ci
    LEFT JOIN (SELECT checklist_id AS cid, COUNT(*) AS qtd FROM checklist_itens GROUP BY 1) x ON x.cid = ci.checklist_id`
  },
  {
    titulo: 'Quem recebe cada tarefa (D4)',
    tabelas: ['usuario_checklists', 'checklist_cargos', 'usuarios'],
    sql: `SELECT
      (SELECT COUNT(*) FROM usuario_checklists) AS vinculos_por_pessoa,
      (SELECT COUNT(*) FROM usuario_checklists WHERE ativo = 1) AS vinculos_por_pessoa_ativos,
      (SELECT COUNT(*) FROM usuario_checklists WHERE bonus_override IS NOT NULL OR desconto_override IS NOT NULL) AS com_valor_proprio,
      (SELECT COUNT(*) FROM usuario_checklists uc JOIN usuarios d ON d.id = uc.usuario_id WHERE d.perfil = 'super_admin') AS vinculos_de_dono,
      (SELECT COUNT(*) FROM checklist_cargos) AS vinculos_por_cargo,
      (SELECT COUNT(*) FROM checklist_cargos WHERE ativo = 1) AS vinculos_por_cargo_ativos,
      (SELECT COUNT(DISTINCT checklist_id) FROM checklist_cargos WHERE ativo = 1) AS tarefas_com_cargo`
  },
  {
    titulo: 'Datas extras (checklist_datas)',
    tabelas: ['checklist_datas'],
    sql: `SELECT COUNT(*) AS total FROM checklist_datas`
  },
  {
    titulo: 'Execuções antigas (execucoes, ou _legado depois da migração) (D3, D6, D7)',
    depende: { conferencia_pendente: '{{execucoes}}.status_conferencia', conferencia_aprovada: '{{execucoes}}.status_conferencia', conferencia_reprovada: '{{execucoes}}.status_conferencia' },
    tabelas: ['{{execucoes}}', 'usuarios'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE e.status = 'em_andamento') AS em_andamento,
      COUNT(*) FILTER (WHERE e.status = 'concluido' OR e.status = 'concluida') AS concluidas,
      COUNT(*) FILTER (WHERE e.status IS NULL OR e.status NOT IN ('em_andamento','concluido','concluida')) AS outro_status,
      COUNT(*) FILTER (WHERE e.status_conferencia = 'pendente') AS conferencia_pendente,
      COUNT(*) FILTER (WHERE e.status_conferencia = 'aprovada' OR e.status_conferencia = 'aprovado') AS conferencia_aprovada,
      COUNT(*) FILTER (WHERE e.status_conferencia = 'reprovada' OR e.status_conferencia = 'reprovado') AS conferencia_reprovada,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM usuarios d WHERE d.id = e.usuario_id AND d.perfil = 'super_admin')) AS de_dono,
      COUNT(*) FILTER (WHERE e.loja_id IS NULL) AS sem_unidade
    FROM {{execucoes}} e`
  },
  {
    titulo: 'Respostas e fotos antigas (execucoes_itens, ou _legado depois da migração)',
    tabelas: ['{{execucoes_itens}}'],
    sql: `SELECT
      COUNT(*) AS respostas,
      COUNT(*) FILTER (WHERE evidencia_url LIKE 'data:%' OR foto_url LIKE 'data:%') AS fotos_base64,
      COALESCE(ROUND(SUM(
        (CASE WHEN evidencia_url LIKE 'data:%' THEN octet_length(evidencia_url) ELSE 0 END) +
        (CASE WHEN foto_url LIKE 'data:%' THEN octet_length(foto_url) ELSE 0 END)
      ) / 1048576.0, 1), 0) AS fotos_base64_mb,
      COUNT(*) FILTER (WHERE (evidencia_url IS NOT NULL AND evidencia_url NOT LIKE 'data:%') OR (foto_url IS NOT NULL AND foto_url NOT LIKE 'data:%')) AS fotos_em_outro_formato
    FROM {{execucoes_itens}}`
  },
  {
    titulo: 'Assinaturas (subscriptions) (P1, D13)',
    tabelas: ['subscriptions', 'planos'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE s.status = 'trial' AND (s.trial_fim IS NULL OR s.trial_fim >= NOW())) AS trial_em_dia,
      COUNT(*) FILTER (WHERE s.status = 'trial' AND s.trial_fim < NOW()) AS trial_vencido,
      COUNT(*) FILTER (WHERE s.status = 'ativo') AS ativas,
      COUNT(*) FILTER (WHERE s.status = 'suspenso') AS suspensas,
      COUNT(*) FILTER (WHERE s.status = 'cancelado') AS canceladas,
      COUNT(*) FILTER (WHERE s.status NOT IN ('trial','ativo','suspenso','cancelado')) AS outro_status,
      COUNT(*) FILTER (WHERE p.slug = 'essencial') AS plano_essencial,
      COUNT(*) FILTER (WHERE p.slug = 'profissional') AS plano_profissional,
      COUNT(*) FILTER (WHERE p.slug = 'franquia') AS plano_franquia,
      COUNT(*) FILTER (WHERE s.gateway_subscription_id IS NOT NULL) AS com_assinatura_no_gateway
    FROM subscriptions s LEFT JOIN planos p ON p.id = s.plano_id`
  },
  {
    titulo: 'Empresas sem assinatura',
    tabelas: ['usuarios', 'subscriptions'],
    sql: `SELECT COUNT(*) AS donos_sem_assinatura
    FROM usuarios u
    WHERE u.perfil = 'super_admin' AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.admin_id = u.id)`
  },
  {
    titulo: 'Outras tabelas (D15, auditoria)',
    tabelas: ['templates', 'template_itens', 'onboarding_progresso', 'auditoria'],
    sql: `SELECT
      (SELECT COUNT(*) FROM templates) AS templates,
      (SELECT COUNT(*) FROM template_itens) AS template_itens,
      (SELECT COUNT(*) FROM onboarding_progresso) AS onboarding_progresso,
      (SELECT COUNT(*) FROM auditoria) AS auditoria`
  },
  {
    titulo: 'Redefinição de senha (password_resets)',
    tabelas: ['password_resets'],
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE usado = false AND expira_em > NOW()) AS validos_agora
    FROM password_resets`
  }
]

// Depois da migração: contagens das tabelas novas (puladas se não existirem).
const NOVAS = [
  {
    titulo: 'Tabelas novas: empresas, unidades e pessoas',
    tabelas: ['empresas', 'admins', 'unidades', 'colaboradores', 'cargos', 'perfis_acesso'],
    sql: `SELECT
      (SELECT COUNT(*) FROM empresas) AS empresas,
      (SELECT COUNT(*) FROM admins) AS admins,
      (SELECT COUNT(*) FROM unidades) AS unidades,
      (SELECT COUNT(*) FROM unidades WHERE arquivado_em IS NULL) AS unidades_ativas,
      (SELECT COUNT(*) FROM colaboradores WHERE excluido_em IS NULL) AS pessoas,
      (SELECT COUNT(*) FROM colaboradores WHERE excluido_em IS NULL AND situacao = 'ativo') AS pessoas_ativas,
      (SELECT COUNT(*) FROM colaboradores WHERE excluido_em IS NULL AND situacao = 'aguardando') AS pessoas_aguardando,
      (SELECT COUNT(*) FROM colaboradores WHERE excluido_em IS NULL AND celular IS NULL) AS pessoas_sem_celular,
      (SELECT COUNT(*) FROM colaboradores WHERE excluido_em IS NULL AND pin_hash IS NOT NULL) AS pessoas_com_pin,
      (SELECT COUNT(*) FROM cargos WHERE arquivado_em IS NULL) AS cargos_ativos,
      (SELECT COUNT(*) FROM perfis_acesso WHERE arquivado_em IS NULL) AS perfis_de_acesso`
  },
  {
    titulo: 'Tabelas novas: tarefas, execuções e fotos',
    tabelas: ['tarefas', 'execucoes_legado', 'fotos'],
    sql: `SELECT
      (SELECT COUNT(*) FROM tarefas) AS tarefas,
      (SELECT COUNT(*) FROM tarefas WHERE ativa AND arquivado_em IS NULL) AS tarefas_ativas,
      (SELECT COUNT(*) FROM tarefas WHERE pai_id IS NOT NULL) AS sub_itens,
      (SELECT COUNT(*) FROM tarefas WHERE cargo_id IS NOT NULL) AS tarefas_de_cargo,
      (SELECT COUNT(*) FROM execucoes) AS execucoes,
      (SELECT COUNT(*) FROM execucoes WHERE estado = 'a_fazer') AS a_fazer,
      (SELECT COUNT(*) FROM execucoes WHERE estado = 'feita') AS feitas,
      (SELECT COUNT(*) FROM execucoes WHERE estado = 'nao_feita') AS nao_feitas,
      (SELECT COUNT(*) FROM execucoes WHERE estado = 'dispensada') AS dispensadas,
      (SELECT COUNT(*) FROM execucoes WHERE estado IN ('cancelada', 'na')) AS canceladas_ou_na,
      (SELECT COUNT(*) FROM execucoes WHERE desfeita_em IS NOT NULL) AS desfeitas,
      (SELECT COUNT(*) FROM execucoes WHERE conferencia = 'aprovada') AS aprovadas,
      (SELECT COUNT(*) FROM execucoes WHERE conferencia = 'reaberta') AS reabertas,
      (SELECT COUNT(*) FROM fotos) AS fotos,
      (SELECT COALESCE(ROUND(SUM(tamanho) / 1048576.0, 2), 0) FROM fotos) AS fotos_mb`
  },
  {
    titulo: 'Tabelas novas: pedidos, ações, logins e registro',
    tabelas: ['pedidos', 'acoes', 'logins', 'registro_atividades', 'regras_bonus'],
    sql: `SELECT
      (SELECT COUNT(*) FROM pedidos WHERE estado = 'pend') AS pedidos_pendentes,
      (SELECT COUNT(*) FROM pedidos WHERE estado = 'ok') AS pedidos_aprovados,
      (SELECT COUNT(*) FROM pedidos WHERE estado = 'no') AS pedidos_negados,
      (SELECT COUNT(*) FROM acoes WHERE estado = 'aberta') AS acoes_abertas,
      (SELECT COUNT(*) FROM acoes WHERE estado = 'resolvida') AS acoes_resolvidas,
      (SELECT COUNT(*) FROM logins) AS logins,
      (SELECT COUNT(*) FROM registro_atividades) AS registro_atividades,
      (SELECT COUNT(*) FROM regras_bonus) AS regras_bonus`
  }
]

// Nomes das tabelas antigas que mudaram de nome na migração (027 e 034).
function nomes(migrado) {
  return migrado
    ? { execucoes: 'execucoes_legado', execucoes_itens: 'execucoes_itens_legado', perfil_permissoes: 'perfil_permissoes_legado' }
    : { execucoes: 'execucoes', execucoes_itens: 'execucoes_itens', perfil_permissoes: 'perfil_permissoes' }
}
const TIPO_COLUNA = { arquivado_em: 'timestamp', admin_id: 'integer', escopo: 'text', tipo: 'text', status_conferencia: 'text' }
// "FROM perfis p" → "FROM (SELECT _t.*, NULL::text AS escopo FROM perfis _t) p".
function comColunasVazias(sql, ausentes) {
  const porTabela = {}
  for (const c of ausentes) { const [t, col] = c.split('.'); (porTabela[t] = porTabela[t] || []).push(col) }
  for (const [t, cols] of Object.entries(porTabela)) {
    const extra = [...new Set(cols)].map((c) => `NULL::${TIPO_COLUNA[c] || 'text'} AS ${c}`).join(', ')
    sql = sql.replace(new RegExp(`\\b(FROM|JOIN)\\s+${t}\\b(\\s+(?!WHERE|LEFT|JOIN|GROUP|ORDER|ON|LIMIT)[a-z]\\w*)?`, 'g'),
      (_, pre, apelido) => `${pre} (SELECT _t.*, ${extra} FROM ${t} _t)${apelido || ` ${t}`}`)
  }
  return sql
}
const trocar = (texto, n) => texto.replace(/\{\{(\w+)\}\}/g, (_, k) => n[k])
function montar(migrado) {
  const n = nomes(migrado)
  return [...CONSULTAS, ...(migrado ? NOVAS : [])].map((c) => ({ ...c, sql: trocar(c.sql, n), tabelas: c.tabelas.map((t) => trocar(t, n)), depende: Object.fromEntries(Object.entries(c.depende || {}).map(([k, v]) => [k, trocar(v, n)])) }))
}

// Tabelas novas que não podem existir ainda (colisão / migração já feita).
const TABELAS_PARA_CONFERIR = [
  'password_resets', 'schema_migrations', 'empresas', 'admins', 'pessoas', 'unidades',
  'cargos', 'tarefas', 'execucoes_legado', 'perfil_permissoes_legado'
]

// ---------------------------------------------------------------------------
// Conferência das consultas ANTES de conectar: só SELECT simples.
const PROIBIDAS = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|exec|prepare|deallocate|lock|vacuum|analyze|cluster|reindex|set|reset|comment|security|refresh|listen|notify|unlisten|discard|checkpoint|load|import|into|returning|nextval|setval|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|current_setting|set_config|inet_server_addr|inet_server_port|current_database|current_user|session_user|version)\b/i

function conferirConsulta(sql) {
  const s = sql.trim()
  if (!/^select\b/i.test(s)) return 'não começa com SELECT'
  if (s.includes(';')) return 'tem ";"'
  if (s.includes('--') || s.includes('/*')) return 'tem comentário'
  if (PROIBIDAS.test(s)) return `usa palavra proibida (${s.match(PROIBIDAS)[0]})`
  return null
}

const SQL_EXISTE_TABELA = `SELECT to_regclass($1) IS NOT NULL AS existe`
const SQL_EXISTE_COLUNA = `SELECT COUNT(*) > 0 AS existe FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`
const todas = [SQL_EXISTE_TABELA, SQL_EXISTE_COLUNA, ...[...montar(false), ...montar(true)].flatMap((c) => [c.sql, comColunasVazias(c.sql, Object.values(c.depende))])]
for (const sql of todas) {
  const problema = conferirConsulta(sql)
  if (problema) {
    console.error(`Recusado: uma das consultas ${problema}. Nada foi executado.`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
function soNumeros(linha) {
  for (const v of Object.values(linha)) {
    if (v === null || typeof v === 'boolean' || typeof v === 'number') continue
    if (typeof v === 'string' && /^-?[0-9]+(\.[0-9]+)?$/.test(v)) continue
    return false
  }
  return true
}

function erroSeguro(e) {
  return `erro (código ${e && e.code ? e.code : 'desconhecido'})`
}

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
    console.error(`Não consegui conectar ao banco: ${erroSeguro(e)}.`)
    process.exit(1)
  }

  try {
    console.log('VALIDA · relatório pré-migração (só leitura, só números)')
    console.log(`Gerado em: ${new Date().toISOString()}`)
    console.log(`Banco: ${ehLocal ? 'local' : 'remoto'}\n`)

    const existe = {}
    async function tabelaExiste(nome) {
      if (!(nome in existe)) {
        const r = await client.query(SQL_EXISTE_TABELA, [`public.${nome}`])
        existe[nome] = r.rows[0].existe === true
      }
      return existe[nome]
    }

    console.log('## Tabelas que existem hoje')
    for (const t of TABELAS_PARA_CONFERIR) {
      console.log(`  ${t}: ${(await tabelaExiste(t)) ? 'existe' : 'não existe'}`)
    }
    const migrado = await tabelaExiste('execucoes_legado')
    console.log(`\nSituação: ${migrado ? 'banco JÁ migrado (as tabelas antigas são lidas pelos nomes *_legado; no fim, as tabelas novas)' : 'banco ainda NÃO migrado'}\n`)

    for (const c of montar(migrado)) {
      console.log(`## ${c.titulo}`)
      const faltando = []
      for (const t of c.tabelas) if (!(await tabelaExiste(t))) faltando.push(t)
      if (faltando.length) {
        console.log(`  (pulado: tabela ausente: ${faltando.join(', ')})\n`)
        continue
      }
      const ausentes = []
      for (const col of new Set(Object.values(c.depende))) {
        const r = await client.query(SQL_EXISTE_COLUNA, col.split('.'))
        if (!r.rows[0].existe) ausentes.push(col)
      }
      let linha
      try {
        const r = await client.query(comColunasVazias(c.sql, ausentes))
        linha = r.rows[0] || {}
      } catch (e) {
        console.log(e && e.code === '42703' ? '  (pulado: coluna ausente)\n' : `  ${erroSeguro(e)}\n`)
        continue
      }
      if (!soNumeros(linha)) {
        console.error('Parado: uma resposta veio com algo que não é número. Nada foi mostrado.')
        process.exitCode = 1
        return
      }
      for (const [k, v] of Object.entries(linha)) {
        console.log(`  ${k}: ${ausentes.includes(c.depende[k]) ? `coluna ausente (${c.depende[k]})` : v === null ? 0 : v}`)
      }
      console.log('')
    }
    console.log('Fim. Cole este resultado na conversa.')
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error(`Falhou: ${erroSeguro(e)}.`)
  process.exit(1)
})
