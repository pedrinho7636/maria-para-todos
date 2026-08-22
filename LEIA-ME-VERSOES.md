# Como usar as duas versões do Portal da Maria

Agora existem **3 variações** do protótipo, todas derivadas do mesmo `Portal Da Maria V 0.0.3.html`:

| Arquivo | O que muda | Fonte de dados |
|---|---|---|
| `Portal Da Maria V 0.0.3.html` (original enviado) | Nada — é o seu arquivo original | Dados fixos no próprio código JS |
| **`Portal Da Maria - SIMULADO.html`** | Lê os dados de um arquivo externo | `banco-simulado.txt` (JSON num arquivo `.txt`, sem banco de verdade) |
| **`Portal Da Maria - CONECTADO.html`** | Lê/grava direto num banco real | Supabase/PostgreSQL, usando `banco-schema.sql` |

As duas versões novas também já têm a mudança pedida no cadastro do administrador: **Nome e Sobrenome separados** + **campo de CNPJ** (aceita mais de um CNPJ, separados por vírgula — para o franqueado que administra duas franquias, com o mesmo CNPJ ou com CNPJs diferentes).

---

## 1. `Portal Da Maria - SIMULADO.html`

Não usa banco de verdade. Ele faz `fetch('banco-simulado.txt')` assim que a página abre e usa esse conteúdo para preencher as mesmas variáveis que antes eram fixas no código (agenda, equipe, clientes, avaliações etc.).

**Importante:** `fetch()` não funciona abrindo o HTML direto (duplo-clique / `file://`) por causa de bloqueio de CORS do navegador. Você precisa servir os dois arquivos por um servidor local. Duas formas simples:

- **VS Code:** instale a extensão "Live Server", clique com o botão direito no `Portal Da Maria - SIMULADO.html` → "Open with Live Server".
- **Terminal (Node):** na pasta onde estão os dois arquivos, rode:
  ```
  npx serve .
  ```
  e abra o endereço que aparecer (ex.: `http://localhost:3000`).

Os dois arquivos (`Portal Da Maria - SIMULADO.html` e `banco-simulado.txt`) precisam estar **na mesma pasta**.

Se o `fetch` falhar, aparece um aviso no topo da página explicando o problema.

---

## 2. `Portal Da Maria - CONECTADO.html`

Essa é a modificação do arquivo original para se conectar de verdade ao banco (Supabase/PostgreSQL), usando o `banco-schema.sql` que já tínhamos.

### Passo a passo para deixar funcionando:

1. **Crie um projeto no Supabase** (supabase.com), se ainda não tiver um.
2. No painel do Supabase, vá em **SQL Editor** e rode o conteúdo do `banco-schema.sql` (ele cria as tabelas, views, RLS e já insere os dados de exemplo).
3. No painel, vá em **Project Settings → API** e copie a **Project URL** e a **anon public key**.
4. Abra o `Portal Da Maria - CONECTADO.html` num editor de texto e troque estas duas linhas perto do topo do `<script>`:
   ```js
   const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
   const SUPABASE_ANON_KEY = "SUA-CHAVE-ANON-AQUI";
   ```
   pelas suas chaves reais.
5. Abra o arquivo por um servidor local (mesma observação do item 1 — `file://` direto não funciona bem com chamadas de rede no navegador).

### O que já está realmente ligado ao banco:
- Carregamento de unidades, agenda do dia, equipe, clientes e avaliações (via `SELECT`, inclusive pelas views `vw_dashboard_unidade`, `vw_equipe_unidade`, `vw_clientes_unidade`)
- Login (`supabase.auth.signInWithPassword`)
- Cadastro de administrador (com CNPJ vinculando à(s) unidade(s) certa(s)), prestadora e cliente (`supabase.auth.signUp` + insert na tabela do perfil)
- Aceitar/recusar convite (`UPDATE atendimentos`)
- Aprovar/recusar avaliação (`UPDATE avaliacoes`)
- Cliente enviar avaliação (`INSERT avaliacoes`)
- Pedido de orçamento pela home (`INSERT atendimentos`)

### O que ainda depende de você configurar no Supabase:
- **Confirmação de e-mail:** por padrão o Supabase Auth exige confirmar o e-mail antes do primeiro login. Para testar rápido, desative isso em **Authentication → Providers → Email → "Confirm email"**, ou confirme manualmente pelo painel.
- **RLS:** as políticas já estão no `banco-schema.sql`, mas dependem de `administradores.id` / `prestadoras.id` / `clientes.id` serem o mesmo UUID do usuário criado no Supabase Auth — é exatamente isso que o `doCadastro()` faz agora.
- Cadastro de prestadora usa um e-mail "fake" gerado a partir do telefone (`5599999999@prestadora.portaldamaria.app`), porque o Supabase Auth exige e-mail mesmo no fluxo que no protótipo é "só WhatsApp". Se quiser um fluxo 100% por telefone, dá pra trocar para `supabase.auth.signInWithOtp` com SMS/WhatsApp via um provedor de Auth por telefone — isso fica pra próxima etapa, quando a integração com WhatsApp Business API entrar.

---

## 3. Sobre o CNPJ e o Nome/Sobrenome

- O CNPJ agora vive na tabela **`unidades`** (uma franquia = um CNPJ), não no administrador — porque, como você apontou, o mesmo franqueado pode ter duas franquias com o mesmo CNPJ ou com CNPJs diferentes.
- No cadastro, o administrador informa o(s) CNPJ(s) das franquias que administra (separados por vírgula, se for mais de uma). O sistema busca em `unidades.cnpj` e cria o vínculo em `administrador_unidades` automaticamente para cada unidade encontrada.
- "Nome completo" virou dois campos (**Nome** e **Sobrenome**), tanto na interface quanto na tabela `administradores` (`nome` + `sobrenome`).
