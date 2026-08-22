-- ============================================================================
-- Portal da Maria — Schema PostgreSQL (Supabase)
-- Gerado a partir da engenharia reversa de "Portal Da Maria V 0.0.3.html"
-- Os dados de exemplo (INSERTs) reproduzem exatamente os mocks usados no
-- protótipo, para permitir testar o front-end contra o banco real.
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
  id          uuid primary key default gen_random_uuid(), -- mesmo id do auth.users (Supabase Auth)
  nome        text not null,
  sobrenome   text not null,
  email       text unique not null,
  senha_hash  text not null,  -- gerenciada pelo Supabase Auth; coluna mantida só para referência/compatibilidade
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
  telefone    text not null,               -- usado no cadastro/verificação via WhatsApp
  unidade_id  uuid not null references unidades(id),
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now()
);

comment on table prestadoras is 'Cadastro vinculado à unidade desde a verificação por WhatsApp (regra observada no fluxo de cadastro do protótipo).';

-- ============================================================================
-- CLIENTES (equivalente a `clientesData` no HTML)
-- ============================================================================

create table clientes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,               -- pode ser pessoa física ou nome fantasia (ex: 'Cond. Primavera')
  telefone    text,
  email       text,
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
  moderado_por    uuid references administradores(id),
  moderado_em     timestamptz,
  criado_em       timestamptz not null default now()
);

comment on table avaliacoes is 'Ciclo cliente -> moderação do admin -> prestadora. Somente status=aprovada é visível para a prestadora (regra do protótipo).';

create index idx_avaliacoes_status on avaliacoes(status);
create index idx_avaliacoes_prestadora on avaliacoes(prestadora_id);

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
-- ROW LEVEL SECURITY (RLS)
-- Pressuposto: administradores.id / prestadoras.id / clientes.id são o MESMO
-- uuid do usuário em auth.users (padrão comum no Supabase: o id da tabela de
-- perfil é criado igual ao id retornado pelo Supabase Auth no cadastro).
-- Ajustar as policies abaixo caso essa convenção não seja adotada.
-- ============================================================================

alter table unidades enable row level security;
alter table administradores enable row level security;
alter table administrador_unidades enable row level security;
alter table prestadoras enable row level security;
alter table clientes enable row level security;
alter table atendimentos enable row level security;
alter table avaliacoes enable row level security;

-- Dados institucionais das unidades (nome, telefone, endereço, CNPJ) são
-- públicos: alimentam a home pública (seletor de região) sem exigir login.
create policy publico_ve_unidades on unidades
  for select using (true);

-- Só administradores vinculados podem alterar dados da própria unidade
create policy adm_edita_sua_unidade on unidades
  for update using (
    id in (select unidade_id from administrador_unidades where administrador_id = auth.uid())
  );

create policy adm_gerencia_atendimentos_da_unidade on atendimentos
  for all using (
    unidade_id in (select unidade_id from administrador_unidades where administrador_id = auth.uid())
  );

create policy adm_gerencia_avaliacoes_da_unidade on avaliacoes
  for all using (
    prestadora_id in (
      select p.id from prestadoras p
      where p.unidade_id in (select unidade_id from administrador_unidades where administrador_id = auth.uid())
    )
  );

-- Prestadora só vê seus próprios atendimentos (convites propostos + agenda aceita)
create policy prestadora_ve_seus_atendimentos on atendimentos
  for select using (prestadora_id = auth.uid());

create policy prestadora_atualiza_status_proprio on atendimentos
  for update using (prestadora_id = auth.uid());

-- Prestadora só vê avaliações aprovadas dela
create policy prestadora_ve_suas_avaliacoes_aprovadas on avaliacoes
  for select using (prestadora_id = auth.uid() and status = 'aprovada');

-- Cliente só vê seus próprios atendimentos e avaliações
create policy cliente_ve_seus_atendimentos on atendimentos
  for select using (cliente_id = auth.uid());

create policy cliente_gerencia_suas_avaliacoes on avaliacoes
  for all using (cliente_id = auth.uid());

-- ============================================================================
-- SEED DATA — reproduz fielmente os dados mockados no protótipo HTML
-- ============================================================================

-- Unidades (`cidades` / `unidades`)
-- Exemplo aqui: CNPJs diferentes por unidade. Se o mesmo franqueado tivesse
-- as duas franquias sob um único CNPJ, bastaria repetir o mesmo valor nas
-- duas linhas — o modelo suporta os dois casos.
insert into unidades (id, slug, nome, uf, cnpj, telefone, endereco, endereco_curto) values
  ('11111111-1111-1111-1111-111111111111', 'carazinho', 'Carazinho', 'RS', '12.345.678/0001-90', '(54) 9 9999-0001', 'Rua Exemplo, 123 — Centro, Carazinho/RS', 'Rua Exemplo, 123 — Centro'),
  ('22222222-2222-2222-2222-222222222222', 'panambi',   'Panambi',   'RS', '12.345.678/0002-71', '(55) 9 9999-0002', 'Av. Exemplo, 456 — Centro, Panambi/RS',   'Av. Exemplo, 456 — Centro');

-- Administrador de exemplo, vinculado às DUAS unidades (mesmo franqueado
-- gerenciando as duas franquias, cada uma com seu próprio CNPJ).
-- Atenção: em produção, o id abaixo precisa ser o MESMO id gerado pelo
-- Supabase Auth no momento do cadastro (supabase.auth.signUp) — este
-- valor fixo serve apenas para testar as demais tabelas isoladamente.
insert into administradores (id, nome, sobrenome, email, senha_hash) values
  ('d0000000-0000-0000-0000-000000000001', 'Renata', 'Almeida', 'renata@mariabrasileira.com', 'gerenciado-pelo-supabase-auth');

insert into administrador_unidades (administrador_id, unidade_id) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- Prestadoras (`equipeData`)
insert into prestadoras (id, nome, telefone, unidade_id, ativa) values
  ('a0000000-0000-0000-0000-000000000001', 'Fabiana S.',  '(54) 9 9000-0001', '11111111-1111-1111-1111-111111111111', true),
  ('a0000000-0000-0000-0000-000000000002', 'Cláudia B.',  '(54) 9 9000-0002', '11111111-1111-1111-1111-111111111111', true),
  ('a0000000-0000-0000-0000-000000000003', 'Joana R.',    '(54) 9 9000-0003', '11111111-1111-1111-1111-111111111111', true),
  ('a0000000-0000-0000-0000-000000000004', 'Patrícia L.', '(54) 9 9000-0004', '11111111-1111-1111-1111-111111111111', false),
  ('a0000000-0000-0000-0000-000000000005', 'Rosa M.',     '(55) 9 9000-0005', '22222222-2222-2222-2222-222222222222', true),
  ('a0000000-0000-0000-0000-000000000006', 'Inês K.',     '(55) 9 9000-0006', '22222222-2222-2222-2222-222222222222', true),
  ('a0000000-0000-0000-0000-000000000007', 'Daniel T.',   '(55) 9 9000-0007', '22222222-2222-2222-2222-222222222222', true);

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
-- FIM
-- ============================================================================
