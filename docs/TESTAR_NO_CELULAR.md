# Como testar o VALIDA no celular (ambiente de desenvolvimento)

Guia simples pra abrir o sistema no celular enquanto ele está rodando
no seu Mac, na mesma rede Wi-Fi.

## 1. Deixe os dois servidores rodando no Mac

No terminal, dentro de `back/`:

```
node server.js
```

E em outro terminal, dentro de `front/`:

```
npm run dev -- --host
```

O `--host` é o que faz o Vite aceitar conexões de outros aparelhos na
rede, não só do próprio Mac.

## 2. Descubra o IP do seu Mac na rede

No terminal:

```
ipconfig getifaddr en0
```

Isso devolve um número tipo `192.168.0.22`. Se não devolver nada (Mac
conectado por cabo, não por Wi-Fi), tente:

```
ipconfig getifaddr en1
```

Esse IP muda de vez em quando (toda vez que o Mac reconecta na rede),
então vale conferir de novo se parar de funcionar depois de um tempo.

## 3. Abra no celular

**O celular precisa estar na MESMA rede Wi-Fi que o Mac** — não
funciona com o celular no 4G/5G, nem em Wi-Fis diferentes (ex.: o Mac
na rede de casa e o celular usando o Wi-Fi do vizinho).

No navegador do celular, digite exatamente:

```
http://192.168.0.22:3000
```

(trocando pelo IP que você descobriu no passo 2 — sempre com
`http://` na frente e `:3000` no final).

## 4. Recarregar sem cache (quando mudar algo no código)

Na maioria das vezes, basta salvar o arquivo no Mac que a tela do
celular atualiza sozinha (é o "recarregamento ao vivo" do Vite). Mas
se a tela do celular não mudar mesmo depois de alterar o código:

- **iPhone (Safari)**: puxe a página pra baixo pra forçar atualizar, ou
  feche a aba e abra de novo.
- **Android (Chrome)**: toque nos três pontinhos → recarregar, ou feche
  a aba e abra de novo.
- **Limpar de vez** (se nada disso resolver): nas configurações do
  navegador do celular, apague os dados/cache só do site
  `192.168.0.22` (ou do IP que você está usando) — evite "limpar tudo"
  do navegador, pra não perder login de outros sites.

## 5. Se mesmo assim não atualizar

1. **Confira se os dois servidores foram reiniciados** depois da
   última mudança de código. O back (`node server.js`) só lê o código
   de novo se for reiniciado — ele NÃO recarrega sozinho quando um
   arquivo muda. Pare com Ctrl+C e rode `node server.js` de novo.
2. **Confira se o celular e o Mac estão na mesma rede** (passo 3) — é
   a causa mais comum de "não abre" ou "fica girando".
3. **Confira o IP** — ele pode ter mudado (passo 2). Se mudou, o
   endereço antigo salvo no celular não funciona mais.
4. Se nada disso resolver, veja o console do navegador no celular: no
   Safari do iPhone dá pra ver os erros ligando o Mac no celular por
   cabo e abrindo Safari → Desenvolver → [nome do iPhone] no Mac; no
   Android, é só plugar o celular no Mac e abrir
   `chrome://inspect` no Chrome do Mac.

## Telas em formato app (abaixo de 960px) — o que conferir em cada uma

Todas as rotas de `front/src/router/index.js` foram revisadas. "Feita"
quer dizer: usa os componentes compartilhados (AppHeader, BottomNav,
Sheet, FullScreenModal, PageFab, ListCard) onde fazem sentido, sem
rolagem horizontal da página inteira. Abra cada endereço no celular
(ou encolha a janela do navegador no Mac até menos de 960px de
largura) e confira o que está descrito.

| Rota | Tela | Status | O que conferir no celular |
|---|---|---|---|
| `/login` | Login (admin e celular+PIN) | **Feita** | Cartão único centralizado, teclado numérico ao tocar no PIN, botão "Entrar" ocupa a largura toda. |
| `/cadastro` | Cadastro | **Feita** | Mesmo padrão de cartão centralizado; campos não dão zoom ao tocar. |
| `/esqueci-senha` | Esqueci minha senha | **Feita** | Idem. |
| `/reset-password` | Redefinir senha | **Feita** | Idem. |
| `/dashboard` | Dashboard | **Feita** | Abre direto no "hub" de atalhos (grade de ícones); Acessos e Planos aparecem na grade (antes não apareciam). Tocar no menu (☰) no topo abre a gaveta lateral. |
| `/lojas` | Unidades | **Feita** | "+ Nova Loja" abre em tela cheia (Cancelar/Título/Salvar no topo); dentro dele, editar horários e fechamentos funciona igual; unidades arquivadas aparecem como cartões com "Restaurar". |
| `/equipe` | Equipe | **Feita** | Cartões de pessoa (já existia); menu (☰) abre a gaveta lateral; "+ Novo" abre o colaborador em tela cheia. |
| `/tarefas` | Tarefas | **Feita** | Tela de escolher cargo em grade; abrir/editar tarefa é em tela cheia; "+ Adicionar colaborador" também. |
| `/execucoes` | Relatórios | **Feita** | Abas com rolagem horizontal; botão "Filtrar" abre gaveta inferior com período/unidade/pessoa/tipo; números em grade 2x2; tabela vira lista de cartões; "⋯" tem o Exportar CSV; aba Histórico é uma linha do tempo de cartões com foto. |
| `/acessos` | Acessos | **Feita** | Lista agrupada Coordenador/Operador; botão flutuante "+" abre a escolha de perfil; abrir um cargo vai pra tela cheia (ver linha abaixo). |
| `/acessos/:id` | Detalhe do cargo | **Feita** | Cabeçalho mostra o nome do cargo com seta de voltar; matriz de permissões com interruptores grandes; "Alcance" abre numa gaveta inferior. |
| `/planos` | Planos | **Feita** | Comparativo vira cartões deslizáveis na horizontal com bolinha indicadora; Mensal/Anual e perguntas frequentes já eram compatíveis. |
| `/configuracoes` | Configurações | **Feita** | Abre como lista (Minha conta / Empresa / Sair); tocar um item abre em tela cheia com "Salvar" fixo embaixo. |
| `/conferencia` | Conferência | **Já estava pronta** | Tela própria, pensada pro celular desde sempre (é pra onde o Proprietário cai ao entrar pelo celular); não foi mexida nesta tarefa. |
| `/minhas-tarefas` | Minhas Tarefas | **Já estava pronta** | Tela própria em formato app desde a Fase 2 (é o app do Operador/Líder no celular); não foi mexida nesta tarefa. |

**Não feito nesta passada** (ficou de fora, sem risco de rolagem
horizontal, mas sem o polimento extra pedido):
- O seletor de unidade (dentro do menu lateral) continua um menu
  suspenso em vez de virar uma gaveta inferior própria — já fica
  dentro de uma gaveta lateral que ocupa a tela toda no celular, então
  não há problema de uso, só não é exatamente o padrão "Sheet" à parte.
- Os modais menores de Tarefas (templates, confirmar exclusão, pausar
  tarefa, editar colaborador do quadro) continuam no estilo de modal
  centralizado de sempre — não viraram tela cheia. Já funcionam sem
  rolagem horizontal, só não seguem o padrão novo.

## O que já está preparado no projeto

- O sistema não usa nenhum "service worker" de verdade (nada fica
  guardado offline), e qualquer um antigo que porventura exista no
  celular é removido automaticamente assim que a página carrega — então
  não deveria sobrar nada de uma versão velha travada no celular.
- Em desenvolvimento, as respostas do servidor do front (Vite) pedem
  pra nunca ficar em cache, bem como no celular quanto no Mac.
- O endereço da API usado pelo celular é sempre relativo (`/api/...`),
  nunca fixo em `localhost` — por isso funciona tanto no Mac
  (`localhost:3000`) quanto no celular (pelo IP da rede).
