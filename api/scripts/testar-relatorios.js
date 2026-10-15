// Uso: npm run teste:relatorios   (não precisa de API nem de banco)
// Cálculos da aba Relatórios: período, Agenda, Financeiro e Satisfação — com dados inventados e contas conferidas à mão.
const R = require('../src/utils/relatorios');

let ok = 0, falhas = 0;
const check = (n, c, extra = '') => { c ? ok++ : falhas++; console.log(c ? '  ok  ' : '  FALHA', n, c ? '' : extra); };
const J = (x) => JSON.stringify(x);

const HOJE = '2026-10-15'; // quinta-feira

// ---------------------------------------------------------------- período
console.log('\nPeríodo');
let p = R.resolverPeriodo({}, HOJE);
check('padrão = mês atual inteiro (01 a 31/10), um balde por dia', p.de === '2026-10-01' && p.ate === '2026-10-31' && p.dias === 31 && p.granularidade === 'dia', J(p));
check('mês cheio compara com o mês anterior inteiro', p.anterior.de === '2026-09-01' && p.anterior.ate === '2026-09-30', J(p.anterior));
p = R.resolverPeriodo({ preset: 'mes_anterior' }, HOJE);
check('mês passado = setembro, comparado com agosto', p.de === '2026-09-01' && p.ate === '2026-09-30' && p.anterior.de === '2026-08-01' && p.anterior.ate === '2026-08-31', J(p));
p = R.resolverPeriodo({ preset: '30d' }, HOJE);
check('últimos 30 dias termina hoje e o anterior tem a mesma duração', p.de === '2026-09-16' && p.ate === HOJE && p.dias === 30 && p.anterior.de === '2026-08-17' && p.anterior.ate === '2026-09-15', J(p));
p = R.resolverPeriodo({ preset: '90d' }, HOJE);
check('90 dias agrupa por semana', p.dias === 90 && p.granularidade === 'semana', J(p));
p = R.resolverPeriodo({ preset: '12m' }, HOJE);
check('12 meses = nov/2025 a out/2026, agrupado por mês', p.de === '2025-11-01' && p.ate === '2026-10-31' && p.granularidade === 'mes', J(p));
p = R.resolverPeriodo({ preset: 'ano' }, HOJE);
check('ano = 2026 inteiro, comparado com 2025', p.de === '2026-01-01' && p.ate === '2026-12-31' && p.dias === 365 && p.anterior.de === '2025-01-01' && p.anterior.ate === '2025-12-31', J(p));
p = R.resolverPeriodo({ mes: '2028-02' }, HOJE);
check('fevereiro de ano bissexto vai até o dia 29', p.de === '2028-02-01' && p.ate === '2028-02-29', J(p));
p = R.resolverPeriodo({ de: '2026-10-10', ate: '2026-10-12' }, HOJE);
check('personalizado: 3 dias; o anterior são os 3 dias antes', p.dias === 3 && p.id === 'custom' && p.anterior.de === '2026-10-07' && p.anterior.ate === '2026-10-09', J(p));
check('data inicial depois da final: erro', !!R.resolverPeriodo({ de: '2026-10-12', ate: '2026-10-10' }, HOJE).erro);
check('data que não existe (30/02): erro', !!R.resolverPeriodo({ de: '2026-02-30', ate: '2026-03-10' }, HOJE).erro);
check('só uma das datas: erro', !!R.resolverPeriodo({ de: '2026-10-10' }, HOJE).erro);
check('datas em lista (?de=a&de=b): erro', !!R.resolverPeriodo({ de: ['2026-10-01', '2026-10-02'], ate: '2026-10-03' }, HOJE).erro);
check('período maior que o limite: erro', !!R.resolverPeriodo({ de: '2020-01-01', ate: '2026-01-01' }, HOJE).erro);
check('mês inválido (2026-13): erro', !!R.resolverPeriodo({ mes: '2026-13' }, HOJE).erro);
check('preset desconhecido: erro', !!R.resolverPeriodo({ preset: 'xyz' }, HOJE).erro);
check('segunda-feira é o primeiro dia da semana: 14/10 (quarta) cai na semana de 12/10', R.chaveDe('2026-10-14', 'semana') === '2026-10-12');
check('domingo é o 7º dia (isodow) e cai na semana que começou na segunda anterior', R.isodow('2026-10-04') === 7 && R.chaveDe('2026-10-04', 'semana') === '2026-09-28');
check('outubro por semana: 5 baldes (28/09, 05, 12, 19 e 26/10)', R.chavesDoPeriodo('2026-10-01', '2026-10-31', 'semana').join() === '2026-09-28,2026-10-05,2026-10-12,2026-10-19,2026-10-26');

// ---------------------------------------------------------------- dados inventados
const L = (o) => ({
  id: 'x' + Math.random().toString(36).slice(2), unidade_id: 'u1', dia: '2026-10-05', hora: '09:00', status: 'concluido', tipo_servico: 'Limpeza residencial',
  area: null, origem: 'site', recorrente: false, duracao_horas: null, valor: null, custo: null, repasse_pago_em: null, profissional_externo: null,
  prestadora_id: null, prestadora_nome: null, cliente_id: null, cliente_nome: null, ...o,
});
const ANA = { prestadora_id: 'p1', prestadora_nome: 'Ana' }, BIA = { prestadora_id: 'p2', prestadora_nome: 'Bia' }, CARLA = { prestadora_id: 'p3', prestadora_nome: 'Carla' };
const C1 = { cliente_id: 'c1', cliente_nome: 'Cliente 1' }, C2 = { cliente_id: 'c2', cliente_nome: 'Cliente 2' }, C3 = { cliente_id: 'c3', cliente_nome: 'Cliente 3' };

const linhas = [
  L({ id: 'l1', ...ANA, ...C1, dia: '2026-10-05', hora: '09:00', duracao_horas: 4, valor: '300.00', custo: '100.00', recorrente: true, origem: 'importacao', repasse_pago_em: '2026-10-10T12:00:00Z' }),
  L({ id: 'l2', ...ANA, ...C2, dia: '2026-10-05', hora: '11:00', duracao_horas: 2, valor: '200.00', custo: '80.00' }),               // choca com l1 (09–13 × 11–13)
  L({ id: 'l3', ...BIA, ...C1, dia: '2026-10-06', hora: '14:00', duracao_horas: 3, valor: '450.50', custo: '150.25', tipo_servico: 'Passadoria' }),
  L({ id: 'l4', ...ANA, ...C2, dia: '2026-10-07', hora: '08:00', valor: null, custo: '100.00' }),                                    // sem valor, duração 1 h
  L({ id: 'l5', ...ANA, dia: '2026-10-08', status: 'falta', duracao_horas: 2, valor: '300.00' }),                                   // a Ana faltou
  L({ id: 'l6', ...BIA, dia: '2026-10-09', status: 'cancelado', valor: '250.00' }),
  L({ id: 'l7', ...BIA, dia: '2026-10-20', status: 'aceito', duracao_horas: 2, valor: '300.00', custo: '100.00' }),
  L({ id: 'l8', ...ANA, dia: '2026-10-22', hora: '15:00', status: 'proposto', valor: '250.00', custo: '90.00' }),
  L({ id: 'l9', dia: '2026-10-25', hora: null, status: 'pedido' }),                                                                  // futuro, sem prestadora
  L({ id: 'l10', dia: '2026-10-03', status: 'pedido' }),                                                                            // já passou e ninguém foi atribuído
  L({ id: 'l11', dia: '2026-10-18', hora: '10:00', status: 'recusado' }),
  L({ id: 'l12', dia: '2026-10-10', hora: '10:00', duracao_horas: 2, valor: '120.00', profissional_externo: 'Joana', area: 'Rua A, Centro' }), // sem custo, sem cadastro
  L({ id: 'l13', unidade_id: 'u2', ...CARLA, ...C3, dia: '2026-10-12', hora: '16:00', duracao_horas: 2, valor: '500.00', custo: '200.00', tipo_servico: 'Limpeza empresarial', area: 'Rua A, Centro' }),
];
const anteriores = [
  L({ id: 'a1', dia: '2026-09-10', valor: '100.00', custo: '50.00', ...ANA }),
  L({ id: 'a2', dia: '2026-09-11', valor: '200.00', custo: '80.00', ...ANA }),
  L({ id: 'a3', dia: '2026-09-12', status: 'cancelado' }),
];
const recusas = [{ atendimento_id: 'l11', prestadora_id: 'p2' }, { atendimento_id: 'l8', prestadora_id: 'p2' }, { atendimento_id: 'fora', prestadora_id: 'p1' }];
const prestadoras = [
  { id: 'p1', nome: 'Ana', ativa: true, faltas_aceitavel_pct: '10.00' }, { id: 'p2', nome: 'Bia', ativa: true, faltas_aceitavel_pct: null },
  { id: 'p3', nome: 'Carla', ativa: true, faltas_aceitavel_pct: null }, { id: 'p4', nome: 'Dani', ativa: true, faltas_aceitavel_pct: null },
  { id: 'p5', nome: 'Eva', ativa: false, faltas_aceitavel_pct: null },
];
const unidades = [{ id: 'u1', nome: 'Carazinho' }, { id: 'u2', nome: 'Panambi' }];
const periodo = R.resolverPeriodo({}, HOJE);

// ---------------------------------------------------------------- AGENDA
console.log('\nAgenda — contagens');
const avisos = [
  { criado_em: '2026-10-05T10:00:00Z', lido_em: '2026-10-05T12:00:00Z' }, { criado_em: '2026-10-06T10:00:00Z', lido_em: '2026-10-06T16:00:00Z' }, { criado_em: '2026-10-07T10:00:00Z', lido_em: null },
];
const ag = R.relatorioAgenda(linhas, { periodo, hoje: HOJE, anteriores, recusas, avisos, prestadoras, unidades, clientesNovos: 4 });
const rs = ag.resumo;
check('13 agendados: 11 atendimentos (cancelado e falta ficam de fora)', rs.registrados === 13 && rs.total === 11, J(rs));
check('6 concluídos e 5 programados', rs.concluidos === 6 && rs.programados === 5, J(rs));
check('1 cancelado e 1 falta', rs.cancelados === 1 && rs.faltas === 1);
check('horas realizadas = 4+2+3+1(sem duração vale 1 h)+2+2 = 14', rs.horas_realizadas === 14, rs.horas_realizadas);
check('horas programadas = 2 + 4×1 h = 6; total 20', rs.horas_programadas === 6 && rs.horas_total === 20, J(rs));
check('taxa de cancelamento = 1 ÷ 13 = 7,7%', rs.taxa_cancelamento_pct === 7.7, rs.taxa_cancelamento_pct);
check('taxa de faltas = 1 ÷ (6 concluídos + 1 falta) = 14,3%', rs.taxa_faltas_pct === 14.3, rs.taxa_faltas_pct);
check('período anterior: 2 atendimentos concluídos e 1 cancelado', ag.anterior.total === 2 && ag.anterior.concluidos === 2 && ag.anterior.cancelados === 1, J(ag.anterior));

console.log('\nAgenda — distribuições');
const funil = Object.fromEntries(ag.funil.map(f => [f.status, f.qtd]));
check('funil por situação', funil.pedido === 2 && funil.proposto === 1 && funil.recusado === 1 && funil.aceito === 1 && funil.concluido === 6 && funil.cancelado === 1 && funil.falta === 1, J(funil));
check('série por dia tem os 31 dias de outubro (os vazios zerados)', ag.serie.length === 31 && ag.serie[0].chave === '2026-10-01' && ag.serie[30].chave === '2026-10-31');
const dia5 = ag.serie.find(s => s.chave === '2026-10-05');
check('dia 05: 2 atendimentos concluídos', dia5.total === 2 && dia5.concluidos === 2 && dia5.programados === 0, J(dia5));
check('dia 08 só tem a falta; dia 09 só o cancelado (não contam como atendimento)', ag.serie.find(s => s.chave === '2026-10-08').faltas === 1 && ag.serie.find(s => s.chave === '2026-10-08').total === 0 && ag.serie.find(s => s.chave === '2026-10-09').cancelados === 1);
check('soma da série = total de atendimentos', ag.serie.reduce((s, x) => s + x.total, 0) === rs.total);
const seg = ag.dia_semana[0], sab = ag.dia_semana[5], dom = ag.dia_semana[6];
check('segunda tem 3 atendimentos (05/10 ×2 e 12/10), sábado 2, domingo 2', seg.qtd === 3 && sab.qtd === 2 && dom.qtd === 2 && ag.dia_semana.length === 7, J(ag.dia_semana.map(d => d.qtd)));
check('mapa de calor: segunda às 9h = 1; atendimento sem horário contado à parte', ag.calor.celulas.some(c => c.dow === 1 && c.hora === 9 && c.qtd === 1) && ag.calor.sem_horario === 1, J(ag.calor));
const lr = ag.por_servico.find(s => s.tipo_servico === 'Limpeza residencial');
check('por serviço: Limpeza residencial = 9 (l1, l2, l4, l7, l8, l9, l10, l11 e l12); a soma fecha com os 11 atendimentos', ag.por_servico.reduce((s, x) => s + x.qtd, 0) === rs.total && lr.qtd === 9, J(ag.por_servico));
check('serviços ordenados do mais pedido pro menos', ag.por_servico[0].tipo_servico === 'Limpeza residencial');
check('locais: "Rua A, Centro" aparece 2 vezes', ag.por_local.length === 1 && ag.por_local[0].qtd === 2, J(ag.por_local));
check('origem: 12 pelo site e 1 por importação', ag.por_origem[0].origem === 'site' && ag.por_origem[0].qtd === 12 && ag.por_origem[1].origem === 'importacao');
check('recorrentes × avulsos: 1 e 10', ag.recorrencia.recorrentes === 1 && ag.recorrencia.avulsos === 10);

console.log('\nAgenda — clientes');
check('3 clientes ativos, 2 voltaram (2+ atendimentos), 4 cadastrados no período', ag.clientes.ativos === 3 && ag.clientes.voltaram === 2 && ag.clientes.novos === 4, J(ag.clientes));
check('6 atendimentos sem cliente cadastrado', ag.clientes.sem_cadastro === 6, ag.clientes.sem_cadastro);
check('quem mais agenda: Cliente 1 (empate com o 2, desempata por nome)', ag.clientes.top[0].cliente === 'Cliente 1' && ag.clientes.top[0].qtd === 2);

console.log('\nAgenda — prestadoras');
const ana = ag.prestadoras.find(x => x.nome === 'Ana'), bia = ag.prestadoras.find(x => x.nome === 'Bia');
check('Ana: 3 concluídos, 1 programado, 1 falta, 7 h realizadas', ana.concluidos === 3 && ana.programados === 1 && ana.faltas === 1 && ana.horas_realizadas === 7, J(ana));
check('Ana: taxa de faltas 1 ÷ 4 = 25% — acima da meta de 10%', ana.taxa_faltas_pct === 25 && ana.meta_pct === 10 && ana.acima_meta === true);
check('Bia: 2 recusas em 4 convites = 50%', bia.recusas === 2 && bia.convites === 4 && bia.taxa_recusa_pct === 50, J(bia));
check('Bia: sem meta definida nunca fica "acima da meta"', bia.meta_pct === null && bia.acima_meta === false);
check('recusa de atendimento de OUTRO período/unidade (fora) é ignorada', ag.recusas.total === 2 && ag.recusas.atendimentos === 2, J(ag.recusas));
check('taxa de recusa geral = 2 ÷ 10 convites = 20%', ag.recusas.convites === 10 && ag.recusas.taxa_pct === 20, J(ag.recusas));
check('só Dani (ativa, sem atendimento) é ociosa; Eva está inativa', ag.ociosas.length === 1 && ag.ociosas[0].nome === 'Dani', J(ag.ociosas));
check('ordenadas por concluídos: Ana primeiro', ag.prestadoras[0].nome === 'Ana');
check('avisos: 3 enviados, 2 lidos, 1 sem ler, 4 h em média pra ler', ag.avisos.enviados === 3 && ag.avisos.lidos === 2 && ag.avisos.nao_lidos === 1 && ag.avisos.horas_ate_ler === 4, J(ag.avisos));

console.log('\nAgenda — alertas');
const al = ag.alertas;
check('2 futuros sem prestadora (l9, l11) e 1 que já passou sem ninguém (l10)', al.sem_prestadora_futuros === 2 && al.sem_prestadora_passados === 1, J(al));
check('nenhum convite vencido; 1 atendimento com nome da planilha sem vínculo', al.convites_vencidos === 0 && al.sem_vinculo_planilha === 1, J(al));
check('choque de horário: l1 e l2 da Ana (09–13 × 11–13)', al.choques.atendimentos === 2 && al.choques.prestadoras === 1, J(al.choques));
check('por unidade: Carazinho 10, Panambi 1', ag.por_unidade.length === 2 && ag.por_unidade[0].nome === 'Carazinho' && ag.por_unidade[0].total === 10 && ag.por_unidade[1].total === 1, J(ag.por_unidade.map(u => u.total)));
const ag1 = R.relatorioAgenda(linhas, { periodo, hoje: HOJE, prestadoras, unidades: [unidades[0]] });
check('com uma unidade só não há comparativo entre unidades', ag1.por_unidade.length === 0);
const agVazio = R.relatorioAgenda([], { periodo, hoje: HOJE });
check('período sem nada: zeros e taxas nulas (sem dividir por zero)', agVazio.resumo.total === 0 && agVazio.resumo.taxa_faltas_pct === null && agVazio.resumo.taxa_cancelamento_pct === null && agVazio.serie.length === 31);
check('choque: horários colados (09–11 e 11–13) NÃO se sobrepõem', R.choquesDeHorario([
  L({ id: 'q1', prestadora_id: 'p1', hora: '09:00', duracao_horas: 2 }), L({ id: 'q2', prestadora_id: 'p1', hora: '11:00', duracao_horas: 2 })]).atendimentos === 0);
check('choque: cancelado e falta não ocupam horário', R.choquesDeHorario([
  L({ id: 'q1', prestadora_id: 'p1', hora: '09:00', duracao_horas: 2 }), L({ id: 'q2', prestadora_id: 'p1', status: 'cancelado', hora: '09:30', duracao_horas: 2 })]).atendimentos === 0);

// ---------------------------------------------------------------- FINANCEIRO
console.log('\nFinanceiro');
const evolucao = [{ mes: '2026-10', qtd: 5, receita: '1570.50', custo: '630.25', receita_completa: '1450.50', custo_completo: '530.25' }, { mes: '2026-08', qtd: 1, receita: '100', custo: '40', receita_completa: '100', custo_completo: '40' }];
const fin = R.relatorioFinanceiro(linhas, { periodo, hoje: HOJE, anteriores, evolucao, unidades });
const re = fin.realizado;
check('receita realizada = 300+200+450,50+120+500 = 1.570,50 (o concluído sem valor não entra)', re.receita === 1570.5, re.receita);
check('custo = 100+80+150,25+100+200 = 630,25', re.custo === 630.25, re.custo);
check('margem só dos completos: 1.450,50 − 530,25 = 920,25 (63,4%) em 4 de 5', re.margem === 920.25 && re.margem_pct === 63.4 && re.completos === 4, J(re));
check('ticket médio = 1.570,50 ÷ 5 que têm valor = 314,10', re.ticket_medio === 314.1, re.ticket_medio);
check('receita por hora = 1.570,50 ÷ 13 h = 120,81', re.receita_hora === 120.81, re.receita_hora);
check('previsto: 4 por acontecer (l7, l8, l9, l11), receita 550; o pedido que já passou (l10) não entra', fin.previsto.qtd === 4 && fin.previsto.receita === 550, J(fin.previsto));
check('previsto: 2 sem prestadora e 2 sem valor', fin.previsto.sem_prestadora_qtd === 2 && fin.previsto.sem_valor_qtd === 2);
check('receita perdida: cancelado 250 + falta 300 = 550', fin.perdido.cancelados.receita === 250 && fin.perdido.faltas.receita === 300 && fin.perdido.receita === 550, J(fin.perdido));
check('repasses: 630,25 no total, 100 já pago, 530,25 pendente, 1 concluído sem custo', fin.repasses.total === 630.25 && fin.repasses.pago === 100 && fin.repasses.pendente === 530.25 && fin.repasses.sem_custo_qtd === 1, J(fin.repasses));
check('período anterior: receita 300, custo 130 (o cancelado não conta)', fin.anterior.receita === 300 && fin.anterior.custo === 130 && fin.anterior.qtd === 2, J(fin.anterior));
check('série mensal do dia 05: receita 500, custo 180, margem 320', (() => { const d = fin.serie.find(s => s.chave === '2026-10-05'); return d.receita === 500 && d.custo === 180 && d.margem === 320 && d.qtd === 2; })());
check('série: o previsto aparece nos dias futuros (20/10 = 300)', fin.serie.find(s => s.chave === '2026-10-20').prevista === 300);
check('soma da receita da série = receita realizada', Math.round(fin.serie.reduce((s, x) => s + x.receita, 0) * 100) / 100 === re.receita);
const s0 = fin.por_servico;
check('por serviço: Limpeza residencial 620, Limpeza empresarial 500, Passadoria 450,50 (maior receita primeiro)', s0.map(s => s.tipo_servico + '=' + s.receita).join() === 'Limpeza residencial=620,Limpeza empresarial=500,Passadoria=450.5', s0.map(s => s.tipo_servico + '=' + s.receita).join());
check('Passadoria: ticket 450,50, 3 h, 150,17/h', s0[2].ticket_medio === 450.5 && s0[2].horas === 3 && s0[2].receita_hora === 150.17, J(s0[2]));
check('clientes: 1 (750,50 = 47,8%), 3 (500), 2 (200)', fin.por_cliente.map(c => c.cliente).join() === 'Cliente 1,Cliente 3,Cliente 2' && fin.por_cliente[0].receita === 750.5 && fin.por_cliente[0].pct_receita === 47.8, J(fin.por_cliente.map(c => [c.cliente, c.receita, c.pct_receita])));
check('concentração: maior cliente 47,8% da receita; os 3 maiores 92,4%', fin.concentracao.top1_pct === 47.8 && fin.concentracao.top3_pct === 92.4 && fin.concentracao.clientes === 3, J(fin.concentracao));
const fa = fin.por_prestadora.find(x => x.prestadora === 'Ana');
check('Ana: 3 concluídos, receita 500, a pagar 280, pago 100, pendente 180', fa.qtd === 3 && fa.receita === 500 && fa.a_pagar_total === 280 && fa.pago === 100 && fa.pendente === 180, J(fa));
check('o concluído sem prestadora (l12) não vira repasse de ninguém', fin.por_prestadora.length === 3);
check('evolução tem sempre 12 meses (nov/2025 a out/2026), os vazios zerados', fin.evolucao.length === 12 && fin.evolucao[0].mes === '2025-11' && fin.evolucao[11].mes === '2026-10' && fin.evolucao[0].receita === 0, J(fin.evolucao.map(e => e.mes)));
check('evolução de outubro: receita 1.570,50 e margem 920,25; agosto: margem 60', fin.evolucao[11].receita === 1570.5 && fin.evolucao[11].margem === 920.25 && fin.evolucao.find(e => e.mes === '2026-08').margem === 60);
check('alertas de dados: 1 concluído sem valor, 1 sem custo', fin.alertas.realizados_sem_valor === 1 && fin.alertas.realizados_sem_custo === 1, J(fin.alertas));
check('por unidade: Carazinho 1.070,50 e Panambi 500', fin.por_unidade.length === 2 && fin.por_unidade[0].receita === 1070.5 && fin.por_unidade[1].receita === 500, J(fin.por_unidade.map(u => u.receita)));
const finVazio = R.relatorioFinanceiro([], { periodo, hoje: HOJE });
check('sem nada: tudo zerado, ticket e margem nulos', finVazio.realizado.qtd === 0 && finVazio.realizado.ticket_medio === null && finVazio.realizado.margem_pct === null && finVazio.concentracao.top1_pct === null && finVazio.evolucao.length === 12);

// ---------------------------------------------------------------- SATISFAÇÃO
console.log('\nSatisfação');
const AV = (o) => ({ id: 'v' + Math.random().toString(36).slice(2), nota: 5, status: 'aprovada', comentario: null, dia: '2026-10-05', unidade_id: 'u1', ...ANA, ...C1, tipo_servico: 'Limpeza residencial', horas_ate_avaliar: null, horas_moderacao: null, ...o });
const avaliacoes = [
  AV({ id: 'v1', nota: 5, comentario: 'Ótima', horas_ate_avaliar: 2, horas_moderacao: 1 }),
  AV({ id: 'v2', nota: 4, ...C2, horas_ate_avaliar: 4, horas_moderacao: 3 }),
  AV({ id: 'v3', nota: 2, ...BIA, dia: '2026-10-06', tipo_servico: 'Passadoria', comentario: 'Atrasou', horas_ate_avaliar: 6, horas_moderacao: 5 }),
  AV({ id: 'v4', nota: 3, status: 'pendente', ...BIA, dia: '2026-10-07', comentario: 'Mais ou menos', horas_ate_avaliar: 8 }),
  AV({ id: 'v5', nota: 1, status: 'recusada', ...ANA, ...C2, dia: '2026-10-08', comentario: 'Reclamação injusta', horas_ate_avaliar: 10, horas_moderacao: 2 }),
  AV({ id: 'v6', nota: 5, unidade_id: 'u2', ...CARLA, ...C3, dia: '2026-10-12', tipo_servico: 'Limpeza empresarial', comentario: '' }),
];
const sat = R.relatorioSatisfacao(avaliacoes, { periodo, hoje: HOJE, linhas, anteriores: [AV({ nota: 3 }), AV({ nota: 4 })], recusas, prestadoras, unidades });
const sr = sat.resumo;
check('6 avaliações: 4 aprovadas, 1 pendente, 1 recusada', sr.total === 6 && sr.aprovadas === 4 && sr.pendentes === 1 && sr.recusadas === 1, J(sr));
check('nota média só das aprovadas: (5+4+2+5) ÷ 4 = 4,00', sr.nota_media === 4, sr.nota_media);
check('75% satisfeitos (notas 4 e 5) e 25% insatisfeitos (1 e 2)', sr.satisfeitos_pct === 75 && sr.insatisfeitos_pct === 25, J(sr));
check('distribuição das aprovadas: 5★ ×2, 4★ ×1, 3★ ×0, 2★ ×1, 1★ ×0', sr.distribuicao.map(d => d.qtd).join() === '2,1,0,1,0', J(sr.distribuicao));
check('aprovação = 4 de 5 moderadas = 80%', sr.taxa_aprovacao_pct === 80, sr.taxa_aprovacao_pct);
check('tempo médio até avaliar = (2+4+6+8+10) ÷ 5 = 6 h; moderação = (1+3+5+2) ÷ 4 = 2,8 h', sr.horas_ate_avaliar === 6 && sr.horas_moderacao === 2.8, J([sr.horas_ate_avaliar, sr.horas_moderacao]));
check('período anterior: 2 aprovadas, média 3,5', sat.anterior.aprovadas === 2 && sat.anterior.nota_media === 3.5, J(sat.anterior));
check('taxa de resposta limitada a 100% (6 avaliações pra 5 concluídos com cliente)', sat.cobertura.concluidos === 5 && sat.cobertura.taxa_resposta_pct === 100, J(sat.cobertura));
check('3 clientes atendidos e os 3 avaliaram', sat.cobertura.clientes_atendidos === 3 && sat.cobertura.clientes_que_avaliaram === 3, J(sat.cobertura));
const sat2 = R.relatorioSatisfacao([AV({})], { periodo, hoje: HOJE, linhas: linhas.filter(l => l.id === 'l1' || l.id === 'l2' || l.id === 'l3' || l.id === 'l4'), prestadoras, unidades: [] });
check('1 avaliação pra 4 concluídos com cliente = 25%', sat2.cobertura.taxa_resposta_pct === 25, J(sat2.cobertura));
check('série: nota média do dia 05 = 4,5 (5 e 4); dia 06 = 2; dia sem avaliação = nulo', sat.serie.find(s => s.chave === '2026-10-05').nota_media === 4.5 && sat.serie.find(s => s.chave === '2026-10-06').nota_media === 2 && sat.serie.find(s => s.chave === '2026-10-10').nota_media === null);
check('prestadoras por nota: Carla 5,00 · Ana 4,50 · Bia 2,00', sat.por_prestadora.map(x => x.nome + '=' + x.nota_media).join() === 'Carla=5,Ana=4.5,Bia=2', sat.por_prestadora.map(x => x.nome + '=' + x.nota_media).join());
const sana = sat.por_prestadora.find(x => x.nome === 'Ana'), sbia = sat.por_prestadora.find(x => x.nome === 'Bia');
check('Ana: 2 avaliações aprovadas (a recusada não conta), 100% satisfeita, 1 falta e acima da meta', sana.avaliacoes === 2 && sana.satisfeitos_pct === 100 && sana.faltas === 1 && sana.acima_meta === true, J(sana));
check('Bia: 1 aprovada (2,00) + 1 pendente de moderação; 2 recusas e 1 cancelamento', sbia.avaliacoes === 1 && sbia.pendentes === 1 && sbia.recusas === 2 && sbia.cancelados === 1, J(sbia));
check('serviços: Limpeza residencial 2 avaliações (4,50), Passadoria 1 (2,00), Limpeza empresarial 1 (5,00)', sat.por_servico.map(s => s.tipo_servico + ':' + s.avaliacoes + ':' + s.nota_media).join() === 'Limpeza residencial:2:4.5,Limpeza empresarial:1:5,Passadoria:1:2', sat.por_servico.map(s => s.tipo_servico + ':' + s.avaliacoes + ':' + s.nota_media).join());
check('atenção (nota ≤ 3, qualquer situação), mais recente primeiro: v5, v4, v3', sat.atencao.map(a => a.id).join() === 'v5,v4,v3', sat.atencao.map(a => a.id).join());
check('elogios: só nota 5 aprovada COM comentário (v1)', sat.elogios.length === 1 && sat.elogios[0].id === 'v1');
check('qualidade operacional: 1 falta (14,3%), 1 cancelamento, 2 recusas (20%)', sat.qualidade.faltas === 1 && sat.qualidade.taxa_faltas_pct === 14.3 && sat.qualidade.cancelados === 1 && sat.qualidade.recusas === 2 && sat.qualidade.taxa_recusa_pct === 20, J(sat.qualidade));
check('por unidade: Panambi 5,00 e Carazinho 3,67', sat.por_unidade.length === 2 && sat.por_unidade[0].nome === 'Panambi' && sat.por_unidade[0].nota_media === 5 && sat.por_unidade[1].nota_media === 3.67, J(sat.por_unidade));
const satVazio = R.relatorioSatisfacao([], { periodo, hoje: HOJE, linhas: [], prestadoras: [] });
check('sem avaliações: média nula, sem dividir por zero', satVazio.resumo.nota_media === null && satVazio.resumo.satisfeitos_pct === null && satVazio.cobertura.taxa_resposta_pct === null && satVazio.por_prestadora.length === 0);

console.log(`\n${falhas ? 'COM FALHAS' : 'TUDO CERTO'} — ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
