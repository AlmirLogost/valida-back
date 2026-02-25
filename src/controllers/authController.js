const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Aqui usamos 'database' em vez de 'db' para bater com o seu arquivo real
const { query } = require('../config/database'); 

exports.login = async (req, res) => {
  try {
    console.log('📍 Entrou no controller de login');
    const { email, senha } = req.body;
    console.log('🔍 Tentativa de login:', email); 
    
    // Busca o usuário usando a função query importada do seu database.js
    console.log('🔄 Executando query...');
    const users = await query('SELECT * FROM usuarios WHERE email = ?', [email]);
    console.log('📊 Usuários encontrados:', users ? users.length : 'null'); 
    
    if (users.length === 0) {
      return res.status(401).json({ erro: 'Usuário não encontrado' });
    }
    
    const user = users[0];
    
    // Compara a senha digitada com a senha criptografada no banco
    const senhaValida = await bcrypt.compare(senha, user.senha);
    console.log('🔑 Senha válida:', senhaValida); 
    
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Senha incorreta' });
    }
    
    // Gera o token JWT (certifique-se de ter JWT_SECRET no seu arquivo .env)
    const token = jwt.sign(
      { id: user.id, perfil: user.perfil }, 
      process.env.JWT_SECRET || 'sua_chave_secreta_aqui', 
      { expiresIn: '90d' }
    );
    console.log('✅ Token gerado:', token.substring(0, 20) + '...'); 
    
    // Buscar permissoes do perfil
    const perfilData = await query(
      'SELECT * FROM perfis WHERE nome = ? AND ativo = 1 LIMIT 1',
      [user.perfil]
    )
    const permissoes = perfilData.length > 0 ? {
      perm_dashboard: !!perfilData[0].perm_dashboard,
      perm_criar_tarefas: !!perfilData[0].perm_criar_tarefas,
      perm_executar_tarefas: !!perfilData[0].perm_executar_tarefas,
      perm_conferir: !!perfilData[0].perm_conferir,
      perm_gerenciar_equipe: !!perfilData[0].perm_gerenciar_equipe,
      perm_gerenciar_lojas: !!perfilData[0].perm_gerenciar_lojas,
      perm_relatorios: !!perfilData[0].perm_relatorios,
      perm_configuracoes: !!perfilData[0].perm_configuracoes
    } : null

    res.json({ 
      token, 
      user: { 
        id: user.id, 
        nome: user.nome, 
        email: user.email, 
        perfil: user.perfil,
        loja_id: user.loja_id,
        tipo_comissao: user.tipo_comissao,
        valor_tarefa_feita: user.valor_tarefa_feita,
        valor_mensal_fixo: user.valor_mensal_fixo,
        rotulo_perfil: perfilData.length > 0 ? perfilData[0].rotulo : user.perfil,
        permissoes
      } 
    });

  } catch (erro) {
    console.error('❌ Erro:', erro); 
    res.status(500).json({ erro: erro.message });
  }
};