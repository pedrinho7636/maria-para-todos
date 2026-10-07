// Uso: npm run teste:financeiro   (não precisa de API nem de banco)
// Cálculos do módulo Financeiro: receita, custo, margem, repasses, previsto e pendências.
const { resumir } = require('../src/utils/financeiro');

let ok = 0, falhas = 0;
const check = (n, c, extra = '') => { c ? ok++ : falhas++; console.log(c ? '  ok  ' : '  FALHA', n, c ? '' : extra); };

const HOJE = '2026-10-15';
const L = (o) => ({ id: Math.random().toString(36).slice(2), dia: '2026-10-05', hora: '09:00', status: 'concluido', tipo_servico: 'Limpeza residencial',
  valor: null, custo: null, prestadora_id: null, prestadora_nome: null, cliente_id: null, cliente_nome: null, repasse_pago_em: null, ...o });

// Duas prestadoras, 3 concluídos completos + 1 sem valor + 1 sem custo + 1 sem prestadora
const linhas = [
  L({ valor: '300.00', custo: '100.00', prestadora_id: 'p1', prestadora_nome: 'Ana', cliente_id: 'c1', cliente_nome: 'Cliente 1' }),
  L({ valor: '300.00', custo: '100.00', prestadora_id: 'p1', prestadora_nome: 'Ana', cliente_id: 'c1', cliente_nome: 'Cliente 1', repasse_pago_em: '2026-10-10T12:00:00Z' }),
  L({ valor: '450.50', custo: '150.25', prestadora_id: 'p2', prestadora_nome: 'Bia', cliente_id: 'c2', cliente_nome: 'Cliente 2', tipo_servico: 'Passadoria' }),
  L({ valor: null, custo: '100.00', prestadora_id: 'p1', prestadora_nome: 'Ana' }),                       // sem valor cobrado
  L({ valor: '200.00', custo: null, prestadora_id: 'p2', prestadora_nome: 'Bia', tipo_servico: 'Passadoria' }), // prestadora sem tarifa
  L({ valor: '120.00', custo: null }),                                                                      // sem prestadora
  // futuros
  L({ status: 'aceito', dia: '2026-10-20', valor: '300.00', custo: '100.00', prestadora_id: 'p1', prestadora_nome: 'Ana' }),
  L({ status: 'proposto', dia: '2026-10-22', valor: '250.00', custo: '90.00', prestadora_id: 'p2', prestadora_nome: 'Bia' }),
  L({ status: 'pedido', dia: '2026-10-25', valor: null }),
  // convite que já venceu (não aceito e a data passou)
  L({ status: 'proposto', dia: '2026-10-03', valor: '300.00', custo: '100.00', prestadora_id: 'p1', prestadora_nome: 'Ana' }),
];
const r = resumir(linhas, HOJE);

console.log('\nRealizado');
check('6 atendimentos concluídos', r.realizado.qtd === 6);
check('receita = 300+300+450,50+200+120 = 1.370,50 (o que não tem valor não entra)', r.realizado.receita === 1370.5, r.realizado.receita);
check('custo = 100+100+150,25+100 = 450,25', r.realizado.custo === 450.25, r.realizado.custo);
check('margem só dos COMPLETOS (valor E custo): 1050,50 − 350,25 = 700,25', r.realizado.margem === 700.25 && r.realizado.completos === 3, JSON.stringify(r.realizado));
check('margem % = 700,25 ÷ 1050,50 = 66,7%', r.realizado.margem_pct === 66.7, r.realizado.margem_pct);

console.log('\nPrevisto');
check('3 por acontecer (aceito, proposto e pedido; o convite vencido NÃO conta)', r.previsto.qtd === 3, r.previsto.qtd);
check('receita prevista = 300 + 250 = 550', r.previsto.receita === 550);
check('1 ainda sem prestadora e 1 sem valor', r.previsto.sem_prestadora_qtd === 1 && r.previsto.sem_valor_qtd === 1, JSON.stringify(r.previsto));

console.log('\nRepasses por prestadora');
const ana = r.por_prestadora.find(p => p.prestadora_id === 'p1'), bia = r.por_prestadora.find(p => p.prestadora_id === 'p2');
check('Ana: 3 concluídos, a pagar 300 (100×3), pago 100, pendente 200', ana.qtd === 3 && ana.a_pagar_total === 300 && ana.pago === 100 && ana.pendente === 200, JSON.stringify(ana));
check('Ana: 1 pago e 2 pendentes', ana.pagos_qtd === 1 && ana.pendentes_qtd === 2);
check('Bia: 2 concluídos, mas só 1 tem custo → a pagar 150,25 e 1 "sem custo"', bia.qtd === 2 && bia.a_pagar_total === 150.25 && bia.sem_custo_qtd === 1 && bia.pendente === 150.25, JSON.stringify(bia));
check('o atendimento sem prestadora não vira repasse de ninguém', r.por_prestadora.length === 2);
check('ordenado por pendente (maior primeiro)', r.por_prestadora[0].prestadora_id === 'p1');
check('total de repasses pendentes = 200 + 150,25', r.alertas.repasses_pendentes === 350.25, r.alertas.repasses_pendentes);

console.log('\nMargem por serviço / clientes');
const limpeza = r.por_servico.find(s => s.tipo_servico === 'Limpeza residencial'), passa = r.por_servico.find(s => s.tipo_servico === 'Passadoria');
check('Limpeza residencial: 4 atend., receita 720 (300+300+120 e um sem valor)', limpeza.qtd === 4 && limpeza.receita === 720, JSON.stringify(limpeza));
check('Passadoria: 2 atend., receita 650,50, margem 300,25 (só o completo)', passa.qtd === 2 && passa.receita === 650.5 && passa.margem === 300.25, JSON.stringify(passa));
check('ordem: maior receita primeiro', r.por_servico[0].tipo_servico === 'Limpeza residencial');
check('clientes: só quem tem cadastro, maior receita primeiro (Cliente 1 = 600)', r.por_cliente.length === 2 && r.por_cliente[0].cliente === 'Cliente 1' && r.por_cliente[0].receita === 600, JSON.stringify(r.por_cliente));

console.log('\nAlertas e pendências');
check('alertas: 1 sem valor, 2 sem custo, 1 convite vencido', r.alertas.realizados_sem_valor === 1 && r.alertas.realizados_sem_custo === 2 && r.alertas.convites_vencidos === 1, JSON.stringify(r.alertas));
check('3 pendências listadas', r.pendencias.length === 3, JSON.stringify(r.pendencias));
const faltas = r.pendencias.map(p => p.falta.join('+')).sort();
check('uma falta "valor", uma "custo" e uma "prestadora"', faltas.join(',') === 'custo,prestadora,valor', faltas.join(','));

console.log('\nCentavos (sem erro de ponto flutuante)');
const dez = Array.from({ length: 10 }, () => L({ valor: '0.10', custo: '0.07', prestadora_id: 'p1', prestadora_nome: 'Ana' }));
const rd = resumir(dez, HOJE);
check('10 × 0,10 = 1,00 exato (em float seria 0,9999…)', rd.realizado.receita === 1 && rd.realizado.custo === 0.7 && rd.realizado.margem === 0.3, JSON.stringify(rd.realizado));

console.log('\nMês vazio');
const vazio = resumir([], HOJE);
check('sem atendimentos: zeros, margem % nula, sem pendências', vazio.realizado.qtd === 0 && vazio.realizado.receita === 0 && vazio.realizado.margem_pct === null && vazio.pendencias.length === 0 && vazio.por_prestadora.length === 0);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
