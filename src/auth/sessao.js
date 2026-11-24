// Sessão (Segurança item 3) e resolução de acesso (roteiro item 5).
//
// Token: { t: 'a' (admin) | 'c' (colaborador), id, e: empresa, v: token_versao }.
// Validade: equipe 12 h (renovável enquanto válido), admin 7 dias.
// A cada requisição o ator é lido do banco: se a versão do token mudou
// (trocou PIN/senha, foi arquivado, saiu de todos os aparelhos) → 401.
//
// req.ator = { tipo, id, nome, empresaId, situacaoEmpresa }
// req.acesso = { admin, chaves: Set, unidades: Set, perfilCargo, cargoId, perfilAcessoId }
const jwt = require('jsonwebtoken')
const db = require('../db')
const config = require('../config')
const { CHAVES } = require('./permissoes')
const { naoAutenticado, proibido, naoEncontrado } = require('../lib/erros')

function assinar(ator) {
  const admin = ator.tipo === 'admin'
  return jwt.sign(
    { t: admin ? 'a' : 'c', id: ator.id, e: ator.empresaId, v: ator.tokenVersao },
    config.jwtSegredo(),
    { expiresIn: admin ? config.sessao.admin : config.sessao.equipe }
  )
}

async function carregarAcessoColaborador(c) {
  const perfilId = c.perfil_acesso_id || c.cargo_perfil_acesso_id
  const chaves = await db.q(
    `SELECT pp.chave FROM perfil_permissoes pp JOIN perfis_acesso pa ON pa.id = pp.perfil_id
     WHERE pp.perfil_id = $1 AND pp.permitido AND pa.empresa_id = $2`, [perfilId, c.empresa_id])
  const unidades = await db.q(
    `SELECT cu.unidade_id FROM colaborador_unidades cu JOIN unidades u ON u.id = cu.unidade_id
     WHERE cu.colaborador_id = $1 AND u.empresa_id = $2`, [c.id, c.empresa_id])
  return {
    admin: false,
    chaves: new Set(chaves.map((x) => x.chave)),
    unidades: new Set(unidades.map((x) => x.unidade_id)),
    perfilCargo: c.cargo_perfil,
    cargoId: c.cargo_id,
    perfilAcessoId: perfilId
  }
}

async function carregarAtor(tipo, id) {
  if (tipo === 'admin') {
    const a = await db.um(
      `SELECT a.id, a.nome, a.empresa_id, a.token_versao, e.situacao
       FROM admins a JOIN empresas e ON e.id = a.empresa_id WHERE a.id = $1`, [id])
    if (!a) return null
    const unidades = await db.q('SELECT id FROM unidades WHERE empresa_id = $1', [a.empresa_id])
    return {
      ator: { tipo: 'admin', id: a.id, nome: a.nome, empresaId: a.empresa_id, tokenVersao: a.token_versao, situacaoEmpresa: a.situacao },
      acesso: { admin: true, chaves: new Set(CHAVES), unidades: new Set(unidades.map((u) => u.id)), perfilCargo: null }
    }
  }
  const c = await db.um(
    `SELECT c.*, cg.perfil AS cargo_perfil, cg.perfil_acesso_id AS cargo_perfil_acesso_id, e.situacao AS situacao_empresa
     FROM colaboradores c JOIN cargos cg ON cg.id = c.cargo_id JOIN empresas e ON e.id = c.empresa_id
     WHERE c.id = $1 AND c.excluido_em IS NULL`, [id])
  if (!c) return null
  return {
    ator: { tipo: 'colaborador', id: c.id, nome: c.nome, empresaId: c.empresa_id, tokenVersao: c.token_versao, situacao: c.situacao, situacaoEmpresa: c.situacao_empresa, unidadePrincipalId: c.unidade_principal_id },
    acesso: await carregarAcessoColaborador(c)
  }
}

// Middleware: exige sessão válida.
async function autenticar(req, res, next) {
  const bruto = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!bruto) throw naoAutenticado('Entre para continuar.')
  let tk
  try {
    tk = jwt.verify(bruto, config.jwtSegredo())
  } catch {
    throw naoAutenticado()
  }
  const r = await carregarAtor(tk.t === 'a' ? 'admin' : 'colaborador', tk.id)
  if (!r || r.ator.empresaId !== tk.e || r.ator.tokenVersao !== tk.v) throw naoAutenticado()
  if (r.ator.tipo === 'colaborador' && r.ator.situacao !== 'ativo') throw naoAutenticado()
  if (r.ator.situacaoEmpresa === 'bloqueada') throw proibido('A conta está bloqueada. Fale com o responsável pela assinatura.')
  if (r.ator.situacaoEmpresa === 'consulta' && !['GET', 'HEAD'].includes(req.method) && !req.path.startsWith('/auth/')) {
    throw proibido('A conta está em modo consulta: dá para ver, mas não para alterar.')
  }
  req.ator = r.ator
  req.acesso = r.acesso
  req.tokenExp = tk.exp
  next()
}

// ---- conferências usadas pelas rotas ---------------------------------------
const tem = (req, chave) => req.acesso.admin || req.acesso.chaves.has(chave)

function exigir(...chaves) {
  return (req, res, next) => {
    if (!chaves.every((c) => tem(req, c))) throw proibido()
    next()
  }
}

function soAdmin(req, res, next) {
  if (!req.acesso.admin) throw proibido('Só o admin pode fazer isso.')
  next()
}

// Unidade fora do alcance de quem pede → 404 (não revela que existe).
function conferirUnidade(req, unidadeId) {
  if (!req.acesso.unidades.has(Number(unidadeId))) throw naoEncontrado()
}

module.exports = { assinar, autenticar, carregarAtor, tem, exigir, soAdmin, conferirUnidade }
