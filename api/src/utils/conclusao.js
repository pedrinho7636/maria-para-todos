const { pool } = require('../db');

// Fases automáticas do atendimento, pelo relógio de Brasília (as datas do sistema são datas locais, sem fuso).
//
// REGRA: atendimento que NÃO foi cancelado e cuja prestadora NÃO foi trocada vale como CONFIRMADO por ela — não existe
// "aceitar" um atendimento que já começou. Então, com prestadora ligada:
//   • o horário de INÍCIO chegou e o de término não → fica "em andamento" (um convite ainda não aceito vira "aceito"
//     nesse momento, e a tarifa vigente dela é travada);
//   • o horário de TÉRMINO passou → vira CONCLUÍDO (convite não aceito também; sem horário vale o dia inteiro).
// Sem prestadora (pedido/recusado) não há quem tenha ido: continua como está até alguém atribuir.
//
// Antes só o "aceito" era concluído; sem isso nada virava "concluído" por si só, o cliente nunca era convidado a avaliar,
// a Equipe mostrava 0 atendimentos e o financeiro não tinha o que somar. Ao concluir, trava a tarifa vigente da
// prestadora (valor_prestadora) se ainda não estava travada — é esse valor que entra no repasse.
// (Não há exceção por escolha manual: atendimento que já terminou não fica "programado".)
const AGORA = "(now() at time zone 'America/Sao_Paulo')";
const INICIO = 'a.data_atendimento + coalesce(a.hora_atendimento, \'00:00\'::time)';
const FIM = `(case when a.hora_atendimento is null then (a.data_atendimento + 1)::timestamp
           else a.data_atendimento + a.hora_atendimento + coalesce(a.duracao_horas, 1)::float8 * interval '1 hour' end)`;
const TARIFA = '(select p.valor_por_atendimento from prestadoras p where p.id = a.prestadora_id)';

// começou e ainda não terminou: convite sem resposta vira confirmado
const SQL_CONFIRMAR = `
  update atendimentos a set
    status = 'aceito',
    valor_prestadora = coalesce(a.valor_prestadora, ${TARIFA}),
    atualizado_em = now()
  where a.status = 'proposto' and a.prestadora_id is not null
    and (${INICIO}) <= ${AGORA} and ${FIM} > ${AGORA}`;

// terminou: confirmado (ou convite que nunca foi respondido) vira concluído
const SQL_CONCLUIR = `
  update atendimentos a set
    status = 'concluido',
    valor_prestadora = coalesce(a.valor_prestadora, ${TARIFA}),
    atualizado_em = now()
  where a.status in ('aceito', 'proposto') and a.prestadora_id is not null
    and ${FIM} <= ${AGORA}`;

// `escopo` restringe a conta a uma unidade / prestadora / cliente / atendimento (as telas chamam isso ao abrir, só no
// que vão mostrar, pra não depender do intervalo do temporizador). Sem escopo, vale pra todos.
async function concluirAtendimentosRealizados(db = pool, escopo = {}) {
  const params = [], cond = [];
  for (const [campo, coluna] of [['unidadeId', 'a.unidade_id'], ['prestadoraId', 'a.prestadora_id'], ['clienteId', 'a.cliente_id'], ['atendimentoId', 'a.id']]) {
    if (escopo[campo]) { params.push(escopo[campo]); cond.push(`${coluna} = $${params.length}`); }
  }
  const filtro = cond.length ? ' and ' + cond.join(' and ') : '';
  await db.query(SQL_CONFIRMAR + filtro, params);
  const { rowCount } = await db.query(SQL_CONCLUIR + filtro, params);
  return rowCount;
}

// Intervalo em minutos (variável CONCLUSAO_MINUTOS, padrão 5). Em hospedagem com banco que "dorme"
// quando ocioso (Neon grátis), um intervalo curto o manteria acordado 24 h e gastaria a cota —
// por isso no Render ele é maior. As telas (agenda, prestadora, cliente, Financeiro) aplicam a regra na hora ao
// abrir, então o que elas mostram nunca depende desse intervalo.
const INTERVALO = Math.max(1, Number(process.env.CONCLUSAO_MINUTOS) || 5) * 60 * 1000;

// Roda agora e repete no intervalo acima enquanto a API estiver de pé. unref(): esse
// temporizador sozinho nunca segura o processo aberto.
function iniciarConclusaoAutomatica() {
  const rodar = async () => {
    try {
      const n = await concluirAtendimentosRealizados();
      if (n > 0) console.log(`[conclusão] ${n} atendimento(s) já realizado(s) marcado(s) como concluído(s).`);
    } catch (erro) {
      console.error('[conclusão] não foi possível concluir os atendimentos realizados:', erro.message);
    }
  };
  rodar();
  setInterval(rodar, INTERVALO).unref();
}

module.exports = { concluirAtendimentosRealizados, iniciarConclusaoAutomatica };
