// Migração de DADOS (não é .sql porque precisa do bcrypt, que só existe em
// código): re-criptografa qualquer PIN que ainda esteja guardado em texto
// puro (4 dígitos) no banco, trocando por um hash bcrypt — igual já é feito
// com a senha.
//
// IDEMPOTENTE: só altera linhas em que o PIN é exatamente 4 dígitos (texto
// puro). Um PIN que já é hash bcrypt (começa com "$2") é ignorado — pode
// rodar este script mais de uma vez sem problema.
//
// Como rodar (dentro da pasta back/):
//   node scripts/migrar_pins_para_hash.js
//
// Rode isso uma vez no banco local (já fiz isso por você e testei) e uma
// vez no banco de produção quando for publicar a 1.4 — ANTES ou IMEDIATAMENTE
// DEPOIS do deploy do código novo (não precisa ser na ordem exata, mas os dois
// precisam acontecer: código novo compara com bcrypt, banco antigo guarda
// texto puro — sem rodar isto, nenhum colaborador com PIN antigo consegue
// mais entrar até alguém trocar o PIN dele).

require('dotenv').config()
const bcrypt = require('bcrypt')
const { query, run, pool } = require('../src/config/database')

async function main() {
  console.log(`Banco de destino: ${process.env.DB_HOST || 'localhost'} / ${process.env.DB_NAME || 'valida_v2'}`)
  console.log('Confirme que esse é o banco certo antes de continuar (local ou produção, conforme a sua intenção agora).\n')

  const usuarios = await query(
    "SELECT id, nome, pin FROM usuarios WHERE pin IS NOT NULL AND pin ~ '^[0-9]{4}$'"
  )

  if (usuarios.length === 0) {
    console.log('Nenhum PIN em texto puro encontrado — nada para migrar (já estava tudo com hash, ou não tem ninguém com PIN).')
  } else {
    console.log(`Encontrados ${usuarios.length} usuário(s) com PIN em texto puro. Re-criptografando...`)
    for (const u of usuarios) {
      const hash = await bcrypt.hash(u.pin, 10)
      await run('UPDATE usuarios SET pin = ? WHERE id = ?', [hash, u.id])
      console.log(`  ✓ ${u.nome} (id ${u.id})`)
    }
    console.log('✅ Migração concluída.')
  }

  await pool.end()
}

main().catch((e) => {
  console.error('❌ Erro:', e.message)
  process.exit(1)
})
