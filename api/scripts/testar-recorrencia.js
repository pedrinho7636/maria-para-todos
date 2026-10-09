// Uso: npm run teste:recorrencia   (não precisa de API nem de banco)
// Valor do mês de um atendimento recorrente: divisão entre as ocorrências de cada mês (4 ou 5 terças,
// quinzenal, mês parcial, centavos que sobram) e a geração das datas.
const { gerarOcorrencias } = require('../src/utils/recorrencia');
let ok = 0, falhas = 0;
const check = (n, c, extra = '') => { c ? ok++ : falhas++; console.log(c ? '  ok  ' : '  FALHA', n, c ? '' : extra); };
const soma = (ls) => Math.round(ls.reduce((s, l) => s + l.valor * 100, 0));
const porMes = (ls) => ls.reduce((m, l) => { (m[l.data.slice(0, 7)] ||= []).push(l); return m; }, {});

// terças (dia 2), a partir de 01/09/2026 (terça), 3 meses → set/out/nov. Set 2026 tem 4 terças; out 4 (6,13,20,27); nov 4 (3,10,17,24)
let ls = gerarOcorrencias({ dataInicio: '2026-09-01', horizonteMeses: 3, alternadas: false, itens: [{ dia_semana: 2, valor_mensal: 1200 }] });
let m = porMes(ls);
console.log('  meses:', Object.entries(m).map(([k, v]) => `${k}:${v.length}x${v[0].valor}`).join(' '));
check('set/2026 (5 terças): R$ 240 cada; out e nov (4 terças): R$ 300 cada', m['2026-09'].length === 5 && m['2026-09'].every(l => l.valor === 240) && m['2026-10'].every(l => l.valor === 300) && m['2026-11'].every(l => l.valor === 300));
check('soma de cada mês completo = 1200', ['2026-09', '2026-10', '2026-11'].every(k => soma(m[k]) === 120000), JSON.stringify(Object.values(m).map(soma)));
check('valor_mensal fica guardado (1200)', ls.every(l => l.valor_mensal === 1200));

// mês com 5 terças: dezembro 2026 tem terças 1,8,15,22,29 → 1200/5 = 240
ls = gerarOcorrencias({ dataInicio: '2026-12-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 2, valor_mensal: 1200 }] });
m = porMes(ls);
check('dez/2026 (5 terças): R$ 240 cada, soma 1200', m['2026-12'].length === 5 && m['2026-12'].every(l => l.valor === 240) && soma(m['2026-12']) === 120000);

// centavos: 1000 / 3 → 333,34 + 333,33 + 333,33 = 1000,00. Mês com 3 ocorrências: quinzenal? usar sexta (dia 5) alternada
ls = gerarOcorrencias({ dataInicio: '2026-09-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 3, valor_mensal: 1000 }] }); // quartas set: 2,9,16,23,30 = 5
m = porMes(ls);
check('1000 ÷ 5 quartas = 200 exato', m['2026-09'].every(l => l.valor === 200));
ls = gerarOcorrencias({ dataInicio: '2026-10-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 2, valor_mensal: 1000 }] }); // out: 4 terças
check('1000 ÷ 4 = 250', porMes(ls)['2026-10'].every(l => l.valor === 250));
ls = gerarOcorrencias({ dataInicio: '2026-09-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 3, valor_mensal: 100 }] }); // 5 quartas: 100/5=20
const dividir = gerarOcorrencias({ dataInicio: '2026-09-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 3, valor_mensal: 100.01 }] });
check('centavos: 100,01 ÷ 5 fecha em 100,01 (sem perder/inventar centavo)', soma(porMes(dividir)['2026-09']) === 10001, JSON.stringify(dividir.map(l => l.valor)));

// mês parcial: começa dia 15/09 → terças 15,22,29 (3 das 5 de set): cada R$ 240 (proporcional), não 400
ls = gerarOcorrencias({ dataInicio: '2026-09-15', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 2, valor_mensal: 1200 }] });
m = porMes(ls);
check('mês parcial (3 de 5 terças): cada uma R$ 240 — não cobra o mês cheio', m['2026-09'].length === 3 && m['2026-09'].every(l => l.valor === 240), JSON.stringify(m['2026-09']));

// quinzenal: terças alternadas a partir de 01/09: semanas 0,2,4 → 1/9, 15/9, 29/9 → 3 em set; mês cheio do padrão = 3 → 400
ls = gerarOcorrencias({ dataInicio: '2026-09-01', horizonteMeses: 1, alternadas: true, itens: [{ dia_semana: 2, valor_mensal: 1200 }] });
m = porMes(ls);
console.log('  quinzenal set:', m['2026-09'].map(l => l.data + '=' + l.valor).join(' '));
check('quinzenal: datas 1, 15, 29 e R$ 400 cada', m['2026-09'].map(l => l.data).join() === '2026-09-01,2026-09-15,2026-09-29' && m['2026-09'].every(l => l.valor === 400));
// mês seguinte do quinzenal (out): terças 13, 27 (semanas pares) = 2 → 600 cada; confere paridade além do mês de início
ls = gerarOcorrencias({ dataInicio: '2026-09-01', horizonteMeses: 2, alternadas: true, itens: [{ dia_semana: 2, valor_mensal: 1200 }] });
m = porMes(ls);
console.log('  quinzenal out:', m['2026-10'].map(l => l.data + '=' + l.valor).join(' '));
check('quinzenal outubro: 13/10 e 27/10, R$ 600 cada (soma 1200)', m['2026-10'].map(l => l.data).join() === '2026-10-13,2026-10-27' && soma(m['2026-10']) === 120000);

// vários itens com valores diferentes + item sem valor
ls = gerarOcorrencias({ dataInicio: '2026-09-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 2, valor_mensal: 800 }, { dia_semana: 4, valor_mensal: null }] });
check('item sem valor mensal fica sem valor (null)', ls.filter(l => l.item === 1).every(l => l.valor === null && l.valor_mensal === null));
check('item com valor soma 800 no mês', soma(ls.filter(l => l.item === 0)) === 80000);
// início num domingo e data inválida
ls = gerarOcorrencias({ dataInicio: '2026-09-06', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 0 }] });
check('sem valor_mensal nenhum valor é calculado', ls.length > 0 && ls.every(l => l.valor === null));
let erro = null; try { gerarOcorrencias({ dataInicio: '2026-02-30', itens: [{ dia_semana: 1 }] }); } catch (e) { erro = e.message; }
check('data inexistente (30/02) é recusada', erro === 'data_inicio inválida', erro);
ls = gerarOcorrencias({ dataInicio: '2026-01-01', horizonteMeses: 24, alternadas: false, itens: [0, 1, 2, 3, 4, 5, 6].map(d => ({ dia_semana: d })) });
check('trava de 200 ocorrências', ls.length === 200);
// Série com VÁRIOS dias da semana e um valor do mês só: dividido entre TODAS as ocorrências do mês
// (outubro/2026: 4 terças + 5 quintas = 9 atendimentos; R$ 1.000 ÷ 9, fechando em 1.000,00 exato)
ls = gerarOcorrencias({ dataInicio: '2026-10-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 2 }, { dia_semana: 4 }], valorMensalTotal: 1000 });
m = porMes(ls);
check('terça+quinta em outubro: 9 atendimentos', m['2026-10'].length === 9, String(m['2026-10']?.length));
check('R$ 1.000 do mês dividido entre os 9 (não 1.000 por dia da semana): soma exata 1.000,00', soma(m['2026-10']) === 100000, String(soma(m['2026-10'])));
check('o centavo que sobra vai pra primeira ocorrência (111,12 e 111,11)', m['2026-10'][0].valor === 111.12 && m['2026-10'][1].valor === 111.11);
check('todas guardam o valor do mês informado (1000)', ls.every(l => l.valor_mensal === 1000));
ls = gerarOcorrencias({ dataInicio: '2026-10-01', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 2 }, { dia_semana: 4 }] });
check('sem valor do mês, nenhum valor é calculado', ls.every(l => l.valor === null));
ls = gerarOcorrencias({ dataInicio: '2026-10-15', horizonteMeses: 1, alternadas: false, itens: [{ dia_semana: 2 }, { dia_semana: 4 }], valorMensalTotal: 900 });
m = porMes(ls);
check('mês parcial (começa dia 15): cada atendimento recebe a parte proporcional ao mês cheio (900 ÷ 9 = 100)', m['2026-10'].every(l => l.valor === 100), JSON.stringify(m['2026-10'].map(l => l.valor)));

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);


