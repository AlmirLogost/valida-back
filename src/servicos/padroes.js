// Padrões de empresa e de unidade: perfis fixos (§8) e cargos padrão (§7).
const { CHAVES, PADROES } = require('../auth/permissoes')

// Grava a matriz completa (33 linhas) de um perfil.
async function gravarMatriz(db, perfilId, ligadas) {
  const s = new Set(ligadas)
  await db.exec('DELETE FROM perfil_permissoes WHERE perfil_id = $1', [perfilId])
  await db.exec(
    `INSERT INTO perfil_permissoes (perfil_id, chave, permitido)
     SELECT $1, c, c = ANY($2::text[]) FROM unnest($3::text[]) AS c`,
    [perfilId, [...s], CHAVES]
  )
}

// Garante os 3 perfis fixos da empresa (Gerente, Líder, Operadores).
async function garantirPerfisFixos(db, empresaId) {
  const fixos = [['Gerente', 'c', 'gerente'], ['Líder', 'c', 'lider'], ['Operadores', 'o', 'operadores']]
  const ids = {}
  for (const [nome, tipo, fixoTipo] of fixos) {
    let r = await db.um('SELECT id FROM perfis_acesso WHERE empresa_id = $1 AND fixo_tipo = $2', [empresaId, fixoTipo])
    if (!r) {
      r = await db.um(
        `INSERT INTO perfis_acesso (empresa_id, nome, tipo, fixo, fixo_tipo) VALUES ($1, $2, $3, true, $4) RETURNING id`,
        [empresaId, nome, tipo, fixoTipo])
      await gravarMatriz(db, r.id, PADROES[fixoTipo])
    }
    ids[fixoTipo] = r.id
  }
  return ids
}

// Cargos padrão de uma unidade nova (§7): Gerente e Líder (Coordenação),
// Operador (padrão) e Cozinha (Operador). Com unidade base, copia os cargos
// ativos dela.
async function criarCargosPadrao(db, empresaId, unidadeId, unidadeBaseId = null) {
  const fixos = await garantirPerfisFixos(db, empresaId)
  if (unidadeBaseId) {
    const base = await db.q(
      `SELECT nome, perfil, descricao, padrao, perfil_acesso_id FROM cargos
       WHERE unidade_id = $1 AND empresa_id = $2 AND arquivado_em IS NULL`, [unidadeBaseId, empresaId])
    if (base.length) {
      for (const c of base) {
        await db.exec(
          `INSERT INTO cargos (empresa_id, unidade_id, nome, perfil, descricao, padrao, perfil_acesso_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [empresaId, unidadeId, c.nome, c.perfil, c.descricao, c.padrao, c.perfil_acesso_id])
      }
      return
    }
  }
  // Descrições iguais às da v45 (aparecem no cadastro e em "Editar dados").
  const padrao = [
    ['Gerente', 'coordenador', false, fixos.gerente, 'Vê tudo da unidade, confere tarefas e cuida da equipe.'],
    ['Líder', 'coordenador', true, fixos.lider, 'Confere as tarefas do turno e orienta os operadores.'],
    ['Operador', 'operador', true, fixos.operadores, 'Recebe as tarefas do dia e conclui no celular.'],
    ['Cozinha', 'operador', false, fixos.operadores, 'Preparo, limpeza e abertura da cozinha.']
  ]
  for (const [nome, perfil, ePadrao, pa, descricao] of padrao) {
    await db.exec(
      `INSERT INTO cargos (empresa_id, unidade_id, nome, perfil, padrao, perfil_acesso_id, descricao) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [empresaId, unidadeId, nome, perfil, ePadrao, pa, descricao])
  }
}

module.exports = { gravarMatriz, garantirPerfisFixos, criarCargosPadrao }
