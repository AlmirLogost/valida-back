const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Aqui usamos 'database' em vez de 'db' para bater com o seu arquivo real
const { query } = require('../config/database');

// ============================================================================
// Limite de tentativas no login de dono/gerente (e-mail + senha): 5 erros
// seguidos pro mesmo e-mail bloqueiam por 15 minutos. Mesmo padrão já usado
// no login por PIN (authPinController.js) — guardado em memória, chaveado
// pelo e-mail digitado (não por IP, pra não travar todo mundo que usa a
// mesma rede só porque uma pessoa errou a senha).
// ============================================================================
const MAX_TENTATIVAS = 5
const BLOQUEIO_MS = 15 * 60 * 1000
const tentativasLogin = new Map() // email normalizado -> { falhas, bloqueadoAte }

function verificarBloqueio(chave) {
  const estado = tentativasLogin.get(chave)
  if (estado?.bloqueadoAte && estado.bloqueadoAte > Date.now()) {
    return Math.ceil((estado.bloqueadoAte - Date.now()) / 60000)
  }
  return null
}

function registrarFalha(chave) {
  const estado = tentativasLogin.get(chave) || { falhas: 0, bloqueadoAte: null }
  estado.falhas += 1
  if (estado.falhas >= MAX_TENTATIVAS) {
    estado.bloqueadoAte = Date.now() + BLOQUEIO_MS
  }
  tentativasLogin.set(chave, estado)
}

function limparTentativas(chave) {
  tentativasLogin.delete(chave)
}

exports.login = async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Informe e-mail e senha' });
    }

    const chave = String(email).trim().toLowerCase()

    const minutosBloqueio = verificarBloqueio(chave)
    if (minutosBloqueio !== null) {
      return res.status(429).json({
        erro: `Muitas tentativas. Tente de novo em ${minutosBloqueio} minuto(s).`
      })
    }

    // Busca o usuário usando a função query importada do seu database.js
    // (mantém a busca pelo e-mail exatamente como foi digitado — só a chave
    // do limite de tentativas acima é normalizada, pra não depender de
    // como o e-mail foi gravado no banco)
    const users = await query('SELECT * FROM usuarios WHERE email = ?', [email]);

    if (users.length === 0) {
      registrarFalha(chave)
      return res.status(401).json({ erro: 'Usuário não encontrado' });
    }

    const user = users[0];

    // Compara a senha digitada com a senha criptografada no banco
    const senhaValida = await bcrypt.compare(senha, user.senha);

    if (!senhaValida) {
      registrarFalha(chave)
      return res.status(401).json({ erro: 'Senha incorreta' });
    }

    limparTentativas(chave)

    // JWT_SECRET vem só do .env — o servidor nem inicia sem ela (ver server.js)
    const token = jwt.sign(
      { id: user.id, perfil: user.perfil },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

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
    console.error('❌ Erro no login:', erro);
    res.status(500).json({ erro: 'Não foi possível entrar agora. Tente novamente em alguns instantes.' });
  }
};

// Renovação silenciosa de sessão (1.5): o front chama isso de vez em quando,
// enquanto o token atual ainda é válido, pra pegar um token novo com prazo
// cheio de novo — assim quem está usando o sistema ativamente nunca é jogado
// pro login no meio do uso. Exige o middleware "auth" (só funciona com um
// token que ainda não expirou — não existe "renovar" um token já vencido).
exports.renovarToken = async (req, res) => {
  try {
    const users = await query('SELECT id, perfil, ativo FROM usuarios WHERE id = ?', [req.userId])
    if (!users.length || !users[0].ativo) {
      return res.status(401).json({ erro: 'Usuário não encontrado' })
    }
    const user = users[0]

    // Mesma duração que o tipo de login original já usava: PIN=30d, resto=90d.
    const perfilConfig = await query('SELECT metodo_login FROM perfis WHERE nome = ? AND ativo = 1', [user.perfil])
    const expiresIn = perfilConfig[0]?.metodo_login === 'pin' ? '30d' : '90d'

    const token = jwt.sign({ id: user.id, perfil: user.perfil }, process.env.JWT_SECRET, { expiresIn })
    res.json({ token })
  } catch (erro) {
    res.status(500).json({ erro: erro.message })
  }
}
