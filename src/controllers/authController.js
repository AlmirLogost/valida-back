const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Aqui usamos 'database' em vez de 'db' para bater com o seu arquivo real
const { query } = require('../config/database'); 

exports.login = async (req, res) => {
  try {
    const { email, senha } = req.body;
    console.log('🔍 Tentativa de login:', email); 
    
    // Busca o usuário usando a função query importada do seu database.js
    const users = await query('SELECT * FROM usuarios WHERE email = ?', [email]);
    console.log('📊 Usuários encontrados:', users.length); 
    
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
      { expiresIn: '30d' }
    );
    console.log('✅ Token gerado:', token.substring(0, 20) + '...'); 
    
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
        valor_mensal_fixo: user.valor_mensal_fixo
      } 
    });

  } catch (erro) {
    console.error('❌ Erro:', erro); 
    res.status(500).json({ erro: erro.message });
  }
};