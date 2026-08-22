# Documentação técnica — Portal da Maria (v0.0.3)

> Documentação gerada a partir da engenharia reversa do arquivo `Portal Da Maria V 0.0.3.html`, um protótipo estático (HTML + CSS + JS vanilla, sem backend) que simula o funcionamento completo do portal usando dados mockados em memória.

---

## 1. Visão geral

O arquivo é um **SPA de arquivo único**: todas as "telas" são `<section class="screen">` dentro do mesmo HTML, alternadas via JavaScript (função `show(id)`), sem roteamento real de URL nem requisições de rede. Todo o estado (agenda, convites, avaliações, clientes) vive em variáveis JS (`let`/`const`) que resetam ao recarregar a página — não há persistência real, exceto o tema (dark/light) salvo em `localStorage`.

**Tipos de usuário simulados:** administrador (franqueado), prestadora, cliente.
**Unidades:** Carazinho/RS e Panambi/RS, com dados independentes por unidade.

---

## 2. Mapeamento de telas

| ID da seção | Tela | Acesso |
|---|---|---|
| `#screen-home` | Página pública (institucional) | Todos |
| `#screen-login` | Login unificado (3 perfis) | Todos |
| `#screen-cadastro` | Cadastro (admin por e-mail, prestadora por WhatsApp) | Todos |
| `#screen-franqueado` | Painel do administrador | Administrador |
| `#screen-prestadora` | Painel da prestadora | Prestadora |
| `#screen-cliente` | Área do cliente | Cliente |

### 2.1 `#screen-home` — Página pública
- Seletor de região (modal `#region-modal`) que troca todo o conteúdo dinâmico entre Carazinho e Panambi via `setRegiao(key)`.
- Seções: hero, `#funcionalidades`, `#servicos` (links para páginas oficiais da Maria Brasileira), `#contato` (formulário de pedido de orçamento).
- Formulário de contato chama `enviarPedido(viaWhats)` — cria um novo item em `unidades[regiao].jobs` com status `"novo"`, simulando a entrada de um pedido na agenda da unidade (com ou sem redirecionamento simulado ao WhatsApp).

### 2.2 `#screen-login`
- Seleção de perfil (`setProfile`) entre `franqueado`, `prestadora`, `cliente`.
- `doLogin()` decide qual tela abrir e qual função de renderização inicial disparar, conforme o perfil escolhido. Não há validação de credenciais — é um mock.

### 2.3 `#screen-cadastro`
Dois fluxos distintos por perfil (`setCadProfile`):
- **Administrador:** cadastro por e-mail + verificação por código de 6 dígitos (`enviarCodigo('admin-email')` / `confirmarCodigo`).
- **Prestadora:** cadastro vinculado a uma unidade regional (`cad-prest-regiao`) + verificação por WhatsApp, também com código de 6 dígitos simulado (`enviarCodigo('prest-phone')`).
- `doCadastro()` valida apenas se as senhas coincidem e volta para a tela de login (não persiste conta nova).

### 2.4 `#screen-franqueado` — Painel do administrador
Navegação interna via `adminView(name)`, com 5 sub-telas (`.adminview`):

| Sub-tela | Função de render | Fonte de dados |
|---|---|---|
| Visão geral | `setUnit(key)` | `unidades[key]` (KPIs: atendimentos, profissionais, faturamento, NPS + agenda do dia) |
| Agenda | `renderAgendaAdmin()` | `unidades[currentUnit].jobs` |
| Equipe | `renderEquipe()` | `equipeData[currentUnit]` |
| Clientes | `renderClientes()` | `clientesData[currentUnit]` |
| Avaliações | `renderAvaliacoesAdmin()` | `avaliacoes` (moderação) |

Alternância de unidade (Carazinho/Panambi) via `setUnit(key)`, que reescreve todos os elementos com atributo `data-k`.

**Moderação de avaliações:** `aprovarAval(id)` e `recusarAval(id)` alteram `status` de `pendente` para `aprovada`/`recusada`. Só avaliações aprovadas chegam à prestadora (`renderPrestAval` filtra por `status === 'aprovada'`).

### 2.5 `#screen-prestadora` — Painel da prestadora
- `renderPrestadora()` desenha dois blocos:
  - **Convites pendentes** (`convites[]`): `aceitar(id)` move o convite para `agendaPrestadora[]` e também empurra o item para `unidades[unidade].jobs` (refletindo na agenda da unidade); `recusar(id)` apenas remove o convite.
  - **Agenda aceita** (`agendaPrestadora[]`): apenas os atendimentos já confirmados aparecem — reflete a regra de negócio "prestadora só vê o que foi aceito".
- `renderPrestAval()`: nota média, total de avaliações, destaque das 3 mais recentes aprovadas + histórico das demais.

### 2.6 `#screen-cliente` — Área do cliente
- `renderClienteAval()`: lista atendimentos concluídos (`concluidos[]`) aguardando avaliação, com seleção de estrelas (`setStar`) e comentário livre.
- `enviarAvaliacao(id)`: cria um registro em `avaliacoes[]` com `status: 'pendente'` (vai para moderação do admin) e remove o item de `concluidos[]`.

---

## 3. Estruturas de dados mockadas (JS) e principais funções

| Variável JS | Descrição | Funções que a manipulam |
|---|---|---|
| `cidades` | Metadados institucionais das 2 unidades (nome, UF, tel, endereço) | `setRegiao` |
| `unidades` | KPIs + agenda (`jobs[]`) por unidade | `setUnit`, `renderAgendaAdmin`, `enviarPedido`, `aceitar` |
| `prestadora` | Prestadora logada (mock único: "Fabiana S.") | `renderPrestadora`, `renderPrestAval` |
| `convites` | Propostas de atendimento pendentes de aceite pela prestadora | `renderPrestadora`, `aceitar`, `recusar` |
| `agendaPrestadora` | Atendimentos já aceitos pela prestadora logada | `renderPrestadora`, `aceitar` |
| `equipeData` | Lista de prestadoras por unidade, com desempenho | `renderEquipe` |
| `clientesData` | Lista de clientes por unidade, com histórico resumido | `renderClientes` |
| `avaliacoes` | Avaliações enviadas por clientes, com ciclo de moderação | `renderAvaliacoesAdmin`, `aprovarAval`, `recusarAval`, `renderPrestAval`, `enviarAvaliacao` |
| `concluidos` | Atendimentos concluídos aguardando avaliação do cliente | `renderClienteAval`, `enviarAvaliacao` |
| `codes` | Códigos de verificação de 6 dígitos (cadastro) | `enviarCodigo`, `confirmarCodigo` |

---

## 4. Máquina de estados — núcleo do domínio

O protótipo já expressa, de forma implícita, a progressão central identificada no projeto:

```
pedido → proposto → aceito → concluído → avaliado (pendente → aprovada/recusada)
```

Mapeamento explícito para os dados mockados:

1. **pedido** — cliente envia via `enviarPedido()` → entra em `unidades[regiao].jobs` com status `"novo"`.
2. **proposto** — administrador transforma o pedido em convite para uma prestadora → aparece em `convites[]` (esse passo de "converter pedido em convite" não está implementado no protótipo; é feito manualmente/hardcoded nos dados de exemplo).
3. **aceito** — prestadora aceita (`aceitar()`) → sai de `convites[]`, entra em `agendaPrestadora[]` e em `unidades[unidade].jobs` com status `"confirmado"`.
4. **concluído** — atendimento realizado → entra em `concluidos[]` (também definido manualmente nos dados de exemplo; não há botão "concluir atendimento" no protótipo atual).
5. **avaliado** — cliente avalia (`enviarAvaliacao()`) → `avaliacoes[]` com `status: 'pendente'` → admin modera (`aprovarAval`/`recusarAval`) → se aprovada, passa a contar na média da prestadora.

> **Observação de gap:** os passos "pedido → proposto" e "aceito → concluído" ainda não têm ação de UI no protótipo (são simulados diretamente nos arrays de exemplo). Isso deve virar funcionalidade real no backend (ex.: painel do admin converter pedido em convite; algum gatilho — manual ou por data/hora — marcando o atendimento como concluído).

---

## 5. Regras de negócio identificadas

- **Prestadora só enxerga o que foi aceito.** Convites pendentes ficam numa lista separada da agenda confirmada.
- **Avaliação passa por moderação obrigatória.** Cliente → status `pendente` → admin aprova/recusa → só então a prestadora vê.
- **Dados são segmentados por unidade** (Carazinho/Panambi) em quase todas as entidades operacionais (agenda, equipe, clientes). O administrador alterna a unidade ativa via `setUnit()`.
- **Cadastro de prestadora é vinculado à unidade** já no momento da verificação (o código de WhatsApp é "enviado pela unidade" selecionada).
- **Não há autenticação real** — login apenas escolhe qual tela mostrar, sem validar usuário/senha.

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

## 7. Próximos passos sugeridos

1. Implementar as ações de UI que faltam: "converter pedido em convite" (admin) e "marcar atendimento como concluído" (prestadora ou automático por data/hora).
2. Substituir os dados mockados em JS por chamadas reais ao Supabase/PostgreSQL usando o schema anexo.
3. Implementar autenticação real (Supabase Auth) no lugar do `setProfile`/`doLogin` simulados.
4. Persistir o cadastro (`doCadastro`) gravando efetivamente `administradores`/`prestadoras`/`clientes`.
5. Integrar o envio de código via WhatsApp Business API (hoje simulado com `Math.random()`).
