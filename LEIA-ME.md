# Portal da Maria — v1.1.0

Sistema de gestão para franquias de serviços de limpeza (TCC), com 3 perfis de acesso principais — administrador
(franqueado), prestadora e cliente — mais sub-administradores com permissões por módulo. Roda 100% local:
`Portal Da Maria - V1.1.0.html` (frontend) fala com uma API própria em Node/Express (`api/`), que conversa com um
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

O `Portal Da Maria - V1.1.0.html` faz `fetch()` para `http://localhost:3001/api`, então **precisa ser servido por um
servidor local** (não abrir com duplo-clique) por causa de CORS:

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

## 5. Estrutura do backend (`api/`)

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
      asyncHandler.js        — evita que erro numa rota derrube o processo
    routes/
      auth.js                — cadastro (admin/prestadora/cliente) + login unificado
      unidades.js             — dados institucionais + dashboard/equipe/clientes do admin
      atendimentos.js          — pedido público, agenda (calendário/dia), propor/reatribuir/concluir,
                                  atendimento recorrente (padrão semanal), convites/aceitar/recusar (prestadora)
      avaliacoes.js             — cliente envia, admin/sub-admin modera, prestadora vê aprovadas
      sync.js                   — impressão digital do que cada usuário enxerga (a tela consulta a cada 4s)
      subadministradores.js     — CRUD de sub-administradores (só admin completo)
      perfil.js                 — "Meu perfil": nome/foto/telefone/senha + e-mail com verificação, pros 4 tipos
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
  WhatsApp da unidade editável, e uma tela de **Acessos** pra criar/editar sub-administradores com permissão por
  módulo.
- **Prestadora**: convites pendentes (só pode confirmar a partir de 2 dias antes do atendimento), agenda confirmada,
  calendário dos próprios atendimentos, avaliações recebidas.
- **Cliente**: pedido de orçamento pela home (sem login), avaliação de atendimentos concluídos.
- **Cadastro de atendimentos (agenda do admin → "+ Novo atendimento / importar planilha")**: duas abas.
  *Atendimento único*: data, horário, serviço, duração, cliente (existente ou novo), prestadora e valor opcionais —
  com prestadora vira convite e abre o WhatsApp com o link pra ela confirmar. *Importar planilha*: aceita o `.xlsx`
  exportado do sistema da franquia (colunas Orçamento, Número, Data, Horário, Período, Serviço, Tipo, Horas,
  Cliente, Profissionais, Situação, Recorrente). Mostra uma **pré-visualização** (quantos são novos, quantos já
  existiam, clientes novos, profissionais sem cadastro) e só grava quando você confirma. A coluna **Número** é a
  chave: reimportar o mesmo arquivo (ou um export mais novo) só traz o que ainda não existe. Clientes são criados
  (sem login) pelo nome; profissionais que ainda não são prestadoras cadastradas aparecem na agenda como "sem
  cadastro". A duração da coluna Horas define a altura do bloco na agenda.
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
  comercial exigida pela Meta se mostrou mais trabalhosa do que o previsto. O que existe hoje (v1.1.0) é o link
  "clique pra conversar" (`wa.me`), que não depende de conta verificada nem de token — só não envia sozinho nem
  processa a resposta automaticamente. A API oficial fica pra uma versão futura.
- Atualizar atendimentos já importados quando uma planilha mais nova traz mudança neles (ex.: "Previsto" que virou
  "Concluído") — hoje a reimportação só traz o que for novo.
- Cadastrar automaticamente como prestadoras as profissionais que aparecem na planilha (elas ficam como "sem
  cadastro" na agenda até alguém criar a conta).
- Edição de data/hora de um atendimento já criado (só reatribuição de prestadora).
