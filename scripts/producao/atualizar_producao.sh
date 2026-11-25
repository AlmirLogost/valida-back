# Atualização do VALIDA em produção (PUBLICAR_PILOTO.md, 5.3 a 5.10).
# Para no primeiro erro. Rodar de novo continua da fase que faltou.
set -Eeuo pipefail
# Rode uma CÓPIA em ~/valida-atualizacao: a troca de código mexe em /var/www/valida
# e apagaria este arquivo no meio da execução.
case "$(readlink -f "$0")" in /var/www/*) echo "❌ Copie este script para ~/valida-atualizacao e rode de lá. Nada foi feito."; exit 1 ;; esac
umask 022
T="$HOME/valida-atualizacao"; BK="$HOME/backups"; AP=/var/www/valida; B="$AP/back"; F="$AP/front"
FE="$T/ferramentas"; G="$T/guardado"; HOST=srv1464378.hstgr.cloud; U="https://$HOST"
N8N_URL="${N8N_URL:-http://127.0.0.1:5678/}"
COMMIT_BACK=3a7a18b; COMMIT_FRONT=1885a7d
PASSO="início"
trap 'echo; echo "❌ PAROU em: $PASSO. Nada depois disso rodou. Corrija e rode de novo (continua daqui), ou use o voltar_producao.sh."' ERR
passo() { PASSO="$1"; echo; echo "=== $1"; }
parar() { echo "❌ PAROU em: $PASSO. $1"; trap - ERR; exit 1; }
sim() { local r=""; printf '\n>>> %s\n>>> Digite SIM para continuar: ' "$1" > /dev/tty; read -r r < /dev/tty; [ "$r" = SIM ] || parar "você não digitou SIM. Nada desta parte mudou."; }
feita() { [ -e "$T/feito_$1" ]; }
marcar() { date > "$T/feito_$1"; echo "✅ Fase $1 concluída."; }
agora() { date +%Y%m%d_%H%M%S; }
guardar_estado() { printf '%s=%q\n' "$1" "$2" >> "$T/estado.sh"; }
codigo() { curl -s -o /dev/null -m 20 -w '%{http_code}' "$1" || true; }
medir() { curl -s -o /dev/null -m 20 -w '%{http_code} %{content_type}' "$1" || true; }
if [ "$(id -u)" = 0 ]; then SUDO=""; else SUDO="sudo"; fi
como_postgres() { if [ -z "$SUDO" ]; then (cd / && runuser -u postgres -- "$@"); else (cd / && sudo -u postgres "$@"); fi; }
env_() { node "$FE/env.cjs" "$B/.env" "$@"; }
porta_pg() { local p; p="$(env_ valor DB_PORT)"; echo "${p:-5432}"; }
pm2info() { pm2 jlist 2>/dev/null | node "$FE/pm2info.cjs" "$B/.env" "$1"; }
conferir_dump() {
  [ -s "$1" ] || parar "backup vazio."
  pg_restore -f /dev/null "$1"
  pg_restore --list "$1" > "$T/lista_dump.txt"
  grep -q 'TABLE DATA public usuarios' "$T/lista_dump.txt" || parar "o backup não tem a tabela usuarios."
  chmod 600 "$1"; echo "ok: backup legível por inteiro ($(du -h "$1" | cut -f1))"
}
# nada herdado do terminal pode mudar o destino
unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_SSL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE NODE_OPTIONS NODE_ENV FOTOS_DIR APP_BASE PILOTO FRONT_DIST FRONTEND_URL PORT RELOGIO_FIXO DEMO_REDE ENVIO_SIMULADO || true
mkdir -p "$T" "$BK" "$FE" "$G"; chmod 700 "$T" "$BK" "$G"

# ---- ferramentas (não mostram valores) ---------------------------------------
cat > "$FE/env.cjs" <<'JS'
// uso: env.cjs <.env> valor NOME | igual NOME VALOR | pg <comando> ... | sql <consulta>
const fs = require('fs'), exige = require('module').createRequire(__dirname + '/x.js')
const [arq, modo, ...a] = process.argv.slice(2)
const e = exige('dotenv').parse(fs.readFileSync(arq))
const local = ['localhost', '127.0.0.1', '::1'].includes(e.DB_HOST || 'localhost')
if (modo === 'valor') { process.stdout.write(e[a[0]] || ''); process.exit(0) }
if (modo === 'igual') process.exit((e[a[0]] || '') === a[1] ? 0 : 1)
if (local === false) { console.error('o banco do .env não é deste servidor'); process.exit(1) }
const banco = e.DB_NAME || 'valida_v2', porta = e.DB_PORT || '5432'
if (modo === 'pg') {
  const r = require('child_process').spawnSync(a[0], a.slice(1), { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PGHOST: e.DB_HOST || 'localhost', PGPORT: porta, PGUSER: e.DB_USER || 'postgres', PGPASSWORD: e.DB_PASSWORD || '', PGDATABASE: banco } })
  process.exit(r.status === null ? 1 : r.status)
}
const Q = {
  destino: "SELECT CASE WHEN current_database() IN ('valida_ensaio','valida_visual','valida_teste','valida_antigo','postgres') THEN 'ensaio' ELSE 'ok' END",
  situacao: "SELECT CASE WHEN to_regclass('public.usuarios') IS NULL THEN 'sem_usuarios' WHEN to_regclass('public.empresas') IS NULL THEN 'antigo' ELSE 'migrado' END",
  alheios: "SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','S','v','m','p') AND pg_has_role(current_user, c.relowner, 'USAGE') = false",
  direitos: "SELECT CASE WHEN has_schema_privilege(current_user, 'public', 'CREATE') AND has_database_privilege(current_user, current_database(), 'TEMP') THEN 'ok' ELSE 'falta' END",
  papel: "SELECT CASE WHEN rolsuper THEN 'super' WHEN rolcreatedb THEN 'createdb' ELSE 'simples' END FROM pg_roles WHERE rolname = current_user",
  numeros: "SELECT 'pessoas ' || (SELECT COUNT(*) FROM colaboradores) || ' · tarefas ' || (SELECT COUNT(*) FROM tarefas) || ' · execuções ' || (SELECT COUNT(*) FROM execucoes) || ' · fotos ' || (SELECT COUNT(*) FROM fotos)"
}
const { Client } = exige('pg')
const c = new Client({ host: e.DB_HOST || 'localhost', port: Number(porta), database: banco, user: e.DB_USER || 'postgres', password: e.DB_PASSWORD || '', ssl: e.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, options: '-c default_transaction_read_only=on' })
c.connect().then(() => c.query(Q[a[0]])).then((r) => { console.log(String(Object.values(r.rows[0])[0])); process.exit(0) }).catch((x) => { console.error('banco: código ' + (x.code || '-')); process.exit(1) })
JS
cat > "$FE/pm2info.cjs" <<'JS'
// lê "pm2 jlist" da entrada; mostra só o campo pedido (nunca as variáveis)
const fs = require('fs'), exige = require('module').createRequire(__dirname + '/x.js')
const [arq, campo] = process.argv.slice(2)
const t = fs.readFileSync(0, 'utf8'), l = JSON.parse(t.slice(Math.max(t.indexOf('[{'), 0)) || '[]').filter((p) => p.name === 'valida-api')
if (l.length === 0 || l.length > 1) { console.log(l.length === 0 ? 'ausente' : 'repetido'); process.exit(0) }
const p = l[0], v = p.pm2_env
if (campo === 'conflitos') {
  const e = exige('dotenv').parse(fs.readFileSync(arq)), n = {}
  for (const o of [v.env || {}, v]) for (const k of Object.keys(o)) if (/^(PORT|DB_[A-Z]+|JWT_SECRET|APP_BASE|PILOTO|FRONTEND_URL|FRONT_DIST|FOTOS_DIR|PIN_CIFRA_CHAVE|VAPID_[A-Z_]+|ENVIO_SIMULADO|DEMO_REDE|RELOGIO_FIXO|WEBHOOK_ASAAS_ATIVO)$/.test(k) && typeof o[k] === 'string' && o[k].length && (o[k] === e[k]) === false) n[k] = 1
  console.log(Object.keys(n).join(' '))
} else console.log(String({ status: v.status, cwd: v.pm_cwd, script: v.pm_exec_path, modo: v.exec_mode, pid: p.pid, reinicios: v.restart_time }[campo]))
JS
cat > "$FE/nginx.cjs" <<'JS'
// uso: nginx.cjs colocar|tirar <host> <porta> <pasta de saída> <arquivos...>
// Não grava nos arquivos do Nginx: gera as cópias novas e a lista "n<TAB>arquivo".
const fs = require('fs'), path = require('path')
const [modo, host, porta, saida, ...arqs] = process.argv.slice(2)
const erro = (m) => { console.error('Nginx: ' + m); process.exit(2) }
const INI = '# VALIDA (piloto) INICIO', FIM = '# VALIDA (piloto) FIM'
const BLOCO = [
  INI,
  'location = /valida {', '    return 301 /valida/$is_args$args;', '}',
  'location ^~ /valida/ {', '    proxy_pass http://127.0.0.1:' + porta + ';', '    proxy_http_version 1.1;',
  '    proxy_set_header Host              $host;', '    proxy_set_header X-Real-IP         $remote_addr;',
  '    proxy_set_header X-Forwarded-For   $remote_addr;', '    proxy_set_header X-Forwarded-Proto $scheme;',
  '    client_max_body_size 6m;', '    proxy_read_timeout 60s;', '    proxy_hide_header Strict-Transport-Security;',
  '    proxy_cache off;', '    proxy_buffering on;', '}',
  FIM
].map((l) => '    ' + l).join('\n') + '\n'
function ler(t) {
  const blocos = [], diretivas = [], pilha = []
  let ini = -1
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '#' && (ini < 0 || /\s/.test(t[i - 1]))) { const f = t.indexOf('\n', i); i = f < 0 ? t.length : f; continue }
    if (/\s/.test(ch)) continue
    if (ch === '{' || ch === ';') {
      const cab = ini < 0 ? '' : t.slice(ini, i).trim(), pai = pilha[pilha.length - 1] || null
      if (ch === ';') diretivas.push({ cab, pai })
      else { const b = { cab, ini, pai, fecha: -1 }; blocos.push(b); pilha.push(b) }
      ini = -1; continue
    }
    if (ch === '}') { const b = pilha.pop(); if (b === undefined) erro('chaves que não fecham'); b.fecha = i; ini = -1; continue }
    if (ini < 0) ini = i
    if (ch === '\\') { i++; continue }
    if (ch === '"' || ch === "'") { for (i++; i < t.length && (t[i] === ch) === false; i++) if (t[i] === '\\') i++; continue }
    if (ch === '$' && t[i + 1] === '{') { const f = t.indexOf('}', i); if (f < 0) erro('variável que não fecha'); i = f }
  }
  if (pilha.length) erro('chaves que não fecham')
  return { blocos, diretivas }
}
const inicioLinha = (t, i) => { const n = t.lastIndexOf('\n', i - 1) + 1; return t.slice(n, i).trim() === '' ? n : i }
const fimLinha = (t, i) => { const n = t.indexOf('\n', i); return n >= 0 && t.slice(i, n).trim() === '' ? n + 1 : i }
const vistos = new Set(), docs = []
for (const a of arqs) { const r = fs.realpathSync(a); if (vistos.has(r) || r.startsWith('/etc/nginx/') === false) continue; vistos.add(r); const t = fs.readFileSync(r, 'utf8'); docs.push({ r, t, cortes: [] }) }
let alvos = 0, tirados = 0
for (const d of docs) {
  const a = d.t.indexOf(INI), z = d.t.indexOf(FIM), tem = a >= 0 && z > a
  if (modo === 'tirar') { if (tem) { d.cortes.push([inicioLinha(d.t, a), fimLinha(d.t, z + FIM.length), '']); tirados++ } continue }
  const { blocos, diretivas } = ler(d.t)
  for (const b of blocos) {
    const m = /^location\s+(?:(=|\^~|~\*|~)\s*)?(\S+)/.exec(b.cab)
    if (m === null) continue
    const c = m[2].replace(/^["']|["']$/g, '')
    if (/^~/.test(m[1] || '') && /banco/i.test(c)) erro('há um location por expressão com "banco" em ' + d.r + '. Tire à mão.')
    if (c === '/banco' || c.startsWith('/banco/')) { d.cortes.push([inicioLinha(d.t, b.ini), fimLinha(d.t, b.fecha + 1), '']); tirados++ }
  }
  for (const s of blocos.filter((b) => b.cab === 'server')) {
    const ds = diretivas.filter((x) => x.pai === s).map((x) => x.cab)
    if ((ds.some((x) => /^server_name\s/.test(x) && x.split(/\s+/).includes(host)) && ds.some((x) => /^listen\s+(\S*:)?443(\s|$)/.test(x))) === false) continue
    alvos++
    if (tem) continue
    if (blocos.some((b) => b.pai === s && /^location\s.*\/valida/.test(b.cab))) erro('já existe um location /valida nesse server. Veja à mão.')
    const p = inicioLinha(d.t, s.fecha)
    d.cortes.push([p, p, '\n' + BLOCO])
  }
}
if (modo === 'colocar' && alvos === 0) erro('não achei o server de ' + host + ' na 443.')
if (modo === 'colocar' && alvos > 1) erro('há mais de um server de ' + host + ' na 443.')
fs.mkdirSync(saida, { recursive: true })
const lista = []
for (const d of docs) {
  if (d.cortes.length === 0) continue
  let t = d.t
  for (const [x, y, novo] of d.cortes.sort((p, q) => q[0] - p[0])) t = t.slice(0, x) + novo + t.slice(y)
  const n = String(lista.length + 1)
  fs.writeFileSync(path.join(saida, n), t); lista.push(n + '\t' + d.r)
}
fs.writeFileSync(path.join(saida, 'lista'), lista.length ? lista.join('\n') + '\n' : '')
console.log((modo === 'colocar' ? 'blocos /banco/ a tirar: ' : 'blocos do Valida a tirar: ') + tirados + ' · arquivos a mudar: ' + lista.length)
JS
arquivos_nginx() { $SUDO nginx -T 2>/dev/null | sed -n 's/^# configuration file \(.*\):$/\1/p'; }
fotografar() { local n; { for n in "$U/pedidos/" "$N8N_URL" $($SUDO nginx -T 2>/dev/null | sed -nE 's/^[[:space:]]*server_name[[:space:]]+(.*);.*$/\1/p' | tr ' ' '\n' | grep -E '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' | sort -u | sed -e 's#.*#http://&/ https://&/#' || true); do echo "$n $(medir "$n")"; done; } > "$1"; }

# ==== A ========================================================================
if feita A; then echo "Fase A já feita."; else
passo "A1. conferir o servidor (só leitura)"
for c in node npm git pm2 pg_dump pg_restore psql curl ss tar openssl; do command -v "$c" > /dev/null || parar "falta o comando $c."; done
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit((a === 20 && b >= 19) || (a === 22 && b >= 12) || a > 22 ? 0 : 1)' || parar "o Node precisa ser 20.19 ou maior, ou 22.12 ou maior."
grep -q 'ENSAIO COMPLETO' "$HOME/valida-ensaio/ensaio.log" || parar "não achei o ensaio completo."
[ -d "$HOME/valida-ensaio/back/node_modules/pg" ] || parar "não achei ~/valida-ensaio/back/node_modules."
if [ -d "$FE/node_modules" ]; then :; else cp -a "$HOME/valida-ensaio/back/node_modules" "$FE/node_modules"; fi
[ "$(df -Pk "$HOME" | awk 'NR==2{print $4}')" -gt 2000000 ] || parar "menos de 2 GB livres na pasta de backups."
[ "$(df -Pk "$AP" | awk 'NR==2{print $4}')" -gt 1000000 ] || parar "menos de 1 GB livre em $AP."
[ -f "$B/.env" ] || parar "não achei o .env do back."
if [ -L "$B/.env" ]; then parar "o .env do back é um atalho."; fi
for r in "$B" "$F"; do
  O="$(git -C "$r" remote get-url origin)"
  case "$O" in *valida-back*|*valida-front*) ;; *) parar "repositório inesperado em $r." ;; esac
  if git -C "$r" ls-files --error-unmatch .env > /dev/null 2>&1; then parar "o .env está dentro do git em $r."; fi
  echo "$r: $(git -C "$r" rev-parse --short HEAD) ($(git -C "$r" branch --show-current)), $(git -C "$r" status --porcelain -uno | wc -l) arquivo(s) alterado(s)"
done

passo "A2. processo valida-api"
[ "$(pm2info status)" = online ] || parar "o valida-api não está online neste usuário do pm2 ($(pm2info status))."
[ "$(readlink -f "$(pm2info script)")" = "$(readlink -f "$B/server.js")" ] || parar "o valida-api não roda $B/server.js."
[ "$(pm2info modo)" = fork_mode ] || parar "o valida-api não está em modo fork."
C="$(pm2info conflitos)"; [ -z "$C" ] || parar "o pm2 guarda variáveis diferentes das do .env: $C"
PORTA="$(env_ valor PORT)"; PORTA="${PORTA:-3001}"
$SUDO ss -ltnpH "sport = :$PORTA" > "$T/porta.txt"
grep -q "pid=$(pm2info pid)," "$T/porta.txt" || parar "a porta $PORTA não é do valida-api."
echo "ok: valida-api na porta $PORTA"

passo "A3. banco (só leitura)"
[ "$(env_ sql destino)" = ok ] || parar "o .env aponta para um banco de ensaio."
[ "$(env_ sql situacao)" = antigo ] || parar "o banco não está na situação esperada (antes da migração)."
[ "$(env_ valor DB_USER)" = valida_user ] || parar "o usuário do banco não é valida_user."
[ "$(env_ sql alheios)" = 0 ] || parar "há tabelas que não são do valida_user: a migração não poderia alterá-las (no ensaio eram dele)."
[ "$(env_ sql direitos)" = ok ] || parar "o valida_user não pode criar tabelas neste banco."
como_postgres psql -p "$(porta_pg)" -XAtqc 'SELECT 1' > /dev/null || parar "não consigo usar o usuário postgres (preciso dele para tirar o CREATEDB)."
echo "ok: banco certo, ainda não migrado, e o usuário pode migrar"

passo "A4. Nginx e vizinhos"
$SUDO nginx -t
fotografar "$T/vizinhos_antes.txt"; cat "$T/vizinhos_antes.txt"
case "$(codigo "$U/pedidos/")" in 000|5*) parar "/pedidos/ não está respondendo antes da atualização." ;; esac
case "$(codigo "$N8N_URL")" in 000|5*) parar "o n8n não respondeu em $N8N_URL. Rode com o endereço certo na frente: N8N_URL=https://..." ;; esac

passo "A5. backups"
TS="$(agora)"
env_ pg pg_dump -Fc --no-owner --no-privileges -f "$BK/antes_piloto_$TS.dump"
conferir_dump "$BK/antes_piloto_$TS.dump"
cp -p "$B/.env" "$BK/env_antes_piloto_$TS"; chmod 600 "$BK/env_antes_piloto_$TS"; cmp -s "$B/.env" "$BK/env_antes_piloto_$TS"
$SUDO tar czpf "$BK/nginx_antes_piloto_$TS.tar.gz" -C / etc/nginx; $SUDO chown "$(id -un)" "$BK/nginx_antes_piloto_$TS.tar.gz"; chmod 600 "$BK/nginx_antes_piloto_$TS.tar.gz"
[ "$(tar tzf "$BK/nginx_antes_piloto_$TS.tar.gz" | wc -l)" -gt 3 ] || parar "o backup do Nginx está vazio."
if [ -f "$HOME/.pm2/dump.pm2" ]; then cp -p "$HOME/.pm2/dump.pm2" "$BK/pm2_antes_piloto_$TS"; chmod 600 "$BK/pm2_antes_piloto_$TS"; fi
: > "$T/estado.sh"; chmod 600 "$T/estado.sh"
guardar_estado BACK_ANTES "$(git -C "$B" rev-parse HEAD)"; guardar_estado FRONT_ANTES "$(git -C "$F" rev-parse HEAD)"
guardar_estado DUMP_A "$BK/antes_piloto_$TS.dump"; guardar_estado ENV_ANTES "$BK/env_antes_piloto_$TS"; guardar_estado NGINX_ANTES "$BK/nginx_antes_piloto_$TS.tar.gz"
guardar_estado PORTA "$PORTA"
ls -l "$BK"/*antes_piloto_"$TS"*
marcar A
fi
. "$T/estado.sh"

# ==== B ========================================================================
if feita B; then echo "Fase B já feita."; else
passo "B1. código novo disponível (nada muda ainda)"
for r in "$B" "$F"; do git -C "$r" fetch -q origin "+refs/heads/reforma-acessos:refs/remotes/origin/reforma-acessos"; done
git -C "$B" merge-base --is-ancestor "$COMMIT_BACK" origin/reforma-acessos || parar "o back novo não está no GitHub."
git -C "$F" merge-base --is-ancestor "$COMMIT_FRONT" origin/reforma-acessos || parar "o front novo não está no GitHub."
echo "back: $(git -C "$B" log --oneline -1 origin/reforma-acessos)"; echo "front: $(git -C "$F" log --oneline -1 origin/reforma-acessos)"
sim "FASE B: PARAR o valida-api (o Valida sai do ar até a fase G), fazer o backup final, guardar as mudanças locais e baixar o código. Já copiou os backups da fase A para fora do servidor?"

passo "B2. parar o valida-api"
pm2 stop valida-api > /dev/null
[ "$(pm2info status)" = stopped ] || parar "o valida-api não parou."
echo "ok: parado"

passo "B3. backup final, com o sistema parado"
TS="$(agora)"
env_ pg pg_dump -Fc --no-owner --no-privileges -f "$BK/antes_piloto_parado_$TS.dump"
conferir_dump "$BK/antes_piloto_parado_$TS.dump"
guardar_estado DUMP_FINAL "$BK/antes_piloto_parado_$TS.dump"

passo "B4. guardar mudanças locais e o que a volta precisa"
for x in BACK FRONT; do
  if [ "$x" = BACK ]; then r="$B"; else r="$F"; fi
  if [ -n "$(git -C "$r" status --porcelain -uno)" ]; then
    git -C "$r" -c user.name=atualizacao -c user.email=atualizacao@localhost stash push -m "antes do piloto $TS"
    guardar_estado "STASH_$x" "$(git -C "$r" rev-parse refs/stash)"
  else echo "$x: nada a guardar"; fi
  [ -z "$(git -C "$r" status --porcelain -uno)" ] || parar "sobraram mudanças locais em $r."
done
[ -f "$B/.env" ] || parar "o .env sumiu."
if [ -e "$G/dist" ]; then :; elif [ -d "$F/dist" ]; then cp -a "$F/dist" "$G/dist_parcial"; mv "$G/dist_parcial" "$G/dist"; fi

passo "B5. mudar para a reforma-acessos"
for r in "$B" "$F"; do
  if git -C "$r" show-ref -q --verify refs/heads/reforma-acessos; then git -C "$r" checkout -q reforma-acessos; else git -C "$r" checkout -q --no-track -b reforma-acessos origin/reforma-acessos; fi
  git -C "$r" merge -q --ff-only origin/reforma-acessos
  [ "$(git -C "$r" rev-parse HEAD)" = "$(git -C "$r" rev-parse origin/reforma-acessos)" ] || parar "$r não ficou igual ao GitHub."
done
cmp -s "$B/.env" "$ENV_ANTES" || parar "o .env mudou na troca de código."

passo "B6. dependências"
if [ -e "$G/node_modules_back" ]; then :; elif [ -d "$B/node_modules" ]; then mv "$B/node_modules" "$G/node_modules_back"; fi
(cd "$B" && npm ci --omit=dev --no-audit --no-fund)
(cd "$F" && npm ci --include=dev --no-audit --no-fund)
marcar B
fi
. "$T/estado.sh"

# ==== C ========================================================================
if feita C; then echo "Fase C já feita."; else
passo "C. variáveis e pasta das fotos"
sim "FASE C: acrescentar ao .env só as variáveis que faltam e criar /var/lib/valida/fotos."
tem() { grep -qE "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$B/.env"; }
if [ -n "$(tail -c1 "$B/.env")" ]; then printf '\n' >> "$B/.env"; fi
por() { if tem "$1"; then echo "$1: já existia, não mudei"; else printf '%s=%s\n' "$1" "$2" >> "$B/.env"; echo "$1: acrescentada"; fi; }
por APP_BASE /valida/
por PILOTO true
por ENVIO_SIMULADO true
por WEBHOOK_ASAAS_ATIVO false
por FOTOS_DIR /var/lib/valida/fotos
por FRONTEND_URL "$U"
if tem PIN_CIFRA_CHAVE; then echo "PIN_CIFRA_CHAVE: já existia, não mudei"; else { printf 'PIN_CIFRA_CHAVE='; openssl rand -hex 32; } >> "$B/.env"; echo "PIN_CIFRA_CHAVE: acrescentada"; fi
chmod 600 "$B/.env"
env_ igual APP_BASE /valida/ || parar "APP_BASE já existia com outro valor. Ajuste à mão."
env_ igual PILOTO true || parar "PILOTO já existia com outro valor. Ajuste à mão."
env_ igual ENVIO_SIMULADO true || parar "ENVIO_SIMULADO já existia com outro valor. Ajuste à mão."
env_ igual WEBHOOK_ASAAS_ATIVO false || parar "WEBHOOK_ASAAS_ATIVO já existia com outro valor. Ajuste à mão."
env_ igual FOTOS_DIR /var/lib/valida/fotos || parar "FOTOS_DIR já existia com outro valor. Ajuste à mão."
env_ igual FRONTEND_URL "$U" || echo "⚠️  FRONTEND_URL já existia com outro valor e ficou como estava. No piloto o certo é $U (só muda o link de senha, que é simulado)."
for n in JWT_SECRET PIN_CIFRA_CHAVE; do if env_ igual "$n" ""; then parar "$n está vazia."; fi; done
for n in RELOGIO_FIXO DEMO_REDE FRONT_DIST; do if tem "$n"; then parar "$n não pode existir no servidor. Tire à mão."; fi; done
$SUDO mkdir -p /var/lib/valida/fotos; $SUDO chown "$(id -un)" /var/lib/valida/fotos; $SUDO chmod 700 /var/lib/valida/fotos
[ -w /var/lib/valida/fotos ] || parar "não consigo gravar na pasta das fotos."
marcar C
fi

# ==== D ========================================================================
if feita D; then echo "Fase D já feita."; else
passo "D1. relatório (só leitura)"
[ "$(pm2info status)" = stopped ] || parar "o valida-api precisa estar parado."
[ "$(env_ sql destino)" = ok ] || parar "o .env aponta para um banco de ensaio."
conferir_dump "$DUMP_FINAL"
cd "$B"
node scripts/relatorio_pre_migracao.js | tee "$T/relatorio_antes.txt"
if grep -q 'erro (código' "$T/relatorio_antes.txt"; then parar "o relatório teve erro."; fi
if grep -qE 'grupos_repetidos: [1-9]' "$T/relatorio_antes.txt"; then parar "há celular ou e-mail repetido."; fi
node scripts/migrar_pins_para_hash.js --dry-run | tee "$T/pins.txt"
grep -q 'fora_do_padrao: 0' "$T/pins.txt" || parar "há PIN fora do padrão."
node scripts/migrar.js --dry-run
sim "FASE D: mudar o BANCO DE PRODUÇÃO: PINs para hash, migrations, fotos e conferência. No fim, tirar o CREATEDB do valida_user."
date > "$T/banco_tocado"

passo "D2. PINs para hash"
node scripts/migrar_pins_para_hash.js
node scripts/relatorio_pre_migracao.js > "$T/relatorio_pins.txt"
grep -E 'pin_(texto_puro|em_hash)' "$T/relatorio_pins.txt"
grep -q 'pin_texto_puro: 0' "$T/relatorio_pins.txt" || parar "sobrou PIN em texto puro."

passo "D3. migrar"
node scripts/migrar.js
node scripts/migrar.js --status > "$T/status.txt"
if grep -qE 'pendente|ALTERADO|não existe' "$T/status.txt"; then parar "sobrou migration pendente."; fi

passo "D4. fotos"
node scripts/migrar_fotos.js --dry-run
node scripts/migrar_fotos.js

passo "D5. conferir"
node scripts/conferir_migracao.js
env_ sql numeros

passo "D6. tirar o CREATEDB do valida_user"
como_postgres psql -p "$(porta_pg)" -v ON_ERROR_STOP=1 -Xqc 'ALTER ROLE valida_user NOCREATEDB'
[ "$(env_ sql papel)" = simples ] || parar "o valida_user continua com poder a mais ($(env_ sql papel))."
echo "ok: valida_user sem CREATEDB"
marcar D
fi

# ==== E ========================================================================
if feita E; then echo "Fase E já feita."; else
passo "E. chaves do push e build do front"
sim "FASE E: gerar as chaves do push (se não existirem) e compilar o front para /valida/."
CONTATO="${CONTATO_PUSH:-}"
if [ -z "$CONTATO" ]; then printf '>>> E-mail de contato do push (vai para o Google e a Apple): ' > /dev/tty; read -r CONTATO < /dev/tty; fi
case "$CONTATO" in *" "*) parar "e-mail inválido." ;; *?@?*.?*) ;; *) parar "e-mail inválido." ;; esac
cd "$B"; node scripts/gerar_vapid.js --contato="mailto:$CONTATO"
for n in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT; do if env_ igual "$n" ""; then parar "$n está vazia."; fi; done
env_ igual VAPID_SUBJECT "mailto:$CONTATO" || echo "⚠️  As chaves já existiam com outro contato e ficaram como estavam."
chmod 600 "$B/.env"
cd "$F"; APP_BASE=/valida/ npm run build
grep -oE '(src|href)="[^"]+"' dist/index.html > "$T/build.txt"; cat "$T/build.txt"
[ -s "$T/build.txt" ] || parar "o build não gerou a página."
if grep -vE '="/valida/' "$T/build.txt" > /dev/null; then parar "o build tem caminho fora de /valida/."; fi
[ -s dist/sw.js ] && [ -s dist/manifest.webmanifest ] || parar "faltou o service worker ou o manifest."
marcar E
fi

# ==== F ========================================================================
if feita F; then echo "Fase F já feita."; else
passo "F1. preparar o Nginx (nada muda ainda)"
$SUDO nginx -t
P="$T/nginx_$(agora)"
node "$FE/nginx.cjs" colocar "$HOST" "$PORTA" "$P" $(arquivos_nginx)
while IFS=$'\t' read -r n real <&3; do diff -u "$real" "$P/$n" || true; done 3< "$P/lista"
fotografar "$T/vizinhos_f_antes.txt"
BANCO_ANTES="$(curl -sL -m 20 "$U/banco/" | sha256sum | cut -d' ' -f1 || true)"
sim "FASE F: aplicar no Nginx exatamente o que aparece acima (linhas + entram, linhas - saem). Confira que só sai o /banco/ e só entra o Valida."

passo "F2. aplicar, testar e recarregar"
while IFS=$'\t' read -r n real <&3; do $SUDO cp -p "$real" "$P/$n.antes"; done 3< "$P/lista"
desfazer() { while IFS=$'\t' read -r n real <&3; do $SUDO cat "$P/$n.antes" | $SUDO tee "$real" > /dev/null; done 3< "$P/lista"; $SUDO nginx -t && $SUDO systemctl reload nginx; }
while IFS=$'\t' read -r n real <&3; do $SUDO tee "$real" < "$P/$n" > /dev/null; done 3< "$P/lista"
if $SUDO nginx -t; then :; else desfazer; parar "o nginx -t recusou. Voltei os arquivos; nada mudou."; fi
if $SUDO systemctl reload nginx; then sleep 3; else desfazer; parar "o Nginx não recarregou. Voltei os arquivos."; fi

passo "F3. vizinhos iguais e /banco/ fora"
fotografar "$T/vizinhos_f_depois.txt"
if diff "$T/vizinhos_f_antes.txt" "$T/vizinhos_f_depois.txt"; then echo "ok: /pedidos/, n8n e os outros endereços respondem igual"; else desfazer; parar "algum vizinho mudou (acima). Voltei o Nginx."; fi
echo "/banco/: $(codigo "$U/banco/")"
BANCO_DEPOIS="$(curl -sL -m 20 "$U/banco/" | sha256sum | cut -d' ' -f1 || true)"
if [ -s "$P/lista" ] && [ "$BANCO_ANTES" = "$BANCO_DEPOIS" ] && [ "$(codigo "$U/banco/")" = 200 ]; then parar "o /banco/ continua respondendo a mesma página. Veja à mão."; fi
marcar F
fi

# ==== G ========================================================================
if feita G; then echo "Fase G já feita. Atualização completa."; trap - ERR; exit 0; fi
passo "G1. ligar"
sim "FASE G: ligar o valida-api com a versão nova."
cd "$B"
pm2 start ecosystem.config.js --only valida-api --update-env > /dev/null
OK=0; for i in $(seq 1 40); do if [ "$(codigo "http://127.0.0.1:$PORTA/valida/api/v2/eu")" = 401 ]; then OK=1; break; fi; sleep 1; done
[ "$OK" = 1 ] || parar "o valida-api não respondeu. Veja: pm2 logs valida-api --lines 30 --nostream"
R="$(pm2info reinicios)"; sleep 15
[ "$(pm2info status)" = online ] && [ "$(pm2info reinicios)" = "$R" ] || parar "o valida-api está reiniciando sozinho."
C="$(pm2info conflitos)"; [ -z "$C" ] || parar "o pm2 guarda variáveis diferentes das do .env: $C"
echo "ok: online e estável"

passo "G2. conferências do 5.10"
igual() { if [ "$2" = "$3" ]; then echo "ok   $1: $2"; else parar "$1: esperado $3, veio $2"; fi; }
igual "/valida sem a barra" "$(curl -s -o /dev/null -m 20 -w '%{http_code} %{redirect_url}' "$U/valida")" "301 $U/valida/"
igual "/valida/" "$(codigo "$U/valida/")" 200
igual "API" "$(codigo "$U/valida/api/v2/eu")" 401
igual "piloto" "$(curl -s -m 20 "$U/valida/api/v2/config")" '{"piloto":true}'
curl -sI -m 20 "$U/valida/sw.js" > "$T/sw.txt"
grep -qi '^content-type:.*javascript' "$T/sw.txt" && grep -qi '^cache-control:.*no-cache' "$T/sw.txt" || parar "o service worker não veio certo."
echo "ok   service worker"
curl -s -m 20 "$U/valida/manifest.webmanifest" > "$T/manifest.txt"
grep -q '"start_url": "./"' "$T/manifest.txt" && grep -q '"scope": "./"' "$T/manifest.txt" || parar "o manifest não veio certo."
echo "ok   manifest"
curl -sI -m 20 "$U/valida/" > "$T/cab.txt"
grep -iE '^(strict-transport|permissions-policy|content-security|www-authenticate)' "$T/cab.txt" || echo "ok   nenhum cabeçalho que atrapalhe"
fotografar "$T/vizinhos_g.txt"
for x in "$U/pedidos/" "$N8N_URL"; do igual "$x" "$(grep -m1 -F "$x " "$T/vizinhos_g.txt")" "$(grep -m1 -F "$x " "$T/vizinhos_antes.txt")"; done
pm2 save > /dev/null; echo "ok   pm2 save"
marcar G
trap - ERR
echo; echo "✅ ATUALIZAÇÃO COMPLETA: $U/valida/"
echo "Falta, à mão: testes no celular (5.10), celulares da equipe, fechar a porta $PORTA no firewall, e guardar fora do servidor os backups de $BK."
