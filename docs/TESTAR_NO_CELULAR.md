# Como testar o VALIDA no celular (ambiente de desenvolvimento)

Guia simples pra abrir o sistema no celular enquanto ele está rodando
no seu Mac, na mesma rede Wi-Fi.

## ⚠️ Antes de mais nada: reinicie o `npm run dev` do front

Encontrado nesta revisão: o processo do Vite (`npm run dev -- --host`)
estava rodando havia mais de 1 dia — de ANTES da última mudança em
`vite.config.mjs` (os cabeçalhos de no-cache). Mudança em
`vite.config.mjs` **não recarrega sozinha** — precisa parar
(Ctrl+C) e rodar `npm run dev -- --host` de novo. Enquanto isso não
for feito, o celular pode estar vendo uma versão em cache de antes de
qualquer ajuste de responsividade, mesmo com o código certo no disco.
Isso sozinho pode explicar boa parte do "não é responsivo".

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

## Bug real encontrado nesta revisão (causa provável do "não responsivo")

O painel principal (`AppLayout.vue`) empurrava o conteúdo pra direita
com `margin-left: 240px` (ou `64px` recolhido) usando um `:style`
**inline**, calculado no JavaScript. Estilo inline sempre vence
qualquer regra de CSS — inclusive a regra dentro de
`@media (max-width: 960px)` que tentava zerar essa margem no celular.
Na prática, isso significava que o conteúdo de quase toda tela
(Dashboard, Unidades, Equipe, Tarefas, Relatórios, Acessos, Planos,
Configurações) ficava sempre deslocado 240px/64px pra direita no
celular, por cima de uma tela que já era estreita — exatamente a cara
de "layout de desktop forçado, não se adapta". Corrigido: a margem
agora vem de uma classe CSS (`.collapsed`), que o `@media` consegue
sobrescrever normalmente.

## Telas em formato app (360, 390, 768 e 1024px) — o que conferir em cada uma

Todas as rotas de `front/src/router/index.js` foram revisadas nessas
4 larguras (as duas primeiras são celular — 360px é o Android mais
estreito comum, 390px é o iPhone padrão —, 768px é tablet retrato, e
1024px já fica acima do limite de 960px, ou seja, layout de desktop
completo). "Feita" quer dizer: usa os componentes compartilhados
(AppHeader, BottomNav, Sheet, FullScreenModal, PageFab, ListCard) onde
fazem sentido, sem rolagem horizontal da página inteira em nenhuma das
4 larguras. Pra conferir no Mac sem precisar do celular: abra o
DevTools (F12), ligue o modo responsivo e teste nessas 4 larguras.

| Rota | Tela | 360/390px | 768px | 1024px |
|---|---|---|---|---|
| `/login`, `/cadastro`, `/esqueci-senha`, `/reset-password` | Telas de acesso | **Feita** (app) | **Feita** (app) | **Feita** (cartão centralizado, mesmo em qualquer largura) |
| `/dashboard` | Dashboard | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/lojas` | Unidades | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/equipe` | Equipe | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/tarefas` | Tarefas | **Feita** (app; quadro kanban rola só dentro dele, não a página) | **Feita** (app) | **Feita** (desktop completo) |
| `/execucoes` | Relatórios | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/acessos` | Acessos | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/acessos/:id` | Detalhe do cargo | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/planos` | Planos | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/configuracoes` | Configurações | **Feita** (app) | **Feita** (app) | **Feita** (desktop completo) |
| `/conferencia` | Conferência | **Já estava pronta** (tela própria, formato app em qualquer largura) | Idem | Idem |
| `/minhas-tarefas` | Minhas Tarefas | **Já estava pronta** (tela própria, formato app em qualquer largura) | Idem | Idem |

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
