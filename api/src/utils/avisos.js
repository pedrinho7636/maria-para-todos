// Avisos para a prestadora dentro do portal (hoje: cancelamento de atendimento pelo administrador).
// Ficam em avisos_prestadora até ela marcar como lido; o conteúdo é uma "foto" do atendimento no momento do aviso
// (cliente, data, horário...), então continua legível mesmo se o atendimento mudar depois.

// Cria um aviso de cancelamento pra cada atendimento da lista que tenha prestadora. `db` = pool ou client de transação.
async function avisarCancelamento(db, atendimentoIds) {
  if (!atendimentoIds.length) return 0;
  const { rowCount } = await db.query(
    `insert into avisos_prestadora (prestadora_id, atendimento_id, tipo, dados)
     select a.prestadora_id, a.id, 'cancelamento',
            jsonb_build_object(
              'servico', a.tipo_servico, 'area', a.area, 'cliente', c.nome,
              'data', a.data_atendimento::text,
              'hora', to_char(a.hora_atendimento, 'HH24:MI'),
              'hora_fim', to_char(a.hora_atendimento + (coalesce(a.duracao_horas, 1)::float8 * interval '1 hour'), 'HH24:MI'))
     from atendimentos a left join clientes c on c.id = a.cliente_id
     where a.id = any($1::uuid[]) and a.prestadora_id is not null`,
    [atendimentoIds]
  );
  return rowCount;
}

module.exports = { avisarCancelamento };
