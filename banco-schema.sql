-- ============================================================================
-- Portal da Maria — Schema PostgreSQL (v1.1.0)
-- Autenticação e autorização são responsabilidade da API Node/Express em
-- api/ (bcrypt para senha, JWT para sessão, checagem de permissão por
-- unidade/módulo nas próprias rotas) — não depende de Supabase Auth nem de
-- Row Level Security.
-- ============================================================================

-- Extensão para gerar UUIDs
create extension if not exists "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

create type status_atendimento as enum (
  'pedido',      -- cliente solicitou (via site/whatsapp), ainda sem prestadora
  'proposto',    -- unidade ofereceu o atendimento a uma prestadora (convite)
  'recusado',    -- prestadora recusou o convite
  'aceito',      -- prestadora aceitou; entra na agenda confirmada
  'concluido',   -- atendimento realizado
  'cancelado'    -- cancelado por qualquer parte
);

create type status_avaliacao as enum (
  'pendente',    -- aguardando moderação da unidade
  'aprovada',    -- liberada para a prestadora ver
  'recusada'     -- moderada e não publicada
);

create type origem_pedido as enum ('site', 'whatsapp');

create type perfil_usuario as enum ('administrador', 'prestadora', 'cliente');

-- ============================================================================
-- UNIDADES (equivalente a `cidades` + `unidades` no HTML)
-- ============================================================================

create table unidades (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,          -- 'carazinho' | 'panambi'
  nome           text not null,                 -- 'Carazinho'
  uf             text not null,                 -- 'RS'
  cnpj           text not null,                 -- CNPJ da franquia dessa unidade. Duas unidades PODEM
                                                 -- compartilhar o mesmo CNPJ (mesmo franqueado/mesma empresa)
                                                 -- ou ter CNPJs diferentes — por isso o campo fica na unidade,
                                                 -- não no administrador.
  telefone       text not null,
  endereco       text not null,                 -- endereço completo (contato)
  endereco_curto text not null,                 -- endereço curto (home)
  criado_em      timestamptz not null default now()
);

comment on table unidades is 'Unidades franqueadas (Carazinho, Panambi). Alimenta o seletor de região da home e o alternador de unidade no painel admin.';

-- ============================================================================
-- ADMINISTRADORES (franqueados)
-- ============================================================================

create table administradores (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  sobrenome   text not null,
  email       text unique not null,
  telefone    text,
  foto        text,           -- data URL (base64) da foto de perfil; sem storage de arquivo por ora
  senha_hash  text not null,  -- hash bcrypt gerado pela API no cadastro (não é mais "gerenciado pelo Supabase")
  criado_em   timestamptz not null default now()
);

-- Relação N:N entre administradores e unidades (decisão de segurança do
-- projeto: evita usar CNPJ como controle de acesso; um admin pode
-- gerenciar 1 ou mais unidades)
create table administrador_unidades (
  administrador_id uuid not null references administradores(id) on delete cascade,
  unidade_id        uuid not null references unidades(id) on delete cascade,
  primary key (administrador_id, unidade_id)
);

comment on table administrador_unidades is 'Vínculo N:N administrador<->unidade. Substitui controle de acesso por CNPJ (risco de segurança identificado no projeto).';

-- ============================================================================
-- PRESTADORAS (equivalente a `prestadora` + `equipeData` no HTML)
-- ============================================================================

create table prestadoras (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  telefone    text not null unique,       -- login da prestadora
  email       text,                       -- usado pra verificar identidade no cadastro (não há API de WhatsApp
                                           -- de verdade); nulo só pra prestadoras cadastradas antes dessa mudança
  foto        text,                       -- data URL (base64) da foto de perfil
  senha_hash  text not null,              -- hash bcrypt gerado pela API no cadastro
  unidade_id  uuid not null references unidades(id),
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now()
);

comment on table prestadoras is 'Cadastro vinculado à unidade desde o cadastro, com identidade confirmada por e-mail (sem API de WhatsApp de verdade, a verificação nunca foi por telefone).';

-- ============================================================================
-- CLIENTES (equivalente a `clientesData` no HTML)
-- ============================================================================

create table clientes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,               -- pode ser pessoa física ou nome fantasia (ex: 'Cond. Primavera')
  telefone    text,
  email       text unique,
  foto        text,                        -- data URL (base64) da foto de perfil
  senha_hash  text,                        -- nulo para clientes cadastrados via pedido avulso (sem login ainda)
  unidade_id  uuid not null references unidades(id),
  criado_em   timestamptz not null default now()
);

-- ============================================================================
-- ATENDIMENTOS — tabela central (unifica `jobs`, `convites`,
-- `agendaPrestadora` e `concluidos` do protótipo numa única entidade,
-- diferenciada pelo campo `status`)
-- ============================================================================

create table atendimentos (
  id              uuid primary key default gen_random_uuid(),
  unidade_id      uuid not null references unidades(id),
  cliente_id      uuid references clientes(id),        -- nulo em pedidos avulsos ainda não vinculados a um cadastro
  prestadora_id   uuid references prestadoras(id),      -- nulo até virar 'proposto'/'aceito'
  tipo_servico    text not null,                        -- 'Limpeza residencial', 'Passadoria', etc.
  area            text,                                 -- bairro/endereço resumido (ex: 'Bairro Centro')
  data_atendimento date not null,
  hora_atendimento time,
  valor           numeric(10,2),
  status          status_atendimento not null default 'pedido',
  origem          origem_pedido not null default 'site',
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table atendimentos is 'Espinha dorsal do modelo de dados. Progressão de status: pedido -> proposto -> aceito -> concluido (ou recusado/cancelado a qualquer momento).';

create index idx_atendimentos_unidade on atendimentos(unidade_id);
create index idx_atendimentos_prestadora on atendimentos(prestadora_id);
create index idx_atendimentos_status on atendimentos(status);

-- ============================================================================
-- AVALIAÇÕES (equivalente a `avaliacoes` no HTML)
-- ============================================================================

create table avaliacoes (
  id              uuid primary key default gen_random_uuid(),
  atendimento_id  uuid not null references atendimentos(id),
  cliente_id      uuid not null references clientes(id),
  prestadora_id   uuid not null references prestadoras(id),
  nota            smallint not null check (nota between 1 and 5),
  comentario      text,
  status          status_avaliacao not null default 'pendente',
  moderado_por    uuid, -- id de administradores OU sub_administradores; sem FK unica, pode vir de duas tabelas
  moderado_em     timestamptz,
  criado_em       timestamptz not null default now()
);

comment on table avaliacoes is 'Ciclo cliente -> moderação do admin -> prestadora. Somente status=aprovada é visível para a prestadora (regra do protótipo).';

create index idx_avaliacoes_status on avaliacoes(status);
create index idx_avaliacoes_prestadora on avaliacoes(prestadora_id);

-- ============================================================================
-- CÓDIGOS DE VERIFICAÇÃO (cadastro por e-mail/WhatsApp)
-- ============================================================================

create table codigos_verificacao (
  id          uuid primary key default gen_random_uuid(),
  destino     text not null,        -- e-mail ou telefone
  codigo      text not null,        -- código de 6 dígitos
  usado       boolean not null default false,
  expira_em   timestamptz not null,
  criado_em   timestamptz not null default now()
);

comment on table codigos_verificacao is 'Códigos/tokens de verificação por e-mail — cadastro (admin/prestadora/cliente, 6 dígitos) e troca de e-mail no perfil (link "clique OK", qualquer perfil). Sempre por e-mail: não há API de WhatsApp de verdade. Envio real de e-mail é simulado (logado no console) por ora.';

-- ============================================================================
-- VIEWS — substituem os campos pré-calculados que existiam nos mocks
-- (ex: `unidades[key].atend`, `equipeData[].serv/.nota`,
-- `clientesData[].ultimo/.total`), evitando dados duplicados/desatualizados
-- ============================================================================

-- Dashboard "Visão geral" do admin
create view vw_dashboard_unidade as
select
  u.id as unidade_id,
  u.nome as unidade_nome,
  count(*) filter (where a.data_atendimento = current_date) as atendimentos_hoje,
  count(distinct a.prestadora_id) filter (where a.data_atendimento = current_date and a.status = 'aceito') as prestadoras_escaladas_hoje,
  coalesce(sum(a.valor) filter (where date_trunc('month', a.data_atendimento) = date_trunc('month', current_date) and a.status = 'concluido'), 0) as faturamento_mes,
  round(avg(av.nota) filter (where av.status = 'aprovada'), 1) as nps_medio
from unidades u
left join atendimentos a on a.unidade_id = u.id
left join avaliacoes av on av.prestadora_id in (select id from prestadoras p where p.unidade_id = u.id)
group by u.id, u.nome;

-- Tela "Equipe"
create view vw_equipe_unidade as
select
  p.id as prestadora_id,
  p.unidade_id,
  p.nome,
  p.ativa,
  count(a.id) filter (where a.status = 'concluido') as total_atendimentos,
  round(avg(av.nota) filter (where av.status = 'aprovada'), 1) as nota_media
from prestadoras p
left join atendimentos a on a.prestadora_id = p.id
left join avaliacoes av on av.prestadora_id = p.id
group by p.id, p.unidade_id, p.nome, p.ativa;

-- Tela "Clientes"
create view vw_clientes_unidade as
select
  c.id as cliente_id,
  c.unidade_id,
  c.nome,
  count(a.id) as total_servicos,
  max(a.data_atendimento) as ultimo_atendimento_data,
  (array_agg(a.tipo_servico order by a.data_atendimento desc))[1] as ultimo_atendimento_tipo
from clientes c
left join atendimentos a on a.cliente_id = c.id and a.status = 'concluido'
group by c.id, c.unidade_id, c.nome;

-- ============================================================================
-- SEED DATA — reproduz fielmente os dados mockados no protótipo HTML
-- Senhas de exemplo: todas "senha123" (hash bcrypt gerado com custo 10)
-- ============================================================================

-- Unidades (`cidades` / `unidades`)
-- telefone é o número (WhatsApp) da franquia usado nos links de "clique pra
-- conversar" do site — editável pelo administrador em runtime (PATCH
-- /unidades/:slug/telefone), estes são só os valores de partida.
insert into unidades (id, slug, nome, uf, cnpj, telefone, endereco, endereco_curto) values
  ('11111111-1111-1111-1111-111111111111', 'carazinho', 'Carazinho', 'RS', '12.345.678/0001-90', '(54) 9 9909-310', 'Rua Exemplo, 123 — Centro, Carazinho/RS', 'Rua Exemplo, 123 — Centro'),
  ('22222222-2222-2222-2222-222222222222', 'panambi',   'Panambi',   'RS', '12.345.678/0002-71', '(55) 9680-6226', 'Av. Exemplo, 456 — Centro, Panambi/RS',   'Av. Exemplo, 456 — Centro');

-- Administrador de exemplo — senha: senha123
insert into administradores (id, nome, sobrenome, email, senha_hash) values
  ('d0000000-0000-0000-0000-000000000001', 'Renata', 'Almeida', 'renata@mariabrasileira.com', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O');

insert into administrador_unidades (administrador_id, unidade_id) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- Prestadoras (`equipeData`) — senha: senha123
-- telefone gravado só com dígitos (sem DDD com parênteses/espaço) — o backend
-- normaliza pro mesmo formato tanto no cadastro quanto no login, então
-- digitar "(54) 9 9000-0001" ou "54990000001" no login funciona igual.
insert into prestadoras (id, nome, telefone, senha_hash, unidade_id, ativa) values
  ('a0000000-0000-0000-0000-000000000001', 'Fabiana S.',  '54990000001', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O', '11111111-1111-1111-1111-111111111111', true),
  ('a0000000-0000-0000-0000-000000000002', 'Cláudia B.',  '54990000002', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O', '11111111-1111-1111-1111-111111111111', true),
  ('a0000000-0000-0000-0000-000000000003', 'Joana R.',    '54990000003', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O', '11111111-1111-1111-1111-111111111111', true),
  ('a0000000-0000-0000-0000-000000000004', 'Patrícia L.', '54990000004', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O', '11111111-1111-1111-1111-111111111111', false),
  ('a0000000-0000-0000-0000-000000000005', 'Rosa M.',     '55990000005', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O', '22222222-2222-2222-2222-222222222222', true),
  ('a0000000-0000-0000-0000-000000000006', 'Inês K.',     '55990000006', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O', '22222222-2222-2222-2222-222222222222', true),
  ('a0000000-0000-0000-0000-000000000007', 'Daniel T.',   '55990000007', '$2b$10$OXiJF9wC56zrf6o1ozs7oeztV5wd4e61DicovoZueBYeeBbaM1E4O', '22222222-2222-2222-2222-222222222222', true);

-- Clientes (`clientesData`)
insert into clientes (id, nome, unidade_id) values
  ('b0000000-0000-0000-0000-000000000001', 'Amanda C.',        '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000002', 'Marcos T.',        '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000003', 'Cond. Primavera',  '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000004', 'Escritório Norte', '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000005', 'Júlia R.',         '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000006', 'Bruno A.',         '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000007', 'Helena P.',        '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000008', 'Família Souza',    '22222222-2222-2222-2222-222222222222'),
  ('b0000000-0000-0000-0000-000000000009', 'Clínica Vida',     '22222222-2222-2222-2222-222222222222'),
  ('b0000000-0000-0000-0000-00000000000a', 'Loja Veste Bem',   '22222222-2222-2222-2222-222222222222');

-- Atendimentos: agenda do dia de Carazinho e Panambi (`unidades[key].jobs`)
insert into atendimentos (unidade_id, cliente_id, prestadora_id, tipo_servico, area, data_atendimento, hora_atendimento, valor, status) values
  ('11111111-1111-1111-1111-111111111111', null, 'a0000000-0000-0000-0000-000000000001', 'Limpeza residencial', 'Bairro Centro',        current_date, '08:00', 130.00, 'aceito'),
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'Limpeza empresarial', 'Escritório Norte',      current_date, '09:30', 160.00, 'aceito'),
  ('11111111-1111-1111-1111-111111111111', null, null, 'Pós-obra', 'Rua das Flores', current_date, '13:00', null, 'proposto'),
  ('11111111-1111-1111-1111-111111111111', null, 'a0000000-0000-0000-0000-000000000003', 'Passadoria', 'Cond. Primavera', current_date, '15:00', 90.00, 'aceito'),
  ('11111111-1111-1111-1111-111111111111', null, null, 'Limpeza residencial', 'Bairro Oriental', current_date, '17:00', null, 'proposto'),
  ('22222222-2222-2222-2222-222222222222', null, 'a0000000-0000-0000-0000-000000000005', 'Limpeza residencial', 'Centro', current_date, '08:30', null, 'proposto'),
  ('22222222-2222-2222-2222-222222222222', null, null, 'Limpeza empresarial', 'Indústria Sul', current_date, '10:00', null, 'aceito'),
  ('22222222-2222-2222-2222-222222222222', null, 'a0000000-0000-0000-0000-000000000007', 'Sanitização', 'Clínica Vida', current_date, '14:00', null, 'aceito'),
  ('22222222-2222-2222-2222-222222222222', null, 'a0000000-0000-0000-0000-000000000006', 'Passadoria', 'Res. Bela Vista', current_date, '16:30', null, 'proposto');

-- Convites pendentes de aceite pela prestadora Fabiana S. (`convites`)
insert into atendimentos (unidade_id, prestadora_id, tipo_servico, area, data_atendimento, hora_atendimento, valor, status) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'Limpeza residencial', 'Bairro São João', current_date + 1, '08:00', 130.00, 'proposto'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'Limpeza empresarial', 'Av. Pátria, Centro', current_date + 2, '14:00', 160.00, 'proposto');

-- Agenda já aceita pela prestadora Fabiana S. (`agendaPrestadora`)
insert into atendimentos (unidade_id, prestadora_id, tipo_servico, area, data_atendimento, hora_atendimento, valor, status) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'Passadoria', 'Cond. Acácias', current_date, '10:00', 90.00, 'aceito'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'Limpeza residencial', 'Vila Nova', current_date, '15:00', 130.00, 'aceito');

-- Atendimentos concluídos aguardando avaliação do cliente (`concluidos`)
insert into atendimentos (id, unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, status) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Passadoria', current_date - 12, 'concluido'),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Limpeza pós-obra', current_date - 25, 'concluido');

-- Avaliações (`avaliacoes`) — 4 já aprovadas + 1 pendente de moderação
insert into atendimentos (id, unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, status) values
  ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Limpeza residencial', '2026-06-18', 'concluido'),
  ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Passadoria', '2026-06-15', 'concluido'),
  ('c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Limpeza residencial', '2026-06-09', 'concluido'),
  ('c0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Limpeza pós-obra', '2026-06-02', 'concluido'),
  ('c0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Passadoria', '2026-06-21', 'concluido');

insert into avaliacoes (atendimento_id, cliente_id, prestadora_id, nota, comentario, status) values
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 5, 'Casa impecável, super atenciosa!', 'aprovada'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 5, 'Sempre pontual e caprichosa.', 'aprovada'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 4, 'Muito boa, recomendo.', 'aprovada'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 5, 'Trabalho excelente.', 'aprovada'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 4, 'Tudo certo, atenciosa.', 'pendente');

-- ============================================================================
-- SUB-ADMINISTRADORES, RECORRÊNCIA E ORIGEM 'manual'
-- Funcionários do franqueado (permissões granulares por módulo, vinculados a
-- UMA unidade) + agrupamento de atendimentos recorrentes gerados em lote.
-- ============================================================================

-- Atendimento criado direto no painel do admin (avulso ou recorrente),
-- diferente de um pedido vindo do site ou do WhatsApp.
alter type origem_pedido add value 'manual';

-- Agrupamento de atendimentos recorrentes — não é FK, não existe tabela de
-- regra: cada ocorrência já nasce como uma linha concreta em atendimentos.
alter table atendimentos add column serie_id uuid;
comment on column atendimentos.serie_id is 'Tag compartilhada pelas linhas geradas de uma vez por um atendimento recorrente.';
create index idx_atendimentos_serie on atendimentos(serie_id) where serie_id is not null;

-- Importação de planilha de atendimentos (.xlsx do sistema da franquia).
-- codigo_externo = coluna "Número" da planilha: é a chave que impede duplicar
-- na reimportação (único por unidade; atendimentos criados no portal ficam nulos).
alter type origem_pedido add value 'importacao';
alter table atendimentos add column codigo_externo text;
alter table atendimentos add column orcamento_externo text;        -- coluna "Orçamento" (agrupa vários atendimentos)
alter table atendimentos add column duracao_horas numeric(4,1);    -- coluna "Horas"; nulo = bloco de 1h na agenda
alter table atendimentos add column profissional_externo text;     -- nome da planilha quando não casou com nenhuma prestadora cadastrada
create unique index uq_atendimentos_codigo_externo on atendimentos(unidade_id, codigo_externo) where codigo_externo is not null;

create table sub_administradores (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  sobrenome       text not null,
  email           text unique not null,
  telefone        text,
  foto            text,           -- data URL (base64) da foto de perfil
  senha_hash      text not null,
  unidade_id      uuid not null references unidades(id),
  ativo           boolean not null default true,
  criado_por      uuid references administradores(id),
  pode_dashboard  boolean not null default false,
  pode_agenda     boolean not null default false,
  pode_avaliacoes boolean not null default false,
  pode_equipe     boolean not null default false,
  pode_clientes   boolean not null default false,
  pode_financeiro boolean not null default false, -- reservado, módulo "em breve" no painel
  criado_em       timestamptz not null default now()
);

comment on table sub_administradores is 'Contas de funcionários do franqueado, vinculadas a UMA unidade, com permissões por módulo (pode_<modulo>).';

create index idx_sub_administradores_unidade on sub_administradores(unidade_id);

-- ============================================================================
-- FIM
-- ============================================================================
