// Uso: npm run teste:relatorios-historico   (não precisa de API nem de banco)
// Indicadores que saem do HISTÓRICO dos atendimentos (atendimento_eventos): tempo de resposta da prestadora ao convite,
// cancelamentos (quem pediu, motivo, antecedência), receita perdida por motivo e o funil real — com eventos inventados e contas conferidas à mão.
const R = require('../src/utils/relatorios');

let ok = 0, falhas = 0;
const check = (n, c, extra = '') => { c ? ok++ : falhas++; console.log(c ? '  ok  ' : '  FALHA', n, c ? '' : extra); };
const J = (x) => JSON.stringify(x);

const HOJE = '2026-10-15';
const periodo = R.resolverPeriodo({}, HOJE);
let seq = 0;
// um evento; o `id` cresce na ordem em que são criados (é ele que dá a ordem dos fatos)
const E = (atendimento_id, acao, de, para, quando, o = {}) => ({
  id: ++seq, atendimento_id, acao, status_anterior: de, status_novo: para, quando, prestadora_id: null, ator_perfil: 'administrador',
  cancelado_por: null, motivo: null, inicio_em: null, janela_abre: null, ...o,
});
const L = (id, status, o = {}) => ({
  id, unidade_id: 'u1', dia: '2026-10-05', hora: '09:00', status, tipo_servico: 'Limpeza residencial', area: null, origem: 'site', recorrente: false,
  duracao_horas: null, valor: null, custo: null, repasse_pago_em: null, profissional_externo: null, prestadora_id: null, prestadora_nome: null, cliente_id: null, cliente_nome: null, ...o,
});
const ANA = 'p1', BIA = 'p2';
const prestadoras = [{ id: ANA, nome: 'Ana', ativa: true }, { id: BIA, nome: 'Bia', ativa: true }];

// ---------------------------------------------------------------- tempo de resposta ao convite
console.log('\nTempo de resposta ao convite');
const ev = [
  // a1: convite à Ana em 01/10 12:00Z pra um atendimento em 04/10 — o aceite só abre em 02/10 00:00 (BRT) = 03:00Z; ela aceita 03/10 11:00Z → 32 h desde a abertura
  E('a1', 'criado', null, 'pedido', '2026-10-01T10:00:00Z'),
  E('a1', 'proposto', 'pedido', 'proposto', '2026-10-01T12:00:00Z', { prestadora_id: ANA, janela_abre: '2026-10-02T03:00:00Z' }),
  E('a1', 'aceito', 'proposto', 'aceito', '2026-10-03T11:00:00Z', { prestadora_id: ANA, ator_perfil: 'prestadora' }),
  // a2: a janela já estava aberta (atendimento amanhã): conta desde o convite → 6 h
  E('a2', 'criado', null, 'proposto', '2026-10-05T09:00:00Z', { prestadora_id: ANA, janela_abre: '2026-10-04T03:00:00Z' }),
  E('a2', 'aceito', 'proposto', 'aceito', '2026-10-05T15:00:00Z', { prestadora_id: ANA, ator_perfil: 'prestadora' }),
  // a3: Bia recusa em 1,5 h (a recusa não espera a janela); depois a unidade convida a Ana, que não responde: o sistema confirma
  E('a3', 'criado', null, 'proposto', '2026-10-05T09:00:00Z', { prestadora_id: BIA, janela_abre: '2026-10-20T03:00:00Z' }),
  E('a3', 'recusado', 'proposto', 'recusado', '2026-10-05T10:30:00Z', { prestadora_id: BIA, ator_perfil: 'prestadora' }),
  E('a3', 'proposto', 'recusado', 'proposto', '2026-10-05T11:00:00Z', { prestadora_id: ANA, janela_abre: '2026-10-05T03:00:00Z' }),
  E('a3', 'confirmado_auto', 'proposto', 'aceito', '2026-10-07T12:00:00Z', { prestadora_id: ANA, ator_perfil: 'sistema' }),
  // a4: convite à Bia que a unidade passa pra Ana antes de ela responder (Bia: trocado); Ana aceita em 2 h
  E('a4', 'criado', null, 'proposto', '2026-10-06T08:00:00Z', { prestadora_id: BIA, janela_abre: '2026-10-05T03:00:00Z' }),
  E('a4', 'reatribuido', 'proposto', 'proposto', '2026-10-06T09:00:00Z', { prestadora_id: ANA, janela_abre: '2026-10-05T03:00:00Z' }),
  E('a4', 'aceito', 'proposto', 'aceito', '2026-10-06T11:00:00Z', { prestadora_id: ANA, ator_perfil: 'prestadora' }),
  // a5: convite à Bia ainda sem resposta
  E('a5', 'criado', null, 'proposto', '2026-10-07T08:00:00Z', { prestadora_id: BIA, janela_abre: '2026-10-05T03:00:00Z' }),
  // a6: a unidade deu o convite da Bia como combinado (não foi ela que aceitou)
  E('a6', 'criado', null, 'proposto', '2026-10-07T08:00:00Z', { prestadora_id: BIA, janela_abre: '2026-10-05T03:00:00Z' }),
  E('a6', 'aceito', 'proposto', 'aceito', '2026-10-07T09:00:00Z', { prestadora_id: BIA, ator_perfil: 'administrador' }),
  // a7: veio da planilha já como convite: não se sabe quando foi enviado, então não conta
  E('a7', 'importado', null, 'proposto', '2026-10-10T08:00:00Z', { prestadora_id: BIA }),
];
const rc = R.respostasAosConvites(ev, prestadoras);
const rAna = rc.por_prestadora.find(p => p.prestadora_id === ANA), rBia = rc.por_prestadora.find(p => p.prestadora_id === BIA);
check('Ana: 4 convites (a1, a2, a3, a4), 3 aceites, 1 sem resposta (o sistema confirmou)', rAna.convites === 4 && rAna.aceitos === 3 && rAna.recusados === 0 && rAna.sem_resposta === 1, J(rAna));
check('Ana: tempo médio (32 + 6 + 2) ÷ 3 = 13,3 h; mediana 6 h; 2 de 3 em até 24 h = 66,7%', rAna.tempo_medio_h === 13.3 && rAna.mediana_h === 6 && rAna.ate_24h_pct === 66.7, J(rAna));
check('o aceite conta desde a ABERTURA da janela (2 dias antes), não desde o convite: 32 h e não 47 h', rAna.tempo_medio_h !== 18.3 && rAna.respondidos === 3);
check('Bia: 4 convites (a3, a4, a5, a6): 1 recusa em 1,5 h, 1 trocado, 1 em aberto, 1 sem resposta (a unidade aceitou por ela)',
  rBia.convites === 4 && rBia.recusados === 1 && rBia.aceitos === 0 && rBia.trocados === 1 && rBia.em_aberto === 1 && rBia.sem_resposta === 1 && rBia.tempo_medio_h === 1.5, J(rBia));
check('a importação da planilha não vira convite', rc.convites === 8, rc.convites);
check('geral: 8 convites, 4 respondidos (3 aceites + 1 recusa), 2 sem resposta, 1 em aberto, 1 trocado', rc.respondidos === 4 && rc.aceitos === 3 && rc.recusados === 1 && rc.sem_resposta === 2 && rc.em_aberto === 1 && rc.trocados === 1, J(rc));
check('geral: média (32+6+2+1,5) ÷ 4 = 10,4 h, mediana (2 e 6) = 4 h, 75% em até 24 h', rc.tempo_medio_h === 10.4 && rc.mediana_h === 4 && rc.ate_24h_pct === 75, J(rc));
check('a tabela começa por quem demora mais (Ana, depois Bia)', rc.por_prestadora[0].nome === 'Ana' && rc.por_prestadora[1].nome === 'Bia');
check('sem eventos: zeros e tempo nulo (sem dividir por zero)', R.respostasAosConvites([], []).convites === 0 && R.respostasAosConvites([], []).tempo_medio_h === null);
check('resposta antes de "existir" convite não dá tempo negativo', R.respostasAosConvites([
  E('z', 'criado', null, 'proposto', '2026-10-05T12:00:00Z', { prestadora_id: ANA, janela_abre: '2026-10-05T03:00:00Z' }),
  E('z', 'aceito', 'proposto', 'aceito', '2026-10-05T11:00:00Z', { prestadora_id: ANA, ator_perfil: 'prestadora' }),
], prestadoras).tempo_medio_h === 0);
check('a ordem vem do id do evento, não da ordem em que chegaram no array', R.respostasAosConvites([...ev].reverse(), prestadoras).tempo_medio_h === 10.4);
const agRC = R.relatorioAgenda([L('a1', 'aceito', { prestadora_id: ANA, prestadora_nome: 'Ana' })], { periodo, hoje: HOJE, prestadoras, eventos: ev });
check('a tabela de prestadoras da Agenda ganha o tempo médio de resposta e quantos ela respondeu (só dos atendimentos do relatório)', agRC.prestadoras[0].resposta_media_h === 32 && agRC.prestadoras[0].respondidos === 1, J(agRC.prestadoras[0]));
check('eventos de atendimentos que não estão no relatório (outro período/unidade) são ignorados', agRC.resposta_convites.convites === 1, J(agRC.resposta_convites));

// ---------------------------------------------------------------- cancelamentos
console.log('\nCancelamentos');
const cancelados = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map(id => L(id, 'cancelado', { prestadora_id: id === 'c6' ? ANA : null, prestadora_nome: id === 'c6' ? 'Ana' : null }));
const evc = [
  E('c1', 'cancelado', 'aceito', 'cancelado', '2026-10-03T12:00:00Z', { cancelado_por: 'cliente', motivo: 'Viagem', inicio_em: '2026-10-05T12:00:00Z' }),                 // 48 h antes
  E('c2', 'cancelado', 'aceito', 'cancelado', '2026-10-05T20:00:00Z', { cancelado_por: 'cliente', motivo: ' viagem. ', inicio_em: '2026-10-06T11:00:00Z' }),            // 15 h antes (mesmo motivo, outra grafia)
  E('c3', 'cancelado', 'aceito', 'cancelado', '2026-10-07T10:00:00Z', { cancelado_por: 'franquia', motivo: 'Sem prestadora', inicio_em: '2026-10-07T09:00:00Z' }),       // 1 h DEPOIS de começar
  E('c4', 'cancelado', 'pedido', 'cancelado', '2026-10-08T10:00:00Z', { inicio_em: '2026-10-12T10:00:00Z' }),                                                           // quem/motivo não informados, 96 h
  // c5 foi cancelado antes do histórico existir: nenhum evento
  E('c6', 'cancelado', 'aceito', 'cancelado', '2026-10-09T10:00:00Z', { cancelado_por: 'prestadora', motivo: 'Doente', prestadora_id: ANA, inicio_em: '2026-10-10T10:00:00Z' }), // 24 h exatas
  // c7: cancelado, reaberto e cancelado de novo — vale o ÚLTIMO cancelamento
  E('c7', 'cancelado', 'aceito', 'cancelado', '2026-10-01T10:00:00Z', { cancelado_por: 'cliente', motivo: 'a', inicio_em: '2026-10-20T10:00:00Z' }),
  E('c7', 'reaberto', 'cancelado', 'aceito', '2026-10-02T10:00:00Z', { inicio_em: '2026-10-20T10:00:00Z' }),
  E('c7', 'cancelado', 'aceito', 'cancelado', '2026-10-16T10:00:00Z', { cancelado_por: 'franquia', motivo: 'b', inicio_em: '2026-10-20T10:00:00Z' }),   // 96 h
  E('c8', 'cancelado', 'aceito', 'cancelado', '2026-10-03T10:00:00Z', { cancelado_por: 'cliente', motivo: 'x' }),                                                      // c8 já foi reaberto e NÃO está cancelado hoje
  E('c8', 'reaberto', 'cancelado', 'aceito', '2026-10-04T10:00:00Z'),
];
const cc = R.resumoCancelamentos(cancelados, R.infoCancelamentos(cancelados, evc));
const quem = Object.fromEntries(cc.por_quem.map(x => [x.quem, x.qtd]));
check('7 cancelados: 6 com registro, 1 de antes do histórico', cc.total === 7 && cc.com_registro === 6 && cc.sem_registro === 1, J(cc));
check('quem cancelou: cliente 2, franquia 2 (c3 e o último cancelamento de c7), prestadora 1, não informado 1, sem registro 1', quem.cliente === 2 && quem.franquia === 2 && quem.prestadora === 1 && quem.nao_informado === 1 && quem.sem_registro === 1, J(quem));
check('percentuais sobre os 7: cliente 28,6% e prestadora 14,3%', cc.por_quem.find(x => x.quem === 'cliente').pct === 28.6 && cc.por_quem.find(x => x.quem === 'prestadora').pct === 14.3);
check('o cancelamento já desfeito (c8, reaberto) não conta', R.infoCancelamentos([L('c8', 'aceito')], evc).size === 0);
check('motivos: "Viagem" e " viagem. " são o mesmo (2); depois um de cada em ordem alfabética; os 2 sem motivo vão no fim',
  cc.motivos.map(m => `${m.motivo}:${m.qtd}`).join() === 'Viagem:2,b:1,Doente:1,Sem prestadora:1,null:2', cc.motivos.map(m => `${m.motivo}:${m.qtd}`).join());
const ant = cc.antecedencia;
check('antecedência: 6 avaliados (c5 não tem evento); 2 com menos de 24 h (c2 e c3) = 33,3%; 1 cancelado depois de começar', ant.avaliados === 6 && ant.menos_24h === 2 && ant.menos_24h_pct === 33.3 && ant.depois_do_inicio === 1, J(ant));
check('antecedência: 24 h exatas (c6) NÃO é "menos de 24 h"; mediana de [-1, 15, 24, 48, 96, 96] = 36 h', ant.mediana_h === 36, J(ant));
const agCanc = R.relatorioAgenda(cancelados, { periodo, hoje: HOJE, prestadoras, eventos: evc });
check('na Agenda cada prestadora mostra quantos cancelamentos foram DELA (c6): 1 de 1', agCanc.prestadoras.find(p => p.nome === 'Ana').cancelou_ela === 1 && agCanc.cancelamentos.por_quem.find(x => x.quem === 'prestadora').qtd === 1);
check('sem histórico nenhum: tudo "sem registro", motivo só "sem motivo"', (() => { const c = R.resumoCancelamentos(cancelados, new Map()); return c.com_registro === 0 && c.por_quem.find(x => x.quem === 'sem_registro').qtd === 7 && c.motivos.length === 1 && c.motivos[0].motivo === null && c.antecedencia.avaliados === 0 && c.antecedencia.menos_24h_pct === null; })());
check('muitos motivos diferentes: os 8 mais comuns + "Outros motivos"', (() => {
  const m = R.motivosAgrupados(Array.from({ length: 12 }, (_, i) => ({ motivo: 'motivo ' + String.fromCharCode(97 + i) })), 8);
  return m.length === 9 && m[8].motivo === 'Outros motivos' && m[8].qtd === 4;
})());
check('acentos e maiúsculas não separam motivos ("Não gostou" = "nao gostou")', R.motivosAgrupados([{ motivo: 'Não gostou' }, { motivo: 'nao gostou' }, { motivo: 'NÃO GOSTOU!' }]).length === 1);

// ---------------------------------------------------------------- receita perdida (Financeiro)
console.log('\nReceita perdida por quem cancelou e por motivo');
const lf = [
  L('f1', 'cancelado', { valor: '300.00' }), L('f2', 'cancelado', { valor: '200.00' }), L('f3', 'cancelado', { valor: null }), L('f4', 'cancelado', { valor: '100.00' }),
  L('f5', 'concluido', { valor: '500.00', custo: '200.00' }),
];
const evf = [
  E('f1', 'cancelado', 'aceito', 'cancelado', '2026-10-03T12:00:00Z', { cancelado_por: 'cliente', motivo: 'Viagem' }),
  E('f2', 'cancelado', 'aceito', 'cancelado', '2026-10-03T12:00:00Z', { cancelado_por: 'franquia', motivo: 'viagem' }),
  E('f4', 'cancelado', 'aceito', 'cancelado', '2026-10-03T12:00:00Z', { cancelado_por: 'prestadora', motivo: 'Doente' }),
];
const fin = R.relatorioFinanceiro(lf, { periodo, hoje: HOJE, unidades: [], eventos: evf });
const pc = fin.perdido.cancelados;
check('receita perdida com cancelamentos continua 600 (300 + 200 + 100; um sem valor)', pc.qtd === 4 && pc.com_valor === 3 && pc.receita === 600 && fin.perdido.receita === 600, J(fin.perdido));
check('por quem: cliente 300, franquia 200, prestadora 100, e o de antes do histórico (sem valor) em "sem registro"',
  pc.por_quem.map(x => `${x.quem}:${x.qtd}:${x.receita}`).join() === 'cliente:1:300,franquia:1:200,prestadora:1:100,sem_registro:1:0', pc.por_quem.map(x => `${x.quem}:${x.qtd}:${x.receita}`).join());
check('por motivo: Viagem 2 (R$ 500), Doente 1 (R$ 100), sem motivo 1 (R$ 0)', pc.por_motivo.map(x => `${x.motivo}:${x.qtd}:${x.receita}`).join() === 'Viagem:2:500,Doente:1:100,null:1:0', pc.por_motivo.map(x => `${x.motivo}:${x.qtd}:${x.receita}`).join());
check('sem eventos o Financeiro funciona igual (tudo "sem registro")', R.relatorioFinanceiro(lf, { periodo, hoje: HOJE, unidades: [] }).perdido.cancelados.por_quem.length === 1);

// ---------------------------------------------------------------- funil real
console.log('\nFunil real');
const lfun = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'].map(id => L(id, 'concluido'));
const evFun = [
  E('f1', 'criado', null, 'pedido', '2026-10-01T10:00:00Z'), E('f1', 'proposto', 'pedido', 'proposto', '2026-10-01T11:00:00Z', { prestadora_id: ANA }),
  E('f1', 'aceito', 'proposto', 'aceito', '2026-10-02T11:00:00Z', { prestadora_id: ANA, ator_perfil: 'prestadora' }), E('f1', 'concluido_auto', 'aceito', 'concluido', '2026-10-05T11:00:00Z', { ator_perfil: 'sistema' }),
  // f2: recusado, reconvidado, confirmado e concluído pelo sistema
  E('f2', 'criado', null, 'pedido', '2026-10-01T10:00:00Z'), E('f2', 'proposto', 'pedido', 'proposto', '2026-10-01T11:00:00Z', { prestadora_id: BIA }),
  E('f2', 'recusado', 'proposto', 'recusado', '2026-10-01T12:00:00Z', { prestadora_id: BIA, ator_perfil: 'prestadora' }), E('f2', 'proposto', 'recusado', 'proposto', '2026-10-01T13:00:00Z', { prestadora_id: ANA }),
  E('f2', 'confirmado_auto', 'proposto', 'aceito', '2026-10-05T09:00:00Z', { ator_perfil: 'sistema' }), E('f2', 'concluido_auto', 'aceito', 'concluido', '2026-10-05T12:00:00Z', { ator_perfil: 'sistema' }),
  // f3: já nasceu como convite e foi cancelado
  E('f3', 'criado', null, 'proposto', '2026-10-01T10:00:00Z', { prestadora_id: ANA }), E('f3', 'cancelado', 'proposto', 'cancelado', '2026-10-02T10:00:00Z', { cancelado_por: 'cliente' }),
  // f4: pedido cancelado antes de qualquer convite
  E('f4', 'criado', null, 'pedido', '2026-10-01T10:00:00Z'), E('f4', 'cancelado', 'pedido', 'cancelado', '2026-10-02T10:00:00Z'),
  // f5: importado da planilha (entra pronto, sem fluxo)
  E('f5', 'importado', null, 'concluido', '2026-10-10T10:00:00Z'),
  // f6: sem nenhum evento (anterior ao histórico)
  // f7: convite que ninguém respondeu e o sistema concluiu — chegou a "concluído" sem nunca ter sido aceito
  E('f7', 'criado', null, 'pedido', '2026-10-01T10:00:00Z'), E('f7', 'proposto', 'pedido', 'proposto', '2026-10-01T11:00:00Z', { prestadora_id: ANA }), E('f7', 'concluido_auto', 'proposto', 'concluido', '2026-10-05T12:00:00Z', { ator_perfil: 'sistema' }),
  // f8: aceito pela prestadora e depois marcado como falta
  E('f8', 'criado', null, 'pedido', '2026-10-01T10:00:00Z'), E('f8', 'proposto', 'pedido', 'proposto', '2026-10-01T11:00:00Z', { prestadora_id: ANA }),
  E('f8', 'aceito', 'proposto', 'aceito', '2026-10-02T11:00:00Z', { prestadora_id: ANA, ator_perfil: 'prestadora' }), E('f8', 'falta', 'aceito', 'falta', '2026-10-05T10:00:00Z', { prestadora_id: ANA }),
];
const fr = R.funilDoHistorico(lfun, evFun);
const et = Object.fromEntries(fr.etapas.map(e => [e.etapa, e]));
check('6 atendimentos no funil; 1 importado e 1 sem histórico ficam de fora', fr.base === 6 && fr.importados === 1 && fr.sem_historico === 1, J(fr));
check('etapas: 6 pedidos → 5 convidados → 4 confirmados → 4 concluídos', et.pedido.qtd === 6 && et.proposto.qtd === 5 && et.aceito.qtd === 4 && et.concluido.qtd === 4, J(fr.etapas));
check('cada etapa inclui as seguintes (f7 foi concluído sem aceite e conta como confirmado)', et.aceito.qtd === 4);
check('percentuais: convite 83,3% do pedido; confirmado 80% do convite e 66,7% do início; concluído 100% do confirmado', et.proposto.pct_do_anterior === 83.3 && et.aceito.pct_do_anterior === 80 && et.aceito.pct_do_inicio === 66.7 && et.concluido.pct_do_anterior === 100, J(fr.etapas));
check('desfechos: 1 recusado, 2 cancelados, 1 falta', fr.desfechos.recusados === 1 && fr.desfechos.cancelados === 2 && fr.desfechos.faltas === 1, J(fr.desfechos));
check('só 2 dos 4 confirmados foram aceitos pela própria prestadora (f1 e f8); os outros o sistema confirmou/concluiu', fr.aceitos_pela_prestadora === 2, fr.aceitos_pela_prestadora);
check('sem eventos o funil fica zerado, sem erro', R.funilDoHistorico(lfun, []).base === 0 && R.funilDoHistorico(lfun, []).sem_historico === 8 && R.funilDoHistorico([], []).etapas[1].pct_do_anterior === null);
const agH = R.relatorioAgenda(lfun, { periodo, hoje: HOJE, prestadoras, eventos: evFun, historicoDesde: '2026-10-01T10:00:00Z' });
check('a Agenda traz o funil real e quantos atendimentos estão sem histórico', agH.funil_real.base === 6 && agH.historico.sem_historico === 1 && agH.historico.desde === '2026-10-01T10:00:00Z', J(agH.historico));
check('a Agenda sem eventos continua igual de antes (nada quebra)', (() => { const a = R.relatorioAgenda(lfun, { periodo, hoje: HOJE, prestadoras }); return a.resposta_convites.convites === 0 && a.cancelamentos.total === 0 && a.funil_real.base === 0 && a.historico.sem_historico === 8; })());

console.log(`\n${falhas ? 'COM FALHAS' : 'TUDO CERTO'} — ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
