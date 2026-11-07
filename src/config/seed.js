const { run, query } = require('./database')
const seedDatabase = async () => {
  console.log('Inserindo dados...')
  
  const existeAdmin = await query(`SELECT id FROM perfis WHERE nome = 'super_admin'`)
  if (existeAdmin.length === 0) {
    await run(
      `INSERT INTO perfis (nome, rotulo, metodo_login, pode_acessar_painel, cor, sistema, ordem,
        perm_dashboard, perm_criar_tarefas, perm_executar_tarefas, perm_conferir,
        perm_gerenciar_equipe, perm_gerenciar_lojas, perm_relatorios, perm_configuracoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 1)`,
      ['super_admin', 'Dono', 'email_senha', 1, '#9c27b0', 1, 0]
    )
  } else {
    await run(
      `UPDATE perfis SET perm_dashboard=1, perm_criar_tarefas=1, perm_executar_tarefas=1, perm_conferir=1,
        perm_gerenciar_equipe=1, perm_gerenciar_lojas=1, perm_relatorios=1, perm_configuracoes=1, rotulo='Dono'
       WHERE nome = 'super_admin'`
    )
  }

  const existeFiscal = await query(`SELECT id FROM perfis WHERE nome = 'fiscal' AND sistema = 1`)
  if (existeFiscal.length === 0) {
    await run(
      `INSERT INTO perfis (nome, rotulo, metodo_login, pode_acessar_painel, cor, sistema, ordem,
        perm_dashboard, perm_criar_tarefas, perm_executar_tarefas, perm_conferir,
        perm_gerenciar_equipe, perm_gerenciar_lojas, perm_relatorios, perm_configuracoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 1, 1, 0, 1, 0)`,
      ['fiscal', 'Fiscal', 'pin', 1, '#3483fa', 1, 1]
    )
  } else {
    await run(
      `UPDATE perfis SET perm_dashboard=1, perm_criar_tarefas=1, perm_executar_tarefas=0, perm_conferir=1,
        perm_gerenciar_equipe=1, perm_gerenciar_lojas=0, perm_relatorios=1, perm_configuracoes=0
       WHERE nome = 'fiscal' AND sistema = 1`
    )
  }

  const existeOperador = await query(`SELECT id FROM perfis WHERE nome = 'operador' AND sistema = 1`)
  if (existeOperador.length === 0) {
    await run(
      `INSERT INTO perfis (nome, rotulo, metodo_login, pode_acessar_painel, cor, sistema, ordem,
        perm_dashboard, perm_criar_tarefas, perm_executar_tarefas, perm_conferir,
        perm_gerenciar_equipe, perm_gerenciar_lojas, perm_relatorios, perm_configuracoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 0, 0, 0, 0, 0)`,
      ['operador', 'Operador', 'pin', 0, '#2e7d32', 1, 2]
    )
  } else {
    await run(
      `UPDATE perfis SET perm_dashboard=0, perm_criar_tarefas=0, perm_executar_tarefas=1, perm_conferir=0,
        perm_gerenciar_equipe=0, perm_gerenciar_lojas=0, perm_relatorios=0, perm_configuracoes=0
       WHERE nome = 'operador' AND sistema = 1`
    )
  }
  const existeGerente = await query(`SELECT id FROM perfis WHERE nome = 'gerente' AND sistema = 1`)
  if (existeGerente.length === 0) {
    await run(
      `INSERT INTO perfis (nome, rotulo, metodo_login, pode_acessar_painel, cor, sistema, ordem,
        perm_dashboard, perm_criar_tarefas, perm_executar_tarefas, perm_conferir,
        perm_gerenciar_equipe, perm_gerenciar_lojas, perm_relatorios, perm_configuracoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 0)`,
      ['gerente', 'Gerente', 'email_senha', 1, '#1a73e8', 1, 1]
    )
  } else {
    await run(
      `UPDATE perfis SET perm_dashboard=1, perm_criar_tarefas=1, perm_executar_tarefas=1, perm_conferir=1,
        perm_gerenciar_equipe=1, perm_gerenciar_lojas=1, perm_relatorios=1, perm_configuracoes=0
       WHERE nome = 'gerente' AND sistema = 1`
    )
  }
  console.log('Perfis padrao criados/atualizados!')

  // Reforma de Acessos: garante a matriz de permissões (perfil_permissoes)
  // de todos os perfis de sistema — mesmo mapeamento das migrations 006/007.
  // ON CONFLICT DO NOTHING: nunca sobrescreve um ajuste manual já feito na
  // matriz (exceto o bloco do Dono, que sempre força tudo ligado).
  await run(`
    INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
    SELECT id, 'painel', 'ver', perm_dashboard FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'tarefas', 'ver', CASE WHEN perm_criar_tarefas = 1 OR perm_executar_tarefas = 1 THEN 1 ELSE 0 END FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'tarefas', 'criar', perm_criar_tarefas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'tarefas', 'editar', perm_criar_tarefas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'tarefas', 'arquivar', perm_criar_tarefas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'tarefas', 'executar', perm_executar_tarefas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'unidades', 'ver', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'unidades', 'criar', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'unidades', 'editar', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'unidades', 'arquivar', perm_gerenciar_lojas FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'equipe', 'ver', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'equipe', 'criar', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'equipe', 'editar', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'equipe', 'arquivar', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'relatorios', 'ver', CASE WHEN perm_relatorios = 1 OR perm_conferir = 1 THEN 1 ELSE 0 END FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'comissoes', 'ver_todas', perm_gerenciar_equipe FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'comissoes', 'ver_minhas', 1 FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'configuracoes', 'ver', perm_configuracoes FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'configuracoes', 'editar', perm_configuracoes FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'acessos', 'ver', 0 FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'acessos', 'criar', 0 FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'acessos', 'editar', 0 FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'acessos', 'arquivar', 0 FROM perfis WHERE sistema = 1
    UNION ALL SELECT id, 'plano', 'ver', 0 FROM perfis WHERE sistema = 1
    ON CONFLICT (perfil_id, modulo, acao) DO NOTHING
  `)
  await run(`
    INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido)
    SELECT p.id, m.modulo, m.acao, 1
    FROM perfis p
    CROSS JOIN (VALUES
      ('painel','ver'),
      ('tarefas','ver'),('tarefas','criar'),('tarefas','editar'),('tarefas','arquivar'),('tarefas','executar'),
      ('unidades','ver'),('unidades','criar'),('unidades','editar'),('unidades','arquivar'),
      ('equipe','ver'),('equipe','criar'),('equipe','editar'),('equipe','arquivar'),
      ('relatorios','ver'),
      ('comissoes','ver_todas'),('comissoes','ver_minhas'),
      ('configuracoes','ver'),('configuracoes','editar'),
      ('acessos','ver'),('acessos','criar'),('acessos','editar'),('acessos','arquivar'),
      ('plano','ver')
    ) AS m(modulo, acao)
    WHERE p.nome = 'super_admin' AND p.sistema = 1
    ON CONFLICT (perfil_id, modulo, acao) DO UPDATE SET permitido = 1
  `)

  await run(
    `INSERT INTO lojas (nome) VALUES (?)
     ON CONFLICT DO NOTHING`,
    ['Restaurante Exemplo']
  )
}
module.exports = { seedDatabase }
