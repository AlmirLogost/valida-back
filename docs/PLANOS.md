# Planos — proposta para decisão (Passo 6 da Reforma de Acessos)

**Isto é uma proposta, não uma mudança já feita.** Nenhum preço ou limite
dos planos atuais foi alterado no código — essa decisão é sua. Este
documento existe pra você decidir com calma, com os números de hoje ao
lado pra comparar.

## O que existe hoje (sem alterações)

| Plano | Preço/mês | Lojas | Usuários | Tarefas ativas | Comissões |
|---|---|---|---|---|---|
| Essencial | R$ 197 | 1 | 10 | ilimitado | Não |
| Profissional | R$ 397 | 5 | 30 | ilimitado | Sim |
| Franquia | R$ 897 | ilimitado | ilimitado | ilimitado | Sim |

Trial: 14 dias, sem pedir cartão — já funciona assim hoje, mantido na
proposta.

## O que mudou no sistema que afeta os planos

A Reforma de Acessos trouxe **cargos personalizados com matriz de
permissões** (tela Acessos) e **gerente com várias unidades**
(usuario_lojas). Isso é um recurso novo que pode ou não entrar em todo
plano — essa é a primeira decisão que este documento propõe.

## Proposta 1 — recursos por plano (incluindo perfis personalizados)

| Recurso | Essencial | Profissional | Franquia |
|---|---|---|---|
| Cargos de sistema (Dono/Gerente/Fiscal/Operador) | Sim | Sim | Sim |
| **Cargos personalizados (tela Acessos)** | Não | Sim | Sim |
| Gerente com várias unidades | — (só 1 unidade no plano) | Sim | Sim |
| Comissões | Não | Sim | Sim |
| Relatórios/Conferência | Sim | Sim | Sim |

Raciocínio: quem está no plano de 1 loja não tem necessidade prática de
cargos personalizados multi-unidade; oferecer isso só a partir do
Profissional dá um motivo claro de upgrade sem tirar nada de quem já
usa o Essencial hoje.

## Proposta 2 — limites por unidades e usuários

Mantendo a mesma lógica de hoje (loja/usuário/tarefa), só reorganizando
os números pra refletir que agora uma loja pode ter mais de um gerente
vinculado:

| Plano | Lojas | Usuários por loja (sugestão) | Usuários totais |
|---|---|---|---|
| Essencial | 1 | até 10 | 10 (igual hoje) |
| Profissional | 5 | até 10 | 30 → **sugestão: 50** (5 lojas × 10) |
| Franquia | ilimitado | ilimitado | ilimitado (igual hoje) |

O "30" atual do Profissional fica meio apertado se 5 lojas tiverem
equipes de verdade (10 pessoas por loja já dá 50). Isso é só uma
sugestão de número — ajuste como fizer sentido pro seu custo.

## Proposta 3 — redes: base + valor por unidade extra

Hoje o Franquia é "ilimitado" por um preço fixo (R$ 897), o que não
escala bem pra uma rede de 20 lojas vs. uma de 6. Proposta de um modelo
alternativo pra redes grandes, **sem remover o Franquia atual**:

- **Franquia Base**: R$ 897/mês, inclui até 10 lojas.
- **+ Unidade extra**: R$ 69/mês por loja acima de 10.

Exemplo: uma rede com 15 lojas pagaria R$ 897 + 5×R$69 = R$ 1.242/mês,
em vez de pagar o mesmo que uma rede de 11 lojas.

Isso exige um campo novo (algo como `preco_por_unidade_extra` no plano,
e contar lojas ativas na cobrança) — não implementado ainda, é só a
proposta de desenho pra quando você decidir seguir com isso.

## Proposta 4 — desconto anual

Sugestão simples: **2 meses grátis pagando o ano à vista** (equivalente
a ~17% de desconto), mesmo percentual nos 3 planos:

| Plano | Mensal | Anual (10x o valor mensal) | Economia |
|---|---|---|---|
| Essencial | R$ 197/mês | R$ 1.970/ano | R$ 394 |
| Profissional | R$ 397/mês | R$ 3.970/ano | R$ 794 |
| Franquia | R$ 897/mês | R$ 8.970/ano | R$ 1.794 |

Exige guardar o período de cobrança (mensal/anual) na subscription —
hoje a tabela não distingue isso.

## Ponto de integração para pagamento

O sistema hoje já tem o esqueleto pra isso, mas incompleto:

- `subscriptions.gateway_customer_id` / `gateway_subscription_id` — já
  existem, prontos pra guardar o ID de um cliente/assinatura num
  gateway (ex.: Asaas, que já aparece mencionado em
  `subscriptionController.webhookAsaas`).
- O webhook `/webhooks/asaas` já existe e já trata dois eventos:
  confirmação de pagamento (reativa a assinatura) e cancelamento. **Não
  testado neste passo** (precisaria de uma conta de teste no gateway,
  fora do escopo de "banco local").
- **Falta**: a tela de checkout/cobrança em si (hoje não existe nenhum
  fluxo de "inserir cartão" ou redirecionar pro gateway) e o botão
  "Fazer upgrade" na tela Assinatura hoje não leva a lugar nenhum
  (é só visual).

Quando for integrar de verdade, o próximo passo natural é: escolher o
gateway definitivo, criar a cobrança no provedor ao assinar/trocar de
plano, e usar o webhook que já existe pra manter o status sincronizado.

## O que NÃO foi alterado neste passo

- Preços dos 3 planos (R$ 197 / R$ 397 / R$ 897).
- Limites de lojas/usuários/tarefas de cada plano.
- A regra de trial de 14 dias sem cartão.

Tudo isso continua exatamente como estava — as propostas acima são
material de decisão, não mudanças aplicadas.
