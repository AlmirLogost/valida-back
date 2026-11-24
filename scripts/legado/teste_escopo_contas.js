// Teste manual da sub-etapa 1.1: confirma que o gerente de uma conta NUNCA
// vê a loja/tarefa de outra conta (o bug do lojaSubquery quebrado).
//
// SEGURANÇA: este script só deve rodar contra o banco LOCAL (nunca produção).
// Ele usa a mesma configuração do back/.env que o "npm run dev" já usa — se
// essa configuração não apontar para localhost/127.0.0.1, o script recusa
// rodar (não lê nem mostra o valor das variáveis, só confere o formato).
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_escopo_contas.js
//
// Cria usuários/lojas de teste prefixados, testa, e remove tudo no final
// (mesmo se o teste falhar no meio).

require('dotenv').config()

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  console.error('   Por segurança, ele não vai continuar. Confirme seu .env local antes de tentar de novo.')
  process.exit(1)
}

const { query, run, pool } = require('../src/config/database')
const { getAdminId, getLojaIds } = require('../src/helpers/adminLojas')

const PREFIXO = '__teste_escopo__'
let falhas = 0

function ok(nome) {
  console.log(`  ✓ ${nome}`)
}
function falhou(nome, detalhe) {
  falhas++
  console.error(`  ✗ ${nome} — ${detalhe}`)
}

async function limpar() {
  await run('DELETE FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE email LIKE ?', [`${PREFIXO}%`])
}

async function main() {
  try {
    await limpar() // garante estado limpo antes de começar (caso uma rodada anterior tenha falhado no meio)

    // Conta A: dono + loja + gerente
    const donoA = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, 'x', 'super_admin')`,
      [`${PREFIXO}Dono A`, `${PREFIXO}dono_a@teste.local`]
    )
    const lojaA = await run(
      `INSERT INTO lojas (nome, admin_id) VALUES (?, ?)`,
      [`${PREFIXO}Loja A`, donoA.lastID]
    )
    const gerenteA = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, 'x', 'gerente', ?)`,
      [`${PREFIXO}Gerente A`, `${PREFIXO}gerente_a@teste.local`, lojaA.lastID]
    )

    // Conta B: dono + loja (empresa totalmente diferente)
    const donoB = await run(
      `INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, 'x', 'super_admin')`,
      [`${PREFIXO}Dono B`, `${PREFIXO}dono_b@teste.local`]
    )
    const lojaB = await run(
      `INSERT INTO lojas (nome, admin_id) VALUES (?, ?)`,
      [`${PREFIXO}Loja B`, donoB.lastID]
    )

    console.log('Testando isolamento entre contas...\n')

    // Teste 1: o gerente da conta A deve resolver para o admin_id (dono) da conta A
    const adminIdResolvido = await getAdminId(gerenteA.lastID, 'gerente')
    if (adminIdResolvido === donoA.lastID) ok('gerente A resolve para o dono A')
    else falhou('gerente A resolve para o dono A', `esperado ${donoA.lastID}, recebido ${adminIdResolvido}`)

    // Teste 2: as lojas do gerente A devem ser só a Loja A
    const lojasGerenteA = await getLojaIds(gerenteA.lastID, 'gerente')
    if (lojasGerenteA.length === 1 && lojasGerenteA[0] === lojaA.lastID) ok('gerente A vê exatamente a Loja A')
    else falhou('gerente A vê exatamente a Loja A', `recebido ${JSON.stringify(lojasGerenteA)}`)

    // Teste 3 (o mais importante): o gerente A NÃO pode ver a loja B
    if (!lojasGerenteA.includes(lojaB.lastID)) ok('gerente A NÃO vê a Loja B (de outra conta)')
    else falhou('gerente A NÃO vê a Loja B (de outra conta)', 'loja B apareceu na lista do gerente A!')

    // Teste 4: o dono A também não vê a loja B
    const lojasDonoA = await getLojaIds(donoA.lastID, 'super_admin')
    if (!lojasDonoA.includes(lojaB.lastID)) ok('dono A NÃO vê a Loja B (de outra conta)')
    else falhou('dono A NÃO vê a Loja B (de outra conta)', 'loja B apareceu na lista do dono A!')

    console.log('')
    if (falhas === 0) {
      console.log('✅ Todos os testes passaram — isolamento entre contas está OK.')
    } else {
      console.log(`❌ ${falhas} teste(s) falharam.`)
    }
  } catch (e) {
    falhas++
    console.error('\n❌ Erro ao rodar o teste:', e.message)
  } finally {
    await limpar()
    await pool.end()
  }
  process.exit(falhas > 0 ? 1 : 0)
}

main()
