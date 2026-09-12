# Portal da Maria — v1.0.0

Sistema de gestão para franquias de serviços de limpeza (TCC), com 3 perfis de acesso principais — administrador
(franqueado), prestadora e cliente — mais sub-administradores com permissões por módulo. Roda 100% local:
`Portal Da Maria - V1.0.0.html` (frontend) fala com uma API própria em Node/Express (`api/`), que conversa com um
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
qualquer string aleatória longa.

```bash
npm install
npm start
```

Deve aparecer `API do Portal da Maria rodando em http://localhost:3001`. Teste em outra aba: `http://localhost:3001/api/health`
deve responder `{"ok":true}`.

---

## 4. Abrir o frontend

O `Portal Da Maria - V1.0.0.html` faz `fetch()` para `http://localhost:3001/api`, então **precisa ser servido por um
servidor local** (não abrir com duplo-clique) por causa de CORS:

- **VS Code:** extensão "Live Server" → botão direito no arquivo → "Open with Live Server".
- **Terminal (Node):** na pasta do projeto, `npx serve .` e abra o endereço que aparecer.

Com a API rodando (passo 3) e o HTML servido, teste o fluxo:

1. Home pública → deve carregar Carazinho/Panambi (dado público, sem login).
2. Login como **administrador**: `renata@mariabrasileira.com` / `senha123`.
3. Login como **prestadora**: telefone `(54) 9 9000-0001` / `senha123` (Fabiana S.).
4. Cadastro novo de qualquer perfil → deve gravar no Postgres (confira com `SELECT * FROM administradores;` no psql,
   ou com uma extensão de PostgreSQL no VS Code).

---

## 5. Estrutura do backend (`api/`)

```
api/
  src/
    server.js               — entrypoint Express
    db.js                   — pool de conexão pg
    middleware/auth.js       — requireAuth / requireRole / requireAcessoUnidade (JWT + permissão por módulo)
    utils/
      permissoes.js          — vínculo admin↔unidade e permissões de sub-administrador
      asyncHandler.js        — evita que erro numa rota derrube o processo
    routes/
      auth.js                — cadastro (admin/prestadora/cliente) + login unificado
      unidades.js             — dados institucionais + dashboard/equipe/clientes do admin
      atendimentos.js          — pedido público, agenda (calendário/dia), propor/reatribuir/concluir,
                                  atendimento recorrente (padrão semanal), convites/aceitar/recusar (prestadora)
      avaliacoes.js             — cliente envia, admin/sub-admin modera, prestadora vê aprovadas
      subadministradores.js     — CRUD de sub-administradores (só admin completo)
```

Autenticação: senha com hash `bcrypt`, sessão via JWT (7 dias) guardado no `localStorage` do navegador (`pm-token`).
Autorização por unidade e por módulo é sempre reconferida no backend a cada request (`requireAcessoUnidade`), nunca
só confiando no que o token diz.

---

## 6. O que dá pra fazer no sistema hoje

- **Administrador**: dashboard da unidade, agenda em calendário (mês + linha do tempo do dia) com reatribuição de
  prestadora, atendimento recorrente por semana-padrão, moderação de avaliações, equipe, clientes, e uma tela de
  **Acessos** pra criar/editar sub-administradores com permissão por módulo.
- **Prestadora**: convites pendentes (só pode confirmar a partir de 2 dias antes do atendimento), agenda confirmada,
  calendário dos próprios atendimentos, avaliações recebidas.
- **Cliente**: pedido de orçamento pela home (sem login), avaliação de atendimentos concluídos.

## 7. Fora de escopo por enquanto

- **Integração com WhatsApp Business API** — pausada; a verificação de conta comercial exigida pela Meta se mostrou
  mais trabalhosa do que o previsto. Fica pra uma versão futura.
- Duração configurável de atendimento (a agenda usa um bloco fixo de 60min).
- Edição de data/hora de um atendimento já criado (só reatribuição de prestadora).
