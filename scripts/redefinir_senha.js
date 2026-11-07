// Redefine a senha de um usuário direto no banco LOCAL, sem passar pelo
// fluxo de "esqueci minha senha" por e-mail. Útil para destravar sua
// própria conta em desenvolvimento.
//
// Pede o e-mail (aparece na tela) e a senha nova (digitação escondida,
// sem eco no terminal), mínimo 8 caracteres, grava com bcrypt.
//
// SEGURANÇA: só roda contra o banco LOCAL (bloqueado se DB_HOST não for
// localhost/127.0.0.1/::1) — nunca grava em produção.
//
// Como rodar (dentro da pasta back/):
//   node scripts/redefinir_senha.js

require('dotenv').config()

const host = process.env.DB_HOST || 'localhost'
const ehLocal = ['localhost', '127.0.0.1', '::1'].includes(host)
if (!ehLocal) {
  console.error('❌ Este script só pode rodar contra um banco local (DB_HOST não parece ser localhost).')
  process.exit(1)
}

const readline = require('readline')
const { Writable } = require('stream')
const bcrypt = require('bcrypt')
const { query, run, pool } = require('../src/config/database')

const SENHA_MIN = 8

// Um único readline, reaproveitado pras 3 perguntas (e-mail + senha +
// confirmação), em vez de ficar criando/destruindo leitores diferentes
// no mesmo stdin — é a forma mais simples de não perder entrada no meio
// do caminho. Pra esconder a senha, muta a saída (não imprime o eco)
// enquanto a pergunta de senha está em aberto.
const saidaMutavel = new Writable({
  write(chunk, encoding, callback) {
    if (!saidaMutavel.escondida) process.stdout.write(chunk, encoding)
    callback()
  }
})
saidaMutavel.escondida = false

const rl = readline.createInterface({ input: process.stdin, output: saidaMutavel, terminal: process.stdin.isTTY === true })

function perguntar(pergunta) {
  return new Promise((resolve) => rl.question(pergunta, (resposta) => resolve(resposta.trim())))
}

function perguntarSenhaEscondida(pergunta) {
  return new Promise((resolve) => {
    process.stdout.write(pergunta)
    saidaMutavel.escondida = true
    rl.question('', (resposta) => {
      saidaMutavel.escondida = false
      process.stdout.write('\n')
      resolve(resposta.trim())
    })
  })
}

async function main() {
  console.log(`Banco de destino: ${host} / ${process.env.DB_NAME || 'valida_v2'} (local)\n`)

  const email = (await perguntar('E-mail da conta: ')).toLowerCase()
  if (!email) throw new Error('E-mail não pode ser vazio.')

  const usuarios = await query('SELECT id, nome, email FROM usuarios WHERE email = ?', [email])
  if (usuarios.length === 0) throw new Error(`Nenhum usuário encontrado com o e-mail ${email}.`)
  const usuario = usuarios[0]

  const senha = await perguntarSenhaEscondida('Nova senha (mínimo 8 caracteres, não aparece na tela): ')
  if (senha.length < SENHA_MIN) throw new Error(`A senha deve ter no mínimo ${SENHA_MIN} caracteres.`)

  const confirmacao = await perguntarSenhaEscondida('Confirme a nova senha: ')
  if (confirmacao !== senha) throw new Error('As senhas não coincidem.')

  const hash = await bcrypt.hash(senha, 10)
  await run('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, usuario.id])

  console.log(`\n✅ Senha redefinida para ${usuario.nome} (${usuario.email}).`)
}

main()
  .catch((e) => { console.error(`\n❌ ${e.message}`); process.exitCode = 1 })
  .finally(() => { rl.close(); pool.end() })
