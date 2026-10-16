// Uso: npm run teste:relatorios-api   (a API precisa estar rodando; API_URL muda o endereço)
//
// Cobre as rotas /api/relatorios/*: quem pode abrir (só o administrador da unidade), os parâmetros de período,
// o consolidado de várias unidades e se os números batem com o que está gravado.
// Os dados de teste ficam em março de 2040 (nenhuma agenda real chega lá) e são apagados no fim. Cria e apaga "qa-%".
//   PowerShell:  $env:PORT='3011'; $env:SMTP_USER=''; $env:SMTP_PASS=''; $env:RESEND_API_KEY=''; $env:LIMITE_CADASTRO='1000'; node src/server.js
//   e então:     $env:API_URL='http://localhost:3011'; npm run teste:relatorios-api
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const BASE = (process.env.API_URL || 'http://localhost:3001') + '/api';
const pool = new Pool({ host: process.env.PGHOST, port: process.env.PGPORT, database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD });
let ok = 0, falhas = 0;
const check = (nome, cond, extra = '') => { if (cond) { ok++; console.log('  ok  ', nome); } else { falhas++; console.log('  FALHA', nome, extra); } };
const http = async (rota, token) => {
  const r = await fetch(BASE + rota, { headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  let j = {}; try { j = await r.json(); } catch (e) { }
  return { s: r.status, j };
};
const login = async (email, senha) => {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perfil: 'administrador', identificador: email, senha }) });
  return (await r.json()).token;
};
const limpar = async () => {
  await pool.query("delete from avaliacoes where atendimento_id in (select id from atendimentos where tipo_servico like 'qa-%')");
  await pool.query("delete from atendimentos where tipo_servico like 'qa-%'");
  await pool.query("delete from administrador_unidades where administrador_id in (select id from administradores where email like 'qa-%')");
  await pool.query("delete from sub_administradores where email like 'qa-%'");
  await pool.query("delete from administradores where email like 'qa-%'");
  await pool.query("delete from prestadoras where nome like 'qa-%'");
  await pool.query("delete from clientes where email like 'qa-%'");
};

(async () => {
  const hash = await bcrypt.hash('senhaqa123', 10);
  const { rows: [car] } = await pool.query("select id, nome from unidades where slug = 'carazinho'");
  const { rows: [pan] } = await pool.query("select id, nome from unidades where slug = 'panambi'");
  await limpar();

  const novoAdmin = async (email, unidades) => {
    const { rows: [a] } = await pool.query("insert into administradores (nome, sobrenome, email, senha_hash) values ('qa','Rel',$1,$2) returning id", [email, hash]);
    for (const u of unidades) await pool.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1,$2)', [a.id, u]);
    return a.id;
  };
  await novoAdmin('qa-reladm@teste.local', [car.id]);
  await novoAdmin('qa-relpan@teste.local', [pan.id]);
  await novoAdmin('qa-relmulti@teste.local', [car.id, pan.id]);
  await pool.query("insert into sub_administradores (nome, sobrenome, email, senha_hash, unidade_id, pode_dashboard, pode_agenda, pode_avaliacoes, pode_equipe, pode_clientes, pode_financeiro) values ('qa','Sub','qa-relsub@teste.local',$1,$2,true,true,true,true,true,true)", [hash, car.id]);
  const { rows: [pa] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id, valor_por_atendimento) values ('qa-RelA','54999991001','qa-rela@teste.local',$1,$2,80) returning id", [hash, car.id]);
  const { rows: [pb] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id) values ('qa-RelB','54999991002','qa-relb@teste.local',$1,$2) returning id", [hash, pan.id]);
  await pool.query('insert into controle_prestadora (prestadora_id, faltas_aceitavel_pct) values ($1, 10)', [pa.id]);
  const { rows: [cli] } = await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-RelCli','qa-relcli@teste.local',$1,$2) returning id", [hash, car.id]);
  const ins = async (unidade, prest, status, dia, hora, valor, valorPrest) => (await pool.query(
    `insert into atendimentos (unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, hora_atendimento, duracao_horas, valor, valor_prestadora, status, origem)
     values ($1,$2,$3,'qa-rel',$4,$5,2,$6,$7,$8,'manual') returning id`, [unidade, unidade === car.id ? cli.id : null, prest, `2040-03-${dia}`, hora, valor, valorPrest, status])).rows[0].id;
  const l1 = await ins(car.id, pa.id, 'concluido', '05', '09:00', 300, 100);
  const l2 = await ins(car.id, pa.id, 'concluido', '06', '09:00', 200, null);   // custo = tarifa atual (80)
  await ins(car.id, pa.id, 'cancelado', '07', '09:00', 150, null);
  await ins(car.id, pa.id, 'falta', '08', '09:00', 100, null);
  await ins(car.id, pa.id, 'aceito', '20', '09:00', 250, null);                  // futuro: previsto
  await ins(pan.id, pb.id, 'concluido', '10', '09:00', 500, 200);
  await pool.query("insert into avaliacoes (atendimento_id, cliente_id, prestadora_id, nota, comentario, status) values ($1,$2,$3,5,'Ótimo','aprovada')", [l1, cli.id, pa.id]);
  await pool.query("insert into avaliacoes (atendimento_id, cliente_id, prestadora_id, nota, status) values ($1,$2,$3,3,'pendente')", [l2, cli.id, pa.id]);

  const tAdm = await login('qa-reladm@teste.local', 'senhaqa123');
  const tPan = await login('qa-relpan@teste.local', 'senhaqa123');
  const tMulti = await login('qa-relmulti@teste.local', 'senhaqa123');
  const tSub = await login('qa-relsub@teste.local', 'senhaqa123');
  const P = '?mes=2040-03';

  console.log('\n== Quem pode abrir ==');
  for (const aba of ['agenda', 'financeiro', 'satisfacao']) {
    let r = await http(`/relatorios/carazinho/${aba}${P}`, tAdm);
    check(`${aba}: administrador da unidade abre (200)`, r.s === 200, JSON.stringify(r.j).slice(0, 120));
    r = await http(`/relatorios/carazinho/${aba}${P}`, tSub);
    check(`${aba}: funcionário SEM a permissão Relatórios NÃO abre, mesmo com todos os outros módulos (403)`, r.s === 403);
    r = await http(`/relatorios/carazinho/${aba}${P}`, tPan);
    check(`${aba}: administrador de OUTRA unidade (403)`, r.s === 403);
    r = await http(`/relatorios/carazinho/${aba}${P}`);
    check(`${aba}: sem login (401)`, r.s === 401);
  }

  console.log('\n== Funcionário com a permissão Relatórios ==');
  await pool.query("update sub_administradores set pode_relatorios = true where email = 'qa-relsub@teste.local'");
  for (const aba of ['agenda', 'financeiro', 'satisfacao']) {
    const r = await http(`/relatorios/carazinho/${aba}${P}`, tSub);
    check(`${aba}: com Relatórios + Financeiro abre (200)`, r.s === 200, JSON.stringify(r.j).slice(0, 120));
  }
  let rs = await http(`/relatorios/carazinho/agenda${P}&escopo=todas`, tSub);
  check('escopo=todas não vale pro funcionário: só a unidade dele', rs.s === 200 && rs.j.escopo === 'unidade' && rs.j.unidades.length === 1, JSON.stringify(rs.j).slice(0, 160));
  rs = await http(`/relatorios/panambi/agenda${P}`, tSub);
  check('funcionário não abre relatório de outra unidade (403)', rs.s === 403);
  await pool.query("update sub_administradores set pode_financeiro = false where email = 'qa-relsub@teste.local'");
  rs = await http(`/relatorios/carazinho/financeiro${P}`, tSub);
  check('sem a permissão Financeiro: relatório Financeiro bloqueado (403)', rs.s === 403);
  for (const aba of ['agenda', 'satisfacao']) {
    rs = await http(`/relatorios/carazinho/${aba}${P}`, tSub);
    check(`sem a permissão Financeiro: ${aba} continua abrindo (200)`, rs.s === 200);
  }
  await pool.query("update sub_administradores set pode_relatorios = false, pode_financeiro = true where email = 'qa-relsub@teste.local'");

  console.log('\n== Período ==');
  let r = await http('/relatorios/carazinho/agenda?mes=2026-13', tAdm);
  check('mês inválido: 400', r.s === 400);
  r = await http('/relatorios/carazinho/agenda?de=2040-03-10&ate=2040-03-01', tAdm);
  check('data inicial depois da final: 400', r.s === 400);
  r = await http('/relatorios/carazinho/agenda?de=2040-03-01', tAdm);
  check('só uma das datas: 400', r.s === 400);
  r = await http('/relatorios/carazinho/agenda?preset=xyz', tAdm);
  check('preset desconhecido: 400', r.s === 400);
  r = await http('/relatorios/carazinho/agenda?de=2020-01-01&ate=2026-12-31', tAdm);
  check('período maior que o limite: 400', r.s === 400);
  r = await http('/relatorios/carazinho/agenda', tAdm);
  check('sem parâmetros vale o mês atual inteiro', r.s === 200 && r.j.periodo.id === 'mes' && r.j.periodo.de === r.j.hoje.slice(0, 7) + '-01', JSON.stringify(r.j.periodo));
  r = await http('/relatorios/carazinho/agenda?preset=12m', tAdm);
  check('12 meses: agrupado por mês', r.s === 200 && r.j.periodo.granularidade === 'mes' && r.j.serie.length === 12, JSON.stringify(r.j.periodo));
  r = await http('/relatorios/carazinho/agenda?de=2040-03-05&ate=2040-03-06', tAdm);
  check('personalizado de 2 dias: só os atendimentos desses dias (L1 e L2)', r.s === 200 && r.j.resumo.total === 2 && r.j.serie.length === 2, JSON.stringify(r.j.resumo));

  console.log('\n== Agenda (março de 2040, Carazinho) ==');
  r = await http(`/relatorios/carazinho/agenda${P}`, tAdm);
  const ag = r.j;
  check('cabeçalho: escopo "unidade", só Carazinho', ag.escopo === 'unidade' && ag.unidades.length === 1 && ag.unidades[0].slug === 'carazinho');
  check('5 agendados: 3 atendimentos (2 concluídos + 1 programado), 1 cancelado e 1 falta', ag.resumo.registrados === 5 && ag.resumo.total === 3 && ag.resumo.concluidos === 2 && ag.resumo.programados === 1 && ag.resumo.cancelados === 1 && ag.resumo.faltas === 1, JSON.stringify(ag.resumo));
  check('4 h realizadas', ag.resumo.horas_realizadas === 4);
  check('faltas: 1 de 3 (concluídos + falta) = 33,3%', ag.resumo.taxa_faltas_pct === 33.3, ag.resumo.taxa_faltas_pct);
  check('o atendimento da OUTRA unidade (Panambi) não entra', !ag.prestadoras.some(p => p.nome === 'qa-RelB'));
  const a = ag.prestadoras.find(p => p.nome === 'qa-RelA');
  check('prestadora com a meta de faltas (10%) vinda da tabela de controle, e acima dela', a && a.meta_pct === 10 && a.acima_meta === true && a.faltas === 1 && a.concluidos === 2, JSON.stringify(a));
  check('série de março tem os 31 dias', ag.serie.length === 31 && ag.serie[0].chave === '2040-03-01');
  check('o mês anterior (fev/2040) está vazio', ag.anterior.total === 0);

  console.log('\n== Financeiro ==');
  r = await http(`/relatorios/carazinho/financeiro${P}`, tAdm);
  const fin = r.j;
  check('receita 500, custo 180 (100 travado + 80 da tarifa), margem 320', fin.realizado.receita === 500 && fin.realizado.custo === 180 && fin.realizado.margem === 320, JSON.stringify(fin.realizado));
  check('ticket médio 250 e receita por hora 125 (500 ÷ 4 h)', fin.realizado.ticket_medio === 250 && fin.realizado.receita_hora === 125, JSON.stringify(fin.realizado));
  check('previsto: o aceito de 20/03 (250)', fin.previsto.qtd === 1 && fin.previsto.receita === 250, JSON.stringify(fin.previsto));
  check('receita perdida: cancelado 150 + falta 100', fin.perdido.cancelados.receita === 150 && fin.perdido.faltas.receita === 100 && fin.perdido.receita === 250, JSON.stringify(fin.perdido));
  check('repasses a pagar: 180, nada pago ainda', fin.repasses.total === 180 && fin.repasses.pago === 0 && fin.repasses.pendente === 180);
  check('evolução de 12 meses termina em março de 2040 com a receita do mês', fin.evolucao.length === 12 && fin.evolucao[11].mes === '2040-03' && fin.evolucao[11].receita === 500 && fin.evolucao[11].margem === 320, JSON.stringify(fin.evolucao[11]));
  check('por serviço e por cliente', fin.por_servico[0].tipo_servico === 'qa-rel' && fin.por_cliente[0].cliente === 'qa-RelCli' && fin.por_cliente[0].pct_receita === 100);

  console.log('\n== Satisfação ==');
  r = await http(`/relatorios/carazinho/satisfacao${P}`, tAdm);
  const sat = r.j;
  check('2 avaliações: 1 aprovada (nota 5) e 1 pendente (a pendente fica fora da média)', sat.resumo.total === 2 && sat.resumo.aprovadas === 1 && sat.resumo.pendentes === 1 && sat.resumo.nota_media === 5, JSON.stringify(sat.resumo));
  check('taxa de resposta: 2 avaliações pra 2 concluídos com cliente = 100%', sat.cobertura.concluidos === 2 && sat.cobertura.taxa_resposta_pct === 100, JSON.stringify(sat.cobertura));
  const sa = sat.por_prestadora.find(p => p.nome === 'qa-RelA');
  check('prestadora: nota 5,00, 1 pendente, 1 falta acima da meta', sa && sa.nota_media === 5 && sa.pendentes === 1 && sa.faltas === 1 && sa.acima_meta === true, JSON.stringify(sa));
  check('a avaliação pendente aparece em "atenção" (nota ≤ 3)', sat.atencao.length === 1 && sat.atencao[0].nota === 3 && sat.atencao[0].status === 'pendente');
  check('tempos de leitura/moderação calculados (a de nota 5 ainda sem moderador = nulo)', typeof sat.resumo.horas_ate_avaliar === 'number' || sat.resumo.horas_ate_avaliar === null);

  console.log('\n== Várias unidades (escopo=todas) ==');
  r = await http(`/relatorios/carazinho/agenda${P}&escopo=todas`, tMulti);
  check('admin das duas unidades soma as duas: 4 atendimentos concluídos+programados… (3 + 1)', r.s === 200 && r.j.escopo === 'todas' && r.j.unidades.length === 2 && r.j.resumo.total === 4 && r.j.resumo.concluidos === 3, JSON.stringify(r.j.resumo));
  check('comparativo por unidade traz as duas', r.j.por_unidade.length === 2 && r.j.por_unidade.map(u => u.total).sort().join() === '1,3', JSON.stringify(r.j.por_unidade));
  r = await http(`/relatorios/carazinho/financeiro${P}&escopo=todas`, tMulti);
  check('financeiro consolidado: receita 1.000 (500 + 500), por unidade 500 e 500', r.s === 200 && r.j.realizado.receita === 1000 && r.j.por_unidade.length === 2 && r.j.por_unidade.every(u => u.receita === 500), JSON.stringify(r.j.por_unidade));
  r = await http(`/relatorios/carazinho/satisfacao${P}&escopo=todas`, tMulti);
  check('satisfação consolidada responde', r.s === 200 && r.j.escopo === 'todas');
  r = await http(`/relatorios/carazinho/agenda${P}&escopo=todas`, tAdm);
  check('escopo=todas com uma unidade só = só ela (sem comparativo)', r.s === 200 && r.j.unidades.length === 1 && r.j.por_unidade.length === 0 && r.j.resumo.total === 3, JSON.stringify(r.j.resumo));
  r = await http(`/relatorios/panambi/agenda${P}&escopo=todas`, tPan);
  check('administrador só de Panambi com escopo=todas NÃO vê Carazinho', r.s === 200 && r.j.unidades.length === 1 && r.j.unidades[0].slug === 'panambi' && r.j.resumo.total === 1, JSON.stringify(r.j.resumo));
  r = await http(`/relatorios/carazinho/agenda${P}&escopo=todas`, tPan);
  check('…e não abre a rota de uma unidade que não é dele nem com escopo=todas (403)', r.s === 403);

  await limpar();
  const { rows: [sobrou] } = await pool.query("select (select count(*) from atendimentos where tipo_servico like 'qa-%') + (select count(*) from administradores where email like 'qa-%') + (select count(*) from prestadoras where nome like 'qa-%') as n");
  check('limpeza: nada de teste sobrou no banco', Number(sobrou.n) === 0);

  console.log(`\n${falhas ? 'COM FALHAS' : 'TUDO CERTO'} — ${ok} ok, ${falhas} falha(s)`);
  await pool.end();
  process.exit(falhas ? 1 : 0);
})().catch(async (e) => { console.error('ERRO NO TESTE:', e); try { await limpar(); } catch { } process.exit(1); });
