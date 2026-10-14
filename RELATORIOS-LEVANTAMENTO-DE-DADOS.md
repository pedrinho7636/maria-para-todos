# Relatórios — levantamento dos dados que o Portal da Maria já gera

Levantamento feito em 14/10/2026 sobre o banco (`banco-schema.sql` + migrações de `api/src/db.js`) e as rotas da API,
separado nas três categorias da aba **Relatórios**: **Agenda**, **Financeiro** e **Satisfação**.
Serve de base pra decidir o que cada relatório vai mostrar e o que ainda precisa ser capturado antes.

Legenda: ✅ já gravado e fácil de somar · 🟡 dá pra calcular com o que existe (precisa de consulta nova) · ❌ não é capturado hoje.

---

## 0. Regras de contagem (valem pra todos os relatórios)

| Situação do atendimento | Conta como atendimento? | Conta como receita/repasse? |
|---|---|---|
| `pedido`, `proposto`, `aceito`, `recusado` (programados) | **Sim** — "programado" | Não (é *previsto*) |
| `concluido` (o sistema conclui sozinho quando o horário de término passa) | **Sim** | **Sim** (receita; repasse se tem custo) |
| `cancelado` | **Não** | Não |
| `falta` (a prestadora não foi) | **Não** | **Não** |
| "em andamento" | não é status gravado: é `aceito` entre início e término (calculado na hora) | Não (ainda) |

- Fuso: tudo em **horário de Brasília** (as datas do sistema são datas locais).
- **Falta é controle interno da franquia**: a prestadora nunca vê a marca, nem a meta de faltas (tabela à parte `controle_prestadora`).
- Faltas e metas **nunca** devem aparecer em relatório que a prestadora possa abrir.

---

## 1. AGENDA

### 1.1 O que cada atendimento guarda hoje (`atendimentos`)

| Dado | Campo | Obs. |
|---|---|---|
| Quando | `data_atendimento`, `hora_atendimento`, `duracao_horas` | ✅ sem horário vale o dia todo; sem duração vale 1 h |
| Onde / o quê | `unidade_id`, `area`, `tipo_servico` | ✅ `tipo_servico` é texto livre (variações viram categorias diferentes) |
| Quem | `cliente_id`, `prestadora_id`, `profissional_externo` | ✅ `profissional_externo` = nome da planilha que ainda não casou com uma prestadora |
| Situação | `status` (`pedido, proposto, recusado, aceito, concluido, cancelado, falta`) | ✅ só o status *atual* |
| Origem | `origem` (`site, whatsapp, manual, importacao`) | ✅ |
| Série semanal | `serie_id`, `valor_mensal` | ✅ agrupa as ocorrências geradas juntas |
| Planilha | `codigo_externo` (Número), `orcamento_externo` (Orçamento) | ✅ |
| Controle | `situacao_manual`, `criado_em`, `atualizado_em` | ✅ |

### 1.2 Tabelas de apoio já existentes
- `recusas_atendimento` (atendimento, prestadora, **quando recusou**) — ✅ histórico completo de recusas desde a versão com recusas (as anteriores não foram registradas).
- `avisos_prestadora` (cancelamentos avisados, `criado_em`, `lido_em`) — ✅ dá pra medir quanto tempo a prestadora leva pra ler um aviso.
- `controle_prestadora` (meta de faltas aceitável por prestadora).

### 1.3 Indicadores possíveis

| Indicador | Situação | De onde sai |
|---|---|---|
| Atendimentos por dia/semana/mês (programados + concluídos) | ✅ | `count(*)` por `data_atendimento`, status fora de cancelado/falta (a tela já faz por dia: `agenda/resumo-mensal`) |
| Atendimentos por tipo de serviço / bairro (`area`) / cliente | ✅ | `group by tipo_servico / area / cliente_id` |
| Horas agendadas e **horas realizadas** | 🟡 | `sum(duracao_horas)` (usar 1 h onde nulo) por status |
| Ocupação por horário (mapa de calor dia × hora) | 🟡 | `hora_atendimento` + `duracao_horas` |
| Ocupação/produtividade por prestadora | 🟡 | atendimentos e horas por `prestadora_id`; já existe `total_atendimentos` na Equipe |
| Funil: pedido → proposto → aceito → concluído | 🟡 | só *estado atual* (não há histórico de transições) |
| Taxa de recusa de convites | ✅ | `recusas_atendimento` ÷ convites (convite = `proposto` + recusados + aceitos do período) |
| Taxa de **cancelamento** | 🟡 | `status = cancelado` ÷ total; **sem data nem motivo do cancelamento** (só `atualizado_em`) |
| Taxa de **faltas** por prestadora vs meta | ✅ | `faltas ÷ (concluídos + faltas)` — já calculada na Equipe com `faltas_aceitavel_pct` |
| Conflitos de horário por prestadora | 🟡 | sobreposição de intervalos (a regra já existe em `utils/conflitos.js`) |
| Atendimentos sem prestadora / convites vencidos | 🟡 | `pedido`/`proposto` com data passada (o Financeiro já mostra `convites_vencidos`) |
| Origem dos pedidos (site × WhatsApp × manual × planilha) | ✅ | `group by origem` |
| Recorrentes × avulsos | ✅ | `serie_id is not null` |
| Clientes novos × recorrentes | 🟡 | `clientes.criado_em` e contagem de atendimentos por cliente |
| **Tempo de resposta** da prestadora a um convite | ❌ | falta gravar `proposto_em` e `aceito_em` |
| **Quando** cada mudança de status aconteceu / quem fez | ❌ | não há histórico de status (log de auditoria) |
| Motivo de cancelamento / quem cancelou | ❌ | não é perguntado nem gravado |

### 1.4 Ressalvas de qualidade
- Dados importados da planilha trazem `profissional_externo` para quem não tem cadastro → relatórios por prestadora só enxergam quem já foi cadastrada/ligada.
- `tipo_servico` livre: vale normalizar (ou criar catálogo) antes de relatório por serviço.
- Atendimento criado no passado por importação entra com status da planilha (concluído/previsto), sem histórico de aceite.

---

## 2. FINANCEIRO

### 2.1 O que existe hoje
| Dado | Campo | Obs. |
|---|---|---|
| **Receita** (o que o cliente paga) | `atendimentos.valor` | ✅ unitário, ou dividido do valor mensal em séries (`valor_mensal` guarda o total do mês) |
| **Custo / repasse** (o que a franquia paga à prestadora) | `atendimentos.valor_prestadora` (travado no aceite/conclusão/pagamento); senão `prestadoras.valor_por_atendimento` | ✅ |
| Repasse pago? quando? | `atendimentos.repasse_pago_em` | ✅ pagamento por prestadora/mês |
| Tarifa atual por prestadora | `prestadoras.valor_por_atendimento` | ✅ |
| Data do serviço | `data_atendimento` | ✅ base do "mês" nos relatórios |

### 2.2 O que o sistema já calcula (`api/src/utils/financeiro.js`, rota `GET /financeiro/:slug/resumo?mes=AAAA-MM`)
- Realizado (concluídos): quantidade, **receita, custo, margem (R$ e %)** — margem só nos atendimentos com valor **e** custo.
- Previsto (pedido/convite/aceito de hoje em diante) com alertas (sem prestadora, sem valor).
- **Por serviço**, **por cliente (top 10)**, **por prestadora** (a pagar, pago, pendente, sem custo).
- Alertas e pendências (concluído sem valor, sem custo, convites vencidos, repasses pendentes).
- Comparativo com o mês anterior (receita, custo, margem). CSV do repasse por prestadora.
- Faturamento do mês (concluídos) no painel inicial.

### 2.3 Indicadores possíveis

| Indicador | Situação |
|---|---|
| Receita, custo, margem por mês / serviço / cliente / prestadora / unidade | ✅ (já existe no mês; falta série histórica e comparativo de vários meses) |
| Ticket médio (receita ÷ atendimentos) | 🟡 |
| Receita por hora trabalhada | 🟡 (`valor` ÷ `duracao_horas`) |
| Evolução mensal (12 meses) e sazonalidade | 🟡 |
| Receita prevista × realizada | ✅ (previsto/realizado do mês) |
| Repasses a pagar × pagos por período | ✅ |
| Receita **perdida**: cancelados e faltas com valor cadastrado | 🟡 (`status in (cancelado, falta)` somando `valor`) |
| Consolidado da empresa (várias unidades do mesmo CNPJ) | 🟡 (somar por CNPJ) |
| **Recebimento do cliente** (pago / em aberto / atrasado) | ❌ não existe (só se sabe o valor, não se foi pago) |
| Despesas da franquia (fixas, impostos, comissão) | ❌ |
| Forma de pagamento / nota fiscal | ❌ |
| Custo quando a planilha não traz repasse | 🟡 usa a tarifa atual da prestadora (pode mudar com o tempo; o valor trava ao aceitar) |

### 2.4 Ressalvas
- A planilha da franquia traz **Valor (R$)** mas **não o custo**; sem tarifa definida na Equipe o atendimento fica "sem custo" e fora da margem.
- Falta **não** gera receita nem repasse (decisão adotada nesta versão — confirmar com o cliente).

---

## 3. SATISFAÇÃO

### 3.1 O que existe hoje (`avaliacoes`)
| Dado | Campo |
|---|---|
| Nota 1 a 5, comentário | `nota`, `comentario` |
| Quem avaliou / quem foi avaliada / qual atendimento | `cliente_id`, `prestadora_id`, `atendimento_id` |
| Moderação | `status` (`pendente, aprovada, recusada`), `moderado_por`, `moderado_em`, `criado_em` |

Fluxo: só atendimento **concluído** pode ser avaliado → entra `pendente` → a unidade aprova/recusa → só a **aprovada** chega à prestadora.

### 3.2 O que o sistema já calcula
- `nps_medio` do painel = **média das notas aprovadas** da unidade (⚠ não é NPS de verdade, é nota média).
- `nota_media` por prestadora na Equipe (média das notas aprovadas) e média/total na área da prestadora.
- Contagem de avaliações pendentes de moderação (selo na tela).

### 3.3 Indicadores possíveis

| Indicador | Situação |
|---|---|
| Nota média por prestadora / serviço / unidade / período | ✅/🟡 |
| Distribuição de notas (1–5) e evolução mensal | 🟡 |
| Taxa de resposta (avaliações ÷ concluídos) | 🟡 |
| Tempo até avaliar (`avaliacoes.criado_em` − fim do atendimento) | 🟡 |
| Tempo de moderação (`moderado_em` − `criado_em`) e taxa de aprovação/recusa | ✅ |
| Comentários (nuvem de palavras / lista dos piores) | 🟡 |
| Qualidade operacional: **faltas**, **recusas**, **cancelamentos** por prestadora | ✅/🟡 (faltas e recusas já gravadas) |
| Ranking de prestadoras (nota + faltas + pontualidade) | 🟡 |
| **NPS de verdade** (pergunta "indicaria?" 0–10) | ❌ |
| Avaliação por critério (pontualidade, limpeza, atendimento) | ❌ |
| Reclamações / ocorrências registradas | ❌ |
| Avaliação da unidade/serviço (não só da prestadora) | ❌ |

### 3.4 Ressalvas
- Só avaliações **aprovadas** devem entrar em relatórios exibidos à prestadora; as pendentes/recusadas são interno da franquia.
- Poucas avaliações por prestadora → média instável (mostrar o total junto).

---

## 4. Lacunas a resolver antes (ou junto) dos relatórios

Em ordem de valor / esforço:

1. **Histórico de status** (`atendimento_eventos`: atendimento, status anterior → novo, quando, quem). Destrava funil, tempo de resposta, motivo/data de cancelamento e auditoria.
2. **Motivo do cancelamento** (e quem cancelou: cliente pediu / franquia / prestadora).
3. **Catálogo de serviços** (normalizar `tipo_servico`).
4. **Recebimento do cliente** (pago/em aberto) — sem isso o Financeiro é "competência", não "caixa".
5. **NPS real** (0–10) e/ou critérios na avaliação.
6. `proposto_em` / `aceito_em` (se não fizer o histórico completo).
7. Custo por atendimento vindo da planilha (o cliente vai verificar se consegue exportar).

## 5. Perguntas de negócio pra fechar com o cliente
- Falta gera **desconto/repasse zero** (adotado) ou há outra regra? Aparece como receita perdida?
- "Mês" dos relatórios = mês do **serviço** (adotado) ou do **pagamento**?
- A meta de faltas é só alerta ou deve bloquear/suspender a prestadora?
- Relatório por **empresa** (todas as unidades do CNPJ) ou sempre por unidade?
- Quem vê o quê: administrador completo × funcionário (já há permissão `Financeiro`; faltaria `Relatórios`?).
- Prestadora vê algum relatório dela (nota média, atendimentos, ganhos)? (já vê resumo de ganhos e avaliações aprovadas)

## 6. Onde isso aparece hoje na interface
- **Visão geral:** atendimentos hoje, profissionais escalados, faturamento do mês, nota média.
- **Agenda:** calendário com pontos por dia, linha do tempo do dia, situação/recusas/faltas no balão.
- **Equipe:** atendimentos e nota por prestadora, tarifa, faltas × meta.
- **Financeiro:** receita/custo/margem, repasses, pendências, CSV.
- **Avaliações:** moderação.
- **Relatórios:** atalho ainda "em breve".
