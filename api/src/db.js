const { Pool } = require('pg');

// Em produção (Neon/Render) o banco vem numa URL só, e exige SSL; localmente
// segue valendo o PGHOST/PGUSER/... do .env.
const conexao = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

const pool = new Pool({
  ...conexao,
  max: 10,
  idleTimeoutMillis: 30000,
  // Sem isso, com o Postgres fora do ar a requisição fica pendurada pra sempre
  // em vez de falhar rápido com erro claro; e uma query travada nunca solta a conexão.
  // (Banco hospedado grátis, tipo Neon, "dorme" quando ocioso: acordar pode passar de 5 s.)
  connectionTimeoutMillis: process.env.DATABASE_URL ? 20000 : 5000,
  statement_timeout: 15000,
  application_name: 'portal-da-maria-api',
});

// Sem este handler, um erro numa conexão OCIOSA do pool (ex.: Postgres
// reiniciou, rede caiu) vira 'error' não tratado e derruba o processo inteiro.
// Com ele, a conexão ruim é descartada e o pool abre outra na próxima query.
pool.on('error', (erro) => {
  console.error('[db] conexão ociosa caiu (o pool abre outra sozinho):', erro.message);
});

// Mantém o banco em dia com o código a cada subida da API. Tudo é idempotente
// (if not exists), então pode rodar sempre — banco novo, antigo ou já atualizado.
// Espelha o final do banco-schema.sql; ao criar coluna/tabela nova, ponha aqui também.
const MIGRACOES = [
  `alter type origem_pedido add value if not exists 'manual'`,
  `alter type origem_pedido add value if not exists 'importacao'`,

  `create table if not exists sub_administradores (
     id              uuid primary key default gen_random_uuid(),
     nome            text not null,
     sobrenome       text not null,
     email           text unique not null,
     telefone        text,
     foto            text,
     senha_hash      text not null,
     unidade_id      uuid not null references unidades(id),
     ativo           boolean not null default true,
     criado_por      uuid references administradores(id),
     pode_dashboard  boolean not null default false,
     pode_agenda     boolean not null default false,
     pode_avaliacoes boolean not null default false,
     pode_equipe     boolean not null default false,
     pode_clientes   boolean not null default false,
     pode_financeiro boolean not null default false,
     criado_em       timestamptz not null default now()
   )`,
  `create index if not exists idx_sub_administradores_unidade on sub_administradores(unidade_id)`,

  `alter table administradores     add column if not exists telefone text`,
  `alter table administradores     add column if not exists foto text`,
  `alter table sub_administradores add column if not exists telefone text`,
  `alter table sub_administradores add column if not exists foto text`,
  `alter table prestadoras         add column if not exists email text`,
  `alter table prestadoras         add column if not exists foto text`,
  `alter table clientes            add column if not exists foto text`,

  `alter table atendimentos add column if not exists serie_id uuid`,
  `alter table atendimentos add column if not exists codigo_externo text`,
  `alter table atendimentos add column if not exists orcamento_externo text`,
  `alter table atendimentos add column if not exists duracao_horas numeric(4,1)`,
  `alter table atendimentos add column if not exists profissional_externo text`,
  `create index if not exists idx_atendimentos_serie on atendimentos(serie_id) where serie_id is not null`,
  `create unique index if not exists uq_atendimentos_codigo_externo on atendimentos(unidade_id, codigo_externo) where codigo_externo is not null`,

  // quanto a franquia paga à prestadora por atendimento; o valor é "travado" no
  // atendimento (valor_prestadora) quando ela aceita, pra mudar a tarifa depois
  // não alterar o que já foi combinado/realizado
  `alter table prestadoras  add column if not exists valor_por_atendimento numeric(10,2)`,
  `alter table prestadoras  add column if not exists atualizado_em timestamptz not null default now()`,
  `alter table atendimentos add column if not exists valor_prestadora numeric(10,2)`,

  // prestadoras vindas da planilha de atendimentos não têm telefone (só o nome): o login
  // delas é pelo e-mail. O telefone continua único quando existe (NULLs não colidem).
  `alter table prestadoras alter column telefone drop not null`,

  // CNPJ e telefone da unidade também são opcionais: a unidade pode existir "vazia", sem dono, e
  // o 1º administrador a se cadastrar nela define o CNPJ (e o telefone)
  `alter table unidades alter column cnpj drop not null`,
  `alter table unidades alter column telefone drop not null`,

  // o endereço da unidade passou a ser opcional: sem endereço, o campo some do site
  `alter table unidades alter column endereco drop not null`,
  `alter table unidades alter column endereco_curto drop not null`,

  // atendimento de uma série recorrente guarda o valor MENSAL informado; o valor de cada
  // ocorrência (atendimentos.valor) é a parte dele que cabe naquele atendimento
  `alter table atendimentos add column if not exists valor_mensal numeric(10,2)`,

  // quando o repasse (pagamento à prestadora) deste atendimento foi pago; nulo = a pagar
  `alter table atendimentos add column if not exists repasse_pago_em timestamptz`,

  // As views da Visão geral e da Equipe juntavam atendimentos com avaliações num mesmo
  // select: cada atendimento era contado uma vez POR AVALIAÇÃO (1 atendimento + 5 avaliações
  // = "5 atendimentos hoje") e o faturamento do mês saía multiplicado. Agora cada número vem
  // da sua própria subconsulta. Mesmas colunas de antes (só o cálculo mudou). "Hoje" é a
  // data de Brasília, não a do servidor; atendimento cancelado não conta.
  `create or replace view vw_dashboard_unidade as
   select
     u.id as unidade_id,
     u.nome as unidade_nome,
     (select count(*) from atendimentos a
       where a.unidade_id = u.id and a.status <> 'cancelado'
         and a.data_atendimento = (now() at time zone 'America/Sao_Paulo')::date) as atendimentos_hoje,
     (select count(distinct a.prestadora_id) from atendimentos a
       where a.unidade_id = u.id and a.status = 'aceito'
         and a.data_atendimento = (now() at time zone 'America/Sao_Paulo')::date) as prestadoras_escaladas_hoje,
     coalesce((select sum(a.valor) from atendimentos a
       where a.unidade_id = u.id and a.status = 'concluido'
         and date_trunc('month', a.data_atendimento) = date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)), 0) as faturamento_mes,
     (select round(avg(av.nota), 1) from avaliacoes av join prestadoras p on p.id = av.prestadora_id
       where p.unidade_id = u.id and av.status = 'aprovada') as nps_medio
   from unidades u`,
  `create or replace view vw_equipe_unidade as
   select
     p.id as prestadora_id,
     p.unidade_id,
     p.nome,
     p.ativa,
     (select count(*) from atendimentos a where a.prestadora_id = p.id and a.status = 'concluido') as total_atendimentos,
     (select round(avg(av.nota), 1) from avaliacoes av where av.prestadora_id = p.id and av.status = 'aprovada') as nota_media
   from prestadoras p`,

  // índices que a sincronização entre usuários consulta a cada poucos segundos
  `create index if not exists idx_atendimentos_unidade_atualizado on atendimentos(unidade_id, atualizado_em)`,
  `create index if not exists idx_atendimentos_cliente on atendimentos(cliente_id)`,

  // a moderação passou a poder ser feita por sub-administrador também
  `alter table avaliacoes drop constraint if exists avaliacoes_moderado_por_fkey`,
];

const TABELAS_BASE = ['unidades', 'administradores', 'administrador_unidades', 'prestadoras', 'clientes', 'atendimentos', 'avaliacoes', 'codigos_verificacao'];

// Traduz o erro técnico do driver numa instrução que dá pra seguir.
function explicarErroDeConexao(erro) {
  const alvo = `${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}`;
  if (erro.code === 'ECONNREFUSED' || erro.code === 'ETIMEDOUT' || erro.code === 'ENOTFOUND') {
    return `Não consegui conectar no PostgreSQL em ${alvo}. Ele está rodando? (no Windows: serviço "postgresql-x64-17" em services.msc)`;
  }
  if (erro.code === '28P01' || erro.code === '28000') {
    return 'O Postgres recusou o usuário/senha. Confira PGUSER e PGPASSWORD no api/.env.';
  }
  if (erro.code === '3D000') {
    return `O banco "${process.env.PGDATABASE}" não existe. Crie com CREATE DATABASE ${process.env.PGDATABASE}; e rode: psql -U postgres -d ${process.env.PGDATABASE} -f banco-schema.sql`;
  }
  return `Erro ao falar com o banco: ${erro.message}`;
}

// Chamado uma vez antes da API abrir a porta: confere a conexão, aplica as
// migrações e confirma que as tabelas base existem. Falha cedo e claro, em vez
// de subir "ok" e dar erro 500 só quando alguém usar a tela.
async function prepararBanco() {
  try {
    await pool.query('select 1');
  } catch (erro) {
    throw new Error(explicarErroDeConexao(erro));
  }

  const { rows } = await pool.query(
    "select t as tabela, to_regclass('public.' || t) is not null as existe from unnest($1::text[]) as t",
    [TABELAS_BASE]
  );
  const faltando = rows.filter(r => !r.existe).map(r => r.tabela);
  if (faltando.length) {
    throw new Error(`O banco não tem as tabelas: ${faltando.join(', ')}. Rode (dentro de api/): npm run banco:schema`);
  }

  for (const comando of MIGRACOES) {
    try {
      await pool.query(comando);
    } catch (erro) {
      throw new Error(`Falha ao atualizar o banco (${comando.split('\n')[0].trim().slice(0, 70)}…): ${erro.message}`);
    }
  }
}

module.exports = { pool, prepararBanco };
