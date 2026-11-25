# VOLTA da atualização do VALIDA (PUBLICAR_PILOTO.md, seção 7).
# Código antigo + cópia do banco de antes, num banco NOVO. Nada é apagado.
set -Eeuo pipefail
# Rode uma CÓPIA em ~/valida-atualizacao: a troca de código mexe em /var/www/valida
# e apagaria este arquivo no meio da execução.
case "$(readlink -f "$0")" in /var/www/*) echo "❌ Copie este script para ~/valida-atualizacao e rode de lá. Nada foi feito."; exit 1 ;; esac
umask 022
T="$HOME/valida-atualizacao"; BK="$HOME/backups"; AP=/var/www/valida; B="$AP/back"; F="$AP/front"
FE="$T/ferramentas"; G="$T/guardado"; HOST=srv1464378.hstgr.cloud
PASSO="início"
trap 'echo; echo "❌ PAROU em: $PASSO. Nada depois disso rodou. Corrija e rode de novo (continua daqui)."' ERR
passo() { PASSO="$1"; echo; echo "=== $1"; }
parar() { echo "❌ PAROU em: $PASSO. $1"; trap - ERR; exit 1; }
sim() { local r=""; printf '\n>>> %s\n>>> Digite SIM para continuar: ' "$1" > /dev/tty; read -r r < /dev/tty; [ "$r" = SIM ] || parar "você não digitou SIM. Nada desta parte mudou."; }
feita() { [ -e "$T/volta_$1" ]; }
marcar() { date > "$T/volta_$1"; echo "✅ Volta: $1."; }
agora() { date +%Y%m%d_%H%M%S; }
codigo() { curl -s -o /dev/null -m 20 -w '%{http_code}' "$1" || true; }
if [ "$(id -u)" = 0 ]; then SUDO=""; else SUDO="sudo"; fi
como_postgres() { if [ -z "$SUDO" ]; then (cd / && runuser -u postgres -- "$@"); else (cd / && sudo -u postgres "$@"); fi; }
pm2info() { pm2 jlist 2>/dev/null | node "$FE/pm2info.cjs" "$B/.env" "$1"; }
cabeca() { git -C "$1" rev-parse HEAD; }
unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_SSL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE NODE_OPTIONS NODE_ENV FOTOS_DIR APP_BASE PILOTO FRONT_DIST FRONTEND_URL PORT || true
[ -s "$T/estado.sh" ] && [ -d "$FE/node_modules" ] || parar "não achei o estado da atualização em $T (a fase A não terminou: não há o que voltar)."
BACK_ANTES=""; FRONT_ANTES=""; STASH_BACK=""; STASH_FRONT=""; SOLTOS_BACK=""; SOLTOS_FRONT=""; DUMP_A=""; DUMP_FINAL=""; ENV_ANTES=""; NGINX_ANTES=""; PORTA=3001
. "$T/estado.sh"
DUMP="${DUMP_FINAL:-$DUMP_A}"

passo "1. conferir (só leitura)"
[ -s "$ENV_ANTES" ] || parar "não achei o .env de antes."
git -C "$B" cat-file -e "$BACK_ANTES^{commit}"; git -C "$F" cat-file -e "$FRONT_ANTES^{commit}"
if feita codigo; then :; else
  for x in "$B $BACK_ANTES" "$F $FRONT_ANTES"; do
    if [ "$(cabeca "${x% *}")" = "${x##* }" ]; then echo "${x% *}: já no código antigo"
    elif [ -n "$(git -C "${x% *}" status --porcelain -uno)" ]; then parar "há mudanças locais em ${x% *}. Guarde antes (git stash)."; fi
  done
fi
if [ -e "$T/banco_tocado" ]; then
  [ -s "$DUMP" ] || parar "não achei o backup do banco."
  pg_restore -f /dev/null "$DUMP"
  echo "O banco foi mexido: a volta usa a cópia $(basename "$DUMP") num banco novo."
else echo "O banco não foi mexido: a volta usa o mesmo banco."; fi
sim "VOLTA: parar o valida-api e voltar o banco, o código e o .env de antes. O que foi feito no piloto fica guardado no banco migrado, mas não aparece no sistema antigo."

passo "2. parar o valida-api"
pm2 stop valida-api > /dev/null
[ "$(pm2info status)" = stopped ] || parar "o valida-api não parou."

if feita banco; then :; else
passo "3. banco"
if [ -e "$T/banco_tocado" ]; then
  TS="$(agora)"
  node "$FE/env.cjs" "$B/.env" pg pg_dump -Fc --no-owner --no-privileges -f "$BK/do_piloto_$TS.dump"
  chmod 600 "$BK/do_piloto_$TS.dump"; pg_restore -f /dev/null "$BK/do_piloto_$TS.dump"
  NOVO="valida_volta_$(date +%Y%m%d%H%M%S)"
  PP="$(node "$FE/env.cjs" "$ENV_ANTES" valor DB_PORT)"
  como_postgres createdb -p "${PP:-5432}" -O valida_user "$NOVO"
  node "$FE/env.cjs" "$ENV_ANTES" pg pg_restore --no-owner --no-privileges --exit-on-error -d "$NOVO" "$DUMP"
  node "$FE/env.cjs" "$ENV_ANTES" pg psql -XAtq -v ON_ERROR_STOP=1 -d "$NOVO" -c "SELECT 'pessoas no banco da volta: ' || COUNT(*) FROM usuarios"
  echo "$NOVO" > "$T/volta_nome_do_banco"
fi
marcar banco
fi

if feita codigo; then :; else
passo "4. código"
if [ "$(cabeca "$B")" = "$BACK_ANTES" ]; then :; else git -C "$B" checkout -q --detach "$BACK_ANTES"; fi
if [ "$(cabeca "$F")" = "$FRONT_ANTES" ]; then :; else git -C "$F" checkout -q --detach "$FRONT_ANTES"; fi
if [ -n "$STASH_BACK" ] && [ -z "$(git -C "$B" status --porcelain -uno)" ]; then git -C "$B" stash apply -q "$STASH_BACK"; fi
if [ -n "$STASH_FRONT" ] && [ -z "$(git -C "$F" status --porcelain -uno)" ]; then git -C "$F" stash apply -q "$STASH_FRONT"; fi
# Arquivos soltos guardados na fase B4. Se o piloto criou um com o mesmo nome, o
# dele vai para o lado (nada é apagado).
devolver() {
  local a o l="$1.lista"
  while IFS= read -r -d '' a <&3; do
    a="${a%/}"; o="$1/$a"
    if [ -e "$o" ] || [ -L "$o" ]; then
      if [ -e "$2/$a" ] || [ -L "$2/$a" ]; then mkdir -p "$(dirname "$T/soltos_do_piloto_$TS/$3/$a")"; mv "$2/$a" "$T/soltos_do_piloto_$TS/$3/$a"; fi
      mkdir -p "$(dirname "$2/$a")"; mv "$o" "$2/$a"; echo "$3: devolvi $a"
    fi
  done 3< "$l"
  mv "$l" "$l.devolvida_$TS"
}
TS="$(agora)"
if [ -n "$SOLTOS_BACK" ] && [ -e "$SOLTOS_BACK.lista" ]; then devolver "$SOLTOS_BACK" "$B" back; fi
if [ -n "$SOLTOS_FRONT" ] && [ -e "$SOLTOS_FRONT.lista" ]; then devolver "$SOLTOS_FRONT" "$F" front; fi
marcar codigo
fi

if feita pastas; then :; else
passo "5. dependências e front de antes"
TS="$(agora)"
if [ -d "$G/node_modules_back" ]; then
  if [ -d "$B/node_modules" ]; then mv "$B/node_modules" "$T/node_modules_do_piloto_$TS"; fi
  mv "$G/node_modules_back" "$B/node_modules"
fi
if [ -d "$G/dist" ]; then
  if [ -d "$F/dist" ]; then mv "$F/dist" "$T/dist_do_piloto_$TS"; fi
  cp -a "$G/dist" "$F/dist"
fi
marcar pastas
fi

if feita env; then :; else
passo "6. .env de antes"
TS="$(agora)"; cp -p "$B/.env" "$BK/env_do_piloto_$TS"; chmod 600 "$BK/env_do_piloto_$TS"
NOVO=""; if [ -s "$T/volta_nome_do_banco" ]; then NOVO="$(cat "$T/volta_nome_do_banco")"; fi
if [ -n "$NOVO" ]; then
  (umask 077; { grep -vE '^[[:space:]]*(export[[:space:]]+)?DB_NAME[[:space:]]*=' "$ENV_ANTES"; printf '\nDB_NAME=%s\n' "$NOVO"; } > "$T/env_volta")
else cp -p "$ENV_ANTES" "$T/env_volta"; fi
cat "$T/env_volta" > "$B/.env"; chmod 600 "$B/.env"
if [ -n "$NOVO" ]; then node "$FE/env.cjs" "$B/.env" igual DB_NAME "$NOVO" || parar "o .env não aponta para o banco da volta."; fi
marcar env
fi

if feita nginx; then :; else
passo "7. tirar o /valida/ do Nginx"
P="$T/nginx_volta_$(agora)"
node "$FE/nginx.cjs" tirar "$HOST" "$PORTA" "$P" $($SUDO nginx -T 2>/dev/null | sed -n 's/^# configuration file \(.*\):$/\1/p')
if [ -s "$P/lista" ]; then
  while IFS=$'\t' read -r n real <&3; do diff -u "$real" "$P/$n" || true; done 3< "$P/lista"
  sim "Aplicar no Nginx o que aparece acima (só deve sair o bloco do Valida; o /banco/ continua fora)."
  while IFS=$'\t' read -r n real <&3; do $SUDO cp -p "$real" "$P/$n.antes"; done 3< "$P/lista"
  while IFS=$'\t' read -r n real <&3; do $SUDO tee "$real" < "$P/$n" > /dev/null; done 3< "$P/lista"
  if $SUDO nginx -t; then $SUDO systemctl reload nginx; else
    while IFS=$'\t' read -r n real <&3; do $SUDO cat "$P/$n.antes" | $SUDO tee "$real" > /dev/null; done 3< "$P/lista"
    parar "o nginx -t recusou. Voltei os arquivos do Nginx."
  fi
fi
marcar nginx
fi

passo "8. ligar o sistema antigo"
pm2 restart valida-api --update-env > /dev/null
OK=0; for i in $(seq 1 40); do case "$(codigo "http://127.0.0.1:$PORTA/")" in 2*|3*) OK=1; break ;; esac; sleep 1; done
[ "$OK" = 1 ] || parar "o sistema antigo não respondeu. Veja: pm2 logs valida-api --lines 30 --nostream"
R="$(pm2info reinicios)"; sleep 10
[ "$(pm2info status)" = online ] && [ "$(pm2info reinicios)" = "$R" ] || parar "o valida-api está reiniciando sozinho."
pm2 save > /dev/null
D="$T/voltou_$(agora)"; mkdir -p "$D"
for x in "$T"/feito_* "$T"/volta_* "$T/estado.sh" "$T/banco_tocado" "$T/env_volta" "$G/dist"; do if [ -e "$x" ]; then mv "$x" "$D/"; fi; done
trap - ERR
echo; echo "✅ VOLTA COMPLETA. O sistema antigo está no ar. O banco migrado e o .env do piloto ficaram guardados."
echo "O /banco/ continua fora do Nginx; o backup está em $NGINX_ANTES."
