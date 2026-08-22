# Como rodar o Portal da Maria 100% local (PostgreSQL + API Node/Express)

Esta é a 4ª variação do protótipo, focada em desenvolvimento sem depender de nuvem:

| Arquivo | Fonte de dados |
|---|---|
| `Portal Da Maria - LOCAL.html` | API própria (`api/`) que fala com PostgreSQL rodando na sua máquina |

Diferente da versão `CONECTADO.html` (que usa Supabase), aqui a autenticação (bcrypt + JWT) e as regras de autorização
vivem no próprio backend Node, em `api/`.

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

Depois, ainda conectado (agora no banco `portal_da_maria`), aplique o schema local:

```bash
psql -U postgres -d portal_da_maria -f "banco-schema-local.sql"
```

(Rode esse comando a partir da pasta `C:\Maria-Project`, ou ajuste o caminho do arquivo.)

Isso cria as tabelas, enums, views e já popula com os mesmos dados de exemplo do protótipo (usuário admin, prestadoras,
clientes, atendimentos). **Todas as senhas de exemplo são `senha123`.**

---

## 3. Configurar e instalar a API

```bash
cd api
copy .env.example .env
```

Edite o `api/.env` e troque `PGPASSWORD` pela senha que você definiu na instalação do PostgreSQL, e `JWT_SECRET` por
qualquer string aleatória longa.

As dependências já foram instaladas (`npm install` rodado com sucesso — `bcrypt@6`, `express`, `pg`, `jsonwebtoken`,
`dotenv`, `cors`, 0 vulnerabilidades no `npm audit`).

Para rodar a API:

```bash
cd api
npm start
```

Deve aparecer `API do Portal da Maria rodando em http://localhost:3001`. Teste em outra aba: `http://localhost:3001/api/health`
deve responder `{"ok":true}`.

---

## 4. Abrir o frontend

O `Portal Da Maria - LOCAL.html` faz `fetch()` para `http://localhost:3001/api`, então **precisa ser servido por um
servidor local** (não abrir com duplo-clique) por causa de CORS — mesma observação das outras versões:

- **VS Code:** extensão "Live Server" → botão direito no arquivo → "Open with Live Server".
- **Terminal (Node):** na pasta do projeto, `npx serve .` e abra o endereço que aparecer.

Com a API rodando (passo 3) e o HTML servido, teste o fluxo:

1. Home pública → deve carregar Carazinho/Panambi (dado público, sem login).
2. Login como **administrador**: `renata@mariabrasileira.com` / `senha123`.
3. Login como **prestadora**: telefone `(54) 9 9000-0001` / `senha123` (Fabiana S.).
4. Cadastro novo de qualquer perfil → deve gravar no Postgres (confira com `SELECT * FROM administradores;` no psql).

---

## 5. Estrutura do backend (`api/`)

```
api/
  src/
    server.js          — entrypoint Express
    db.js               — pool de conexão pg
    middleware/auth.js   — valida JWT e checa perfil (requireAuth / requireRole)
    utils/permissoes.js  — checa se o admin logado administra a unidade
    routes/
      auth.js            — cadastro (admin/prestadora/cliente) + login unificado
      unidades.js         — dados institucionais + dashboard/equipe/clientes do admin
      atendimentos.js      — pedido público, agenda, propor/concluir (admin), convites/aceitar/recusar (prestadora)
      avaliacoes.js         — cliente envia, admin modera, prestadora vê aprovadas
```

Autenticação: senha com hash `bcrypt`, sessão via JWT (7 dias) guardado no `localStorage` do navegador
(`pm-token`). Autorização por unidade (RLS do Supabase virou checagem manual em `utils/permissoes.js` + `WHERE` nas
queries).

---

## 6. Próximos passos possíveis

- Trocar o PostgreSQL local por Docker (facilita replicar em outra máquina).
- Adicionar testes automatizados para as rotas da API.
- Reaproveitar o mesmo `api/` numa migração futura para produção (trocar só `PGHOST`/`PGPASSWORD` para um Postgres
  gerenciado, ex. Supabase, RDS, Railway).
