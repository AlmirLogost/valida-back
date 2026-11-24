# Como subir as mudanças em produção

Guia passo a passo, na **ordem exata**, pra levar pro servidor (Hostinger)
tudo que foi feito nas sub-etapas 1.1 até 1.6 (Etapa 1 completa). Rode os comandos um por um,
direto no terminal do servidor (via SSH), conferindo a saída de cada um antes
de ir pro próximo.

Troque `<caminho-do-projeto>` pelo caminho real da pasta no servidor, e
`<nome-do-processo>` pelo nome que o `pm2 list` mostrar pro back (provavelmente
`valida-back` ou parecido — se não souber, rode `pm2 list` primeiro).

---

## 0. Antes de tudo: backup do banco

**Nunca pule esse passo.** Se algo der errado, o backup é o que te traz de volta.

```bash
# No servidor, dentro de uma pasta de backups (fora da pasta do projeto)
pg_dump -U postgres -d valida_v2 -F c -f backup_antes_etapa_1_4_$(date +%Y%m%d_%H%M).dump
```

Confirme que o arquivo foi criado e tem tamanho razoável (não é um arquivo vazio):

```bash
ls -lh backup_antes_etapa_1_4_*.dump
```

Copie esse arquivo pra fora do servidor (seu Mac, um drive, etc.) antes de continuar —
um backup que mora só no mesmo servidor não protege contra o servidor inteiro falhar.

---

## 1. Conferir a variável JWT_SECRET

Desde a sub-etapa 1.2, o servidor **recusa iniciar** sem essa variável no `.env`.
Não preciso ver o valor — só confirme que a variável existe:

```bash
cd <caminho-do-projeto>/back
grep -q "^JWT_SECRET=" .env && echo "JWT_SECRET está definida" || echo "⚠️  JWT_SECRET NÃO está definida — pare aqui e configure antes de continuar"
```

Se aparecer o aviso, **pare e configure a variável antes de ir pro próximo passo** —
o `pm2 restart` do passo 7 vai falhar (o processo vai cair e não voltar) sem ela.

---

## 2. Buscar o código novo (sem builda nem reiniciar ainda)

```bash
cd <caminho-do-projeto>/back
git pull
cd ../front
git pull
```

Se aparecer qualquer coisa como "local changes would be overwritten" num dos dois,
**pare e me avise** — não force (`git checkout --` ou `git reset --hard`) sem confirmar
antes o que seria perdido.

---

## 3. Rodar as migrations do banco (SQL)

Todas usam `IF NOT EXISTS` — são seguras de rodar mesmo que alguma coluna já exista
(ex.: se foi criada manualmente antes). Rode as quatro, na ordem:

```bash
cd <caminho-do-projeto>/back
psql -U postgres -d valida_v2 -f migrations/001_planos_subscriptions.sql
psql -U postgres -d valida_v2 -f migrations/002_escopo_contas.sql
psql -U postgres -d valida_v2 -f migrations/003_cadastro_dono.sql
psql -U postgres -d valida_v2 -f migrations/004_minha_conta.sql
```

A 004 é só por segurança/consistência: no banco de produção essas colunas
(whatsapp, documento, email_cobranca, cep, endereco, cidade, estado) já foram
adicionadas à mão antes, então o `IF NOT EXISTS` não vai alterar nada — é
esperado que apareça "already exists, skipping" pra todas elas.

Cada comando deve terminar sem erro (pode aparecer `NOTICE` ou "already exists,
skipping" — isso é esperado e não é problema).

**Se a branch `reforma-acessos` já tiver sido mesclada na `main`** (confirme
com `git log --oneline -5` depois do `git pull` do passo 2 — vai aparecer
"middleware requirePermissao" ou "Acessos e Unidades" nos commits), rode
também as migrations 005 a 011, **na ordem, depois das quatro acima**:

```bash
cd <caminho-do-projeto>/back
psql -U postgres -d valida_v2 -f migrations/005_perfis_admin_id.sql
psql -U postgres -d valida_v2 -f migrations/006_perfil_permissoes.sql
psql -U postgres -d valida_v2 -f migrations/007_perfis_sistema.sql
psql -U postgres -d valida_v2 -f migrations/008_usuario_lojas.sql
psql -U postgres -d valida_v2 -f migrations/009_auditoria.sql
psql -U postgres -d valida_v2 -f migrations/010_arquivamento.sql
psql -U postgres -d valida_v2 -f migrations/011_corrige_matriz_perfis_sistema.sql
```

> **Mudou na Etapa 1:** `scripts/rodar_migrations.js` foi substituído por
> `scripts/migrar.js` (controle em `schema_migrations`, `up`/`down`,
> `--status`, `--dry-run`). O antigo agora se recusa a rodar. Em produção o
> novo só roda com `--producao --confirmar-banco=<DB_NAME>`. Passo a passo em
> `docs/valida/ETAPA_1_PARTE_1.md` (raiz do projeto).

```bash
cd <caminho-do-projeto>/back
node scripts/migrar.js --status
```

**Impacto pra quem já usa o sistema hoje (contas e colaboradores
existentes):**
- Ninguém perde acesso a nada. Toda loja/colaborador que já existia
  continua com exatamente o mesmo acesso que tinha (as migrations só
  preenchem dados novos a partir do que já existia — `admin_id` dos
  cargos personalizados vem do `loja_id` atual deles; `usuario_lojas`
  vem do `loja_id` de cada colaborador).
- Cargos personalizados que a conta já tinha continuam funcionando
  exatamente como antes (mesmas permissões, migradas das 8 colunas
  antigas pra matriz nova — mapeamento documentado dentro da migration
  006).
- Um gerente que hoje só acessa a própria loja continua só vendo a
  própria loja até alguém (o dono) vincular outras unidades a ele na
  tela Equipe/Acessos.
- Depois do deploy, toda ação de criar/editar/arquivar loja, colaborador
  ou cargo passa a exigir a permissão certa no cargo de quem está
  fazendo — o Dono nunca é afetado por isso.

---

## 4. Rodar a migração de PINs — ANTES de reiniciar o back

**Esse passo é obrigatório e a ordem importa.** A partir da 1.4, o login por PIN
compara com hash (bcrypt), não mais com texto puro. Enquanto o back antigo ainda
está rodando, os PINs no banco continuam em texto puro — então dá pra migrar
tranquilo, sem ninguém ficar impedido de logar no meio do caminho:

```bash
cd <caminho-do-projeto>/back
node scripts/migrar_pins_para_hash.js
```

O script mostra, antes de qualquer alteração, pra qual banco ele vai conectar —
confirme que é o de produção (`valida_v2` no host certo) antes de prosseguir, e
que a lista de usuários migrados faz sentido (deve aparecer um por colaborador
que já tem PIN configurado hoje).

Se esse passo não rodar antes do passo 7 (restart), todo colaborador que já tem
PIN configurado fica impedido de entrar até alguém rodar esse script depois —
ele não perde o PIN, só não consegue logar até a migração rodar.

---

## 5. Build do front

```bash
cd <caminho-do-projeto>/front
npm install
npm run build
```

Confirme que terminou com `✓ built` e sem erro. Isso gera a pasta `front/dist`
que o back serve direto (veja `back/server.js`).

---

## 6. Instalar dependências novas do back (se houver)

```bash
cd <caminho-do-projeto>/back
npm install
```

---

## 7. Reiniciar o back

```bash
pm2 restart <nome-do-processo>
pm2 logs <nome-do-processo> --lines 50
```

Olhe os logs por uns 10-15 segundos. Esperado:

```
✅ Conectado ao PostgreSQL
🔄 Carregando banco de dados...
✅ Banco de dados carregado
🚀 VALIDA na porta <porta>
```

Se aparecer `❌ Variável JWT_SECRET não configurada...` e o processo cair,
volte ao passo 1.

---

## 8. Testar na prática

- Abra o site no navegador, faça login como dono normalmente.
- Teste o login de um funcionário que **já existia antes** (o colaborador
  digita o **nome dele**, exatamente como já fazia, + o PIN de sempre) — isso
  continua funcionando pelo fallback explicado no passo 9, mesmo que ele ainda
  não tenha celular cadastrado.
- Crie um colaborador novo de teste (celular + PIN) e confirme que ele consegue
  entrar numa aba anônima **usando o celular**.
- Erre o PIN 5 vezes de propósito (celular ou nome) — a 6ª tentativa deve dizer
  "Muitas tentativas..." mesmo acertando o PIN.
- Abra a tela **Minha Conta**, confirme que os dados carregam (era o bug do
  `/api/me` corrigido na 1.6) e teste a troca de senha (senha atual + nova,
  mínimo 8 caracteres) — depois confirme que a senha antiga deixou de
  funcionar e a nova funciona.
- Numa conta de teste com trial vencido, suspensa ou cancelada: confirme que
  login e leitura continuam funcionando (inclusive "Meu plano"), mas criar,
  editar ou apagar algo mostra a mensagem de modo somente leitura.
- **Se a Reforma de Acessos já foi mesclada**: entre como dono, confira que o
  menu lateral continua mostrando tudo (Hoje/Unidades/Equipe/Acessos/
  Relatórios/Configurações) e que o seletor de unidade mostra a bolinha de
  status certa. Entre com um colaborador comum (operador/gerente) e confirme
  que o menu dele mostra só o que faz sentido pro cargo.

Se tudo isso funcionar, o deploy foi bem-sucedido.

**Sobre o admin de exemplo (`admin@valida.app`)**: a partir da 1.6, o
`seed.js` não cria mais esse usuário com senha fixa. Isso não afeta o admin
que já existe em produção (o `ON CONFLICT DO NOTHING` nunca alterou essa
linha) — é só pra garantir que nenhum ambiente novo nasça com uma senha
conhecida. Se um dia precisar trocar a senha de uma conta direto no banco
(ex.: esqueceu a senha e não tem acesso ao e-mail de recuperação), use
`node scripts/redefinir_senha.js` — mas esse script é **só para o banco
local**, nunca para produção.

---

## 9. Depois do deploy: completar os celulares e desligar o fallback por nome

Os colaboradores que já existiam antes da 1.4 (hoje, uns 20) não têm celular
cadastrado. Pra eles não ficarem impedidos de entrar no dia do deploy, existe
um fallback temporário: **enquanto alguém não tiver celular cadastrado, continua
entrando pelo nome** (exatamente como sempre fez), em vez de pelo celular.

Isso é temporário e tem um limite de segurança: se dois colaboradores sem
celular (em contas diferentes, por exemplo) tiverem o mesmo nome, o login por
nome é **recusado** pros dois — ninguém entra na conta errada, mas também
ninguém com nome duplicado consegue usar o fallback. Essas pessoas precisam do
celular cadastrado o quanto antes.

**O que fazer:**

1. Abra a tela **Equipe** logado como dono. Se aparecer o aviso amarelo
   "N colaborador(es) sem celular cadastrado", edite cada um (botão de editar
   colaborador) e preencha o campo Celular. O aviso lista os nomes e some
   sozinho quando não faltar mais ninguém.
2. Depois que TODOS tiverem celular cadastrado (aviso sumiu da tela Equipe),
   desligue o fallback — ele não é mais necessário e reduz a superfície de
   ataque (volta a exigir celular pra todo mundo, sem exceção):
   ```bash
   # No .env do servidor, adicione ou altere a linha:
   LOGIN_POR_NOME=false
   ```
   E reinicie o back:
   ```bash
   pm2 restart <nome-do-processo>
   ```
3. Confirme que o login por nome (sem celular) passa a ser recusado e que
   todo mundo com celular cadastrado continua entrando normalmente.

Não tem pressa de fazer isso no mesmo dia do deploy — o fallback é seguro de
deixar ligado por alguns dias enquanto os celulares vão sendo completados. O
importante é não deixar ligado indefinidamente.

---

## Como voltar atrás se algo der errado

A ordem de reversão é o passo a passo acima, de trás para frente:

1. **Parar o processo novo** (se estiver travando/reiniciando sem parar):
   ```bash
   pm2 stop <nome-do-processo>
   ```

2. **Voltar o código pra versão anterior** (nos dois repositórios):
   ```bash
   cd <caminho-do-projeto>/back
   git log --oneline -10        # ache o commit de ANTES do deploy de hoje
   git checkout <hash-do-commit-anterior>
   cd ../front
   git log --oneline -10
   git checkout <hash-do-commit-anterior>
   npm run build
   ```

3. **Restaurar o banco do backup**, só se as migrations tiverem causado algum
   problema real nos dados (normalmente não precisa — as migrations só
   adicionam coluna, não apagam nada):
   ```bash
   # CUIDADO: isso substitui o banco atual pelo backup. Só faça isso se tiver
   # certeza que é necessário, e nunca sem reler o que vai perder desde o backup.
   pg_restore -U postgres -d valida_v2 --clean backup_antes_etapa_1_4_AAAAMMDD_HHMM.dump
   ```

4. **Religar o processo com o código antigo**:
   ```bash
   cd <caminho-do-projeto>/back
   pm2 restart <nome-do-processo>
   ```

5. Me avise o que deu errado antes de tentar o deploy de novo — vamos entender
   a causa antes de repetir.

**Importante sobre o PIN em texto puro**: se você reverter o código do back
para antes da 1.4 DEPOIS de já ter rodado `migrar_pins_para_hash.js`, os PINs
vão estar em hash mas o código antigo vai tentar comparar texto puro — ou seja,
login por PIN para de funcionar até você também desfazer esse passo. Nesse
caso específico, restaurar o backup do banco (passo 3 acima) é a forma mais
simples de desfazer, já que não existe um "desfazer hash" automático.

**Sobre reverter a Reforma de Acessos (migrations 005-011) especificamente**:
diferente do PIN, aqui não tem esse tipo de problema — as migrations só
ADICIONAM colunas e tabelas novas (`admin_id`, `perfil_permissoes`,
`usuario_lojas`, `auditoria`, `arquivado_em`/`arquivado_por`), nunca apagam
nem alteram nada que já existia. Se precisar voltar o CÓDIGO pra antes da
reforma (passo 2 acima) mas deixar essas colunas/tabelas no banco, não há
problema algum — o código antigo simplesmente não usa elas, e nada quebra.
Só restaure o backup (passo 3) se notar dados incorretos de verdade, não só
por precaução.
