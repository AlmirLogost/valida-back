# Como subir as mudanças em produção

Guia passo a passo, na **ordem exata**, pra levar pro servidor (Hostinger)
tudo que foi feito nas sub-etapas 1.1 até 1.4. Rode os comandos um por um,
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
(ex.: se foi criada manualmente antes). Rode as três, na ordem:

```bash
cd <caminho-do-projeto>/back
psql -U postgres -d valida_v2 -f migrations/001_planos_subscriptions.sql
psql -U postgres -d valida_v2 -f migrations/002_escopo_contas.sql
psql -U postgres -d valida_v2 -f migrations/003_cadastro_dono.sql
```

Cada comando deve terminar sem erro (pode aparecer `NOTICE` ou "already exists,
skipping" — isso é esperado e não é problema).

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
- Teste o login de um funcionário que **já existia antes** (celular + PIN que
  ele já usava) — deve continuar funcionando normalmente.
- Crie um colaborador novo de teste (celular + PIN) e confirme que ele consegue
  entrar numa aba anônima.
- Erre o PIN 5 vezes de propósito com um celular de teste — a 6ª tentativa deve
  dizer "Muitas tentativas..." mesmo acertando o PIN.

Se tudo isso funcionar, o deploy foi bem-sucedido.

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
