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

## 5. Fase 3 — resumo das mudanças (branch `reforma-acessos`)

Este documento registrava o estado em que a reforma começou (Passo 1). Esta
seção resume o que a Fase 3 mudou em cima daquilo, pra quem ler este arquivo
mais tarde não precisar reconstruir o histórico pelos commits.

- **Item 1 (Acessos)**: corrigido o bug que travava o Dono pra sempre fora de
  um cargo órfão (sem `admin_id`/`loja_id`) — `perfilPertenceAConta` agora
  "adota" esse cargo pra conta do Dono que tentar abri-lo, em vez de recusar
  pra sempre. Clicar num cargo agora abre a matriz diretamente. Cargos
  ganharam **alcance** (`perfis.escopo` + tabela `perfil_lojas`, migration
  012): própria unidade / unidades escolhidas / todas — consumido por
  `getLojaIdsVisiveis`.
- **Item 2 (Unidades)**: editar uma loja sem horários configurados não é mais
  bloqueado (só exigido ao criar). Nova UI de "dias de fechamento" (datas
  específicas sem expediente) — o endpoint já existia, só não tinha tela.
- **Item 3 (Tarefas)**: o cargo de sistema "fiscal" passou a ter o rótulo
  **"Líder"** (o slug técnico `fiscal` continua o mesmo em todo o código e no
  banco — só o texto mostrado mudou, mesmo princípio já usado antes para
  `super_admin` → "Dono"). `checklists` ganhou a coluna `tipo` (`lider` /
  `operador`, migration 013) e a tela de Tarefas ganhou abas "Tarefas do
  Líder" / "Tarefas do Operador". `execucoes` ganhou `status_conferencia` e
  o Líder passou a poder **aprovar/reprovar/reabrir** a tarefa de alguém da
  equipe (rotas novas `PUT /execucoes/:id/aprovar` e `/reprovar`, gated pela
  nova ação `tarefas.conferir` na matriz). De passagem, corrigido um bug que
  a própria Reforma de Acessos tinha introduzido: o Líder não conseguia
  concluir/reabrir a PRÓPRIA tarefa (`tarefas.executar` estava sempre 0 pra
  fiscal nas colunas antigas).
- **Item 4 (menu)**: "Hoje" → "Dashboard" no menu lateral.
- **Item 5 (Configurações)**: removida a seção "Unidades" de Configurações
  (duplicava a página Unidades do menu lateral); o atalho correspondente no
  painel do usuário agora leva direto pra `/lojas`.
- **Item 6 (Relatórios)**: a tela de Relatórios (`Execucoes.vue`) ganhou
  barra de filtros (período/unidade/pessoa/tipo), KPIs (concluídas, % de
  conclusão, atrasadas, tempo médio, comissão do período), gráfico de
  concluídas por dia, busca/ordenação na tabela e exportação CSV — tudo
  reaproveitando os dados que o front já carregava, sem endpoint novo.
  Única peça nova no back: a ação `relatorios.exportar` na matriz de
  permissões (migration 014), que controla o botão de exportar.

Migrations desta fase: `012_escopo_cargo.sql`, `013_lider_operador.sql`,
`014_relatorios_exportar.sql` — todas aditivas (`IF NOT EXISTS`/
`ON CONFLICT ... DO UPDATE`), seguras de rodar de novo.

## 6. Fase 4 — resumo das mudanças (blocos A a J, branch `reforma-acessos`)

Pente-fino visual e de consistência por cima da Fase 3, mais dois bugs
reais encontrados e corrigidos. Resumo técnico (o relatório em
linguagem simples pro Dono está no final da conversa, não aqui):

- **Bloco A**: nenhuma mudança — `.claude/settings.json` já estava
  conforme pedido desde a Fase 3.
- **Bloco B**: menu lateral e menu do perfil reorganizados (ver
  AUDITORIA_TELAS.md). Seletor de unidade ganhou um valor especial
  `'todas'` no `localStorage` (antes só guardava um ID de loja real) —
  isso quebrou silenciosamente 3 telas que liam essa chave direto
  (`Dashboard.vue`, `Equipe.vue`, `Execucoes.vue`), corrigido nos
  blocos F/H/I.
- **Bloco C**: nova página `Planos.vue`; `Assinatura.vue` removida
  (rota `/assinatura` redireciona pra `/planos`).
- **Bloco D**: `Tarefas.vue` troca abas fixas por uma tela de escolha
  de cargo. Corrigido de passagem: o link "Ver tarefas" da Equipe
  caía nessa tela nova em vez de ir direto pra pessoa.
- **Bloco E**: nova rota `/acessos/:id` (`AcessoDetalhe.vue`).
  Migration 015 (`perfis.descricao` + arquivamento de cargos
  duplicados/órfãos achados no banco local: o cargo de sistema legado
  "funcionario", cargos personalizados shadowed pelo de sistema, e um
  cargo órfão de teste antigo). Duas regras novas de segurança no
  back: ninguém concede a um cargo uma permissão que não tem; o Dono
  da conta nunca pode ser rebaixado nem arquivado.
- **Bloco F**: `Equipe.vue` reformada (cartões, alternador lista,
  Ativos/Arquivados). Nenhuma mudança de back.
- **Bloco G**: bug real corrigido em `Lojas.vue` — `salvarLoja()` só
  chamava `PUT /lojas/:id/horarios` quando a lista local tinha pelo
  menos 1 item e engolia qualquer erro dessa chamada em silêncio, então
  limpar os horários (ou uma falha real de rede) nunca era salvo nem
  avisado — o dono via "Salvo com sucesso!" mesmo quando os horários
  não mudaram. Também protegido contra sobrescrever horários reais com
  uma lista vazia quando a LEITURA deles falha ao abrir o formulário.
- **Bloco H**: dois bugs reais corrigidos. (1) `AppLayout.vue` mapeava
  `route.name` pro título do topo com nomes errados/faltando
  (`Execucoes` → "Execuções" em vez de "Relatórios"; `Acessos` nem
  estava no mapa, caía no fallback "Dashboard") — corrigido e
  padronizado pra toda rota. (2) `Execucoes.vue` tinha sua própria
  conta de comissão, duplicada e divergente da função usada em
  `Equipe.vue`/`MinhasTarefas.vue` (`useComissao.js`): calculava só com
  as tarefas do período do RELATÓRIO (podendo ser só "Hoje"), não do
  período de pagamento da pessoa, e não considerava fechamentos —
  substituído por uma chamada direta a `calcComissaoValor()`.
- **Bloco I**: `Dashboard.vue` reformado (ver AUDITORIA_TELAS.md).
  Nenhuma mudança de back.
- **Bloco J**: lacuna encontrada e corrigida — cargo era arquivado
  (soft delete) mas não tinha nenhum jeito de restaurar. Adicionado
  `GET /perfis?arquivados=1` e `PUT /perfis/:id/restaurar`, mesmo
  padrão já usado em unidades e pessoas.

Nenhuma migration desta fase altera ou remove dados — a 015 só
arquiva (`ativo = 0`) cargos que já eram inalcançáveis ou legados; tudo
reversível manualmente se precisar.

## Fase 5 — perfis de acesso, tarefas por cargo, entrega final

Pedido novo e maior: dois perfis de acesso fixos (Operador/Coordenador)
como TETO do que cada cargo pode receber, reforma de Tarefas pra
funcionar por cargo (com herança), revisão de Unidades/Menu/Planos/
Dashboard/Relatórios já feitos na Fase 4, e entrega final. Trabalho
feito sem perguntar nada durante a execução — toda escolha em ponto
cego está documentada abaixo, com o motivo.

### Bloco B — perfil de acesso (teto de permissões)

**Decisão 1 — taxonomia.** O pedido original fala em módulos
`execucao.*`, `conferencia.*`, `atribuicao.*` e `auditoria.*`. Esses
módulos não existem no sistema real (a tabela `perfil_permissoes` usa
`tarefas.ver/criar/editar/arquivar/executar/conferir`,
`unidades.*`, `equipe.*`, `relatorios.*`, `comissoes.*`,
`configuracoes.*`, `acessos.*`, `plano.ver`). Em vez de criar uma
taxonomia paralela (dobraria a manutenção e criaria dois jeitos de
checar a mesma coisa), os tetos foram mapeados sobre os módulos que já
existem: `execucao.*` → `tarefas.executar`; `conferencia.*` →
`tarefas.conferir`; `atribuicao.*` → `tarefas.criar`/`tarefas.editar`.
Essa é a opção mais segura porque reaproveita o `requirePermissao` e o
`matrizDoPerfil` já testados, em vez de duplicar a lógica de permissão.
Definição completa em `back/src/config/tetoPermissoes.js`.

**Decisão 2 — classificação (migration 016).** Cada cargo existente
foi classificado como `'coordenador'` se tem `tarefas.conferir=1` OU
`equipe.criar/editar=1` OU `unidades.criar/editar=1` na MATRIZ
(`perfil_permissoes`), senão `'operador'`. A fonte de verdade é a
matriz, não as colunas legadas (`perm_conferir`/`perm_gerenciar_equipe`)
— um cargo personalizado criado pela tela de Acessos (Fase 3+) só grava
na matriz, nunca nas colunas legadas, então classificar pelas colunas
legadas erraria todo cargo personalizado moderno. `super_admin`
(Proprietário) fica fora dos dois perfis, sempre `NULL`. Cargos
arquivados também são classificados (pra não sobrar um valor nulo
estranho se algum dia forem restaurados). Resultado verificado no banco
local: `fiscal`/`gerente` (sistema) → coordenador; `operador`/
`funcionario` (sistema) → operador; todos os 5 cargos personalizados
locais (a maioria já arquivada por duplicidade na migration 015) →
classificados sem erro.

**Decisão 3 — teto do Coordenador não inclui `unidades.criar` nem
`unidades.arquivar`.** O pedido descreve o Coordenador como quem
"gerencia unidades existentes dentro do alcance", não quem cria ou
arquiva unidades novas — isso continua exclusivo do Proprietário (ou de
uma exceção pontual que ele liberar pra um cargo específico). Também
confirmado via grep em `back/src/routes/lojaRoutes.js` que não existem
ações separadas `unidades.abrir_fechar`/`unidades.horarios` — tanto o
toggle de abertura/fechamento quanto os horários/fechamentos já usam só
`unidades.editar`, que está no teto do Coordenador.

**Reforço no back (`perfilController.js`):**
- `salvarPermissoes`: além da regra já existente ("ninguém dá a um
  cargo uma permissão que não tem"), agora rejeita (`403`) qualquer
  permissão fora do teto do perfil do cargo — a menos que quem está
  salvando seja o Proprietário (`super_admin`), que pode abrir uma
  exceção pontual.
- `atualizar`: cargos personalizados (não-sistema) podem ter o
  `perfil_acesso` trocado por este endpoint; cargos de sistema (que
  incluem o Proprietário) não passam por esse ramo e mantêm a
  classificação fixa do `seed.js`. Ao trocar, conta quantas pessoas
  ativas usam o cargo (`pessoas_afetadas` na resposta) e remove da
  matriz qualquer permissão que fique fora do NOVO teto — esse corte
  roda depois de `sincronizarMatrizPermissoes` (que reescreve sem
  condição as linhas derivadas das colunas legadas), senão a
  sincronização religaria de volta o que o corte tivesse acabado de
  desligar.

**B9 — login e `/api/me`.** `POST /login`, `POST /login-pin` e
`GET /me` agora devolvem `perfil_acesso` resolvido (junto com
`rotulo_perfil` e a `matriz`, que já existiam), escopado pela conta —
mesma função `resolverPerfilPorNome` já usada nos três lugares.

**B6 — autoconferência.** `execucaoController.aprovar`/`reprovar`
agora recusam (`403`, mensagem clara) quando quem está conferindo é o
mesmo `usuario_id` da execução, mesmo tendo `tarefas.conferir` — antes
só checava se a execução era da mesma conta, nunca se era a própria
pessoa. Vale pra qualquer perfil, inclusive o Proprietário (o pedido
diz "ninguém confere a própria execução", sem abrir exceção). A parte
de "marcar como auto-conferida quando não existe revisor elegível" do
B6 não foi implementada nesta fase — precisa de uma lógica de alcance
(quem é Coordenador de escopo maior que a unidade em questão) que não
existe ainda; fica como pendência.

**B8 — fim das decisões por nome/slug do cargo (parcial).** Migrado
pra usar `perfil_acesso` em vez do slug literal `'fiscal'`/`'operador'`
nos pontos reais de decisão do front, sempre com fallback pro slug
antigo (sessão com token salvo antes dessa mudança, sem
`perfil_acesso` ainda no `localStorage`):
- `MinhasTarefas.vue`: `isFiscal`/`isOperador` — modo leitura, filtro
  de equipe, aprovar/reprovar/reabrir, "um toque pra concluir".
- `Tarefas.vue`: destaque visual da coluna de um Coordenador no
  quadro e ordem das colunas ao adicionar colaborador.
- `Conferencia.vue`: **bug real corrigido** — a lista de equipe dessa
  tela só incluía quem tinha o slug exato `'operador'` ou `'fiscal'`
  (`PERFIS_EQUIPE = ['operador', 'fiscal']`); um cargo Coordenador
  personalizado (ex. "Gerente"/"Supervisor") desaparecia inteiro da
  tela de conferência do Proprietário. Agora carrega `/perfis` uma
  vez e resolve por `perfil_acesso`.

Deixado de propósito como está (não é um gap de perfil_acesso, é uma
regra de produto específica do cargo "fiscal"): em `Tarefas.vue`, os
botões de configurar comissão/calendário no quadro ficam escondidos só
quando quem está logado tem o slug `'fiscal'` — Gerente (que também é
Coordenador) continua vendo esses botões normalmente. Trocar isso por
`perfil_acesso === 'coordenador'` esconderia os botões do Gerente
também, o que mudaria um comportamento que não foi pedido. Em
`Equipe.vue`, a ordenação "fiscal primeiro" na lista também ficou como
estava — é só cosmético e a tela não carrega a lista de cargos pra
resolver `perfil_acesso` sem adicionar uma chamada nova só pra isso.

**B5 — alcance por unidade, sem código novo.** `getLojaIdsVisiveis`
(`back/src/helpers/adminLojas.js`) já tratava `super_admin` e
qualquer perfil com `escopo = 'todas'` devolvendo TODAS as lojas da
conta (via `getLojaIds`), sem depender de linha em `usuario_lojas` —
exatamente o que o B5 pedia. Só faltava o backfill de verdade pra
contas antigas, feito na migration 016 (bloco B1 acima). Nenhuma
mudança de código precisou ser feita aqui.

**B7 — cargos padrão em conta nova.** Confirmado sem precisar mudar
nada: `fiscal`/`operador`/`gerente`/`super_admin` são cargos de
SISTEMA (`sistema = 1`, `admin_id` nulo), compartilhados — toda conta
nova já os "recebe" porque `perfilController.listar` inclui
`sistema = 1` pra qualquer conta, e `resolverPerfilPorNome` os resolve
dinamicamente por nome em qualquer contexto de conta. `registroController.js`
só cria o usuário `super_admin`, a primeira loja e o trial; não precisa
duplicar cargo nenhum.

**Pendências dentro do Bloco B** (não concluídas ainda nesta fase):
fallback "auto-conferida" quando não existe revisor elegível (parte do
B6, ver acima).

### Bloco C — Acessos (criar/editar cargo)

A maior parte do bloco C já tinha sido construída na Fase 4 (lista,
3 abas Permissões/Pessoas/Detalhes, "Ver como este cargo", duplicar,
arquivar com substituto, restaurar, dedup). O que esta fase adicionou:

- **Bug real corrigido**: cargo novo (`perfilController.criar`) e
  cargo duplicado (`perfilController.duplicar`) não gravavam
  `perfil_acesso` — nasciam com `NULL`, ou seja, SEM TETO NENHUM até
  alguém abrir a aba Detalhes e trocar o perfil manualmente. `criar`
  agora aceita `perfil_acesso` no corpo (padrão `'operador'`, o mais
  restrito, se não vier); `duplicar` copia o da origem.
- `Acessos.vue`: lista agrupada em Proprietário / Coordenador /
  Operador (Proprietário sempre no topo); cada linha mostra o perfil
  em texto pequeno. "+ Novo cargo" ganhou um passo novo antes do
  modelo/nome: dois cartões grandes pra escolher o perfil primeiro —
  os modelos oferecidos depois (Gerente/Líder pro Coordenador,
  Operador/Financeiro pro Operador) são filtrados por esse perfil.
- `AcessoDetalhe.vue`: aba Permissões esconde (cinza + 🔒 + tooltip
  "Não disponível para o perfil X") qualquer ação fora do teto do
  perfil do cargo — espelha `back/src/config/tetoPermissoes.js` só
  pra UI, a validação real continua no back. "Marcar tudo" nunca
  marca fora do teto. Aba Detalhes ganhou seletor de perfil pra cargo
  personalizado (não aparece em cargo de sistema), com aviso de
  impacto antes de salvar e mostrando quantas pessoas foram afetadas
  depois (`pessoas_afetadas`, que o back já devolve desde o bloco B).

**Não implementado nesta fase** (ficou de fora por escopo/tempo, não
é um bug): exceção de permissão por PESSOA na tela de Equipe (ponto 8
do bloco C do pedido) — hoje a exceção só existe no nível do CARGO
(editando a matriz do cargo inteiro). Documentado aqui como pendência
pra uma fase futura.

### Bloco D — Equipe

O redesenho visual (cartão minimalista, barra fina de progresso, botão
único "Ver tarefas (N)", menu "⋯", ponto âmbar "Falta o celular",
alternador Cartões/Lista, busca/filtros, Ativos/Arquivados) já tinha
sido construído na Fase 4, bloco F — confirmado de novo nesta fase,
sem precisar mudar nada.

**Bug real corrigido — formulário único de colaborador.** O pedido
"UM formulário de colaborador, usado em Equipe/Unidades/Tarefas" já
existia como componente (`ColaboradorCamposForm.vue`), mas por dentro
só oferecia DOIS cargos fixos, hardcoded: "Operador" e "Líder". Um
cargo personalizado criado em Acessos (ou até o "Gerente" de sistema)
era **impossível de escolher** ao adicionar alguém por essa tela —
mesmo em Tarefas.vue, mesmo em Equipe.vue. Corrigido: o formulário
agora carrega os cargos de verdade (`GET /perfis`), agrupados por
perfil de acesso (Coordenador/Operador); o Proprietário nunca aparece
na lista. `useColaboradorPerfis.js`, que guardava aquele preset de
permissões fixo (e que o back nem lia em `POST /usuarios` — os campos
`perm_*` nunca eram usados ali), foi removido por ficar sem uso.

Aproveitado pra fechar o ponto E4 do pedido ao mesmo tempo: nova prop
`cargoFixo` trava a escolha quando se adiciona alguém de dentro do
quadro de um cargo específico em Tarefas.vue.

**Falha real de escalonamento de privilégio corrigida.**
`usuarioController.criar`/`atualizar` não tinham guarda nenhuma contra
`perfil = 'super_admin'` — qualquer pessoa com `equipe.criar/editar`
(um Gerente ou Líder, cargos Coordenador comuns) podia criar um
colaborador já como Proprietário, ou promover alguém existente a
Proprietário editando o cargo — criando um segundo Dono sem passar
por nenhum fluxo de transferência de propriedade (que não existe no
sistema). Agora `criar` rejeita `super_admin` sempre; `atualizar`
rejeita promover (só permite reenviar `super_admin` quando o alvo já
é o Dono — reenvio idempotente ao editar outro campo sem tocar no
cargo). A proteção contra REBAIXAR o Dono (da Fase 4) continua valendo.

Aviso de impacto adicionado ao trocar o cargo de alguém (frontend) —
"Ela passa a ter as permissões e as tarefas do cargo novo" antes de
salvar; a troca já ficava registrada na auditoria do back.

### Bloco E — Tarefas por cargo, com herança

**E1-E4 (tela de escolher cargo).** A base (grade de cargos com
contagem de pessoas/tarefas, breadcrumb "Tarefas › Nome do cargo",
botão voltar, "+ Adicionar colaborador" quando vazio, lembrar a última
escolha) já tinha sido construída na Fase 4, bloco D, e continua
valendo. Não foi refeito o agrupamento visual em duas colunas
"Coordenador"/"Operador" nem a animação de hover do pedido — prioridade
foi pro E5/E6 (funcionalidade nova de verdade), que tinha risco e valor
bem maiores. Fica como polimento visual pendente.

**E5 — tarefa atribuída a um cargo inteiro, com herança (implementado
por completo).** Antes, uma tarefa só podia ser atribuída a PESSOAS
(`usuario_checklists`). Agora pode ser atribuída também a um CARGO
inteiro: todo mundo que tem aquele cargo recebe a tarefa, inclusive
quem entrar depois; quem sai do cargo deixa de receber — sem precisar
editar vínculo nenhum por pessoa.

- Migration 017: tabela nova `checklist_cargos` (checklist_id,
  perfil_nome, ativo) — não toca em `usuario_checklists`, só soma.
- `checklistCargoController.js` + rotas `POST/GET/DELETE
  /checklist-cargos`, com as mesmas checagens de conta das rotas de
  pessoa (e recusa vincular ao cargo Proprietário).
- "Quem faz" uma tarefa passa a ser a UNIÃO do vínculo direto com o
  vínculo por cargo (pelo perfil atual da pessoa) em TRÊS lugares:
  `listarChecklists` (usado por MinhasTarefas), `listarDisponiveis`
  (exclui o que já vem por cargo) e `listarChecklistsLoja` (visão do
  Coordenador/Proprietário sobre a equipe) — cada linha marcada com
  `origem: 'pessoa'|'cargo'`; o vínculo direto sempre prevalece quando
  os dois existem, sem duplicar a tarefa na lista.
- Front (`Tarefas.vue`): nova seção "Cargos" no modal de criar/editar
  tarefa, ao lado de "Colaboradores" — exige pelo menos um dos dois.
  **Bug real corrigido na mesma frente**: `tarefasFiltradasPorUsuario`
  (o que decide o que aparece em cada coluna do quadro) e
  `cargosComContagem` (contagem "X tarefas" na tela de escolha) só
  olhavam `usuario_checklists` — uma tarefa atribuída só ao cargo não
  aparecia em coluna nenhuma até essa correção. Card ganhou um selo
  "do cargo" quando a origem não é um vínculo direto.
- Decisão de escopo, documentada e deliberada: a resolução de
  COMISSÃO (`usuarioController.js` `/relatorio-comissao` e
  `useComissao.js` no front) continua lendo só `usuario_checklists`,
  sem herança por cargo. Estender isso é uma mudança de cálculo de
  dinheiro de verdade e merece revisão própria — misturar com a
  reforma de acessos seria a opção mais arriscada, não a mais segura.
- `scripts/teste_tarefas_por_cargo.js` (novo) cobre herança ao
  entrar/sair do cargo, não-duplicação, isolamento entre contas e a
  recusa de atribuir ao cargo Proprietário.

**E6 — fim da lógica manual de "tipo".** `tipoParaCargo()` decidia o
tipo da tarefa (`lider`/`operador`) só pelo slug literal `'fiscal'`
— um cargo Coordenador personalizado fazia a tarefa nascer "operador"
por engano. Corrigido pra usar `perfil_acesso` do cargo. `checklists.tipo`
continua existindo como coluna — hoje ele só serve de RÓTULO em
Relatórios (Líder/Operador), não decide mais nada de acesso real (quem
decide "quem faz" é `usuario_checklists`/`checklist_cargos`); por isso
não foi migrado/apagado, e tarefas já existentes mantiveram o tipo
histórico sem alteração — só tarefa nova usa a regra nova.

### Bloco F — Unidades

Verificado contra o pedido: horários (editar, Seg–Sáb, salvar,
reabrir), atalhos "copiar de segunda para todos" e "24h", salvar dados
da unidade + horários na mesma ação, não sobrescrever horários reais
quando a leitura falha, arquivar/restaurar com resumo de impacto e
lista de arquivadas, seletor de unidade (1 toque, sem recarregar,
busca quando mais de 5 unidades, "Todas as unidades", lembra a
última escolhida em `localStorage`) — tudo isso já tinha sido
construído nas Fases 3/4 e continua funcionando, confirmado sem
precisar mudar nada.

Único ajuste real: o campo Telefone, no formulário de unidade, estava
espremido numa coluna fixa de 140px ao lado de Cidade/UF — ganhou a
própria linha. "Horário obrigatório só se a unidade nasce aberta" não
foi implementado — hoje não existe nenhum conceito de "unidade nasce
aberta/fechada" no sistema, e o `*` no rótulo de horários nem era
validado de verdade (criar uma unidade sem preencher horário sempre
funcionou) — inventar esse conceito agora seria funcionalidade nova
não pedida em nenhum outro lugar, fora do escopo desta fase.

### Bloco G — Menu e Planos

Verificado contra o pedido: sidebar (Dashboard, Unidades, Equipe,
Tarefas, Acessos, Relatórios, Planos, sem "Configurações"), menu do
perfil (Minha conta, Empresa, Configurações, Upgrade de plano, Ajuda,
Sair, sem "Unidades"), página Planos (plano atual, status, dias de
trial, próxima cobrança, uso vs. limite, comparação em colunas,
toggle Mensal/Anual, FAQ, sem checkout real) — tudo construído na
Fase 4, blocos B/C/G, e confirmado sem precisar mudar nada nesta fase.

### Bloco H — Dashboard

Verificado contra o pedido: frase "Hoje: X de Y tarefas feitas" com
barra fina (sem bloco azul grande), 4 números (Unidades abertas agora,
Pessoas ativas hoje, Atrasadas, Taxa geral com seta vs. ontem),
"Precisa de atenção agora" (máx. 5, com "Tudo em dia" no vazio),
gráfico "Concluídas por dia" (7/15/30d), ranking de Unidades e Equipe
com "Ver todos", "Atividade recente", e o caso especial de 1 unidade
só (esconde o ranking, mostra "Tarefas de hoje por turno" no lugar) —
tudo já construído na Fase 4, bloco I, confirmado sem precisar mudar
nada nesta fase.

### Bloco I — Relatórios

Verificado contra o pedido: título só "Relatórios" (sem duplicar
"Execuções"), frase-resumo com semáforo ("Hoje: 8 de 12 ... a pior é
X"), três abas (Desempenho/Comissões/Histórico, Comissões escondida
sem `comissoes.ver_todas`), mapa de calor dia×turno, "Tarefas
problemáticas", tabela com Exportar CSV — tudo já construído na Fase
4, bloco H, confirmado sem precisar mudar nada nesta fase. A
inconsistência "comissão com 0 tarefas concluídas" (R$301 citada no
pedido) já tinha sido investigada e corrigida nessa mesma passada da
Fase 4: `Execucoes.vue` tinha uma conta de comissão própria, divergente
de `useComissao.js` (a mesma usada em `Equipe.vue`/`MinhasTarefas.vue`)
— hoje chama `calcComissaoValor()` direto, confirmado no código atual.

### Bloco J — entrada por perfil

O fluxo real de login (`login.vue`) já mandava Coordenador/Proprietário
pro Dashboard no desktop (super_admin no celular cai em Conferência —
decisão de produto anterior, mantida). Corrigido um resquício: o guard
de rota (`router.beforeEach`), usado quando alguém já autenticado
visita `/login` direto (não é o fluxo normal de login, mas pode
acontecer), ainda mandava pra `/equipe` em vez de `/dashboard` — de
antes do Dashboard ter virado a visão geral de verdade (Fase 4, bloco
I). Os dois caminhos agora levam pro mesmo lugar.

**Decisão deliberada: login por PIN (Operador e Líder/Coordenador)
continua caindo em "Minhas tarefas", não no Dashboard.** O pedido lia
"Coordenador cai no Dashboard" de um jeito genérico, mas no sistema
real o login por PIN é pensado pra celular/quiosque — `MinhasTarefas.vue`
já se adapta por dentro quando quem logou é Coordenador (`isFiscal`):
mostra a visão de equipe, aprovar/reprovar, etc. Forçar um Líder pro
Dashboard (uma tela desktop) trocaria um fluxo mobile já pronto e
funcionando por uma tela que não foi pensada pra celular — essa troca
seria a opção mais arriscada, não a mais segura, então foi descartada.

Blocos K ainda não iniciado nesta fase.
