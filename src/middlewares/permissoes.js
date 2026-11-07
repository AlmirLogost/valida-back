// Reforma de Acessos (Passo 3): checagem de permissão granular por
// módulo x ação, usando a matriz perfil_permissoes (migration 006).
//
// Antes da reforma, nenhuma rota conferia a permissão do cargo no back —
// só a conta (isolamento entre empresas). Isso continua existindo (helpers/
// adminLojas.js) e não muda; requirePermissao soma uma segunda camada: além
// de "isso é da minha empresa?", agora também "meu cargo pode fazer isso?".
//
// Dono (super_admin) sempre passa, em qualquer módulo/ação.

const { query, run } = require('../config/database')
const { getAdminId } = require('./../helpers/adminLojas')

// Resolve o perfil (linha da tabela perfis) de quem está logado, já
// considerando a conta certa — perfis de sistema (Dono/Gerente/Fiscal/
// Operador) são globais; cargos personalizados só valem dentro da própria
// conta (admin_id), nunca misturando com o cargo de mesmo nome de outra
// empresa (era o bug corrigido na migration 005).
async function resolverPerfilId(userPerfil, adminId) {
  const rows = await query(
    `SELECT id FROM perfis WHERE nome = ? AND ativo = 1 AND (sistema = 1 OR admin_id = ?) ORDER BY sistema DESC LIMIT 1`,
    [userPerfil, adminId]
  )
  return rows[0]?.id ?? null
}

// Confere se o usuário logado tem a permissão "modulo.acao". Uso direto
// (fora de middleware) quando a checagem precisa acontecer dentro de um
// controller, ex. pra decidir o que incluir numa resposta.
async function temPermissao(userId, userPerfil, moduloAcao) {
  if (userPerfil === 'super_admin') return true
  const adminId = await getAdminId(userId, userPerfil)
  if (!adminId) return false
  const perfilId = await resolverPerfilId(userPerfil, adminId)
  if (!perfilId) return false
  const [modulo, acao] = moduloAcao.split('.')
  const rows = await query(
    'SELECT permitido FROM perfil_permissoes WHERE perfil_id = ? AND modulo = ? AND acao = ?',
    [perfilId, modulo, acao]
  )
  return rows[0]?.permitido === 1
}

// Middleware: usar depois de `auth`. Nunca bloqueia o Dono. Em qualquer
// outro perfil, só deixa passar se a matriz de permissões tiver essa
// combinação módulo.ação marcada como permitida.
const requirePermissao = (moduloAcao) => async (req, res, next) => {
  try {
    if (await temPermissao(req.userId, req.userPerfil, moduloAcao)) return next()
    return res.status(403).json({ erro: 'Seu perfil não tem permissão para isso.' })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}

// Grava uma ação importante na auditoria. NUNCA passar senha, PIN ou token
// em "detalhes" — quem chama é responsável por nunca incluir isso. Uma
// falha ao gravar auditoria nunca pode quebrar a ação principal (por isso
// só loga o erro no console, não propaga).
async function registrarAuditoria(req, { acao, entidade, entidade_id, detalhes }) {
  try {
    const adminId = req.adminId || (await getAdminId(req.userId, req.userPerfil))
    if (!adminId) return
    await run(
      'INSERT INTO auditoria (admin_id, usuario_id, acao, entidade, entidade_id, detalhes) VALUES (?, ?, ?, ?, ?, ?)',
      [adminId, req.userId, acao, entidade, entidade_id ?? null, detalhes ? JSON.stringify(detalhes) : null]
    )
  } catch (e) {
    console.error('[auditoria] falha ao registrar:', e.message)
  }
}

module.exports = { requirePermissao, temPermissao, registrarAuditoria }
