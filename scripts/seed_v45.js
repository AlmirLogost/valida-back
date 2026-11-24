// Seed com os dados de exemplo da v45 (03_MODELO_DE_DADOS.md, "Dados de
// exemplo"), para a comparação visual dar igual.
//
// SÓ no banco de ensaio (valida_ensaio). Senha do admin e PIN da equipe vêm
// do ambiente (SEED_SENHA_ADMIN, SEED_PIN): nunca do código.
// Cria uma empresa nova a cada execução (o ensaio é recriado antes).
//
// Uso (dentro de back/):
//   DB_NAME=valida_ensaio SEED_SENHA_ADMIN=… SEED_PIN=…… RELOGIO_FIXO=10:00 node scripts/seed_v45.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
if (process.env.DB_NAME !== 'valida_ensaio') {
  console.error('❌ O seed da v45 só roda no valida_ensaio (DB_NAME=valida_ensaio).')
  process.exit(1)
}
const host = process.env.DB_HOST || 'localhost'
if (!['localhost', '127.0.0.1', '::1'].includes(host)) { console.error('❌ Só banco local.'); process.exit(1) }
const senha = process.env.SEED_SENHA_ADMIN
const pin = process.env.SEED_PIN
if (!senha || senha.length < 8 || !/^\d{4}$/.test(pin || '')) {
  console.error('❌ Defina SEED_SENHA_ADMIN (8+ caracteres) e SEED_PIN (4 números).')
  process.exit(1)
}

const db = require('../src/db')
const tempo = require('../src/lib/tempo')
const agenda = require('../src/servicos/agenda')
const { hashSenha, hashPin } = require('../src/lib/segredos')
const { garantirPerfisFixos, criarCargosPadrao } = require('../src/servicos/padroes')

const FUSO = 'America/Sao_Paulo'
const POOL = [['Abertura da unidade', '07:00'], ['Ligar equipamentos', '09:00'], ['Conferir temperatura', '10:30'], ['Repor materiais', '11:00'], ['Limpeza de bancadas', '14:00'], ['Fechamento · Caixa', '22:00']]
const FOTO = new Set(['Abertura da unidade', 'Conferir temperatura', 'Fechamento · Caixa'])
const CFG = {
  'Conferir temperatura': { tipo_resposta: 'numero', unidade_medida: '°C', faixa_min: 0, faixa_max: 4, prazo_acao_min: 60, porque: 'Câmara fria. Fora de 0 a 4 °C os alimentos estragam e podem causar intoxicação.' },
  'Limpeza de bancadas': { tipo_resposta: 'escolha', opcoes: [{ rotulo: 'Limpa', abre_acao: false }, { rotulo: 'Precisa limpar de novo', abre_acao: true }], porque: 'Bancada suja contamina o preparo.' }
}
// Pessoas da v45: [nome, cargo, unidade, celular, tarefas, feitas, regra, extra]
const P = [
  ['Marcos', 'Gerente', 'centro', '49991110001', 4, 2, { tipo: 'fixo', valor_mes: 1800, valor_nao_feita: 20 }],
  ['Almir', 'Líder', 'centro', '49991110002', 5, 3, { tipo: 'tarefa', valor_feita: 2, valor_nao_feita: 1 }],
  ['Pedro', 'Operador', 'centro', '49991110003', 6, 3, { tipo: 'tarefa', valor_feita: 1.5, valor_nao_feita: 1, atraso_ativo: true, atraso_tol_min: 10, atraso_desconto: 1 }, { login_ini: '08:00', login_fim: '17:00', login_tol_min: 10 }],
  ['Almiry', 'Operador', 'centro', null, 3, 1],
  ['Henri', 'Operador', 'centro', null, 2, 0],
  ['Rita', 'Cozinha', 'shopping', '49991110006', 4, 0],
  ['Caio', 'Cozinha', 'shopping', null, 3, 0],
  ['Joao', 'Operador', 'xaxim', '49991110008', 4, 2],
  ['Lia', 'Líder', 'xaxim', '49991110009', 3, 1],
  ['Bruna', 'Operador', 'centro', '49991110010', 3, 0, null, { arquivada: true }]
]
const hsh = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h }

async function main() {
  const agora = tempo.agora()
  const hoje = tempo.hoje(FUSO, agora)
  const ids = await db.tx(async (t) => {
    const e = await t.um(
      `INSERT INTO empresas (nome, plano, ciclo, situacao, trial_ate) VALUES ('Upper Franqueadora', 'rede', 'mensal', 'teste', $1) RETURNING id`,
      [new Date(agora.getTime() + 23 * 86400000 - 3600000)])
    await t.exec(`INSERT INTO assinaturas (empresa_id, plano, valor, situacao) VALUES ($1, 'rede', 897, 'teste')`, [e.id])
    const a = await t.um(
      `INSERT INTO admins (empresa_id, nome, email, celular, senha_hash) VALUES ($1, 'Almir', 'almir@upperfranqueadora.com.br', '49999990000', $2) RETURNING id`,
      [e.id, await hashSenha(senha)])
    await garantirPerfisFixos(t, e.id)

    const U = {}
    const unidades = [
      ['centro', 'Bezin Centro', 'Pinhalzinho', -26.8497, -52.9921, true, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, ativo: true, turnos: [{ abre: '06:00', fecha: '23:00' }] }))],
      ['shopping', 'Bezin Shopping', 'Chapecó', -27.1004, -52.6152, false, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, ativo: d !== 0, turnos: d ? [{ abre: '10:00', fecha: '22:00' }] : [] }))],
      ['xaxim', 'Bezin Xaxim', 'Xaxim', -26.9616, -52.5346, true, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, ativo: true, turnos: [{ abre: '06:00', fecha: '11:00' }, { abre: '11:30', fecha: '15:00' }, { abre: '17:00', fecha: '23:00' }] }))]
    ]
    for (const [k, nome, cidade, lat, lng, aberta, semana] of unidades) {
      const u = await t.um(
        `INSERT INTO unidades (empresa_id, nome, cidade, uf, lat, lng, raio_m, aberta_hoje, aberta_hoje_data)
         VALUES ($1, $2, $3, 'SC', $4, $5, 50, $6, $7) RETURNING id`, [e.id, nome, cidade, lat, lng, aberta, aberta ? null : hoje])
      await criarCargosPadrao(t, e.id, u.id)
      await t.exec('INSERT INTO config_notificacoes (unidade_id) VALUES ($1)', [u.id])
      for (const d of semana) {
        if (!d.ativo) { await t.exec('INSERT INTO unidade_turnos (unidade_id, dia_semana, ativo, ordem) VALUES ($1, $2, false, 1)', [u.id, d.dia_semana]); continue }
        let o = 1
        for (const x of d.turnos) await t.exec('INSERT INTO unidade_turnos (unidade_id, dia_semana, ativo, ordem, abre, fecha) VALUES ($1, $2, true, $3, $4, $5)', [u.id, d.dia_semana, o++, x.abre, x.fecha])
      }
      U[k] = u.id
    }

    const pinHash = await hashPin(pin)
    const pessoas = {}
    for (const [nome, cargoNome, uk, cel, nT, nF, regra, extra = {}] of P) {
      const cg = await t.um('SELECT id FROM cargos WHERE unidade_id = $1 AND nome = $2', [U[uk], cargoNome])
      const c = await t.um(
        `INSERT INTO colaboradores (empresa_id, nome, celular, pin_hash, pin_trocado_em, unidade_principal_id, cargo_id, situacao, arquivado_em, login_ini, login_fim, login_tol_min)
         VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [e.id, nome, cel, cel ? pinHash : null, U[uk], cg.id, extra.arquivada ? 'arquivado' : 'ativo', extra.arquivada ? agora : null,
          extra.login_ini || null, extra.login_fim || null, extra.login_tol_min ?? null])
      await t.exec('INSERT INTO colaborador_unidades (colaborador_id, unidade_id) VALUES ($1, $2)', [c.id, U[uk]])
      await t.exec(
        `INSERT INTO regras_bonus (colaborador_id, tipo, valor_feita, valor_nao_feita, valor_mes, atraso_ativo, atraso_tol_min, atraso_desconto, vigente_desde)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.id, regra ? regra.tipo : 'depois', regra?.valor_feita ?? null, regra?.valor_nao_feita ?? null, regra?.valor_mes ?? null,
          !!regra?.atraso_ativo, regra?.atraso_tol_min ?? null, regra?.atraso_desconto ?? null, `${hoje.slice(0, 7)}-01`])
      pessoas[nome] = { id: c.id, unidade: U[uk], feitas: nF, tarefas: [] }
      for (const [titulo, hora] of POOL.slice(0, nT)) {
        const x = CFG[titulo] || {}
        const tk = await t.um(
          `INSERT INTO tarefas (empresa_id, unidade_id, colaborador_id, titulo, porque, recorrencia, hora_ini, tipo_resposta, unidade_medida,
             faixa_min, faixa_max, opcoes, pede_foto, prazo_acao_min, criado_por)
           VALUES ($1, $2, $3, $4, $5, 'diario', $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [e.id, U[uk], c.id, titulo, x.porque || null, hora, x.tipo_resposta || 'feito', x.unidade_medida || null, x.faixa_min ?? null,
            x.faixa_max ?? null, x.opcoes ? JSON.stringify(x.opcoes) : null, FOTO.has(titulo), x.prazo_acao_min ?? 120, a.id])
        pessoas[nome].tarefas.push({ id: tk.id, titulo, hora })
      }
    }

    // Pedidos: 4 pendentes e 2 decididos, como na v45.
    const m = pessoas.Marcos.id
    const ped = async (tipoSol, solId, tipo, unidade, titulo, detalhe, payload, estado = 'pend', minutos = 0) => t.exec(
      `INSERT INTO pedidos (empresa_id, unidade_id, solicitante_tipo, solicitante_id, tipo, titulo, detalhe, payload, estado, criado_em, decidido_por, decidido_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [e.id, unidade, tipoSol, solId, tipo, titulo, detalhe, JSON.stringify(payload), estado, new Date(agora.getTime() - minutos * 60000),
        estado === 'pend' ? null : a.id, estado === 'pend' ? null : agora])
    const limpeza = pessoas.Almir.tarefas.find((x) => x.titulo === 'Limpeza de bancadas')
    await ped('plataforma', 0, 'sup', U.centro, 'Acesso de suporte · 1 hora', 'Ana Lima (Suporte) · ajustar os horários de login da equipe. Ela vê o app como você, só durante esse tempo.', {}, 'pend', 5)
    await ped('colaborador', m, 'tset', U.centro, 'Editar tarefa · Almir', 'Limpeza de bancadas · das 14:00 para 14:30', { tarefa_id: limpeza.id, hora_ini: '14:30', hora_fim: null }, 'pend', 12)
    await ped('colaborador', m, 'dia', U.centro, 'Cadastrar dia fechado', '24 de dez · Reforma do salão · o dia todo', { data: `${hoje.slice(0, 4)}-12-24`, motivo: 'Reforma do salão', todas_unidades: false, unidades: [U.centro], repetir_anual: false, hora_ini: null, hora_fim: null }, 'pend', 60)
    await ped('colaborador', pessoas.Rita.id, 'udom', U.shopping, 'Alterar horário e local · Bezin Shopping', 'Abrir aos domingos, das 10:00 às 22:00', { unidade_id: U.shopping, dia_semana: 0, ativo: true, turnos: [{ abre: '10:00', fecha: '22:00' }] }, 'pend', 1440)
    await ped('colaborador', m, 'pedit', U.centro, 'Editar dados · Pedro', 'Celular: (49) 99111-0033 → (49) 99111-0003', {}, 'ok', 2880)
    await ped('colaborador', m, 'arq', U.centro, 'Arquivar · Henri', 'Operador', {}, 'no', 2880)
    return { empresa: e.id, U, pessoas }
  })

  // Execuções de hoje: gera pelo agendador e marca as "feitas" da v45
  // (as primeiras de cada pessoa), com o horário "Feita às" da v45.
  for (const u of Object.values(ids.U)) await db.tx((x) => agenda.processarUnidade(x, u, tempo.momento(hoje, '06:00', FUSO)))
  for (const [nome, p] of Object.entries(ids.pessoas)) {
    for (const tk of p.tarefas.slice(0, p.feitas)) {
      const [h, mi] = tk.hora.split(':').map(Number)
      const min = h * 60 + mi + 5 + (hsh(tk.titulo) % 25)
      const feita = tempo.momento(hoje, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`, FUSO)
      await db.exec(
        `UPDATE execucoes SET estado = 'feita', feita_em = $3, recebida_em = $3 WHERE tarefa_id = $1 AND colaborador_id = $2 AND data = $4`,
        [tk.id, p.id, feita, hoje])
    }
    void nome
  }
  // Agora (relógio do teste): vence o que passou do limite e abre as ações.
  for (const u of Object.values(ids.U)) await db.tx((x) => agenda.processarUnidade(x, u, agora))
  const n = await db.um(`SELECT COUNT(*)::int AS e, COUNT(*) FILTER (WHERE estado = 'feita')::int AS f FROM execucoes WHERE empresa_id = $1`, [ids.empresa])
  console.log(`✅ Seed v45: empresa ${ids.empresa}, ${Object.keys(ids.pessoas).length} pessoas, ${n.e} execuções de hoje (${n.f} feitas).`)
  await db.fechar()
}

main().catch(async (e) => { console.error(`❌ Seed falhou: ${e.message}`); await db.fechar().catch(() => {}); process.exit(1) })
