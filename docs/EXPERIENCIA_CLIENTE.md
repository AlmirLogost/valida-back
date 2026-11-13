# Experiência do Cliente — decisões da reforma

Objetivo do pedido: um dono novo, sem treinamento, consegue fazer uma
pessoa da equipe concluir a primeira tarefa no celular em menos de 15
minutos. Implementado em 4 blocos, cada um com commit próprio no back e
no front (branch `reforma-acessos`).

## Bloco 1 — Onboarding (passo a passo + cartão + estados vazios)

**Tabela nova, não destrutiva** (`onboarding_progresso`, migration 019):
um registro por conta (`admin_id`), com 4 colunas de passo
(`passo_unidade`, `passo_tarefa`, `passo_pessoa`, `passo_execucao`) +
`concluido`, `dispensado_em` (esconde o cartão), `wizard_visto_em` (o
passo a passo em tela cheia não abre sozinho de novo).

- **Contas existentes nunca veem o onboarding**: a migration faz um
  backfill de `concluido = 1` pra toda conta que já existia na hora em
  que ela roda. Daqui pra frente, **só o cadastro novo**
  (`registroController.js`) insere a própria linha com `concluido = 0`,
  dentro da mesma transação que já cria a conta/loja/trial. Qualquer
  outra forma de "achar" uma conta sem linha (a função
  `garantirLinha()`, chamada em `GET /onboarding`) sempre lança com
  `concluido = 1` por padrão — nunca com `0`. Decisão: é mais seguro uma
  conta antiga "ficar esquecida" (nunca vê o onboarding) do que uma
  conta antiga ver o onboarding por engano.
- **Os 4 passos nunca regridem**: marcados via
  `helpers/onboarding.js::marcarPasso()`, chamado nos pontos certos
  (salvar horários da loja, criar/aplicar uma tarefa, criar colaborador,
  concluir uma execução) com `UPDATE ... WHERE coluna = 0` — uma vez
  marcado, arquivar a pessoa ou a tarefa depois não desfaz o progresso.
- **O wizard reaproveita os modais existentes** (`ModalNovaUnidade.vue`,
  `ModalNovaColaborador.vue`) em vez de duplicar formulário — só
  orquestra a ordem, ouvindo os eventos de salvar/cancelar de cada um
  pra avançar de passo. Decisão: menor risco de regressão do que
  reimplementar os formulários dentro do wizard.
- **Atalhos de horário** ("copiar de segunda para todos", "24h") foram
  colocados direto em `ModalNovaUnidade.vue` (não só dentro do wizard),
  porque é o mesmo componente usado pra editar uma unidade depois — essa
  conveniência não deveria ficar só no primeiro uso.
- **PIN pré-gerado no passo 3**: `ColaboradorCamposForm.vue` ganhou a
  prop `autoGerarPin`, que só o wizard usa — o fluxo normal de Equipe/
  Tarefas continua pedindo pra digitar (ou gerar manualmente, botão que
  já existia), sem mudar comportamento pra quem já estava acostumado.
- **Estados vazios**: Tarefas e Equipe já tinham frase + botão. Unidades,
  Conferência e Relatórios ganharam o mesmo padrão nesta reforma.

## Bloco 2 — Biblioteca de modelos prontos

- **"Modelo" é um agrupamento por `categoria`, não uma coluna nova**: a
  tabela `templates` já existia (campo `categoria` já existia, só não
  era usado pra agrupar). Cada tarefa do modelo é 1 linha de `templates`
  normal, então nada de schema novo foi necessário — só dado
  (`src/data/templatesModelos.js`) e dois endpoints novos:
  `GET /templates/modelos` (agrupa e devolve a contagem real do banco) e
  `POST /templates/aplicar-modelo` (aplica todas as tarefas do modelo de
  uma vez, reaproveitando a mesma função que `POST /templates/aplicar`
  já usava).
- **Semeado sozinho a cada subida do servidor** (`seedTemplatesModelos`,
  chamado em `server.js`), diferente do `seed.js` principal (que só roda
  manualmente via `src/config/init.js`). Decisão: a biblioteca precisa
  estar disponível sem ninguém lembrar de rodar nada à parte — e como é
  só leitura de alguns registros fixos, rodar a cada subida é barato.
- **Bug real encontrado e corrigido durante o teste**: a primeira versão
  checava "já existe esse título+categoria?" e inseria se não — mas
  sem nenhum tipo de trava, duas subidas do servidor quase ao mesmo
  tempo (aconteceu de verdade rodando a bateria de testes, que sobe o
  servidor várias vezes em sequência) conseguiam ambas checar "não
  existe" antes de qualquer uma comitar, e cada uma inseria a própria
  cópia — resultado: tarefas duplicadas na biblioteca. Corrigido com
  `pg_advisory_xact_lock` (serializa chamadas concorrentes) e, por
  segurança, a própria função se autocura (remove duplicatas da MESMA
  categoria/título que encontrar, mantendo a mais antiga) — sem tocar em
  nenhum outro dado do banco. Também movido: a checagem da biblioteca
  agora roda **antes** do `app.listen()`, não mais "em paralelo" —
  servidor só aceita conexão depois de conferir a biblioteca.

## Bloco 3 — Convite pelo WhatsApp

- **O PIN em texto puro só existe no momento da criação**, no front —
  o back nunca guarda nem devolve o PIN de volta (só o hash). Pra tela
  de convite conseguir mostrar o PIN depois de criar alguém sem pedir
  de novo, `ModalNovaColaborador.vue` passou a incluir o PIN no evento
  `salvo` (`pinPlano`), só na criação (nunca na edição). "Reenviar
  convite" é diferente: como não existe PIN antigo guardado em lugar
  nenhum, ele **gera um PIN novo** (`POST /usuarios/:id/novo-pin`) — o
  antigo deixa de funcionar na mesma hora (confirmado por teste).
- **Conteúdo do convite extraído num componente próprio**
  (`ConvidarColaboradorConteudo.vue`, sem gaveta/modal) pra ser
  reaproveitado tanto dentro de uma gaveta normal
  (`ConvidarColaborador.vue`, usado em Equipe/Tarefas) quanto dentro do
  passo a passo em tela cheia (bloco 1), sem duplicar a
  mensagem/pré-visualização/link do WhatsApp em dois lugares.
- **Endereço público**: `urlPublica()` lê `VITE_URL_PUBLICA` (variável
  de build, sem segredo — **não foi adicionada ao `.env` por mim**,
  conforme a regra de nunca editar esse arquivo; o endereço atual do
  navegador é o padrão enquanto ela não existir) e cai pro
  `window.location.origin` na falta dela.
- **"Reenviar convite" só aparece pra quem tem celular cadastrado**
  (proxy simples pra "login por PIN" — a lista de colaboradores não trai
  o método de login de cada cargo sem uma consulta extra por pessoa).

## Bloco 4 — Operador sem atrito

- **A renovação silenciosa de sessão já existia** antes desta reforma
  (`front/src/composables/useApi.js` + `POST /token/renovar`,
  comentários apontam pra uma "sub-etapa 1.5" anterior): o front pede um
  token novo sempre que o atual tem menos de 3 dias de validade, e o
  back emite um PIN de 30 dias / email-senha de 90 dias — na prática, já
  dá uma sessão "perpétua" pra quem abre o app pelo menos uma vez a cada
  ~27 dias. Confirmado que já vale pro perfil Operador (`metodo_login
  === 'pin'`); nada precisou mudar aqui.
- **Login**: máscara de celular é só visual (o back já normaliza pra
  dígitos em `authPinController.js`) — nunca muda o que é validado.
  "Esqueci meu PIN" não tem fluxo de recuperação próprio (não existe
  e-mail/SMS cadastrado pra validar a pessoa com segurança) — só orienta
  a falar com quem cadastra a equipe, que pode gerar um PIN novo (bloco
  3).
- **"Próxima tarefa" é informativa, não interativa**: o jeito de
  concluir uma tarefa em `MinhasTarefas.vue` já era arrastar o cartão
  pra uma zona de "concluídas" (drag-and-drop existente) — refazer esse
  gesto a partir de um cartão separado seria um componente novo e
  arriscado. O destaque mostra qual é a próxima e lembra o gesto
  ("arraste pra concluir"), com atalho pro filtro "Pendentes".
- **PWA sem ícones PNG**: o manifest usa o `favicon.svg` existente
  (`sizes: "any"`) porque não havia ferramenta disponível nesta sessão
  pra gerar ícones PNG em 192x192/512x512. Funciona na maioria dos
  navegadores modernos, mas ícones PNG de verdade dariam compatibilidade
  melhor (ver "o que não foi feito" abaixo).

## O que não foi feito nesta passada

- **PWA**: faltam ícones PNG (192x192 e 512x512) — hoje só tem o SVG.
  Também não há testes automatizados de instalabilidade (dependem do
  navegador real emitir `beforeinstallprompt`, não dá pra simular num
  script de back).
- **"Esqueci meu PIN"** é só uma orientação em texto — não existe (e não
  foi pedido) um fluxo de recuperação por conta própria.
- **Tarefas.vue** (quadro kanban) não ganhou um estado vazio dedicado
  pro caso "tem colaborador, mas zero tarefas" — só o caso "zero
  colaborador" (que já existia) tem frase + botão.
- **Testes end-to-end de UI** (abrir o navegador de verdade, clicar no
  wizard, ver a gaveta de convite) não foram feitos — não havia
  ferramenta de automação de navegador disponível nesta sessão. A
  cobertura é por teste de API (`back/scripts/teste_onboarding_fluxo_completo.js`,
  `teste_templates_modelos.js`, `teste_reenviar_convite_gera_pin.js`) e
  por build do front — ver `back/docs/TESTAR_NO_CELULAR.md` pra conferir
  manualmente.
