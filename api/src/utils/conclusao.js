const { pool } = require('../db');

// Atendimento aceito cuja data/hora (+ duração) já passou é dado como CONCLUÍDO.
//
// Antes só existia uma rota pra concluir e nenhum botão que a chamasse: nada virava
// "concluído", então o cliente nunca era convidado a avaliar, a Equipe mostrava 0
// atendimentos e o financeiro não teria o que somar. Sem horário, vale o dia inteiro.
// Ao concluir, trava a tarifa vigente da prestadora (valor_prestadora) se o aceite ainda
// não tinha travado — é esse valor que entra no repasse.
//
// "Agora" é o relógio de Brasília (as datas do sistema são datas locais, sem fuso).
const SQL_CONCLUIR = `
  update atendimentos a set
    status = 'concluido',
    valor_prestadora = coalesce(a.valor_prestadora, (select p.valor_por_atendimento from prestadoras p where p.id = a.prestadora_id)),
    atualizado_em = now()
  where a.status = 'aceito' and not a.situacao_manual
    and (case
           when a.hora_atendimento is null then (a.data_atendimento + 1)::timestamp
           else a.data_atendimento + a.hora_atendimento + coalesce(a.duracao_horas, 1)::float8 * interval '1 hour'
         end) <= (now() at time zone 'America/Sao_Paulo')`;

async function concluirAtendimentosRealizados(db = pool) {
  const { rowCount } = await db.query(SQL_CONCLUIR);
  return rowCount;
}

// Intervalo em minutos (variável CONCLUSAO_MINUTOS, padrão 5). Em hospedagem com banco que "dorme"
// quando ocioso (Neon grátis), um intervalo curto o manteria acordado 24 h e gastaria a cota —
// por isso no Render ele é maior. O Financeiro conclui na hora ao ser aberto, então os números
// dele nunca dependem desse intervalo.
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
