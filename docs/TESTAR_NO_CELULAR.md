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
