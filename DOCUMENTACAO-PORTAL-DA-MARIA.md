# Documentação técnica — Portal da Maria (versão 0.0.0.0)

> Este documento nasceu da engenharia reversa de um protótipo estático sem backend (v0.0.3). O sistema real hoje
> (versão 0.0.0.0) tem persistência de verdade: frontend em arquivo único (`Portal Da Maria.html`) conversando com
> uma API própria em Node/Express (`api/`), que fala com um PostgreSQL local — nada aqui é mockado ou simulado,
> exceto onde explicitamente marcado (envio de e-mail no cadastro de admin, e a API oficial de WhatsApp Business,
> ambos pausados/fora de escopo — ver seção 7 e `LEIA-ME.md`). As seções abaixo foram atualizadas pra refletir esse
> estado real; a tabela de rastreabilidade tela → tabela (seção 6) continua sendo a referência mais útil pra quem
> for mexer no código.

---

## 1. Visão geral

O frontend é um **SPA de arquivo único**: todas as "telas" são `<section class="screen">` dentro do mesmo HTML,
alternadas via JavaScript (função `show(id)`). Diferente do protótipo original, todo o estado (agenda, convites,
avaliações, clientes) vem de requisições reais (`fetch`) pra API em `api/`, que por sua vez lê/grava num PostgreSQL
local — recarregar a página perde só o estado de navegação (tela atual), não os dados, que continuam no banco.
Sessão via JWT (7 dias) guardado em `localStorage`; tema (dark/light) também em `localStorage`.

**Tipos de usuário reais:** administrador (franqueado), sub-administrador (funcionário com permissão por módulo),
prestadora, cliente.
**Unidades:** Carazinho/RS e Panambi/RS, com dados segmentados por unidade no banco (`unidade_id`).

---

## 2. Mapeamento de telas

| ID da seção | Tela | Acesso |
|---|---|---|
| `#screen-home` | Página pública (institucional) | Todos |
| `#screen-login` | Login unificado (3 perfis) | Todos |
| `#screen-cadastro` | Cadastro (admin/prestadora/cliente, todos verificados por e-mail) | Todos |
| `#screen-franqueado` | Painel do administrador | Administrador |
| `#screen-prestadora` | Painel da prestadora | Prestadora |
| `#screen-cliente` | Área do cliente | Cliente |

### 2.1 `#screen-home` — Página pública
- Seletor de região (modal `#region-modal`) que troca todo o conteúdo dinâmico entre Carazinho e Panambi via `setRegiao(key)`, com os dados vindos de `GET /api/unidades` (público, sem login).
- Seções: hero, `#funcionalidades`, `#servicos` (links para páginas oficiais da Maria Brasileira), `#contato` (formulário de pedido de orçamento).
- Formulário de contato chama `enviarPedido(viaWhats)` — grava de verdade via `POST /api/atendimentos` (status inicial `'pedido'`); se `viaWhats`, também abre um link `wa.me` pro telefone da unidade com os dados do pedido já escritos (ver seção 7, item 6).

### 2.2 `#screen-login`
- Seleção de perfil (`setProfile`) entre `franqueado`, `prestadora`, `cliente`.
- `doLogin()` chama `POST /api/auth/login` de verdade — a API confere a senha com bcrypt contra o hash salvo no Postgres e devolve um JWT (7 dias). Login de administrador tenta `administradores` e, se não achar, `sub_administradores` (mesma tela serve pros dois perfis).
- **"Esqueci a senha"** (`abrirRecuperar()`): abre um modal em duas etapas. `POST /api/auth/recuperar-senha` manda um código de 6 dígitos pro e-mail cadastrado da conta (resposta sempre igual, exista a conta ou não); `POST /api/auth/recuperar-senha/confirmar` troca a senha com o código e a tela já entra com a senha nova. O código fica em `codigos_verificacao` sob a chave `recuperar:perfil:e-mail`; limites por conta (5 pedidos / 8 erros em 15 min).

### 2.3 `#screen-cadastro`
Os 3 perfis (`setCadProfile`) seguem o mesmo padrão de duas etapas — nada é criado até o e-mail ser confirmado, já
que não existe API de WhatsApp de verdade e a identidade só pode ser verificada por e-mail:
- **Administrador:** `POST /api/auth/cadastro/admin` valida os CNPJs informados e manda um código de 6 dígitos pro
  e-mail (hoje enviado de verdade via Resend, se `RESEND_API_KEY` estiver configurada — senão cai no console da
  API, ver seção 7); a conta só é criada em `POST /api/auth/cadastro/admin/confirmar`. CNPJ sozinho nunca cria a
  conta.
- **Prestadora:** `POST /api/auth/cadastro/prestadora` (nome, telefone, e-mail, senha, unidade) manda o código pro
  e-mail informado; `.../confirmar` cria a conta. Telefone continua sendo o login, mas quem confirma a identidade
  no cadastro agora é sempre o e-mail.
- **Cliente:** mesmo padrão em `POST /api/auth/cadastro/cliente` / `.../confirmar` — evita que um e-mail digitado
  errado trave o próprio login depois (e-mail é o identificador do cliente).
- `enviarCodigo(ctx)`/`confirmarCodigo(ctx)` no frontend cobrem os 3 fluxos; `doCadastro()` só existe pra redirecionar
  quem já confirmou de volta ao login (a conta já foi criada no passo de confirmação).

### 2.4 `#screen-franqueado` — Painel do administrador
Navegação interna via `adminView(name)`, com sub-telas (`.adminview`) — cada uma só aparece se o usuário logado
(admin completo ou sub-administrador) tiver permissão pro módulo correspondente:

| Sub-tela | Função de render | Fonte de dados |
|---|---|---|
| Visão geral | `carregarUnidadeAdmin()` | `GET /unidades/:slug/admin/dashboard` (view `vw_dashboard_unidade`) |
| Agenda | `renderAgendaAdmin()` | `GET /atendimentos/admin/:slug/agenda` (calendário + linha do tempo do dia; o balão do atendimento troca prestadora e edita local e valor — `PATCH .../:id/local` e `.../:id/valor`; recorrência semanal com "valor do mês inteiro" dividido pelas ocorrências de cada mês, ver `api/src/utils/recorrencia.js`) |
| Equipe | `renderEquipe()` | `GET /unidades/:slug/admin/equipe` (view `vw_equipe_unidade` + `prestadoras.valor_por_atendimento`); `PATCH /unidades/:slug/admin/equipe/:prestadoraId` define quanto a franquia paga por atendimento (só admin completo) |
| Financeiro | `renderFinanceiro()` | `GET /financeiro/:slug/resumo?mes=` (receita, custo, margem, previsto, repasses por prestadora, margem por serviço, maiores clientes, pendências), `GET .../repasses/:prestadoraId?mes=` (folha do mês, base do CSV) e `POST .../repasses/:prestadoraId/pagar` (marca/desfaz o pagamento do mês). Módulo `financeiro` (admin completo ou funcionário com `pode_financeiro`). Cálculo em `api/src/utils/financeiro.js` |
| Clientes | `renderClientes()` | `GET /unidades/:slug/admin/clientes` (view `vw_clientes_unidade`) |
| Avaliações | `renderAvaliacoesAdmin()` | `GET /avaliacoes/admin/:slug` (moderação) |
| Acessos | `renderSubadmins()` | `GET /sub-administradores/:slug` — CRUD de sub-administradores (funcionários da unidade). Telefone de WhatsApp e **endereço** da unidade ficam em **Meu perfil → Dados da unidade** (`PATCH /unidades/:slug/telefone` e `/endereco`; só admin completo, nunca delegável; endereço vazio some do site) |

Alternância de unidade (Carazinho/Panambi) via `setUnit(key)`, que recarrega os dados da unidade escolhida.

**Moderação de avaliações:** `aprovarAval(id)`/`recusarAval(id)` chamam `POST /avaliacoes/admin/:slug/:id/aprovar|recusar`, que alteram `status` de `pendente` para `aprovada`/`recusada` no banco. Só avaliações aprovadas chegam à prestadora.

### 2.5 `#screen-prestadora` — Painel da prestadora
- `renderPrestadora()` desenha dois blocos, ambos vindos da API:
  - **Convites pendentes** (`GET /atendimentos/prestadora/me/convites`): `aceitar(id)` chama `POST .../:id/aceitar` (só permitido a partir de 2 dias antes do atendimento) e dispara um aviso por WhatsApp pra unidade; `recusar(id)` chama `POST .../:id/recusar`.
  - **Agenda aceita** (`GET /atendimentos/prestadora/me/agenda`): só os atendimentos já confirmados — reflete a regra "prestadora só vê o que foi aceito".
- Valores: convites e agenda trazem `valor_pago` (o que a franquia paga a ela; nunca o `valor` cobrado do cliente). Os cartões "Previsto na semana" e "A receber no mês" vêm de `GET /atendimentos/prestadora/me/resumo` (calculado na API). A tarifa fica travada em `atendimentos.valor_prestadora` no aceite.
- Local (`area`) do atendimento só aparece quando preenchido; o admin edita no balão da agenda (`PATCH /atendimentos/admin/:slug/:id/local`).
- Calendário próprio (`renderCalendarioPrestadora`) com os próximos atendimentos por dia.
- `renderPrestAval()`: nota média, total de avaliações, destaque das 3 mais recentes aprovadas + histórico das demais.

### 2.6 `#screen-cliente` — Área do cliente
- `renderClienteAval()`: lista atendimentos concluídos (`GET /atendimentos/cliente/me/pendentes-avaliacao`) aguardando avaliação, com seleção de estrelas (`setStar`) e comentário livre.
- `enviarAvaliacao(id)`: grava via `POST /api/avaliacoes` com `status: 'pendente'` (vai para moderação do admin).

---

## 3. Variáveis JS no frontend e de onde vêm os dados

As variáveis abaixo continuam existindo no frontend (é nelas que a página guarda o que já buscou da API pra
renderizar sem refazer a requisição a cada clique), mas hoje são **cache local de dados reais**, não mocks —
recarregadas via `fetch` sempre que a tela relevante é aberta ou uma ação muda algo no banco.

| Variável JS | Descrição | Populada por |
|---|---|---|
| `cidades` | Metadados institucionais das 2 unidades (nome, UF, telefone, endereço) | `carregarDadosPublicos()` ← `GET /unidades` |
| `unidades` | Dados do painel admin por unidade (dashboard, agenda) | `carregarUnidadeAdmin()` |
| `prestadora` | Prestadora logada (id, nome, unidade) | `doLogin()` |
| `convites` | Propostas de atendimento pendentes de aceite pela prestadora logada | `carregarDadosPrestadora()` ← `GET /atendimentos/prestadora/me/convites` |
| `agendaPrestadora` | Atendimentos já aceitos pela prestadora logada | `carregarDadosPrestadora()` ← `GET /atendimentos/prestadora/me/agenda` |
| `equipeData` | Lista de prestadoras por unidade, com desempenho | `carregarEquipeClientesAvaliacoes()` ← `GET /unidades/:slug/admin/equipe` |
| `clientesData` | Lista de clientes por unidade, com histórico resumido | `carregarEquipeClientesAvaliacoes()` ← `GET /unidades/:slug/admin/clientes` |
| `avaliacoes` | Avaliações enviadas por clientes, com ciclo de moderação | `carregarEquipeClientesAvaliacoes()` ← `GET /avaliacoes/admin/:slug` |
| `concluidos` | Atendimentos concluídos aguardando avaliação do cliente | `carregarDadosCliente()` |
| `subadminsCache` | Sub-administradores da unidade (Acessos) | `renderSubadmins()` ← `GET /sub-administradores/:slug` |

---

## 4. Máquina de estados — núcleo do domínio

O sistema implementa de ponta a ponta a progressão central identificada no projeto, com uma linha por atendimento
na tabela `atendimentos` (coluna `status`):

```
pedido → proposto → aceito → concluído → avaliado (pendente → aprovada/recusada)
                  ↘ recusado ↗ (prestadora recusa; volta pro admin reatribuir)
        (cancelado, a qualquer momento não-terminal, inclusive em lote por serie_id)
```

1. **pedido** — cliente envia via `enviarPedido()` (`POST /atendimentos`, público) ou o admin cria avulso/recorrente pelo painel (`origem = 'manual'`).
2. **proposto** — admin atribui uma prestadora (`POST .../:id/propor` ou `.../:id/reatribuir`, este último funciona em qualquer status não-terminal, não só a partir de `'pedido'`).
3. **aceito** — prestadora confirma (`POST .../:id/aceitar`), só permitido a partir de 2 dias antes do atendimento; ou recusa (`.../:id/recusar`, volta pro admin reatribuir).
4. **concluído** — admin marca como concluído (`POST .../:id/concluir`).
5. **avaliado** — cliente avalia (`POST /avaliacoes`) com `status: 'pendente'` → admin modera (`aprovar`/`recusar`) → se aprovada, passa a contar na média da prestadora.

---

## 5. Regras de negócio identificadas

- **Prestadora só enxerga o que foi aceito.** Convites pendentes ficam numa lista separada da agenda confirmada.
- **Avaliação passa por moderação obrigatória.** Cliente → status `pendente` → admin aprova/recusa → só então a prestadora vê.
- **Dados são segmentados por unidade** (Carazinho/Panambi) em quase todas as entidades operacionais (agenda, equipe, clientes). O administrador alterna a unidade ativa via `setUnit()`.
- **Cadastro de prestadora é vinculado à unidade** já no momento do cadastro (região selecionada em `cad-prest-regiao`); a verificação de identidade é sempre por e-mail, nunca por WhatsApp/telefone (não há API de WhatsApp de verdade).
- **Autenticação real** (bcrypt + JWT, 7 dias), com autorização por unidade e por módulo sempre reconferida no
  banco a cada request — nunca só confiando no que o token diz. Ver `LEIA-ME.md` pra detalhes de setup.
- **Administrador só é criado depois de confirmar um código de verificação** enviado ao e-mail informado — CNPJ
  sozinho (um dado público) nunca é suficiente pra virar admin de uma unidade real.

---

## 6. Rastreabilidade tela → tabela do banco

Esta tabela conecta cada estrutura mockada acima ao schema relacional gerado em `banco-schema.sql`:

| Dado mockado no HTML | Tabela no banco |
|---|---|
| `cidades` / `unidades` (metadados) | `unidades` |
| `unidades[key].jobs` / `convites` / `agendaPrestadora` / `concluidos` | `atendimentos` (uma única tabela, diferenciada por `status`) |
| `prestadora` / `equipeData` | `prestadoras` |
| `clientesData` | `clientes` |
| `avaliacoes` | `avaliacoes` |
| Cadastro de admin + `administrador_unidades` (padrão já definido no projeto) | `administradores` + `administrador_unidades` |
| KPIs de `unidades[key]` (atend, prof, fat, nps) | Calculados via `VIEW` (`vw_dashboard_unidade`), não armazenados — evita dados duplicados/desatualizados |
| `equipeData[unidade][].serv` / `.nota` | Calculados via `VIEW` (`vw_equipe_unidade`) a partir de `atendimentos` e `avaliacoes` |
| `clientesData[unidade][].ultimo` / `.total` | Calculados via `VIEW` (`vw_clientes_unidade`) a partir de `atendimentos` |

---

## 7. Status desses passos na versão 0.0.0.0

Esta seção listava passos sugeridos quando o projeto ainda era só o protótipo estático. Todos foram implementados
(com Node/Express + PostgreSQL local, não Supabase — ver `LEIA-ME.md` para a arquitetura real):

1. ✅ "Converter pedido em convite" (admin) e reatribuição de prestadora — inclusive fora do fluxo linear original.
2. ✅ Dados mockados substituídos por chamadas reais à API, que fala com PostgreSQL.
3. ✅ Autenticação real (bcrypt + JWT), com administrador, sub-administrador, prestadora e cliente.
4. ✅ Cadastro persistido de verdade em `administradores` / `prestadoras` / `clientes`.
5. ⏸️ Integração com a **API oficial de WhatsApp Business (Meta Cloud API)** — pausada por enquanto (a verificação
   de conta comercial se mostrou mais trabalhosa do que o esperado); o código de verificação no cadastro continua
   simulado. Fica para uma versão futura.
6. ✅ Aviso automático por WhatsApp via link "clique pra conversar" (`wa.me`, sem API/token) — abre sozinho ao
   reatribuir prestadora, ao ela confirmar, e ao pedir orçamento "via WhatsApp", com a mensagem já descrevendo o
   atendimento/pedido; quem abriu ainda aperta enviar. Telefone de cada unidade editável pelo administrador.

Também foi além do que estava previsto aqui: sub-administradores com permissões por módulo, agenda em calendário
com linha do tempo, atendimento recorrente por padrão semanal, e janela de confirmação de 2 dias para a
prestadora.
