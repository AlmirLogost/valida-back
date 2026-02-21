const bcrypt = require('bcrypt')
const { run } = require('./database')

const seedDatabase = async () => {
  console.log('🌱 Inserindo dados...')
  
  const senhaHash = await bcrypt.hash('admin123', 10)
  
  await run(`INSERT OR IGNORE INTO usuarios (nome, email, senha, perfil, loja_id) VALUES (?, ?, ?, ?, ?)`, 
    ['Admin VALIDA', 'admin@valida.app', senhaHash, 'super_admin', null])
  
  await run(`INSERT OR IGNORE INTO lojas (nome) VALUES (?)`, ['Restaurante Exemplo'])
  
  console.log('✅ Admin criado!')
}

module.exports = { seedDatabase }