// As 33 chaves da especificação §8, os padrões dos perfis fixos e as
// dependências automáticas.
const CHAVES = [
  'faz', 'foto', 'desfaz', 'hist', 'own', 'pedlib',
  'ver', 'conf', 'criar', 'tedit', 'tdup', 'toff', 'tdel',
  'equipe', 'ecol', 'pin', 'arq', 'del', 'cargos', 'acesso',
  'premio', 'regra', 'ajuste', 'contest',
  'abre', 'dias', 'hor', 'loc', 'lib', 'dispensa',
  'rel', 'exp', 'log'
]

const SENSIVEIS = ['desfaz', 'tedit', 'toff', 'tdel', 'equipe', 'pin', 'arq', 'del', 'acesso', 'regra', 'ajuste', 'abre', 'loc', 'dispensa', 'exp']

const OPERADORES = ['faz', 'foto', 'hist', 'own', 'pedlib']
const LIDER = [...OPERADORES, 'ver', 'conf', 'criar']
const GERENTE = [...LIDER, 'premio', 'lib', 'dispensa', 'rel']

const PADROES = { operadores: OPERADORES, lider: LIDER, gerente: GERENTE }
const MODELOS = { operador: OPERADORES, lider: LIDER, gerente: GERENTE, tudo: CHAVES, branco: [] }

const DE_EQUIPE = ['conf', 'criar', 'tedit', 'tdup', 'toff', 'tdel']

// Dependências: qualquer permissão de equipe liga "ver"; "foto" e "desfaz"
// exigem "faz" (sem "faz", elas saem).
function normalizar(lista) {
  const s = new Set(lista.filter((c) => CHAVES.includes(c)))
  if (DE_EQUIPE.some((c) => s.has(c))) s.add('ver')
  if (!s.has('faz')) { s.delete('foto'); s.delete('desfaz') }
  return [...s]
}

module.exports = { CHAVES, SENSIVEIS, PADROES, MODELOS, DE_EQUIPE, normalizar }
