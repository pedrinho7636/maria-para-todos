# Portal da Maria — versão de entrega final (0.0.0.0)

Sistema de gestão para franquias de serviços de limpeza (TCC), com 3 perfis de acesso principais — administrador
(franqueado), prestadora e cliente — mais sub-administradores com permissões por módulo. Roda 100% local:
`Portal Da Maria.html` (frontend: HTML + `assets/css` + `assets/js`) fala com uma API própria em Node/Express (`api/`), que conversa com um
PostgreSQL rodando na sua máquina.

---

## 1. Instalar o PostgreSQL

```bash
winget install -e --id PostgreSQL.PostgreSQL.17
```

Durante a instalação, vai pedir uma senha para o usuário `postgres` — anote, você vai usar no passo 3.

---

## 2. Criar o banco e aplicar o schema

Abra o **SQL Shell (psql)** que foi instalado (menu iniciar) ou use o `psql` pelo terminal, conecte como `postgres` e rode:

```sql
CREATE DATABASE portal_da_maria;
```

Depois, ainda conectado (agora no banco `portal_da_maria`), aplique o schema:

```bash
psql -U postgres -d portal_da_maria -f "banco-schema.sql"
```

(Rode esse comando a partir da raiz do repositório, ou ajuste o caminho do arquivo.)

Isso cria as tabelas, enums, views e já popula com dados de exemplo (administrador, prestadoras, clientes,
atendimentos). **Todas as senhas de exemplo são `senha123`.**

---

## 3. Configurar e instalar a API

```bash
cd api
copy .env.example .env
```

Edite o `api/.env` e troque `PGPASSWORD` pela senha que você definiu na instalação do PostgreSQL, e `JWT_SECRET` por
uma string aleatória longa (32+ caracteres — a API recusa subir com o valor de exemplo ou algo mais curto, de
propósito: um segredo fraco/previsível permitiria forjar tokens de admin). Pra gerar uma rápida:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
npm install
npm start
```

Deve aparecer `API do Portal da Maria rodando em http://localhost:3001`. Teste em outra aba: `http://localhost:3001/api/health`
deve responder `{"ok":true}`.

### 3.0 O que a API faz sozinha ao subir

Antes de abrir a porta, a API confere a conexão com o Postgres, confirma que as tabelas base existem e **aplica as
migrações do banco** (colunas/tabelas novas, todas idempotentes — rodam sempre, em banco novo ou antigo, sem
estragar nada). Se algo estiver errado ela não sobe e diz o que fazer (Postgres parado, senha errada, banco
inexistente, schema não aplicado). `GET /api/health` de fato consulta o banco (devolve 503 se ele cair).

Pra conferir que cadastro e acesso estão de pé, com a API rodando: `npm run teste:cadastros` (dentro de `api/`).
Ele cria uma conta de cada tipo (administrador, funcionário, prestadora, cliente), entra logo em seguida, testa as
falhas comuns (código errado, CNPJ/telefone em outro formato, conta duplicada), a sincronização entre usuários e o
limite de login, e apaga tudo que criou. Dica: pra ele não disparar e-mail de verdade, suba a API de teste com
`SMTP_USER= SMTP_PASS= RESEND_API_KEY= npm start`.

Outro teste, `npm run teste:recuperacao`, cobre recuperação de senha (todos os perfis e os limites contra abuso), o valor
por atendimento das prestadoras e o local do atendimento. Ele dispara pedidos de código, então rode contra uma API de
teste **sem** provedor de e-mail (instruções no cabeçalho de `api/scripts/testar-recuperacao-valores.js`). Esse mesmo
teste cobre também o valor dos atendimentos (unitário e em grupo), o endereço da unidade e a criação automática de
prestadoras a partir da planilha, além do Financeiro (permissões, repasses, pagamento), das views corrigidas e da
conclusão automática (essa parte roda numa transação revertida, sem tocar nos atendimentos reais).
`npm run teste:recorrencia` (divisão do valor mensal), `npm run teste:financeiro` (receita, custo, margem, repasses) e
`npm run teste:relatorios` (todos os cálculos da aba Relatórios) e `npm run teste:relatorios-historico` (os indicadores que saem
do histórico de status: tempo de resposta ao convite, cancelamentos, funil real) não precisam de API nem de banco. O
`npm run teste:relatorios-api` confere as rotas dos relatórios (quem pode abrir, período, várias unidades) e precisa da API de
testes rodando, como os demais (instruções no cabeçalho de `api/scripts/testar-relatorios-api.js`). O `npm run teste:eventos`
também precisa da API de testes: percorre cada ponto em que o status de um atendimento muda e confere o evento gravado no histórico
(e o que os relatórios mostram a partir dele).
O `npm run teste:seguranca` confere as correções da varredura de segurança (seção 8: cabeçalhos e CSP, sessão que cai ao trocar a
senha, e-mail só com a senha atual, pedido público, dados que não vazam, bomba de zip, limites de requisição...). Ele sobe sozinho
uma segunda API na porta 3013 pra testar os limites, cria e apaga uma unidade `qa-seg-*` própria e não toca nas unidades reais.
A API tem um teto geral de 1.500 requisições por minuto por IP (variável `LIMITE_API`); a bateria completa cabe nele, mas se um
teste receber 429 inesperado numa máquina lenta/rápida demais, suba a API de teste com `LIMITE_API=100000`. Depois de **uma rodada que
falhou no meio**, reinicie a API de teste (os limites ficam na memória dela) antes de rodar de novo.

**Publicar na internet (Render + Neon):** passo a passo, e o que só você pode fazer, em `PUBLICAR-SITE.md`. No
código já estão: banco por `DATABASE_URL`, `render.yaml`, `/api/ping`, `npm run banco:schema` (`-- --sem-exemplos`
pra não criar contas de exemplo) e `npm run admin:criar` (cria o 1º administrador direto no banco).

### 3.1 (Opcional) Envio real de e-mail

Sem configurar nada, os códigos de verificação (cadastro e troca de e-mail no perfil) só aparecem no console da
API — funciona perfeitamente pra testar sozinho, mas ninguém recebe e-mail de verdade. A API sempre diz na
resposta se o e-mail saiu (`emailEnviado`) e por que não saiu (`motivoEmail`), e a tela avisa a pessoa de acordo; se
o envio falhar, o fluxo continua e o código aparece no console. A API usa o **primeiro** provedor configurado, nesta
ordem: SMTP, Resend, modo simulado.

**Opção 1 — SMTP / Gmail (recomendada pra testes: entrega pra QUALQUER destinatário, sem domínio nem DNS):**

1. Na conta Google que vai enviar os e-mails, ative a **verificação em duas etapas** e gere uma **senha de app**
   em <https://myaccount.google.com/apppasswords> (16 letras).
2. No `api/.env` preencha `SMTP_USER=seu@gmail.com` e `SMTP_PASS=<a senha de app, sem espaços>` (`SMTP_HOST` e
   `SMTP_PORT` já vêm preenchidos pro Gmail).
3. Valide sem passar pela tela: `npm run email:teste -- destino@exemplo.com` (dentro de `api/`). Mostra qual provedor
   está em uso e se o e-mail saiu.
4. Reinicie a API (`npm start`).

**Opção 2 — Resend:** crie uma conta em [resend.com](https://resend.com), gere uma API key e cole em
`RESEND_API_KEY` no `api/.env`. **Limitação do plano grátis sem domínio verificado:** com o remetente padrão
(`onboarding@resend.dev`), a Resend só entrega pro e-mail dono da própria conta — qualquer outro destinatário é
recusado (erro 403). Pra enviar pra qualquer endereço é preciso verificar um domínio em **Domains** no painel da
Resend e trocar `EMAIL_FROM` pra usar esse domínio.

---

## 4. Abrir o frontend

O `Portal Da Maria.html` (com a pasta `assets/` ao lado dele, que tem o CSS e o JavaScript) faz `fetch()` para
`http://localhost:3001/api`, então **precisa ser servido por um servidor local** (não abrir com duplo-clique) por causa de CORS:

- **VS Code:** extensão "Live Server" → botão direito no arquivo → "Open with Live Server".
- **Terminal (Node):** na pasta do projeto, `npx serve .` e abra o endereço que aparecer.

Com a API rodando (passo 3) e o HTML servido, teste o fluxo:

1. Home pública → deve carregar Carazinho/Panambi (dado público, sem login).
2. Login como **administrador**: `renata@mariabrasileira.com` / `senha123`.
3. Login como **prestadora**: telefone `(54) 9 9000-0001` / `senha123` (Fabiana S.) — pode digitar com ou sem
   formatação, o backend normaliza os dois lados antes de comparar.
4. **Cadastro novo de qualquer perfil (admin/prestadora/cliente) passa por verificação de e-mail** antes de existir
   conta — não há API de WhatsApp de verdade, então a identidade é sempre confirmada por e-mail, nunca por
   telefone. Preencha o formulário e clique em "Verificar" ao lado do e-mail: isso grava um código de 6 dígitos no
   banco e **imprime o código no terminal onde a API está rodando** (`[verificacao] código de cadastro (...) para
   ...`), já que o envio real de e-mail ainda não existe. Cole o código no campo que aparece e confirme; só nesse
   momento a conta é criada de verdade (confira com `SELECT * FROM prestadoras;` no psql, ou com uma extensão de
   PostgreSQL no VS Code). Pra administrador, isso existe porque CNPJ sozinho (um dado público) nunca pode ser
   prova suficiente de que quem está cadastrando é dono da franquia; pra prestadora/cliente, evita que um erro de
   digitação no e-mail/telefone trave o próprio login depois. Nenhum perfil tem restrição de domínio no e-mail —
   qualquer e-mail válido serve pros 4 tipos de usuário (a checagem de domínio institucional existe no código, mas
   está desligada por decisão do usuário; ver seção 5).

---

## 5. Estrutura do frontend e do backend

**Frontend** (servido pela própria API: o HTML em `/` e a pasta `assets/` em `/assets`):

```
Portal Da Maria.html          — só a estrutura (HTML) de todas as telas, os <link> dos estilos e os <script> na ordem certa
assets/
  css/                        — estilos por assunto, carregados em ordem (a ordem importa: um sobrescreve o anterior)
    01-base-e-tema.css          cores claro/escuro, tipografia, reset
    02-site-publico.css         home pública (barra, hero, funcionalidades, serviços, contato)
    03-login-cadastro.css       login e cadastro
    04-app-geral.css            área logada: barra, cartões, painéis, modais, formulários, modo escuro
    05-agenda-e-financeiro.css  calendário/linha do tempo da agenda e Financeiro
    06-relatorios.css           aba Relatórios e estilo de impressão
    07-avaliacoes-e-componentes.css  estrelas, avaliações, botões pequenos
    08-celular.css              ajustes para celular
  js/                         — scripts por assunto, numerados na ORDEM DE CARGA (scripts comuns, não módulos: os onclick
                                do HTML chamam as funções globais; cada arquivo usa o que os anteriores definiram)
    01-nucleo-api-sessao.js     endereço da API, sessão, barras de carregamento, api()/apiUpload(), aviso de versão nova
    02-estado-e-formatacao.js   dados em memória, horário 24 h, máscaras (telefone, dinheiro, CNPJ), escapeHtml
    03-dados-sessao-login.js    WhatsApp, permissões, carregar dados, login e entrada na área do usuário
    04-sincronizacao.js         atualização automática do que outras pessoas fazem
    05-recuperar-senha-e-cadastro.js
    06-painel-e-unidades.js     seletor de unidades e layout do painel inicial
    07-agenda-admin.js          calendário do mês, linha do tempo, balão do atendimento
    08-cadastrar-atendimento.js atendimento único, série semanal, importação de planilha
    09-area-prestadora.js       convites, calendário e avisos da prestadora
    10-equipe.js                navegação do administrador, Equipe, valor por atendimento, meta de faltas, contato
    11-primeiro-acesso.js       primeiro acesso da prestadora criada pela planilha
    12-clientes-e-avaliacoes.js clientes, substituição de perfil, moderação de avaliações
    13-financeiro.js            Financeiro
    14-relatorios.js            Relatórios (Agenda, Financeiro, Satisfação)
    15-acessos-funcionarios.js  funcionários e permissões
    16-area-cliente.js          área do cliente
    17-meu-perfil.js            Meu perfil
    18-iniciar.js               toast, tema e a partida do app (precisa ser o ÚLTIMO)
```
Pra acrescentar uma tela nova: crie o `assets/js/NN-nome.js` (antes do `18-iniciar.js`) e acrescente a `<script src>` no HTML
na mesma posição. A versão do site (aviso "versão nova — atualizar") considera o HTML **e** todos os arquivos de `assets/`.

**Backend** (`api/`):

```
api/
  src/
    server.js               — entrypoint Express
    db.js                   — pool de conexão pg (timeouts, tratamento de erro) + checagem e migração do banco no boot
    middleware/auth.js       — requireAuth / requireRole / requireAcessoUnidade (JWT + permissão por módulo)
    utils/
      permissoes.js          — vínculo admin↔unidade e permissões de sub-administrador
      normalizacao.js        — normaliza e-mail/telefone; tem um validador de domínio institucional, hoje desligado
      validacao.js           — senha mínima, formato de e-mail
      verificacaoEmail.js    — gera/confirma o código de 6 dígitos de verificação por e-mail
      email.js               — envia e-mail de verdade via SMTP ou Resend; sem nenhum configurado, cai pro console
      importarPlanilha.js    — lê e valida a planilha .xlsx de atendimentos (cabeçalho flexível, datas/horas)
    scripts/testar-email.js  — `npm run email:teste -- destino@x.com`: testa o provedor de e-mail do .env
    scripts/testar-cadastros.js — `npm run teste:cadastros`: teste de ponta a ponta de cadastro/acesso/sincronização
    scripts/testar-recuperacao-valores.js — `npm run teste:recuperacao`: recuperação de senha, valores, local, endereço, planilha
    scripts/testar-recorrencia.js — `npm run teste:recorrencia`: divisão do valor mensal entre as ocorrências
    scripts/testar-financeiro.js — `npm run teste:financeiro`: cálculos do módulo Financeiro (sem API/banco)
    scripts/testar-relatorios.js — `npm run teste:relatorios`: cálculos da aba Relatórios — período, Agenda, Financeiro, Satisfação (sem API/banco)
    scripts/testar-relatorios-api.js — `npm run teste:relatorios-api`: rotas /api/relatorios (permissões, período, consolidado de unidades; precisa da API)
    scripts/testar-relatorios-historico.js — `npm run teste:relatorios-historico`: tempo de resposta ao convite, cancelamentos (quem/motivo), funil real (sem API/banco)
    scripts/testar-eventos.js — `npm run teste:eventos`: histórico de status — um evento em cada transição + o que os relatórios mostram dele (precisa da API)
    scripts/testar-agenda.js — `npm run teste:agenda`: CNPJ, conflitos de horário, recusas, avisos de cancelamento, calendário/cliente, convite e substituição de perfil (precisa da API)
    scripts/vincular-profissionais-importadas.js — `npm run importadas:vincular`: liga atendimentos importados às prestadoras
      asyncHandler.js        — evita que erro numa rota derrube o processo
    routes/
      auth.js                — cadastro (admin/prestadora/cliente) + login unificado + recuperação de senha
      unidades.js             — dados institucionais + dashboard/equipe/clientes do admin + valor por atendimento
      atendimentos.js          — pedido público, agenda (calendário/dia), propor/reatribuir/concluir, local do atendimento,
                                  atendimento recorrente (padrão semanal), convites/aceitar/recusar e resumo de ganhos (prestadora)
      avaliacoes.js             — cliente envia, admin/sub-admin modera, prestadora vê aprovadas
      sync.js                   — impressão digital do que cada usuário enxerga (a tela consulta a cada 4s)
      subadministradores.js     — CRUD de sub-administradores (só admin completo)
      perfil.js                 — "Meu perfil": nome/foto/telefone/senha + e-mail com verificação, pros 4 tipos
      financeiro.js             — resumo do mês (receita/custo/margem), folha e pagamento de repasses às prestadoras
      relatorios.js             — Relatórios (Agenda, Financeiro, Satisfação) por período; só administrador completo
    utils/financeiro.js        — cálculos do Financeiro (em centavos, testáveis sem banco)
    utils/relatorios.js        — cálculos dos Relatórios (período, séries, taxas; testáveis sem banco)
    utils/conclusao.js         — conclui sozinho o atendimento aceito cuja data/hora já passou (a cada 5 min) e grava o evento no histórico
    utils/eventos.js           — histórico de status dos atendimentos (tabela atendimento_eventos): grava eventos, lê quem cancelou/motivo
```

Autenticação: senha com hash `bcrypt`, sessão via JWT (7 dias) guardado no `localStorage` do navegador (`pm-token`).
Autorização por unidade e por módulo é sempre reconferida no backend a cada request (`requireAcessoUnidade`), nunca
só confiando no que o token diz.

**Atualização entre usuários:** com a tela aberta, o navegador consulta `GET /api/sync` a cada 4 segundos (e na
hora em que a aba volta ao foco). A API devolve uma "impressão digital" barata do que aquele usuário enxerga
(quantidade de linhas + carimbo da última alteração); só quando ela muda é que a tela recarrega os dados. Resultado:
um convite criado pelo administrador aparece na tela da prestadora em poucos segundos, sem ela relogar; o mesmo vale
pra aceite/recusa, avaliações, importação, e pra permissão/desativação de funcionário (que sai da tela na hora).
Abas em segundo plano pausam a checagem e conferem assim que voltam ao foco.

**Recuperação de senha:** "Esqueci a senha" na tela de login (administrador/funcionário e cliente por e-mail;
prestadora por telefone **ou** e-mail). A API manda um código de 6 dígitos (vale 15 min) para o e-mail cadastrado
da conta e, com ele, a pessoa define a nova senha e já entra. Detalhes de segurança: a resposta do pedido é sempre a
mesma, exista a conta ou não (ninguém descobre quem tem cadastro); o código fica guardado sob uma chave própria
(`recuperar:perfil:e-mail`), então um código de cadastro nunca redefine senha; limites **por conta**, não por IP — 5
pedidos e 8 erros de código a cada 15 min. Só contas com senha e e-mail entram: uma prestadora antiga **sem e-mail**
não consegue recuperar sozinha (precisa de um e-mail no cadastro). E-mail de prestadora não é único, então pedir por
e-mail redefine as contas ligadas a ele; pelo telefone é sempre uma só. A sessão que já estava aberta noutro
aparelho continua valendo até o JWT expirar (7 dias) — ele não é revogado ao trocar a senha.

**Valor por atendimento (prestadora):** na tela **Equipe** o administrador define, por prestadora, quanto a
franquia paga por atendimento (só administrador completo altera; funcionário com o módulo Equipe apenas vê). A
prestadora passa a ver esse valor nos convites e na agenda — **nunca o preço cobrado do cliente** — e a tela dela
mostra "Previsto na semana" e "A receber no mês" (realizados + a realizar), calculados pela API
(`GET /atendimentos/prestadora/me/resumo`, semana começando no domingo, fuso de Brasília). O valor é **travado no
atendimento quando ela aceita** (`atendimentos.valor_prestadora`): mudar a tarifa depois vale só pros próximos
aceites; o que já foi aceito mantém o valor combinado. Convites ainda não aceitos mostram a tarifa atual; sem
tarifa definida o valor simplesmente não aparece. Atendimentos "aceitos" com data passada contam como realizados
(o sistema ainda não tem um botão de concluir).

**Local do atendimento:** na agenda, clique no atendimento → o balão traz **Prestadora** e **Local / bairro**.
Dá pra corrigir ou preencher o local (administrador e funcionário com agenda), inclusive em atendimento concluído;
deixar vazio apaga. Nas telas de quem lê (prestadora, avisos de WhatsApp) atendimento sem local não mostra a linha.

**Endereço da unidade (local do estabelecimento):** é o endereço que aparece no site (cabeçalho e seção "Fale com a
gente"). O administrador edita em **Meu perfil → Dados da unidade** (escolhe a unidade; telefone de WhatsApp, endereço completo
e um resumido opcional pro cabeçalho; só administrador completo, nunca funcionário). A tela **Acessos** é só de
funcionários. **Deixando em branco, o campo some do site** em vez de aparecer vazio.

**Valor do atendimento (o que o cliente paga):** é coletado no cadastro.
- *Atendimento único*: campo "Valor do atendimento (R$)" (opcional). Dá pra preencher ou corrigir depois, clicando
  no atendimento na agenda (o balão tem Prestadora, Local e Valor).
- *Atendimento recorrente (em grupo)*: cada dia da semana tem o campo **"Valor do mês inteiro (R$)"**. O sistema
  divide esse valor entre os atendimentos de cada mês, **pelo número de vezes que o padrão ocorre naquele mês**: R$ 1.200
  com 4 terças = R$ 300 cada; com 5 terças = R$ 240 cada; quinzenal (2 ou 3 por mês) idem. A soma do mês fecha no
  valor informado, centavo a centavo. Mês só parcialmente coberto (a série começa ou termina no meio dele) recebe a
  parte proporcional às ocorrências que de fato entram. Cada atendimento guarda o seu valor (`atendimentos.valor`)
  e o mensal original (`valor_mensal`) — é daí que os dashboards vão somar o faturamento.
- Planilha importada (padrão atual, a exportação da franquia com **16 colunas**): Orçamento, Número, Data, Horário, Período, Serviço,
  Tipo, Horas, Cliente, Profissionais, **Repasse (R$)**, Situação, Recorrente, **Local de Atendimento**, **Valor (R$)**, Margem de
  Contribuição (R$). O modelo baixado em "Importar planilha" tem exatamente essas colunas, na mesma ordem.
  - **Valor (R$)** = o que o cliente paga; **Repasse (R$)** = o que a franquia paga à prestadora (vira o custo no Financeiro; sem ele
    vale a tarifa da Equipe); **Local de Atendimento** = o endereço do serviço (vira o "Local" do atendimento).
  - **Contato da profissional:** na coluna *Profissionais* escreva "Nome | Telefone" (como no Cliente) — ou use uma coluna própria
    ("Contato da Profissional", "Telefone da Profissional", "Celular"…). Ao criar a prestadora na importação o telefone **já vai no
    cadastro dela** (ela passa a poder entrar também pelo telefone, e o botão de WhatsApp da Equipe funciona); quem já existia sem
    telefone passa a tê-lo. Telefone inválido, ou que já é de **outra conta**, é ignorado (nunca tira o número de ninguém).
  - *Período*, *Recorrente* e *Margem de Contribuição* não são lidos (a margem o portal calcula: Valor − Repasse).
  - Planilhas antigas continuam valendo: "Valor", "Custo" e "Repasse" são aceitos como nomes.
- Não confundir com o **valor pago à prestadora** (tela Equipe), que é o repasse.

**Prestadoras vindas da planilha:** ao importar, as profissionais que ainda não existem como prestadoras são
**cadastradas automaticamente** e os atendimentos já ficam ligados a elas. Como a planilha só traz o nome, a conta
nasce assim: e-mail presumido = nome sem espaços/acentos + `@gmail.com` (ex.: `clarisseiracemarother@gmail.com`;
homônimas ganham um número), **senha padrão `senha123`**, sem telefone, e **marcada como "primeiro acesso pendente"**.
Os atendimentos já importados antes disso foram ligados com `npm run importadas:vincular -- --aplicar` (sem o
`--aplicar` ele só simula e mostra o que faria).

**Primeiro acesso obrigatório (contas criadas pela planilha):**
1. O administrador preenche o telefone dela em **Equipe → Contato** (o botão também manda o acesso por WhatsApp:
   link + "login: seu nome completo" + senha padrão). A linha dela na Equipe mostra "primeiro acesso pendente".
2. Ela entra em **Prestadora** com o **nome completo** (como na planilha; maiúscula/acento não importam) e a senha
   `senha123`. Se houver duas com o mesmo nome e a mesma senha padrão, o sistema pede o e-mail em vez de adivinhar.
3. O portal abre direto a tela **"Bem-vinda"**, que não dá pra fechar: ela informa o **e-mail dela**, o telefone
   (opcional) e uma **senha nova** (diferente da padrão), recebe um **código de 6 dígitos** nesse e-mail e confirma.
4. Só então a área dela abre. Até lá a API responde 403 `PRIMEIRO_ACESSO` em tudo que é dela (convites, agenda, resumo,
   avaliações, sync). Depois de concluir, o login pelo nome deixa de existir (vale e-mail ou telefone).
- A "recuperar senha" **não** manda código pro e-mail presumido de uma conta pendente (podia ser de um estranho).
- Contas importadas antes dessa regra e ainda com `senha123`: `npm run importadas:primeiro-acesso` lista quais seriam
  marcadas; com `-- --aplicar` ele marca (confira a lista: conta de teste sua com `senha123` também entra).

**Conclusão automática:** a cada 5 minutos (e ao subir a API) o atendimento **aceito** cuja data/hora + duração já
passou vira **concluído** (sem horário, vale o dia inteiro; convite nunca aceito não conclui). Ao concluir, trava a
tarifa da prestadora. É o que faz o "realizado" existir: libera a avaliação pelo cliente, alimenta o total de
atendimentos da Equipe e é a base do Financeiro.

**Situação do atendimento (programado · concluído · cancelado):** na agenda, clique no atendimento → o campo
**Situação** do balão troca entre os três (`POST /atendimentos/admin/:slug/:id/situacao`).
- **Só programados e concluídos entram nas contagens** (visão geral, pontinhos do calendário, "no total" do dia,
  Equipe, Financeiro, resumo da prestadora). O **cancelado** fica registrado — aparece riscado na agenda do dia —
  mas sai de todas as contas, e não aceita mais edição de valor/local/prestadora até ser reativado.
- *Concluído* manual: trava a tarifa da prestadora (se houver) como no aceite.
- *Programado* (reativar): volta a "aceito" se já tem prestadora, senão a "pedido". Fica marcado como escolha manual
  (`situacao_manual`): se a data já passou, a conclusão automática **não** o conclui de novo.
- **Cancelamento avisa a prestadora:** ao cancelar (um atendimento ou uma série), a prestadora responsável recebe um
  **aviso no portal** ("Avisos da unidade", com serviço, cliente, data e horário) até clicar em *Entendi*, e o
  atendimento sai da agenda dela (no calendário aparece como "cancelado"). Tabela `avisos_prestadora`.
- **Quem pediu e por quê (opcional):** ao escolher *Cancelado* no balão da agenda aparecem **Quem pediu o cancelamento?** (o cliente /
  a franquia / a prestadora; ou "Não informar") e **Motivo** (texto livre, até 300 caracteres). Os dois vão pro histórico do atendimento
  e alimentam os relatórios; a prestadora não vê. Na API: `cancelado_por` (`cliente`, `franquia` ou `prestadora`) e `motivo` no corpo de
  `POST /atendimentos/admin/:slug/:id/situacao` (e de `.../serie/:serieId/cancelar`, valendo pra série inteira).

**Histórico de status dos atendimentos (`atendimento_eventos`):** o atendimento guarda só o status de agora; a tabela
`atendimento_eventos` guarda **como ele chegou lá**. Cada mudança grava uma linha — status de antes e de depois, quando, quem fez
(administrador, funcionário, prestadora, cliente, "público" quando o pedido veio do site, ou "sistema" nas conclusões automáticas), a
prestadora envolvida e, no cancelamento, quem pediu e o motivo. O evento entra **na mesma transação** da mudança (um nunca existe sem o
outro) e só se acrescenta: nada é editado. Gravam eventos: pedido do site, cadastro avulso, série semanal, importação da planilha
(`importado`), convite (`proposto`), troca de prestadora (`reatribuido`), aceite e recusa pela prestadora, confirmação automática de
convite cujo horário chegou (`confirmado_auto`), conclusão manual e automática, cancelamento, falta, reabertura (`reaberto`: cancelado →
programado, falta → concluído) e a ligação de atendimentos da planilha a uma prestadora recém-cadastrada. O que **não** muda nada (reatribuir
pra mesma prestadora, cancelar o que já está cancelado, editar local/valor) não gera evento. A tabela nasce vazia: atendimentos anteriores
a ela não têm histórico (os relatórios avisam quantos ficam de fora). Apagar um atendimento apaga o histórico dele. Código em
`api/src/utils/eventos.js` e `api/src/utils/conclusao.js`; a lista de ações está no cabeçalho do primeiro.

**Conflitos de horário e pendências (agenda da prestadora):** dois atendimentos da mesma prestadora se conflitam quando
os intervalos [início, início + duração] se sobrepõem, mesmo em parte (sem duração vale 1 h; terminar às 11:00 e
começar às 11:00 **não** conflita). Na tela dela, em vermelho e com **formas diferentes**: **⏳ Aguardando aceite**
(etiqueta preenchida + faixa sólida) e **⚠ Conflito de horário** (etiqueta só de contorno + fundo listrado); no
calendário, pendência = pontinho vermelho e conflito = dia com contorno vermelho.
- O administrador é **avisado ao atribuir** (novo atendimento, troca de prestadora, série semanal, "programado")
  e escolhe seguir ou não (`409 CONFLITO_HORARIO`; reenvia com `forcar_conflito`).
- A prestadora **não consegue aceitar** um atendimento que se sobrepõe a outro já confirmado/concluído dela (409).
- **Recusas ficam no atendimento** (`recusas_atendimento`): a agenda do administrador mostra "↩ recusado por X"
  e, no balão, a lista de quem já recusou (a prestadora aparece como "já recusou" na lista). Tentar enviar de novo
  pra quem recusou pergunta antes (`409 JA_RECUSOU`; `forcar_recusa`). Vale mesmo depois de ir pra outra prestadora.
  Recusas anteriores a essa versão não foram registradas.
- **Calendário da prestadora:** clicar num dia mostra os atendimentos **dela** naquele dia (cliente, início–término,
  serviço, local, valor, status). `GET /atendimentos/prestadora/me/calendario?mes=AAAA-MM`.

**Horários em 24 h:** o horário do cadastro de atendimento é escolhido em **dois seletores** (hora 00–23 e minuto de 5 em 5),
sempre em 24 h — nunca AM/PM (o `<input type="time">` mostrava AM/PM conforme o idioma do navegador e não dava pra
impedir). Escolher a hora já preenche ":00". A API só aceita `HH:MM` de 00:00 a 23:59.

**Telefones e nomes no cadastro:** todo campo de telefone formata enquanto digita — `(54) 3333-4444` (fixo) ou
`(54) 9 9999-0000` (celular); aceita `+55` colado e o servidor guarda só os dígitos. Todo nome é ajustado ao sair do campo
e de novo no servidor, pra qualquer tipo de usuário (administrador, funcionário, prestadora, cliente, cliente criado na agenda,
meu perfil): "ana carolina" → "Ana Carolina"; "de/da/do/dos/das/e" ficam minúsculos no meio; nome de **pessoa** digitado todo em
maiúsculas ("ANA CAROLINA") também vira "Ana Carolina" (nome de cliente, que pode ser sigla/empresa, só ganha a inicial maiúscula).

**Continua logado ao recarregar:** a sessão (token) fica guardada no navegador — com "Manter conectado" marcado sobrevive a
fechar o navegador; desmarcado, sobrevive a recarregar a página e some ao fechar a aba. Junto vai a "visão" (qual tela do painel
e qual unidade estavam abertas): atualizar a página volta pro mesmo lugar, sem novo login. `GET /auth/sessao` reabre a sessão
(token vencido ou conta desativada → volta pra home). Os links de convite (`?perfil=…`, `?cadastro=…`) mostram a tela pedida.

**Fases do atendimento e falta da prestadora (agenda):**
- **Regra do relógio:** atendimento que **não foi cancelado e cuja prestadora não foi trocada vale como CONFIRMADO por ela** — não existe
  "aceitar" um atendimento que já começou. Com prestadora ligada: o horário de **início** chegou → **▶ em andamento** (convite sem
  resposta vira "aceito" e a tarifa dela é travada); o horário de **término** passou → **concluído** (convite nunca respondido também;
  sem horário vale o dia todo). Sem prestadora (pedido/recusado) ninguém foi: continua como está. Não há exceção por escolha manual.
  A regra roda a cada poucos minutos **e** na hora em que a agenda, a área da prestadora, a do cliente e o Financeiro abrem.
- Antes de começar: **programado** ou **cancelado**. Em andamento: falta da prestadora ou cancelar. Depois do término o sistema conclui
  sozinho e, depois de concluído, o administrador **só pode mudar para "prestadora não foi" (falta)**; cancelar/reprogramar um concluído
  é recusado (400). Reativar (cancelado → programado) um atendimento de data passada com prestadora já o deixa **concluído**.
- **Falta** (`status = falta`): só em atendimento confirmado/concluído **que já começou** e com prestadora. Não conta como atendimento
  nem entra em receita/repasse; engano se desfaz voltando a "concluído". Depois de registrada a falta não cancela nem reprograma.
- **Meta de faltas** (Equipe → *Meta de faltas*, só administrador): percentual aceitável por prestadora. A linha da Equipe mostra
  "Faltas: X de Y (Z%) · aceitável até N%" e fica em **vermelho** se passar. Taxa = faltas ÷ (concluídos + faltas).
- **A prestadora nunca vê isso**: pra ela o atendimento com falta continua "concluído"; a meta mora em tabela à parte
  (`controle_prestadora`) e nenhuma rota dela devolve a palavra falta (testado em `teste:agenda`).

**Cidade pertence a um único CNPJ (regra estrita):** a mesma cidade (nome + UF, sem diferenciar acento/maiúscula) não pode existir em
dois CNPJs. Vale no cadastro de administrador (barra já no 1º passo, antes do e-mail), em "Adicionar unidade" e no `admin:criar`,
com trava contra duas empresas tentando a mesma cidade ao mesmo tempo. Mesmo nome em **UF diferente** é outra cidade (Santa Maria/RS ≠
Santa Maria/PE). `npm run unidades:conflitos` só **lista** cidades que já estejam em mais de um CNPJ no banco.

**Carregando com porcentagem:** barra fina no topo em qualquer chamada que passa de ~0,3 s; cartão com **porcentagem** ao entrar,
reabrir a sessão, trocar de unidade (% = chamadas concluídas ÷ esperadas) e ao enviar a planilha (% de bytes enviados, depois
"processando…").

**Celular:** menu do painel numa linha própria com rolagem; seletor de cidades vira lista suspensa (mais de 3 cidades); campos com 16 px
(sem zoom no iPhone), botões de 40–44 px, janelas quase em tela cheia e o balão do atendimento vira folha no rodapé.

**Duas abas, duas sessões:** cada aba guarda a própria sessão (sessionStorage) — entrar numa conta em outra aba não troca a conta desta;
o localStorage só guarda a sessão "lembrada" para abas **novas**, e sair/expirar numa aba só apaga a lembrada se for a mesma.

**Relatórios (menu *Relatórios*, só administrador completo — funcionário não vê, porque a aba mostra faltas, metas e margem):**
três abas — **Agenda**, **Financeiro** e **Satisfação** — com período à escolha (este mês, mês passado, 30/90 dias, este ano, 12 meses,
um mês qualquer pelas setas ‹ ›, ou datas personalizadas) e, pra quem tem mais de uma unidade, o seletor "Só esta unidade" ×
"Todas as minhas unidades" (soma e compara as unidades do administrador). Cada aba compara com o período anterior (▲/▼), tem gráficos,
tabelas, alertas e os botões **Baixar planilha (CSV)** e **Imprimir** (a impressão sai sem menu).
- **Agenda:** atendimentos (concluídos × programados), horas realizadas, cancelamentos e faltas (com taxas), taxa de recusa de convites,
  clientes atendidos/que voltaram/novos, recorrentes × avulsos, gráfico por dia/semana/mês, situação (funil), dias da semana, mapa de calor
  dia × hora, serviços e origem dos pedidos, tabela por prestadora (faltas × meta, recusas), clientes e locais que mais aparecem, avisos de
  cancelamento (lidos e tempo até ler) e alertas (passou sem prestadora, futuros sem prestadora, choque de horário, profissional da planilha sem cadastro).
  Do **histórico de status**: **tempo médio de resposta ao convite** por prestadora (média, mediana e % em até 24 h; também na tabela de
  prestadoras), **quem cancelou** (cliente / franquia / prestadora / não informado), **motivos dos cancelamentos** (escritas parecidas são
  somadas), antecedência dos cancelamentos (quantos com menos de 24 h) e o **funil real** pedido → convite → confirmado → concluído.
  O aceite só abre 2 dias antes do atendimento, então o tempo de resposta a um aceite conta **desde a abertura dessa janela** (a recusa
  conta desde o convite). Atendimentos anteriores ao histórico ficam de fora desses indicadores e a tela diz quantos são.
- **Financeiro:** receita, custo, margem, ticket médio, receita por hora, a realizar, receita perdida (cancelados e faltas com valor),
  repasses pagos × a pagar, série do período, evolução dos últimos 12 meses, por serviço, maiores clientes (e concentração), resultado por prestadora.
  A receita perdida com cancelamentos aparece **por quem cancelou e por motivo** (do histórico de status).
- **Satisfação:** nota média e % de satisfeitos (só avaliações **aprovadas**), distribuição das notas, taxa de resposta (avaliações ÷
  concluídos), tempo até avaliar e de moderação, nota por serviço e por período, ranking de prestadoras (nota + faltas + recusas +
  cancelamentos), pontos de atenção (nota ≤ 3) e elogios. A "nota média" **não é NPS** (o portal ainda não pergunta "você indicaria?").
Regras: "atendimento" é tudo que não foi cancelado nem falta; cancelado e falta não geram receita nem repasse; o período é o do **serviço**
(data do atendimento). Os cálculos ficam em `api/src/utils/relatorios.js` (testados por `npm run teste:relatorios`, sem banco) e a API em
`/api/relatorios/:slug/agenda|financeiro|satisfacao` (`?mes=AAAA-MM`, `?preset=`, `?de=&ate=`, `&escopo=todas`). O levantamento de dados
que serviu de base, e o que ainda não é capturado, está em `RELATORIOS-LEVANTAMENTO-DE-DADOS.md`.

**Prestadora ativa/inativa (Equipe → Desativar / Reativar, só administrador completo):** inativa **não recebe atendimento novo**
(some da lista de atribuição; a API recusa em novo atendimento, troca, convite e série), **não entra mais no portal** (login
recusado e quem estava logada é barrada na hora) e o histórico continua. Ao desativar, o sistema avisa quantos atendimentos futuros
ainda estão com ela — reatribua na agenda (no balão ela aparece como "(inativa)"). Reativar devolve tudo.

**Cliente acompanha seus atendimentos:** na área do cliente, cada atendimento mostra serviço, data/horário, status
(aguardando profissional · confirmado · concluído · cancelado) e, depois de **confirmado**, a **profissional com nome
e foto**. Enquanto é só convite a profissional não aparece (ela ainda pode recusar). **"Solicitar cancelamento"** só
abre o WhatsApp da unidade com a mensagem pronta (serviço, data, referência) — **não altera o atendimento**: quem cancela
é o administrador. `GET /atendimentos/cliente/me/atendimentos`.

**Convidar cliente sem cadastro e "Substituir perfil" (aba Clientes):** o cliente que só existe na agenda (veio da
planilha/agendamento) aparece como *sem cadastro*; **Convidar por WhatsApp** abre a conversa com o convite e o link do
cadastro (`?cadastro=cliente&unidade=…`, já na cidade certa) e registra o envio. Depois do convite, o administrador
completo vê **Substituir perfil**: escolhe o perfil que o cliente criou e todos os vínculos do provisório (atendimentos,
avaliações e qualquer outra tabela que aponte pra `clientes`) passam pro novo, numa única transação; o provisório é
removido. Só vale se: o provisório não tem login e **já foi convidado**; o destino tem login, é da mesma unidade e
**não tem nenhum atendimento**. Não dá pra desfazer. `POST /unidades/:slug/admin/clientes/:id/substituir`.

**CNPJ:** vale qualquer CNPJ válido pela regra oficial (dígitos verificadores), com ou sem pontuação, **inclusive o
alfanumérico** emitido pela Receita desde julho/2026 (ex.: `12.ABC.345/01DE-35`). O campo formata enquanto digita e avisa
se os dígitos não conferem. (`teste:agenda` confere 2.000 CNPJs válidos sorteados e CNPJs reais.)

**Financeiro (menu *Financeiro*; administrador, ou funcionário com a permissão "Financeiro" marcada em Acessos):**
tela por mês (setas ‹ ›) com
- **Receita** (soma do valor cobrado dos concluídos), **Custo** (repasses às prestadoras) e **Margem** (R$ e %),
  com comparação ao mês anterior; mais o **A realizar no mês** (receita e custo previstos dos agendados).
  A margem só considera os atendimentos em que se sabe o valor E o custo (a tela diz "calculada em X de Y") — receita
  sem custo pareceria lucro puro.
- **Repasses às prestadoras**: por prestadora, os atendimentos concluídos do mês × o valor por atendimento dela, com
  total, pago e pendente. **Ver** abre os atendimentos e permite **baixar a planilha (CSV, abre no Excel)**;
  **Marcar como pago** registra o pagamento (e trava o valor: mudar a tarifa depois não altera o que foi pago) e
  **Desfazer pagamento** reverte. A prestadora vê no painel dela quanto do mês já foi pago.
- **Margem por serviço** e **Maiores clientes**.
- **Alertas e pendências**: concluídos sem valor cobrado, sem custo (prestadora sem valor por atendimento definido), futuros sem
  prestadora, convites vencidos. Cada pendência é clicável e abre a agenda no dia, pra completar o valor.
Os cálculos ficam em `api/src/utils/financeiro.js` (testados por `npm run teste:financeiro`, sem banco) e a API em
`/api/financeiro/:slug/...`. Receita = o que o **cliente** paga; custo = o que a **franquia** paga à prestadora.

**Correção das contagens da Visão geral e da Equipe:** as views do banco juntavam atendimentos com avaliações e
contavam cada atendimento uma vez por avaliação (1 atendimento + 5 avaliações = "5 hoje"; o faturamento e o total da
Equipe saíam multiplicados). Agora cada número tem a sua própria consulta; "hoje" é a data de Brasília e cancelado não
conta. A migração roda sozinha ao subir a API.

**Empresas e unidades (CNPJ):** uma conta de administrador pertence a **uma empresa (um CNPJ)**, e a empresa pode ter
**várias unidades** (franquias de qualquer cidade) — o mesmo login alterna entre elas pelo seletor no topo do painel. Quem
tem **outro CNPJ** é outra empresa e usa **outro login** (e-mail diferente).
- *Criar conta → Administrador:* CNPJ, dados do administrador e os dados da unidade que está cadastrando (cidade, UF,
  telefone/WhatsApp, endereço opcional). **CNPJ novo** → nasce a empresa e a primeira unidade, depois do código por e-mail
  (o CNPJ é conferido pelos dígitos verificadores). **CNPJ que já existe** → só o dono acrescenta unidade: precisa informar
  **exatamente o mesmo nome, e-mail e senha** da conta da empresa (a senha é a prova; sem código); a unidade nova é
  acrescentada e ele entra. Errar qualquer dado dá sempre a mesma resposta (não revela qual falhou) e conta no limite de
  tentativas (por e-mail+IP), porque seria um jeito de chutar senha. Saber o CNPJ — que é público — nunca basta.
- *Meu perfil → Adicionar unidade* (administrador logado): a mesma ação, sem redigitar nada; mostra o CNPJ da empresa e as
  unidades que ela tem. A nova unidade herda o CNPJ.
- Nome de unidade repetido dentro da mesma empresa é recusado; pedidos simultâneos não duplicam (trava por empresa no banco).
- O site começa **sem unidades** no banco limpo; tudo que depende da lista (seletor de cidade da home, cadastros de cliente e
  prestadora, seletor do painel) é montado a partir do que existe, sem nada fixo.
- **Funcionários são por unidade:** cada funcionário acessa só a unidade em que foi criado; quem cuida da agenda de uma franquia
  não ganha acesso às outras da mesma empresa (o administrador troca de unidade no seletor e cadastra o funcionário lá).

**Prestadora criada pelo administrador:** na aba **Equipe → "+ Nova prestadora"** (só administrador completo): nome, e-mail e/ou
telefone (é por um deles que ela entra) e senha provisória (em branco, o sistema gera uma de 8 caracteres e mostra **uma vez**,
com atalho pra mandar o acesso por WhatsApp). Se a agenda tinha atendimentos com o nome dela vindos da planilha ("prestadora sem
cadastro"), eles são ligados à conta nova na hora. Na agenda, esses atendimentos mostram **"prestadora sem cadastro no Portal da
Maria"** e o balão tem o botão "Cadastrar agora" com o nome já preenchido.

**Painel inicial personalizável por unidade:** na Visão geral, **Personalizar** (só administrador) escolhe quais atalhos
(Agenda, Equipe, Clientes, Avaliações, Financeiro, Relatórios) e cartões (atendimentos hoje, profissionais, faturamento, NPS, agenda
de hoje) aparecem e a ordem dos atalhos. Cada unidade tem o seu layout, salvo no banco (`unidades.painel_config`), e vale para toda a
equipe daquela unidade.

**Cadastro de atendimento (um formulário só):** a aba *Atendimento* serve para um atendimento avulso **ou** para repetir toda semana
(caixa "Repetir toda semana": dias da semana, por quantos meses, semana sim/não). Ligada a repetição, o valor passa a ser o do **mês
inteiro** e é dividido entre todas as ocorrências do mês de todos os dias marcados (R$ 1.000 com 4 terças + 5 quintas = 9 atendimentos,
somando exatamente 1.000,00). Antes eram dois formulários com os mesmos campos repetidos; a recorrência agora também guarda a duração
e aceita cliente novo.

**Modelo da planilha de importação:** na aba *Importar planilha* há a lista de colunas consideradas e o botão **Baixar modelo (.xlsx)**
(colunas Número, Data, Horário e Serviço obrigatórias; Orçamento, Tipo, Horas, Cliente, Profissionais, Situação opcionais; e **Valor** e
**Custo** opcionais — o que o cliente paga e o repasse à prestadora —, para quando o sistema da franquia exportar isso). O modelo traz
3 linhas de exemplo com Número `EXEMPLO-n`, que o importador **ignora**, e uma aba "Como preencher".

**Limite de login:** só tentativas ERRADAS contam (10 por conta+IP em 15 min; 60 por IP) — logins certos, mesmo
muitos seguidos, nunca bloqueiam.

Outras proteções: CORS restrito a uma allowlist (`CORS_ORIGINS` no `.env`, default `http://localhost:5000`), limite
de tentativas em login/cadastro/pedido público (`express-rate-limit`), e todo texto livre vindo de cliente/prestadora
(nome, serviço, comentário de avaliação) é escapado no frontend antes de entrar em HTML — sem isso, um pedido público
com `<script>` no lugar do serviço executaria no navegador de quem visualizasse a lista.

---

## 6. O que dá pra fazer no sistema hoje

- **Administrador**: dashboard da unidade, agenda em calendário (mês + linha do tempo do dia) com reatribuição de
  prestadora, atendimento recorrente por semana-padrão, moderação de avaliações, equipe, clientes, telefone de
  WhatsApp da unidade editável, valor por atendimento de cada prestadora (tela Equipe), local de cada atendimento
  editável na própria agenda, e uma tela de **Acessos** pra criar/editar sub-administradores com permissão por
  módulo.
- **Prestadora**: convites pendentes (só pode confirmar a partir de 2 dias antes do atendimento), agenda confirmada,
  calendário dos próprios atendimentos, avaliações recebidas, e o que tem a receber (valor por atendimento definido
  pela franquia × atendimentos da semana/do mês).
- **Cliente**: pedido de orçamento pela home (sem login), avaliação de atendimentos concluídos.
- **Cadastro de atendimentos (agenda do admin → "+ Novo atendimento / importar planilha")**: duas abas.
  *Atendimento único*: data, horário, serviço, duração, cliente (existente ou novo), prestadora e valor opcionais —
  com prestadora vira convite e abre o WhatsApp com o link pra ela confirmar. *Importar planilha*: aceita o `.xlsx`
  exportado do sistema da franquia (colunas Orçamento, Número, Data, Horário, Período, Serviço, Tipo, Horas,
  Cliente, Profissionais, Situação, Recorrente). Mostra uma **pré-visualização** (quantos são novos, quantos já
  existiam, clientes novos, profissionais que serão cadastradas) e só grava quando você confirma. A coluna **Número** é a
  chave: reimportar o mesmo arquivo (ou um export mais novo) só traz o que ainda não existe. Clientes são criados
  (sem login) pelo nome, e as profissionais da planilha viram prestadoras (e-mail `nome@gmail.com`, senha `senha123`,
  ver abaixo). A duração da coluna Horas define a altura do bloco na agenda.
- **WhatsApp (clique pra conversar)**: ao reatribuir prestadora, ao ela confirmar um atendimento, e ao pedir um
  orçamento marcando "via WhatsApp", o sistema abre automaticamente um link `wa.me` com a mensagem (dados do
  atendimento ou do pedido) já preenchida para o número certo — prestadora ou unidade. Quem abriu ainda aperta
  "enviar" no WhatsApp; não há envio nem leitura de resposta automática (isso exigiria a API oficial da Meta). A
  mensagem pra prestadora traz o **link do site** (`<endereço do site>?perfil=prestadora`, que abre direto o login
  dela) porque a confirmação só acontece no portal, não por resposta no WhatsApp.
- **Meu perfil**: clique no seu avatar (canto superior direito) em qualquer painel — administrador,
  sub-administrador, prestadora ou cliente — pra editar nome, foto (salva na hora; o navegador recorta e reduz a
  imagem antes de enviar), telefone e senha. Troca de e-mail passa por confirmação por e-mail com um código de 6
  dígitos (igual ao cadastro — nunca por WhatsApp, já que não existe API de WhatsApp de verdade). Qualquer domínio de e-mail é aceito, pros 4 tipos de
  usuário — a restrição a `@mariabrasileira.com.br` foi desligada por decisão do usuário (o código que a implementa
  continua em `api/src/utils/normalizacao.js`, só não é chamado por enquanto).

## 7. Fora de escopo por enquanto

- **Integração com a API oficial de WhatsApp Business (Meta Cloud API)** — pausada; a verificação de conta
  comercial exigida pela Meta se mostrou mais trabalhosa do que o previsto. O que existe hoje (versão 0.0.0.0) é o link
  "clique pra conversar" (`wa.me`), que não depende de conta verificada nem de token — só não envia sozinho nem
  processa a resposta automaticamente. A API oficial fica pra uma versão futura.
- Atualizar atendimentos já importados quando uma planilha mais nova traz mudança neles (ex.: "Previsto" que virou
  "Concluído") — hoje a reimportação só traz o que for novo.
- Valor (cobrado do cliente) vindo da planilha: ela não tem essa coluna.
- Edição de data/hora de um atendimento já criado (só reatribuição de prestadora).

---

## 8. Segurança (varredura de 16/10/2026)

Revisão de todo o projeto (API, front, banco, scripts, configuração de deploy e dependências). `npm audit`: **0 vulnerabilidades
conhecidas**; nenhum segredo no histórico do git (só os exemplos do `.env.example`); todo SQL usa parâmetros (os poucos nomes de tabela
dinâmicos vêm de mapas fixos no código); o front escapa os dados antes de pôr no HTML. O que foi **corrigido** nesta rodada
(cada item tem teste em `npm run teste:seguranca`):

| Risco | Correção |
|---|---|
| Sessão (token de 7 dias) continuava valendo depois de trocar/redefinir a senha — quem roubou o token mantinha o acesso | Cada conta guarda `senha_alterada_em`; token emitido antes disso cai (401) na hora. Vale pra "esqueci a senha", Meu perfil → senha, primeiro acesso, senha de funcionário trocada pelo administrador e `npm run admin:criar -- --redefinir`. Quem troca a senha pela tela recebe um token novo e continua logado. Conta apagada também derruba o token. (`api/src/utils/sessao.js`) |
| Token aceitava qualquer algoritmo "pedido" por ele | Só HS256, na assinatura e na verificação |
| Trocar o e-mail da conta exigia só a sessão aberta (token roubado → trocar e-mail → "esqueci a senha" → conta tomada) | Trocar o e-mail passa a pedir a **senha atual** (campo novo no Meu perfil), com teto de 5 erros / 15 min por conta |
| E-mail com vírgula/ponto e vírgula (`eu@x.com,vitima@y.com`) era aceito: o código de cadastro ia pra vários destinatários | `emailValido` recusa vírgula, ponto e vírgula, aspas, < > ( ) [ ] \ e mais de 254 caracteres |
| Cadastro mandava e-mail sem limite por destinatário (dava pra lotar a caixa de alguém trocando de IP) e o código de 6 dígitos de um cadastro podia ser chutado de vários IPs | Limite **por e-mail**: 6 pedidos e 10 conferências erradas a cada 15 min |
| Foto de perfil: só o começo (`data:image/png;base64,`) era conferido — texto com aspas/tag depois do prefixo ia pro banco e depois pro HTML/CSS | O servidor confere a foto inteira (base64 puro); o front também só usa foto no formato seguro |
| **XSS** no botão "Cadastrar agora" (agenda): nome vindo da planilha com `&quot;` quebrava o atributo `onclick` | O nome passa por `escapeHtml` antes de entrar no atributo |
| Cliente recebia colunas internas da franquia em `/cliente/me/pendentes-avaliacao` (`select a.*`: valor pago à prestadora, repasse, código da planilha) | A rota devolve só os 8 campos que a tela usa |
| Pedido **público** (sem login) com o nome de um cliente existente caía na conta dele (qualquer um enchia o histórico de outra pessoa com atendimentos falsos); campos sem validação de tipo/data | Pedido público só reaproveita cliente **sem conta**; tipos, datas (30/02, ano 9999), horário e tamanhos são validados |
| Aceite de convite: entre a conferência e o `update` a unidade podia trocar a prestadora, e o aceite caía num atendimento de outra | O `update` exige `prestadora_id` e `status = 'proposto'`; se mudou, responde 409 |
| Um cliente podia avaliar o mesmo atendimento quantas vezes quisesse (inflar/derrubar a nota) | Uma avaliação por atendimento (409); avaliação sem prestadora é recusada |
| Telefone da unidade (público, vira link do WhatsApp) aceitava qualquer texto | Só número válido com DDD |
| Corpo de 2 MB / 9 MB era lido **antes** de conferir o login | `requireAuth` roda antes dos parsers grandes (foto e planilha): sem login, 401 sem ler o corpo |
| "Bomba de zip": uma planilha .xlsx pequena que descompacta em gigabytes derrubaria o servidor por falta de memória | Cada item do zip é descompactado com teto (40 MB por item, 120 MB no total; o tamanho declarado no cabeçalho não é confiado) antes de a planilha ser lida |
| Tempo de resposta do login revelava se a conta existe | Conta inexistente também gasta uma comparação de senha (mesmo tempo da senha errada) |
| Id fora do formato (UUID), data inválida ou texto com caractere nulo viravam erro 500 | O erro do banco por valor inválido vira **400** com mensagem genérica |
| Nenhum teto geral de requisições; erro não tratado numa promessa derrubava o processo | Teto de 1.500 requisições/min por IP (`/api/ping` e `/api/health` livres); `unhandledRejection` só é registrado |
| Sem CSP e sem cabeçalhos de permissão | `Content-Security-Policy` (script/estilo/imagem/fonte só do próprio site e das fontes do Google, `connect-src 'self'`, sem iframe/objeto/base de fora), `Permissions-Policy` (câmera, microfone, localização desligados) e `X-Permitted-Cross-Domain-Policies` |
| `window.open` do WhatsApp sem `noopener`; campos de senha sem `autocomplete` (o navegador podia preencher a senha do **administrador** no campo "senha" de um funcionário novo) | Abas externas abrem com `noopener,noreferrer`; `autocomplete="new-password"`/`current-password` nos campos certos; links `target="_blank"` com `rel="noopener noreferrer"` |
| `npm run banco:schema` num banco hospedado criava contas de exemplo com senha pública ("senha123") | Com `DATABASE_URL`, o comando recusa sem `--sem-exemplos` (ou `--com-exemplos`, explícito) |
| Cancelar série podia apagar uma "falta" de hoje (mudava pra cancelado) | Série cancelada ignora o que já é "falta" |

### Riscos que continuam (decisões de negócio / limites da arquitetura)

- **Senha padrão das prestadoras importadas (`senha123`) + login pelo NOME no primeiro acesso.** É o fluxo pedido, mas quem souber o nome
  de uma prestadora que ainda não fez o primeiro acesso consegue entrar nessa conta e definir o e-mail dela. Mitigações já existentes:
  o limite de tentativas por conta/IP, e a conta só vale até o primeiro acesso ser concluído. **Recomendação:** pedir pras prestadoras
  concluírem o primeiro acesso logo após a importação; a opção futura é trocar a senha fixa por uma **senha provisória aleatória por
  conta**, mostrada uma vez ao administrador (como já é feito pra prestadora criada na Equipe).
- **O token fica no `localStorage`/`sessionStorage`** do navegador (padrão de SPA). Um XSS futuro o exporia; hoje não há XSS conhecido e o
  CSP limita pra onde um código injetado poderia mandar dados. Trocar por cookie `HttpOnly` exigiria reescrever o login. A senha
  trocada ou redefinida agora encerra as outras sessões.
- **O CSP ainda permite `'unsafe-inline'`** em script e estilo, porque o HTML usa `onclick="..."` e `style="..."` em muitos lugares. Tirar isso
  (trocar por `addEventListener`/classes) deixaria o CSP bloquear qualquer script injetado.
- **Contas de prestadora que dividem o mesmo e-mail** (o e-mail de prestadora não é único): "esqueci a senha" redefine **todas** as contas
  ligadas àquele e-mail de uma vez. É o comportamento documentado; evite dois cadastros com o mesmo e-mail.
- **Cadastro aberto de prestadora e de cliente** (qualquer pessoa pode criar conta numa unidade, confirmando o e-mail). É por desenho; o
  administrador só envia convites e dados pra quem ele escolhe.
- **JWT_SECRET:** o do Render é gerado pelo próprio Render. Se algum dia vazar (ele já apareceu numa imagem durante o desenvolvimento),
  troque no painel do Render — isso desconecta todo mundo. Depois, troque também a senha do banco no Neon se a `DATABASE_URL` tiver
  aparecido em algum lugar.
- Dependências: rode `npm audit` de vez em quando dentro de `api/` (hoje 0 vulnerabilidades); `nodemailer`, `pg`, `express-rate-limit` e
  `read-excel-file` têm versões de correção mais novas (`npm outdated`), sem vulnerabilidade conhecida nas instaladas.
