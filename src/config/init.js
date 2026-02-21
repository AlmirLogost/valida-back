const { createTables, createUsuarioChecklistsTable } = require('./database')
const { seedDatabase } = require('./seed')

const initDatabase = async () => {
  try {
    console.log('🚀 Inicializando...')
    await createTables()
    await createUsuarioChecklistsTable()
    await seedDatabase()
    console.log('✅ Pronto!')
    process.exit(0)
  } catch (erro) {
    console.error('❌ Erro:', erro)
    process.exit(1)
  }
}

initDatabase()