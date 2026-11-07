# Reforma de Acessos — Passo 1 (leitura e confirmação)

Este documento é o ponto de partida da reforma. Nada de código foi alterado
neste passo — é só leitura e confirmação do que já existe hoje, para a
reforma ser construída em cima do que é verdade, não do que parecia ser.

## 1. O que foi confirmado (e o que foi corrigido em relação ao que foi pedido)

### a) Perfis já têm permissões, mas só valem no front — CONFIRMADO, com um detalhe importante

A tabela `perfis` já tem as 8 colunas (`perm_dashboard`, `perm_criar_tarefas`,
`perm_executar_tarefas`, `perm_conferir`, `perm_gerenciar_equipe`,
`perm_gerenciar_lojas`, `perm_relatorios`, `perm_configuracoes`), além de
`cor`, `ordem` e `metodo_login`. Existe CRUD completo
(`back/src/controllers/perfilController.js`: listar/criar/atualizar/deletar),
mas:

- **Não existe "duplicar" nem "arquivar com substituto"** — hoje só existe
  excluir (bloqueado se algum usuário ainda usa o cargo).
- **As permissões só são checadas no FRONT** (`Sidebar.vue`, função `hasPerm()`,
  decide o que aparece no menu). **No back, essas colunas nunca são usadas
  para bloquear uma ação** — confirmei isso procurando todo uso das colunas
  `perm_*` no backend: elas só aparecem onde são gravadas/lidas
  (`perfilController.js`) e onde são montadas para devolver ao front no login
  (`authController.js`, `authPinController.js`). Nenhuma rota de
  loja/equipe/tarefa/relatório confere essas permissões antes de agir. Ou
  seja: hoje, **um operador que descobrir o endereço certo da API consegue
  fazer qualquer coisa que um dono faria** — a única proteção real que existe
  é "a conta certa" (isolamento entre empresas), não "o cargo certo". Isso é
  exatamente o que o Passo 3 (middleware `requirePermissao`) resolve.

### b) Perfis não têm `admin_id` — CONFIRMADO, e o problema é real (não teórico)

A tabela `perfis` não tem coluna de dono de conta. Os cargos "de sistema"
(Super Admin, Fiscal, Operador — `loja_id` nulo) são globais e isso está
certo, são compartilhados por todas as contas de propósito. O problema é com
os **cargos personalizados** (criados por um dono, com `loja_id` preenchido):
encontrei, no mínimo, estas consultas que buscam um perfil só por `nome`,
sem considerar de qual conta ele é:

- `authController.js` (login de dono) — linhas 88 e 138
- `authPinController.js` (login por PIN) — linha 181
- `usuarioController.js` (criar/editar colaborador) — linhas 44 e 135

Como `perfis.nome` **não é único entre contas** (duas empresas diferentes
podem ter cada uma um cargo chamado, por exemplo, "gerente_noturno"), essas
consultas podem acabar pegando o cargo **da empresa errada** quando duas
contas usam o mesmo nome de cargo — e aplicando as permissões/método de
login de um perfil que não é da conta do usuário. Isso é o mesmo tipo de bug
que já foi corrigido para lojas/checklists na Etapa 1 (isolamento entre
contas), só que ainda não tinha sido corrigido para perfis. É uma das
prioridades do Passo 2a/3.

### c) Usuário tem uma só loja e o perfil é texto — CONFIRMADO

`usuarios.loja_id` é uma coluna única (um colaborador só pode estar em UMA
loja hoje) e `usuarios.perfil` é um texto livre (o "nome" do cargo, não uma
referência numérica à tabela `perfis`). Isso confirma a necessidade de
`usuario_lojas` (Passo 2d) para gerente com várias unidades, mantendo
`loja_id` funcionando como "loja principal" por compatibilidade.

### d) Lojas arquivadas com `ativo = -1` e status aberta/fechada — CONFIRMADO

- Arquivar uma loja faz `UPDATE lojas SET ativo = -1` (`lojaController.js`).
  Não existe ainda "quando" nem "quem" arquivou, nem uma forma de restaurar
  pela API (Passo 2f cobre isso).
- `aberta` é uma coluna separada (1 = aberta, 0 = fechada), com endpoint
  próprio de toggle. **Pessoas (usuários) hoje só têm `ativo = 0/1`** — não
  têm o mesmo padrão `-1` de arquivamento com data/quem arquivou que as lojas
  têm. Vou padronizar os dois no Passo 2f.

## 2. Correções ao que foi pedido (coisas que já existem e não precisam ser
   recriadas — importante para não refazer trabalho)

- **O endpoint de uso do plano (quantas lojas/usuários/tarefas em uso vs.
  limite do plano) já existe** e já conta certo (só itens ATIVOS):
  `GET /subscription/status` (`subscriptionController.js`) devolve
  `limites: { lojas: {max, uso}, usuarios: {...}, tarefas_ativas: {...} }`.
- **O bloqueio por limite do plano ao criar loja/usuário/tarefa já existe no
  back**, com mensagem em português clara (`middlewares/planos.js`,
  `checkLimite`), já ligado nas 3 rotas de criação
  (`POST /lojas`, `POST /usuarios`, `POST /checklists`).
- **A tela "Plano & Assinatura" (`Assinatura.vue`) já tem** plano atual, dias
  de trial, medidores de uso com barra de progresso e botão de upgrade.
- O erro **"carregarLimites is not defined"** em `Configuracoes.vue` não é uma
  funcionalidade faltando — é uma chamada a uma função que não existe mais
  (sobrou de uma refatoração). Os limites já vêm prontos e reativos da store
  de subscription (`sub.carregar()`, chamado algumas linhas antes, já carrega
  tudo). A correção definitiva (Passo 6) é remover essa chamada morta, não
  criar uma função nova.
- O que **falta de verdade** no Passo 6: 1) a mensagem de limite atingido
  aparecer no ponto exato da ação em TODAS as telas que criam loja/usuário/
  tarefa (hoje é inconsistente — alguns formulários já mostram a mensagem
  real do back, outros mostram um genérico tipo "Erro ao salvar"); 2) o
  `docs/PLANOS.md` com a proposta de limites/preços (não existe ainda).

## 3. Mapa das telas atuais (front)

| Tela (arquivo) | O que faz hoje |
|---|---|
| `login.vue` | Login do dono (e-mail+senha) ou colaborador (celular+PIN) |
| `Cadastro.vue` | Cadastro de novo dono + empresa + loja + trial 14 dias |
| `EsqueciSenha.vue` / `RedefinirSenha.vue` | Fluxo de recuperação de senha por e-mail |
| `Dashboard.vue` | Visão geral do dono: números e indicadores |
| `Lojas.vue` (2482 linhas) | Lista de lojas, criar/editar loja, abrir/fechar loja, formulário de criar colaborador embutido (duplicado com Equipe/Tarefas), gestão de horários |
| `Equipe.vue` (1230 linhas) | Lista de colaboradores, criar/editar/excluir, aviso de quem não tem celular, comissão |
| `Tarefas.vue` (4772 linhas, a maior tela do sistema) | Criar/editar tarefas (checklists) e seus itens, atribuir a colaboradores, e TAMBÉM tem um formulário de criar colaborador embutido (duplicado) |
| `MinhasTarefas.vue` (1636 linhas) | Tela do colaborador (operador): tarefas do dia, executar, evidência/foto |
| `Execucoes.vue` (1745 linhas) | Relatório/histórico de execuções de tarefas |
| `Conferencia.vue` (1164 linhas) | Conferência/auditoria de tarefas executadas |
| `Configuracoes.vue` (1360 linhas) | Minha Conta (dados+senha), Unidades (atalho), Plano (duplica parte do Assinatura.vue, com o bug do `carregarLimites`) |
| `Assinatura.vue` | Tela própria de Plano & Assinatura, mais completa que a aba "Plano" de Configuracoes.vue |

Componentes-chave:
- `Sidebar.vue` — menu lateral atual, já tem um seletor de unidade (só mostra
  o nome, sem bolinha de status aberta/fechada) e os itens do menu já são
  filtrados pelas 8 colunas de permissão antigas (`hasPerm()`), mas só no
  front.
- `layouts/AppLayout.vue` — moldura da tela logada (usa `Sidebar.vue` por
  dentro). Tem, na barra de topo, o **"botão solto" de status aberta/fechada**
  que o Passo 5 pede para remover (hoje duplica o que vai virar parte do
  seletor de unidade da Sidebar).
- `ModalNovaColaborador.vue` — já existe como componente reutilizável, mas
  `Lojas.vue` e `Tarefas.vue` ainda têm formulários de criar colaborador
  próprios e separados (duplicação a resolver no Passo 5c).
- `ModalNovaUnidade.vue`, `ModalPlanoExpirado.vue`, `TrialBanner.vue`,
  `ModalComissao.vue`, `ModalCalendarioComissao.vue`.

## 4. O que isso muda no plano da reforma

Nada do que foi pedido deixa de ser necessário — mas o Passo 3 (middleware de
permissão) e o Passo 2a (admin_id em perfis) ficaram confirmados como os
pontos mais importantes e mais arriscados tecnicamente (hoje não existe
nenhuma checagem de permissão granular no back, e existe um bug real de
mistura de contas em perfis personalizados). O Passo 6 (planos) é mais
simples do que parecia — a maior parte já existe; falta ajustar consistência
de mensagens e corrigir o bug pontual do `carregarLimites`.
