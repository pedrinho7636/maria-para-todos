// Histórico dos atendimentos (tabela atendimento_eventos): cada mudança de status — e cada troca de prestadora num convite —
// vira uma linha com quando aconteceu, quem fez e, no cancelamento, quem pediu e o motivo. É só gravação: o atendimento
// continua sendo a fonte do estado atual; o histórico responde "como chegou aqui" (tempo de resposta a um convite, funil real,
// motivo dos cancelamentos). Quem muda o status grava o evento NA MESMA transação, pra um nunca existir sem o outro.
//
// acao (o que aconteceu, em palavras):
//   criado          atendimento nasceu (pedido do site, cadastro avulso, recorrência)
//   importado       veio da planilha da franquia (entra com o status que a planilha trazia)
//   proposto        convite enviado a uma prestadora
//   reatribuido     passou pra outra prestadora (ou ficou sem) sem mudar de status; num convite, abre um convite novo
//   aceito          prestadora aceitou o convite (ator = prestadora) ou o administrador deu como combinado (ator = administrador)
//   recusado        prestadora recusou o convite
//   confirmado_auto o horário chegou com o convite sem resposta e o sistema o confirmou (ator = sistema)
//   concluido       administrador concluiu à mão
//   concluido_auto  o horário de término passou e o sistema concluiu
//   cancelado       cancelado (cancelado_por + motivo, opcionais)
//   falta           a prestadora não foi
//   reaberto        saiu de cancelado/falta e voltou a valer (cancelado → programado, falta → concluído)
//   atualizado      qualquer outra mudança de status feita à mão pelo administrador (ex.: recusado → pedido)
const ATOR_SISTEMA = { perfil: 'sistema', id: null };
const ATOR_PUBLICO = { perfil: 'publico', id: null };
const QUEM_CANCELOU = ['cliente', 'franquia', 'prestadora'];
const MAX_MOTIVO = 300;

// Quem está agindo, a partir do token (req.user): administrador, sub_administrador (funcionário), prestadora ou cliente
const atorDe = (user) => (user && user.perfil ? { perfil: user.perfil, id: user.id || null } : ATOR_SISTEMA);

// Lê quem cancelou e o motivo do corpo da requisição (os dois são opcionais). Devolve { canceladoPor, motivo } ou { erro }.
function lerCancelamento(corpo = {}) {
  const quem = corpo.cancelado_por === undefined || corpo.cancelado_por === null || corpo.cancelado_por === '' ? null : String(corpo.cancelado_por);
  if (quem !== null && !QUEM_CANCELOU.includes(quem)) return { erro: 'cancelado_por deve ser cliente, franquia ou prestadora' };
  const motivo = String(corpo.motivo ?? '').trim();
  if (motivo.length > MAX_MOTIVO) return { erro: `O motivo excede ${MAX_MOTIVO} caracteres` };
  return { canceladoPor: quem, motivo: motivo || null };
}

// Qual foi a ação, olhando a mudança de status. `ator` separa o que foi a prestadora do que foi o administrador.
function acaoDaMudanca(de, para, ator) {
  if (para === 'cancelado') return 'cancelado';
  if (para === 'falta') return 'falta';
  if (para === 'recusado') return 'recusado';
  if (de === 'cancelado' || de === 'falta') return 'reaberto';
  if (para === 'proposto') return 'proposto';
  if (para === 'aceito') return 'aceito';
  if (para === 'concluido') return ator.perfil === 'sistema' ? 'concluido_auto' : 'concluido';
  return 'atualizado';
}

// Grava vários eventos de uma vez (um insert só). `db` = client da transação (ou o pool). Cada evento:
//   { atendimentoId, de, para, acao, prestadoraId?, ator?, canceladoPor?, motivo? }
async function registrarEventos(db, eventos) {
  if (!eventos.length) return 0;
  const col = (f) => eventos.map(f);
  const { rowCount } = await db.query(
    `insert into atendimento_eventos (atendimento_id, status_anterior, status_novo, acao, prestadora_id, ator_perfil, ator_id, cancelado_por, motivo)
     select * from unnest($1::uuid[], $2::status_atendimento[], $3::status_atendimento[], $4::text[], $5::uuid[], $6::text[], $7::uuid[], $8::text[], $9::text[])`,
    [
      col(e => e.atendimentoId), col(e => e.de ?? null), col(e => e.para), col(e => e.acao), col(e => e.prestadoraId ?? null),
      col(e => (e.ator || ATOR_SISTEMA).perfil), col(e => (e.ator || ATOR_SISTEMA).id ?? null), col(e => e.canceladoPor ?? null), col(e => e.motivo ?? null),
    ]
  );
  return rowCount;
}
const registrarEvento = (db, evento) => registrarEventos(db, [evento]);

module.exports = { ATOR_SISTEMA, ATOR_PUBLICO, QUEM_CANCELOU, MAX_MOTIVO, atorDe, lerCancelamento, acaoDaMudanca, registrarEvento, registrarEventos };
