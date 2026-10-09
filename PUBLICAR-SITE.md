# Publicar o Portal da Maria na internet (Render + Neon)

Como fica: **um endereço só** (ex.: `https://portal-da-maria.onrender.com`). A API em Node entrega o site
(`Portal Da Maria.html`) e responde em `/api` no mesmo endereço. O banco PostgreSQL fica no **Neon**.
Os dois têm plano grátis.

> **Por que não Cloudflare Pages?** Separar o site (Cloudflare) da API (Render) exigiria uma conta a mais, CORS e
> trocar o endereço da API no front — e o ganho seria pequeno, porque a API do Render grátis "dorme" do mesmo jeito.
> Com o site servido pela própria API, o front já usa `location.origin + /api` e **não existe CORS pra configurar**.
> Cloudflare Pages só valeria a pena com um domínio próprio e muito acesso; fica como evolução, não é necessário.

---

## ✅ O que já está pronto no código (nada a fazer)

| Item | Situação |
|---|---|
| Endereço da API no front | Automático: usa o endereço de onde o site foi aberto (`localhost:3001` só no Live Server/arquivo local) |
| Conexão com o banco | `DATABASE_URL` (Neon) com SSL, ou `PG*` local; espera o banco "acordar" (até 20 s) |
| CORS | Não precisa: site e API no mesmo endereço |
| Atrás do proxy do Render | `TRUST_PROXY=1`: limites de login/cadastro enxergam o IP real de cada visitante |
| Segurança | Cabeçalhos (`nosniff`, anti-iframe, HSTS), sem `X-Powered-By`, só o HTML é servido (testei: `.env`, `.sql`, `package.json`, `LEIA-ME` dão 404), `JWT_SECRET` fraco derruba a subida |
| Dependências | `npm audit`: **0 vulnerabilidades** (corrigi `proxy-addr` e `qs`, que estavam com falha crítica/moderada) |
| Build do Render | `npm ci` testado numa cópia limpa; `render.yaml` na raiz (Node 22, health check leve `/api/ping`, região Ohio) |
| Banco novo | `npm run banco:schema` (testado em banco vazio, PostgreSQL 17); `-- --sem-exemplos` não cria contas de exemplo |
| Primeiro acesso | `npm run admin:criar` cria o administrador direto no banco, sem depender de e-mail |
| Fuso horário | O servidor roda em UTC; todas as consultas de "hoje" já usam o horário de Brasília |
| Dados reais | Ensaiei levar o seu banco local pro online (dump → restore): funciona, ver passo 4-B |

---

## 🔴 O que SÓ VOCÊ pode fazer (e como)

São contas e autorizações em seu nome. **Nunca me mande senhas nem a connection string** — você mesmo cola nos
painéis; se algo der erro, me conte a mensagem (sem o segredo).

### 1. Autorizar o envio do código pro GitHub *(preciso do seu "sim")*
O Render publica a partir do repositório `pedrinho7636/maria-para-todos`, branch `master`. Hoje o GitHub só tem a
versão 0.0.0.0; tudo da 0.0.1.1 (Financeiro, valores, endereço, correções) está só no seu computador.
**Me diga a mensagem do commit** (como da outra vez) e eu faço o commit e o push. Não subo sem isso.

### 2. Criar o banco no Neon
1. Conta em <https://neon.tech> (dá pra entrar com o GitHub).
2. **Create project** → nome `portal-da-maria`, Postgres **17**, região **AWS US East 2 (Ohio)** *(é a mesma região do
   Render que configurei; banco e API perto um do outro = site rápido. Não escolha São Paulo.)*
3. Em **Connect**, deixe **Connection pooling DESLIGADO** e copie a *connection string*:
   `postgresql://usuario:senha@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require`
   Se vier `&channel_binding=require` no fim, **apague** essa parte.
   ⚠ É uma senha: não cole em chat, print ou arquivo do projeto.

### 3. Criar as tabelas no Neon (do seu computador)
No PowerShell (a connection string só fica nessa janela):

```powershell
cd C:\Maria-Project\api
$env:DATABASE_URL = "COLE-A-CONNECTION-STRING-AQUI"
npm run banco:schema -- --sem-exemplos
```
Tem que aparecer `Pronto: tabelas criadas SEM dados de exemplo`. Escolha **uma** das duas variações:

- **`-- --sem-exemplos` (recomendado pra site público):** banco **limpo**: nenhuma unidade, conta ou atendimento. Cada
  empresa cria as suas unidades ao se cadastrar (CNPJ + cidade/UF/telefone), então não existe mais CNPJ de exemplo que
  dê acesso a alguma coisa. Siga o 3-A.
- **Já rodou o `banco:schema` antes e quer começar do zero (apagar os dados de exemplo ou de teste do Neon)?**
  Acrescente `--recriar`: `npm run banco:schema -- --sem-exemplos --recriar`. Ele mostra **qual banco** vai ser apagado e
  só continua se você digitar `APAGAR TUDO`. Só apaga o banco da `DATABASE_URL` da janela atual: o seu banco local
  (com a agenda importada) não é tocado, a menos que você rode o comando **sem** definir `DATABASE_URL`.
- **sem a flag (modo demonstração):** vem com atendimentos/clientes/prestadoras de exemplo e **contas com a senha
  `senha123`** (ex.: `renata@mariabrasileira.com`). Qualquer pessoa que leia o repositório consegue entrar nelas.
  Aceitável só pra uma demonstração curta; depois apague os dados ou troque as senhas.

**3-A. Criar o seu administrador e a(s) unidade(s).** Dois jeitos:

- **Pelo próprio site** (*Entrar → Criar conta → Administrador*): CNPJ, seus dados e os dados da unidade (cidade, UF,
  telefone/WhatsApp). CNPJ novo cria a empresa e a primeira unidade; as outras unidades da mesma empresa entram depois por
  *Meu perfil → Adicionar unidade*. Exige o código por e-mail, então só funciona depois que o e-mail estiver saindo (item 6).
- **Pelo PowerShell, sem e-mail** (ainda na mesma janela, com `DATABASE_URL` definida):
  ```powershell
  npm run admin:criar -- --email SEU@EMAIL.com --nome SeuNome --sobrenome SeuSobrenome --cnpj 00.000.000/0001-00 --unidades "Carazinho/RS,Panambi/RS" --telefone "(54) 9 9999-9999"
  ```
  `--unidades` é uma lista de `Cidade/UF`: cada uma é **criada** (precisa do `--cnpj`, validado pelos dígitos). Todas as
  unidades da conta ficam no mesmo CNPJ, e o mesmo login alterna entre elas. Ele pergunta a senha (a digitação fica
  oculta). Depois feche o PowerShell (ou rode `$env:DATABASE_URL = $null`).

### 4. *(Opcional)* Levar os seus dados reais pro Neon
Se quiser o site já com a agenda importada, as 11 prestadoras da planilha, os funcionários etc. — **no lugar do
passo 3** (o banco do Neon tem que estar **vazio**):

```powershell
$bin = "C:\Program Files\PostgreSQL\17\bin"
$env:PGPASSWORD = "SENHA-DO-SEU-POSTGRES-LOCAL"
& "$bin\pg_dump.exe" -h localhost -U postgres -d portal_da_maria --no-owner --no-privileges -Fc -f "$HOME\portal.dump"
& "$bin\pg_restore.exe" --no-owner --no-privileges -d "COLE-A-CONNECTION-STRING-AQUI" "$HOME\portal.dump"
$env:PGPASSWORD = $null
```
⚠ Cuidados: o arquivo `portal.dump` tem **dados pessoais e hashes de senha** — apague depois (`.gitignore` já impede o
commit de `*.dump`). As prestadoras da planilha têm e-mails presumidos (`nome@gmail.com`) e a senha **`senha123`**, e o
site público fica aberto a qualquer pessoa: **troque essas senhas** (ou use o passo 3 e importe a planilha de novo pelo
próprio portal, que cria as prestadoras do mesmo jeito). Os funcionários que você criou também mantêm a senha antiga.

### 5. Criar o serviço no Render
1. Conta em <https://render.com> (entre com o GitHub e autorize o repositório `maria-para-todos`).
2. **New → Blueprint** → escolha `maria-para-todos`. O Render lê o `render.yaml` e preenche tudo (inclusive um
   `JWT_SECRET` aleatório).
3. Quando pedir os valores secretos: **`DATABASE_URL`** = a connection string do Neon; **`RESEND_API_KEY`** = veja o
   item 6 (pode ficar vazio por enquanto).
4. **Apply**. O primeiro deploy leva de 3 a 5 minutos. Depois, todo push no `master` republica sozinho.

### 6. E-mail em produção (Resend) — ⚠ a parte mais chata
O Render grátis **bloqueia SMTP** (o Gmail que usamos no seu computador não funciona lá). O envio sai pela Resend:
1. Conta em <https://resend.com> → **API Keys** → criar → colar em `RESEND_API_KEY` (Render → serviço → Environment).
2. **Limitação:** sem domínio próprio verificado, a Resend só entrega pro **e-mail dono da conta** (o seu). Pra qualquer
   outro destinatário receber o código de cadastro/recuperação de senha, é preciso um domínio:
   - comprar um (ex.: `.com.br` no <https://registro.br>, em torno de R$ 40 por ano);
   - na Resend: **Domains → Add Domain**, e criar no painel do registro os registros DNS que ela mostrar (SPF/DKIM);
   - trocar `EMAIL_FROM` no Render por algo como `Portal da Maria <nao-responda@seudominio.com.br>`.
3. **Sem domínio, o que funciona:** cadastros com o seu e-mail; e, pra quem você cadastrar, **o código aparece nos
   Logs do Render** (serviço → Logs) quando o e-mail não sai — dá pra repassar à pessoa. Para a banca, o mais simples
   é você mesmo criar as contas de demonstração (como administrador, na tela Acessos, ou com `npm run admin:criar`).

### 7. Testar em dispositivos diferentes
1. Abra `https://SEU-SERVICO.onrender.com/api/health` → deve mostrar `{"ok":true,"banco":"ok"}`.
2. No PC entre como administrador; no celular, como prestadora ou cliente (o link `?perfil=prestadora` abre direto o
   login dela).
3. Crie um atendimento com prestadora no PC: o convite aparece no celular em poucos segundos.

### 8. *(Se for o caso)* Ajustes depois de publicado
- **Empresas, CNPJ e unidades:** uma conta de administrador é de **uma empresa (um CNPJ)**, que pode ter várias unidades
  (o mesmo login alterna entre elas); outro CNPJ = outro login. Pelo site: *Criar conta → Administrador* (CNPJ novo cria
  empresa + primeira unidade; CNPJ que já existe só aceita quem informar o **mesmo nome, e-mail e senha** da conta da
  empresa) e, logado, *Meu perfil → Adicionar unidade*. Saber o CNPJ (dado público) nunca dá acesso a uma empresa.
  Para trocar o CNPJ de uma unidade à mão: Neon → **SQL Editor**:
  `update unidades set cnpj = '00.000.000/0001-00' where slug = 'carazinho';` (use o mesmo CNPJ em todas as unidades
  da mesma empresa).
- **E-mail que não sai:** a tela diz o motivo — *"recusou o usuário/senha"* ou *"não conseguiu se conectar"* (porta de
  SMTP bloqueada pela hospedagem). Se for **"recusou o usuário/senha"**: `SMTP_USER` tem que ser **exatamente a conta do
  Google que gerou a senha de app** (não o e-mail que vai receber o código!) e `SMTP_PASS` a senha de app de 16 letras,
  sem espaços nem aspas. Ao subir, a API escreve nos **Logs** do Render uma linha `[email] SMTP smtp.gmail.com:587 · conta
  pe***@gmail.com · senha com 16 caracteres` — confira se a conta e o tamanho batem com o que você espera. No **Shell** do
  Render (planos pagos) dá pra testar sem passar pela tela: `cd api && npm run email:teste -- seu@email.com`.
- **Publicar uma atualização:** como o Render clona o repositório sem estar conectado à sua conta do GitHub, o `git push`
  pode não republicar sozinho. No painel do serviço, use **Manual Deploy → Deploy latest commit**.
- **Telefone e endereço da unidade:** o administrador edita em **Acessos** no próprio portal.
- **Domínio próprio no site:** Render → serviço → Settings → Custom Domains (você compra o domínio).

---

## ⏱ Comportamento do plano grátis (avise a banca / abra antes)

- **Render grátis "dorme"** após 15 min sem acesso; o 1º acesso seguinte leva cerca de 1 minuto. **Abra o site uns
  minutos antes da apresentação.** Truque grátis pra não dormir: um monitor (ex.: <https://uptimerobot.com>, a cada 5
  minutos) chamando `https://SEU-SERVICO.onrender.com/api/ping`. Essa rota não toca o banco, então o Neon continua
  podendo dormir (acorda em ~1 s no primeiro acesso).
- **Neon grátis** dorme sozinho quando ocioso e tem cota mensal de uso; com pouco acesso, sobra.
- Os limites de login são por conta e por IP e ficam na memória: reiniciar o serviço zera os contadores.

## Resumo dos cuidados

- Nunca commitar `DATABASE_URL`, `RESEND_API_KEY` ou `JWT_SECRET` (ficam só nos painéis; o `.gitignore` protege `.env`).
- Contas de exemplo (`senha123`) e prestadoras importadas (`senha123`) **não devem ficar assim num site público**
  por muito tempo.
- **Rodar local continua igual** (`npm start` em `api/`, com os `PG*` do `.env`; abre em `http://localhost:3001`).
