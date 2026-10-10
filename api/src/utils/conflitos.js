// Conflitos de horário e recusas — regras que a agenda inteira compartilha.
//
// Uma prestadora não faz dois serviços ao mesmo tempo: dois atendimentos dela se CONFLITAM quando os intervalos
// [início, início + duração) se sobrepõem, mesmo que só em parte. Sem duração, vale 1 hora (como a agenda desenha).
// Atendimento sem horário não entra na conta (não dá pra saber quando acontece). Concluído também conta: o que ela
// já fez ocupou aquele horário. Cancelado, recusado e pedido (sem prestadora) não ocupam ninguém.
const STATUS_QUE_OCUPAM = ['proposto', 'aceito', 'concluido'];
const STATUS_CONFIRMADOS = ['aceito', 'concluido']; // o que ela já se comprometeu a fazer

const dur = (a) => `(coalesce(${a}.duracao_horas, 1)::float8 * interval '1 hour')`;
const inicio = (a) => `(${a}.data_atendimento + ${a}.hora_atendimento)`;
const fim = (a) => `(${inicio(a)} + ${dur(a)})`;
// "b" sobrepõe "a": começa antes de a terminar e termina depois de a começar
const sobrepoe = (a, b) => `${a}.hora_atendimento is not null and ${b}.hora_atendimento is not null and ${inicio(b)} < ${fim(a)} and ${fim(b)} > ${inicio(a)}`;

const COLUNAS_CONFLITO = (b, c) => `${b}.id, ${b}.status, ${b}.data_atendimento::text as data, to_char(${b}.hora_atendimento, 'HH24:MI') as hora,
  to_char(${b}.hora_atendimento + ${dur(b)}, 'HH24:MI') as hora_fim, ${b}.tipo_servico as servico, ${c}.nome as cliente`;

// Trecho SQL (subconsulta) que devolve, como JSON, os atendimentos da MESMA prestadora que se sobrepõem ao
// atendimento `a` — usado nas listas da prestadora pra marcar o que está em conflito.
const SQL_CONFLITOS_JSON = (a = 'a') => `(
  select coalesce(json_agg(json_build_object('id', b.id, 'status', b.status, 'data', b.data_atendimento::text,
           'hora', to_char(b.hora_atendimento, 'HH24:MI'), 'hora_fim', to_char(b.hora_atendimento + ${dur('b')}, 'HH24:MI'),
           'servico', b.tipo_servico, 'cliente', cb.nome) order by b.data_atendimento, b.hora_atendimento), '[]'::json)
  from atendimentos b left join clientes cb on cb.id = b.cliente_id
  where b.prestadora_id = ${a}.prestadora_id and b.id <> ${a}.id and b.status in ('proposto', 'aceito', 'concluido')
    and ${a}.status in ('proposto', 'aceito', 'concluido') and ${sobrepoe(a, 'b')}
)`;

// Atendimentos da prestadora que ocupam [data hora, + duração) — pra checar ANTES de atribuir/aceitar.
// `excluirId` tira o próprio atendimento da conta; `statuses` escolhe com quais comparar.
async function conflitosDoHorario(db, { prestadoraId, data, hora, duracao = null, excluirId = null, statuses = STATUS_QUE_OCUPAM }) {
  if (!prestadoraId || !data || !hora) return [];
  const { rows } = await db.query(
    `select ${COLUNAS_CONFLITO('b', 'c')}
     from atendimentos b left join clientes c on c.id = b.cliente_id
     where b.prestadora_id = $1 and b.hora_atendimento is not null and b.status = any($6::status_atendimento[])
       and ($5::uuid is null or b.id <> $5)
       and ${inicio('b')} < ($2::date + $3::time + coalesce($4::float8, 1) * interval '1 hour')
       and ${fim('b')} > ($2::date + $3::time)
     order by b.data_atendimento, b.hora_atendimento`,
    [prestadoraId, data, hora, duracao, excluirId, statuses]
  );
  return rows;
}

// Mesma checagem pra um grupo de atendimentos já gravados (ex.: a série recém-criada): devolve, por atendimento,
// com quem ele conflita — inclusive entre os próprios do grupo.
async function conflitosDosAtendimentos(db, ids, statuses = STATUS_QUE_OCUPAM) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `select a.id as atendimento_id, ${COLUNAS_CONFLITO('b', 'c')}
     from atendimentos a
     join atendimentos b on b.prestadora_id = a.prestadora_id and b.id <> a.id and b.status = any($2::status_atendimento[])
     left join clientes c on c.id = b.cliente_id
     where a.id = any($1::uuid[]) and a.prestadora_id is not null and ${sobrepoe('a', 'b')}
     order by a.data_atendimento, a.hora_atendimento`,
    [ids, statuses]
  );
  return rows;
}

// Quem já RECUSOU este atendimento (fica gravado mesmo que ele passe pra outra prestadora depois)
async function recusasDoAtendimento(db, atendimentoId) {
  const { rows } = await db.query(
    `select r.prestadora_id, p.nome, r.recusado_em from recusas_atendimento r join prestadoras p on p.id = r.prestadora_id
     where r.atendimento_id = $1 order by r.recusado_em`, [atendimentoId]);
  return rows;
}

// Texto curto de um conflito pra mensagens ("Maria — Limpeza, 09:00–13:00 (Cliente X)")
const dataBR = (d) => String(d).slice(0, 10).split('-').reverse().join('/');
const descreverConflito = (c) => `${c.servico} em ${dataBR(c.data)}, ${c.hora}–${c.hora_fim}${c.cliente ? ' (' + c.cliente + ')' : ''}`;

module.exports = { STATUS_QUE_OCUPAM, STATUS_CONFIRMADOS, SQL_CONFLITOS_JSON, conflitosDoHorario, conflitosDosAtendimentos, recusasDoAtendimento, descreverConflito, dur, sobrepoe };
