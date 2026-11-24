// Configuração do pm2 para o VALIDA (Etapa 1 · Segurança item 8).
//
// Sem segredos aqui: senhas, chaves e conexão ficam só no back/.env do
// servidor, que o próprio server.js lê (dotenv, a partir desta pasta).
//
// Uma instância só, de propósito: o agendador de tarefas não pode rodar duas
// vezes ao mesmo tempo.
//
// Uso no servidor (dentro da pasta back/):
//   pm2 start ecosystem.config.js     primeira vez
//   pm2 reload ecosystem.config.js    nas atualizações
//   pm2 save                          grava para voltar após reiniciar o servidor
//
// ATENÇÃO: o nome abaixo precisa ser o MESMO que o "pm2 list" mostra hoje no
// servidor. Se for diferente, o pm2 sobe um segundo processo na mesma porta.

module.exports = {
  apps: [
    {
      name: 'valida-api',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      watch: false,
      time: true, // data e hora em cada linha do log
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Sao_Paulo'
      }
    }
  ]
}
