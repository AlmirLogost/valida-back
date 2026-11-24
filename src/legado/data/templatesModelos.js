// Biblioteca de modelos prontos de tarefas (Experiência do Cliente,
// bloco 2) — usada no passo a passo de primeiros passos e em
// GET /templates + POST /templates/aplicar (recursos que já existiam).
// Dado puro, sem lógica — quem decide o que fazer com isso é
// seedTemplatesModelos.js.
//
// "categoria" aqui é só uma etiqueta pra agrupar na tela; cada modelo tem
// de 4 a 8 tarefas, com horário sugerido (o Dono edita/ajusta depois de
// aplicado, nada fica travado).

module.exports = [
  {
    titulo: 'Restaurante / Lanchonete',
    categoria: 'restaurante',
    descricao: 'Abertura, fechamento, limpeza e temperatura de equipamentos.',
    tarefas: [
      {
        titulo: 'Abertura da cozinha', recorrencia: 'diario', horario_inicio: '07:00', horario_fim: '08:00',
        itens: ['Ligar equipamentos (chapa, fritadeira, forno)', 'Verificar botijão/registro de gás', 'Conferir estoque do dia', 'Higienizar bancadas']
      },
      {
        titulo: 'Checagem de temperatura dos equipamentos', recorrencia: 'diario', horario_inicio: '08:00', horario_fim: '08:30', critico: true,
        itens: ['Temperatura do freezer', 'Temperatura da geladeira', 'Temperatura da câmara fria']
      },
      {
        titulo: 'Limpeza do salão', recorrencia: 'diario', horario_inicio: '09:00', horario_fim: '10:00',
        itens: ['Limpar mesas e cadeiras', 'Varrer e passar pano no piso', 'Higienizar banheiros']
      },
      {
        titulo: 'Fechamento de caixa', recorrencia: 'diario', horario_inicio: '22:00', horario_fim: '23:00',
        itens: ['Contagem do dinheiro em caixa', 'Conferência das vendas no cartão', 'Backup do sistema do dia']
      },
      {
        titulo: 'Limpeza final da cozinha', recorrencia: 'diario', horario_inicio: '23:00', horario_fim: '23:30',
        itens: ['Lavar utensílios e louças', 'Limpar chapa e fogão', 'Retirar o lixo']
      }
    ]
  },
  {
    titulo: 'Loja / Varejo',
    categoria: 'varejo',
    descricao: 'Abertura, fechamento e reposição de mercadorias.',
    tarefas: [
      {
        titulo: 'Abertura da loja', recorrencia: 'diario', horario_inicio: '08:00', horario_fim: '08:30',
        itens: ['Ligar luzes e caixa', 'Destravar portas de entrada', 'Conferir vitrine']
      },
      {
        titulo: 'Reposição de mercadorias', recorrencia: 'diario', horario_inicio: '09:00', horario_fim: '10:00',
        itens: ['Conferir estoque', 'Repor prateleiras vazias', 'Organizar seções']
      },
      {
        titulo: 'Limpeza da loja', recorrencia: 'diario', horario_inicio: '13:00', horario_fim: '13:30',
        itens: ['Limpar piso', 'Limpar vitrine', 'Organizar provador']
      },
      {
        titulo: 'Fechamento de caixa', recorrencia: 'diario', horario_inicio: '21:30', horario_fim: '22:00',
        itens: ['Contagem do dinheiro em caixa', 'Conferência das vendas', 'Backup do sistema do dia']
      },
      {
        titulo: 'Fechamento da loja', recorrencia: 'diario', horario_inicio: '22:00', horario_fim: '22:15',
        itens: ['Trancar portas', 'Desligar luzes e equipamentos', 'Ativar alarme']
      }
    ]
  },
  {
    titulo: 'Clínica / Consultório',
    categoria: 'clinica',
    descricao: 'Higienização e conferência de sala de atendimento.',
    tarefas: [
      {
        titulo: 'Higienização das salas de atendimento', recorrencia: 'diario', horario_inicio: '07:00', horario_fim: '07:30', critico: true,
        itens: ['Desinfecção de superfícies', 'Troca de lençóis/toalhas', 'Reposição de materiais descartáveis']
      },
      {
        titulo: 'Conferência de materiais e equipamentos', recorrencia: 'diario', horario_inicio: '07:30', horario_fim: '08:00',
        itens: ['Validade dos insumos', 'Esterilização de instrumentos', 'Estoque de EPIs']
      },
      {
        titulo: 'Organização da recepção', recorrencia: 'diario', horario_inicio: '08:00', horario_fim: '08:30',
        itens: ['Conferir agenda do dia', 'Organizar prontuários', 'Limpar área de espera']
      },
      {
        titulo: 'Fechamento das salas', recorrencia: 'diario', horario_inicio: '18:00', horario_fim: '18:30', critico: true,
        itens: ['Desinfecção final das salas', 'Descarte correto de materiais', 'Checagem do lixo biológico']
      }
    ]
  },
  {
    titulo: 'Academia',
    categoria: 'academia',
    descricao: 'Abertura, limpeza e fechamento da academia.',
    tarefas: [
      {
        titulo: 'Abertura da academia', recorrencia: 'diario', horario_inicio: '05:30', horario_fim: '06:00',
        itens: ['Ligar som e climatização', 'Destravar catracas', 'Conferir vestiários']
      },
      {
        titulo: 'Limpeza dos equipamentos', recorrencia: 'diario', horario_inicio: '06:00', horario_fim: '06:30',
        itens: ['Higienizar aparelhos de musculação', 'Limpar colchonetes', 'Repor álcool em gel']
      },
      {
        titulo: 'Limpeza dos vestiários', recorrencia: 'diario', horario_inicio: '12:00', horario_fim: '12:30',
        itens: ['Limpar banheiros', 'Limpar chuveiros', 'Organizar armários']
      },
      {
        titulo: 'Fechamento da academia', recorrencia: 'diario', horario_inicio: '22:00', horario_fim: '22:30',
        itens: ['Trancar catracas', 'Desligar equipamentos', 'Conferir câmeras']
      }
    ]
  }
]
