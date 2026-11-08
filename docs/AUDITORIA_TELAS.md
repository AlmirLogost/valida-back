# Auditoria de telas — Fase 2, item 1

Verificação de verdade (não só leitura de código): criei um cenário completo
(dono + loja + tarefa + colaborador + execução + template + cargo
personalizado) num banco local e chamei, como **Dono**, todos os 47
endereços de API que alguma tela em `front/src/pages` usa. Script:
`back/scripts/teste_auditoria_telas.js` — roda de novo quando quiser
reconferir.

**Resultado: os 47 endereços responderam certo. Nenhuma tela estava com
endpoint inexistente, campo renomeado ou tela em branco pro Dono.**

## Por tela

| Tela | Endereços usados | Situação |
|---|---|---|
| `Dashboard.vue` | `/execucoes`, `/checklists`, `/lojas`, `/usuarios`, `/usuario-checklists` | OK |
| `Lojas.vue` | `/perfis`, `/lojas/:id/horarios`, `/lojas/:id/impacto-arquivamento`, `/lojas?arquivadas=1`, `/lojas/:id/fechamentos`, `/lojas`, `/usuarios` | OK |
| `Equipe.vue` | `/usuarios`, `/lojas`, `/execucoes`, `/usuario-checklists`, `/usuarios?arquivados=1` | OK |
| `Tarefas.vue` | `/lojas`, `/checklists`, `/usuarios`, `/usuario-checklists`, `/checklist-datas`, `/execucoes`, `/checklists/:id/itens`, `/templates` | OK |
| `Execucoes.vue` | `/lojas`, `/usuarios`, `/checklists`, `/execucoes`, `/usuario-checklists` | OK |
| `Conferencia.vue` | `/lojas`, `/usuarios`, `/usuarios/:id/checklists`, `/execucoes` | OK |
| `MinhasTarefas.vue` | `/usuarios/:id/checklists`, `/usuarios/:id/checklists-disponiveis`, `/execucoes`, `/loja/:id/visao-fiscal` | OK |
| `Configuracoes.vue` | `/me`, `/lojas?todas=1` | OK |
| `Acessos.vue` | `/perfis`, `/perfis/:id/permissoes` | OK |
| `Assinatura.vue` | `/subscription/status` | OK |
| `Equipe.vue`/`MinhasTarefas.vue` | `/usuarios/:id/relatorio-comissao` | OK |
| `login.vue` | `/login`, `/login-pin` (store), `/perfis` (checagem extra) | OK |
| `Cadastro.vue` | `/auth/register` | OK |
| `EsqueciSenha.vue` | `/auth/forgot-password` | OK |
| `RedefinirSenha.vue` | `/auth/reset-password` | OK |

## Achados (nenhum crítico, mas vale registrar)

1. **`login.vue` faz uma chamada extra e redundante**: depois de logar, busca
   `GET /perfis` de novo só pra checar `pode_acessar_painel` do cargo — a
   resposta do login já traz isso (`permissoes.perm_dashboard` e, desde a
   Fase 1, `matriz.painel.ver`). Funciona, mas é uma chamada que não
   precisaria existir. Não toquei nisso agora pra não arriscar o fluxo de
   login sem necessidade — fica registrado pra uma limpeza futura.
2. **`Equipe.vue` tem uma função morta** (`salvarUsuario`, por volta da
   linha 355): não é chamada por nenhum botão — quem cria/edita colaborador
   de verdade é o componente `ModalNovaColaborador.vue` (emite `@salvo`). Não
   removi por não ser "quebrado" (é só código sem uso), mas é candidato a
   limpeza.
3. **`templates` é global, de propósito**: a tabela `templates` não tem
   `admin_id` nem `loja_id` — é uma biblioteca de modelos de tarefa
   compartilhada por todas as contas (assim já era antes da reforma, não é
   bug).
4. **Telas que dependem de `relatorios.ver` pra ver execuções passam, mas
   com uma ressalva**: `Dashboard.vue` e `Equipe.vue` chamam `GET /execucoes`
   sem `usuario_id` (olham todas as execuções da unidade, não só a própria),
   o que exige a permissão `relatorios.ver`. Pro Dono isso nunca é um
   problema (sempre tem acesso). Pra um cargo personalizado que tenha
   `equipe.ver` mas não `relatorios.ver`, a parte de comissão da tela Equipe
   pode não carregar (está dentro de um `try/catch` que já existia, então
   não gera tela em branco — só a comissão não aparece). Mencionado aqui
   porque é uma combinação de permissões que vale ter em mente ao montar um
   cargo personalizado de "gerente de equipe sem ver relatórios".

## O que foi corrigido nesta auditoria

Nada precisou ser corrigido — os 47 endereços já funcionavam. (A Fase 1 já
tinha corrigido, ao longo do caminho, os dois bugs de mistura de contas em
`perfilPertenceAConta` e na listagem de perfis que teriam causado exatamente
esse tipo de quebra.)

## Fase 3 — telas alteradas

| Tela | O que mudou |
|---|---|
| `Acessos.vue` | Clicar num cargo abre a matriz direto (antes o botão "Permissões" ficava desabilitado por um bug). Nova seção de "Alcance" (própria unidade / unidades escolhidas / todas) e contador "X pessoas usam este cargo". |
| `Lojas.vue` | Editar uma loja sem horários não trava mais o resto do formulário. Nova seção "Dias de fechamento" (data + motivo, com lista e remoção). |
| `Tarefas.vue` | Duas abas no topo: "Tarefas do Líder" e "Tarefas do Operador", filtrando o kanban pelo novo campo `tipo` do checklist. "Fiscal" passou a aparecer como "Líder" em todos os rótulos (cards de função, badge da coluna). |
| `MinhasTarefas.vue` | O Líder, ao olhar a tarefa de alguém da equipe já feita, ganha botões de Aprovar/Reprovar/Reabrir (antes só tinha leitura, sem nenhuma ação). |
| `Equipe.vue` | Filtro e badge de perfil mostram "Líder" em vez de "fiscal" (era o slug técnico aparecendo direto na tela). |
| `Sidebar.vue` | Item de menu "Hoje" renomeado para "Dashboard". Atalho "Unidades" do painel do usuário agora leva direto pra `/lojas` (antes ia pra uma seção de Configurações que foi removida). |
| `Configuracoes.vue` | Removida a seção "Unidades" (duplicava a página do menu lateral) — ficaram Minha Conta e Plano & Assinatura. |
| `Execucoes.vue` (Relatórios) | Reformado por completo: filtros de período/unidade/pessoa/tipo, KPIs, gráfico de concluídas por dia, busca/ordenação na tabela, exportar CSV, skeleton de carregamento. Corrigido de passagem um bug em que o comparativo entre unidades só mostrava dados certos da última unidade vista no menu lateral. |

Scripts de teste cobrindo o back dessas mudanças:
`back/scripts/teste_lider_operador.js` (rótulo Líder, tipo de tarefa,
conferência) e `back/scripts/teste_relatorios_exportar.js` (nova permissão
`relatorios.exportar`).
