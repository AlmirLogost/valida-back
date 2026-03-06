const bcrypt = require('bcrypt')
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
      ['super_admin', 'Super Admin', 'email_senha', 1, '#9c27b0', 1, 0]
    )
  } else {
    await run(
      `UPDATE perfis SET perm_dashboard=1, perm_criar_tarefas=1, perm_executar_tarefas=1, perm_conferir=1,
        perm_gerenciar_equipe=1, perm_gerenciar_lojas=1, perm_relatorios=1, perm_configuracoes=1
       WHERE nome = 'super_admin'`
    )
  }

  const existeGerente = await query(`SELECT id FROM perfis WHERE nome = 'gerente' AND sistema = 1`)
  if (existeGerente.length === 0) {
    await run(
      `INSERT INTO perfis (nome, rotulo, metodo_login, pode_acessar_painel, cor, sistema, ordem,
        perm_dashboard, perm_criar_tarefas, perm_executar_tarefas, perm_conferir,
        perm_gerenciar_equipe, perm_gerenciar_lojas, perm_relatorios, perm_configuracoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 1, 1, 0, 1, 0)`,
      ['gerente', 'Gerente', 'pin', 1, '#e65100', 1, 1]
    )
  } else {
    await run(
      `UPDATE perfis SET perm_dashboard=1, perm_criar_tarefas=1, perm_executar_tarefas=0, perm_conferir=1,
        perm_gerenciar_equipe=1, perm_gerenciar_lojas=0, perm_relatorios=1, perm_configuracoes=0
       WHERE nome = 'gerente' AND sistema = 1`
    )
  }

  const existeFunc = await query(`SELECT id FROM perfis WHERE nome = 'funcionario' AND sistema = 1`)
  if (existeFunc.length === 0) {
    await run(
      `INSERT INTO perfis (nome, rotulo, metodo_login, pode_acessar_painel, cor, sistema, ordem,
        perm_dashboard, perm_criar_tarefas, perm_executar_tarefas, perm_conferir,
        perm_gerenciar_equipe, perm_gerenciar_lojas, perm_relatorios, perm_configuracoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 0, 0, 0, 0, 0)`,
      ['funcionario', 'Funcionario', 'pin', 0, '#2e7d32', 1, 2]
    )
  } else {
    await run(
      `UPDATE perfis SET perm_dashboard=0, perm_criar_tarefas=0, perm_executar_tarefas=1, perm_conferir=0,
        perm_gerenciar_equipe=0, perm_gerenciar_lojas=0, perm_relatorios=0, perm_configuracoes=0
       WHERE nome = 'funcionario' AND sistema = 1`
    )
  }
  console.log('Perfis padrao criados/atualizados!')

  const senhaHash = await bcrypt.hash('admin123', 10)

  await run(
    `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (email) DO NOTHING`,
    ['Admin VALIDA', 'admin@valida.app', senhaHash, 'super_admin', null]
  )

  await run(
    `INSERT INTO lojas (nome) VALUES (?)
     ON CONFLICT DO NOTHING`,
    ['Restaurante Exemplo']
  )

  console.log('Admin criado!')
}
module.exports = { seedDatabase }
