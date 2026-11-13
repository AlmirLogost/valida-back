// Teste da Experiência do Cliente, bloco 2: a biblioteca de modelos
// prontos (src/data/templatesModelos.js) é semeada sozinha ao subir o
// servidor, e aplicar um modelo cria as tarefas certas na unidade
// escolhida, sem apagar nada que já existia.
//
// SEGURANÇA: só roda contra o banco LOCAL e sobe o servidor numa porta
// separada da que você já usa.
//
// Como rodar (dentro da pasta back/):
//   node scripts/teste_templates_modelos.js

require('dotenv').config()

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  process.exit(1)
}

const { spawn } = require('child_process')
const path = require('path')
const { query, run, pool } = require('../src/config/database')
const modelos = require('../src/data/templatesModelos')

const PREFIXO = '__teste_modelos__'
const PORTA = 3993
const BASE = `http://127.0.0.1:${PORTA}/api`

let falhas = 0
function ok(nome) { console.log(`  ✓ ${nome}`) }
function falhou(nome, detalhe) { falhas++; console.error(`  ✗ ${nome} — ${detalhe}`) }

async function limpar() {
  const lojas = await query('SELECT id FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
  const lojaIds = lojas.map(l => l.id)
  if (lojaIds.length) {
    await run('DELETE FROM checklist_itens WHERE checklist_id IN (SELECT id FROM checklists WHERE loja_id = ANY(?))', [lojaIds])
    await run('DELETE FROM checklists WHERE loja_id = ANY(?)', [lojaIds])
  }
  await run('DELETE FROM subscriptions WHERE admin_id IN (SELECT id FROM usuarios WHERE email LIKE ?)', [`${PREFIXO}%`])
  await run('DELETE FROM lojas WHERE nome LIKE ?', [`${PREFIXO}%`])
  await run('DELETE FROM usuarios WHERE email LIKE ?', [`${PREFIXO}%`])
}

function esperarServidor(child) {
  return new Promise((resolve, reject) => {
    let saida = ''
    const timeout = setTimeout(() => reject(new Error('servidor não respondeu a tempo')), 8000)
    child.stdout.on('data', (d) => {
      saida += d.toString()
      if (saida.includes('VALIDA na porta')) { clearTimeout(timeout); resolve() }
    })
    child.stderr.on('data', (d) => { saida += d.toString() })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`servidor encerrou antes de subir (código ${code}). Saída: ${saida}`))
    })
  })
}

async function chamar(metodo, caminho, body, token) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await r.json() } catch { /* corpo vazio */ }
  return { status: r.status, body: json }
}

async function main() {
  let child
  try {
    await limpar()

    child = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORTA) }
    })
    await esperarServidor(child)

    console.log('\nTestando a biblioteca de modelos prontos...\n')

    // === A biblioteca foi semeada sozinha, ao subir o servidor ===
    for (const modelo of modelos) {
      const rows = await query('SELECT * FROM templates WHERE categoria = ? AND ativo = 1', [modelo.categoria])
      if (rows.length === modelo.tarefas.length) {
        ok(`modelo "${modelo.titulo}" semeado com ${rows.length} tarefa(s)`)
      } else {
        falhou(`modelo "${modelo.titulo}" semeado com ${modelo.tarefas.length} tarefa(s)`, `encontrado ${rows.length}`)
      }
      for (const tarefa of modelo.tarefas) {
        const t = rows.find(r => r.titulo === tarefa.titulo)
        if (!t) { falhou(`tarefa "${tarefa.titulo}" existe`, 'não encontrada'); continue }
        const itens = await query('SELECT * FROM template_itens WHERE template_id = ?', [t.id])
        if (itens.length !== tarefa.itens.length) {
          falhou(`tarefa "${tarefa.titulo}" tem os itens certos`, `esperado ${tarefa.itens.length}, encontrado ${itens.length}`)
        }
      }
    }

    // Semear de novo (reiniciar o servidor de novo, por ex.) não duplica
    const totalAntes = await query('SELECT COUNT(*)::int AS c FROM templates')
    const seedAgain = require('../src/config/seedTemplatesModelos')
    await seedAgain.seedTemplatesModelos()
    const totalDepois = await query('SELECT COUNT(*)::int AS c FROM templates')
    if (totalAntes[0].c === totalDepois[0].c) ok('semear de novo não duplica (idempotente)')
    else falhou('semear de novo não duplica (idempotente)', `antes ${totalAntes[0].c}, depois ${totalDepois[0].c}`)

    // === GET /templates/modelos agrupa certo ===
    const cadastro = await chamar('POST', '/auth/register', {
      nome: 'Dono Teste', empresa: `${PREFIXO}Empresa`, email: `${PREFIXO}dono@teste.local`, senha: 'senha1234'
    })
    const tokenDono = cadastro.body?.token
    if (!tokenDono) { falhou('cadastro pro teste de modelos', JSON.stringify(cadastro)); throw new Error('parar') }

    const listaModelos = await chamar('GET', '/templates/modelos', null, tokenDono)
    if (Array.isArray(listaModelos.body) && listaModelos.body.length === modelos.length) {
      ok('GET /templates/modelos devolve os 4 modelos agrupados')
    } else {
      falhou('GET /templates/modelos devolve os 4 modelos agrupados', JSON.stringify(listaModelos.body))
    }

    // === Aplicar um modelo cria as tarefas certas, sem apagar nada ===
    const lojasResp = await chamar('GET', '/lojas', null, tokenDono)
    const lojaId = lojasResp.body?.[0]?.id

    // Uma tarefa já existente, pra confirmar que aplicar o modelo não apaga nada
    const tarefaExistente = await chamar('POST', '/checklists', {
      titulo: `${PREFIXO}Tarefa já existia`, loja_id: lojaId, recorrencia: 'diario', tipo: 'operador'
    }, tokenDono)

    const modeloRestaurante = modelos.find(m => m.categoria === 'restaurante')
    const aplicar = await chamar('POST', '/templates/aplicar-modelo', { categoria: 'restaurante', loja_id: lojaId }, tokenDono)
    if (aplicar.status === 200 && Array.isArray(aplicar.body?.ids) && aplicar.body.ids.length === modeloRestaurante.tarefas.length) {
      ok('aplicar modelo cria uma tarefa por item do modelo')
    } else {
      falhou('aplicar modelo cria uma tarefa por item do modelo', JSON.stringify(aplicar))
    }

    const checklistsLoja = await chamar('GET', `/checklists`, null, tokenDono)
    const titulosCriados = (checklistsLoja.body || []).filter(c => c.loja_id === lojaId).map(c => c.titulo)
    const todosPresentes = modeloRestaurante.tarefas.every(t => titulosCriados.includes(t.titulo))
    if (todosPresentes) ok('todas as tarefas do modelo aparecem na unidade')
    else falhou('todas as tarefas do modelo aparecem na unidade', JSON.stringify(titulosCriados))

    if (tarefaExistente.status === 200 && titulosCriados.includes(`${PREFIXO}Tarefa já existia`)) {
      ok('a tarefa que já existia continua lá (nada foi apagado)')
    } else {
      falhou('a tarefa que já existia continua lá', JSON.stringify(titulosCriados))
    }

    console.log('')
    if (falhas === 0) console.log('✅ Todos os testes passaram — biblioteca de modelos funciona de ponta a ponta.')
    else console.log(`❌ ${falhas} teste(s) falharam.`)
  } catch (e) {
    if (e.message !== 'parar') {
      falhas++
      console.error('\n❌ Erro ao rodar o teste:', e.message)
    }
  } finally {
    if (child) child.kill()
    await limpar()
    await pool.end()
  }
  process.exit(falhas > 0 ? 1 : 0)
}

main()
