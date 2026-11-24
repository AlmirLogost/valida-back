// Teto de permissões por perfil de acesso (Fase 5, bloco B2/B3).
//
// Todo cargo (menos o Proprietário/super_admin, que fica fora dos dois e
// nunca tem teto) pertence a um de dois perfis fixos — 'operador' ou
// 'coordenador' — que definem o MÁXIMO de permissão que aquele cargo pode
// receber na matriz (perfilController.salvarPermissoes valida contra isso).
//
// Mapeado sobre a taxonomia de módulo.ação que já existe no sistema
// (perfilController.MODULOS_ACOES) — o pedido original falava em módulos
// "execucao", "conferencia" e "atribuicao", que não existem como módulos
// separados aqui; eles já são cobertos por tarefas.executar,
// tarefas.conferir e tarefas.criar/editar respectivamente. Decisão
// registrada em docs/REFORMA.md (simplificação seguindo "a opção mais
// segura", conforme pedido, em vez de criar uma taxonomia paralela).

// Teto fixo do Operador: só o básico de executar a própria tarefa e ver a
// própria comissão.
const TETO_OPERADOR = [
  'painel.ver',
  'tarefas.ver',
  'tarefas.executar',
  'comissoes.ver_minhas'
]
// Extras que o Proprietário pode liberar a um cargo Operador específico
// (não vêm ligados por padrão): ver relatórios (da própria unidade) e ver
// a comissão de toda a equipe.
const TETO_OPERADOR_EXTRA = ['relatorios.ver', 'comissoes.ver_todas']

// Teto do Coordenador: tudo do Operador + conferir/gerenciar a equipe e as
// tarefas da(s) unidade(s) do seu alcance. NÃO inclui unidades.criar nem
// unidades.arquivar nem equipe.arquivar nem nada de acessos/plano/
// configuracoes — esses continuam só do Proprietário, a menos que ele
// libere explicitamente pra um cargo (ver perfilController.salvarPermissoes).
const TETO_COORDENADOR = [
  ...TETO_OPERADOR,
  ...TETO_OPERADOR_EXTRA,
  'tarefas.criar',
  'tarefas.editar',
  'tarefas.arquivar',
  'tarefas.conferir',
  'equipe.ver',
  'equipe.criar',
  'equipe.editar',
  'unidades.ver',
  'unidades.editar'
]

// null = sem teto (Proprietário, ou cargo ainda sem perfil_acesso
// classificado — nunca bloqueia por segurança/retrocompatibilidade; a
// migration 016 classifica todo cargo existente, então esse caso só
// aconteceria num cargo criado por um bug futuro).
function tetoDoPerfilAcesso(perfilAcesso) {
  if (perfilAcesso === 'operador') return TETO_OPERADOR_EXTRA.concat(TETO_OPERADOR)
  if (perfilAcesso === 'coordenador') return TETO_COORDENADOR
  return null
}

function dentroDoTeto(perfilAcesso, moduloAcao) {
  const teto = tetoDoPerfilAcesso(perfilAcesso)
  if (teto === null) return true
  return teto.includes(moduloAcao)
}

module.exports = { TETO_OPERADOR, TETO_OPERADOR_EXTRA, TETO_COORDENADOR, tetoDoPerfilAcesso, dentroDoTeto }
