// Uso: npm run teste:eventos   (a API precisa estar rodando; API_URL muda o endereço)
//
// Histórico dos atendimentos (tabela atendimento_eventos): confere que CADA ponto onde o status muda grava um evento com
// o status de antes e o de depois, quem fez, a prestadora envolvida e, no cancelamento, quem pediu e o motivo:
// criar (site, avulso, recorrência, planilha), propor, reatribuir, recusar, aceitar, confirmar e concluir sozinho, concluir à mão,
// cancelar (um e a série toda), falta e reabrir. Também confere que o que não muda nada NÃO gera evento e que a conclusão
// automática rodando em paralelo não duplica evento. Dados de teste: "qa-ev-%" (e códigos QA-EV-%), março de 2040 e 2020; apaga no fim.
//   PowerShell:  $env:PORT='3011'; $env:SMTP_USER=''; $env:SMTP_PASS=''; $env:RESEND_API_KEY=''; $env:LIMITE_CADASTRO='1000'; node src/server.js
//   e então:     $env:API_URL='http://localhost:3011'; npm run teste:eventos
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const BASE = (process.env.API_URL || 'http://localhost:3001') + '/api';
const pool = new Pool({ host: process.env.PGHOST, port: process.env.PGPORT, database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD });
let ok = 0, falhas = 0;
const check = (nome, cond, extra = '') => { if (cond) { ok++; console.log('  ok  ', nome); } else { falhas++; console.log('  FALHA', nome, extra); } };

async function http(metodo, rota, corpo, token) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { s: r.status, j: await r.json().catch(() => ({})) };
}
const login = async (perfil, identificador, senha) => (await http('POST', '/auth/login', { perfil, identificador, senha })).j.token;

const eventosDe = async (id) => (await pool.query(
  `select status_anterior, status_novo, acao, prestadora_id, ator_perfil, ator_id, cancelado_por, motivo, quando
   from atendimento_eventos where atendimento_id = $1 order by id`, [id])).rows;
const resumo = (evs) => evs.map(e => `${e.acao}:${e.status_anterior || '∅'}→${e.status_novo}`).join(' | ');
const statusDe = async (id) => (await pool.query('select status::text as s from atendimentos where id = $1', [id])).rows[0]?.s;

const limpar = async () => {
  await pool.query("delete from atendimentos where tipo_servico ilike 'qa-ev-%' or codigo_externo ilike 'QA-EV-%'");
  await pool.query("delete from avisos_prestadora where prestadora_id in (select id from prestadoras where nome ilike 'qa-ev%')");
  await pool.query("delete from administrador_unidades where administrador_id in (select id from administradores where email like 'qa-ev-%')");
  await pool.query("delete from sub_administradores where email like 'qa-ev-%'");
  await pool.query("delete from administradores where email like 'qa-ev-%'");
  await pool.query("delete from prestadoras where nome ilike 'qa-ev%'");
  await pool.query("delete from clientes where nome ilike 'qa-ev%' or email like 'qa-ev-%'");
};

(async () => {
  console.log(`\nAPI em ${BASE}\n`);
  const hash = await bcrypt.hash('senhaqa123', 10);
  const { rows: [car] } = await pool.query("select id from unidades where slug = 'carazinho'");
  await limpar();

  const { rows: [adm] } = await pool.query("insert into administradores (nome, sobrenome, email, senha_hash) values ('qa','Ev','qa-ev-adm@teste.local',$1) returning id", [hash]);
  await pool.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1,$2)', [adm.id, car.id]);
  const { rows: [sub] } = await pool.query(
    "insert into sub_administradores (nome, sobrenome, email, senha_hash, unidade_id, pode_agenda) values ('qa','EvSub','qa-ev-sub@teste.local',$1,$2,true) returning id", [hash, car.id]);
  const { rows: [pa] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id, valor_por_atendimento) values ('qa-ev-A','54999992001','qa-ev-a@teste.local',$1,$2,80) returning id", [hash, car.id]);
  const { rows: [pb] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id) values ('qa-ev-B','54999992002','qa-ev-b@teste.local',$1,$2) returning id", [hash, car.id]);
  const { rows: [cli] } = await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-ev-Cli','qa-ev-cli@teste.local',$1,$2) returning id", [hash, car.id]);

  const tAdm = await login('administrador', 'qa-ev-adm@teste.local', 'senhaqa123');
  const tSub = await login('administrador', 'qa-ev-sub@teste.local', 'senhaqa123');
  const tA = await login('prestadora', 'qa-ev-a@teste.local', 'senhaqa123');
  const tB = await login('prestadora', 'qa-ev-b@teste.local', 'senhaqa123');
  check('logins de teste (administrador, funcionário e 2 prestadoras)', tAdm && tSub && tA && tB);
  const A = (rota) => `/atendimentos/admin/carazinho${rota}`;
  const amanha = (await pool.query("select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text as d")).rows[0].d;
  const ins = async (status, dia, hora, prest, extra = {}) => (await pool.query(
    `insert into atendimentos (unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, hora_atendimento, duracao_horas, status, origem)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'manual') returning id`,
    [car.id, cli.id, prest, extra.servico || 'qa-ev-direto', dia, hora, extra.duracao ?? 2, status])).rows[0].id;

  // ---------------------------------------------------------------- criar
  console.log('== Criar ==');
  let r = await http('POST', '/atendimentos', { unidade_slug: 'carazinho', tipo_servico: 'qa-ev-site', data_atendimento: '2040-03-04', cliente_nome: 'qa-ev-Site', origem: 'site' });
  let evs = await eventosDe(r.j.id);
  check('pedido do site: 1 evento "criado" (∅ → pedido) feito pelo público', r.s === 201 && evs.length === 1 && evs[0].acao === 'criado' && evs[0].status_anterior === null && evs[0].status_novo === 'pedido' && evs[0].ator_perfil === 'publico' && evs[0].ator_id === null, resumo(evs));

  r = await http('POST', A(''), { tipo_servico: 'qa-ev-avulso', data_atendimento: '2040-03-05', hora_atendimento: '10:00', duracao_horas: 2 }, tAdm);
  const avulso = r.j.id; evs = await eventosDe(avulso);
  check('cadastro avulso sem prestadora: "criado" → pedido, feito pelo administrador (com o id dele)', r.s === 201 && evs.length === 1 && evs[0].status_novo === 'pedido' && evs[0].ator_perfil === 'administrador' && evs[0].ator_id === adm.id, resumo(evs));

  r = await http('POST', A(''), { tipo_servico: 'qa-ev-avulso', data_atendimento: '2040-03-05', hora_atendimento: '14:00', duracao_horas: 2, prestadora_id: pa.id }, tAdm);
  const convidado = r.j.id; evs = await eventosDe(convidado);
  check('cadastro avulso COM prestadora: nasce como convite — "criado" → proposto, ligado à prestadora', r.s === 201 && evs.length === 1 && evs[0].status_novo === 'proposto' && evs[0].prestadora_id === pa.id, resumo(evs));

  const antesConflito = Number((await pool.query("select count(*) from atendimento_eventos e join atendimentos a on a.id = e.atendimento_id where a.tipo_servico = 'qa-ev-avulso'")).rows[0].count);
  r = await http('POST', A(''), { tipo_servico: 'qa-ev-avulso', data_atendimento: '2040-03-05', hora_atendimento: '15:00', duracao_horas: 2, prestadora_id: pa.id }, tAdm);
  const depoisConflito = Number((await pool.query("select count(*) from atendimento_eventos e join atendimentos a on a.id = e.atendimento_id where a.tipo_servico = 'qa-ev-avulso'")).rows[0].count);
  check('conflito de horário (409) desfaz tudo, inclusive o evento', r.s === 409 && depoisConflito === antesConflito, `${antesConflito} → ${depoisConflito}`);

  r = await http('POST', A('/recorrente'), { data_inicio: '2040-03-12', horizonte_meses: 1, itens: [{ dia_semana: 1, hora_atendimento: '08:00', tipo_servico: 'qa-ev-serie' }] }, tAdm);
  const serieId = r.j.serie_id; const idsSerie = (r.j.atendimentos || []).map(a => a.id);
  const { rows: [contSerie] } = await pool.query("select count(*)::int as n, count(distinct atendimento_id)::int as d from atendimento_eventos where atendimento_id = any($1::uuid[]) and acao = 'criado' and status_novo = 'pedido'", [idsSerie]);
  check(`série semanal: ${idsSerie.length} atendimentos, cada um com o seu evento "criado"`, r.s === 201 && idsSerie.length >= 4 && contSerie.n === idsSerie.length && contSerie.d === idsSerie.length, JSON.stringify(contSerie));

  // planilha (importação)
  const escreve = require('write-excel-file/node').default;
  const cab = ['Orçamento', 'Número', 'Data', 'Horário', 'Período', 'Serviço', 'Tipo', 'Horas', 'Cliente', 'Profissionais', 'Repasse (R$)', 'Situação', 'Recorrente', 'Local de Atendimento', 'Valor (R$)', 'Margem de Contribuição (R$)'];
  const arq = (await escreve([cab,
    ['1', 'QA-EV-1', '13/03/2040', '08:00:00', 'Manhã', 'Limpeza', 'Residencial', 2, 'qa-ev-ImpCli', 'qa-ev-Imp', '', 'Previsto', 'Não', '', '100', ''],
    ['1', 'QA-EV-2', '14/03/2040', '09:00:00', 'Manhã', 'Limpeza', 'Residencial', 2, 'qa-ev-ImpCli', 'qa-ev-Imp', '', 'Concluído', 'Não', '', '100', ''],
    ['1', 'QA-EV-3', '15/03/2040', '10:00:00', 'Manhã', 'Limpeza', 'Residencial', 2, 'qa-ev-ImpCli', '', '', 'Previsto', 'Não', '', '100', ''],
  ]).toBuffer()).toString('base64');
  r = await http('POST', A('/importar'), { arquivo_base64: arq, confirmar: true }, tAdm);
  const { rows: imp } = await pool.query("select a.id, a.status::text as s, a.prestadora_id from atendimentos a where codigo_externo like 'QA-EV-%' order by codigo_externo");
  const evImp = await Promise.all(imp.map(a => eventosDe(a.id)));
  check('planilha: 3 linhas importadas, cada uma com 1 evento "importado" no status que a planilha trazia (proposto, concluído, pedido)',
    r.s === 200 && r.j.importados === 3 && evImp.every(e => e.length === 1 && e[0].acao === 'importado' && e[0].status_anterior === null && e[0].ator_perfil === 'administrador')
      && evImp.map(e => e[0].status_novo).join() === 'proposto,concluido,pedido', evImp.map(resumo).join(' || '));
  check('o evento da linha importada com prestadora leva a prestadora', evImp[0][0].prestadora_id === imp[0].prestadora_id && imp[0].prestadora_id !== null);
  r = await http('POST', A('/importar'), { arquivo_base64: arq, confirmar: true }, tAdm);
  const { rows: [totImp] } = await pool.query("select count(*)::int as n from atendimento_eventos e join atendimentos a on a.id = e.atendimento_id where a.codigo_externo like 'QA-EV-%'");
  check('reimportar o mesmo arquivo não cria evento nenhum (nada foi inserido)', r.j.importados === 0 && totImp.n === 3, JSON.stringify(totImp));

  // ---------------------------------------------------------------- convite: propor, reatribuir, recusar, aceitar
  console.log('\n== Convite: propor → reatribuir → recusar → reatribuir → aceitar ==');
  r = await http('POST', A(''), { tipo_servico: 'qa-ev-fluxo', data_atendimento: '2040-03-06', hora_atendimento: '11:00', duracao_horas: 2 }, tAdm);
  const X = r.j.id;
  r = await http('POST', A(`/${X}/propor`), { prestadora_id: pa.id }, tAdm);
  evs = await eventosDe(X);
  check('propor: evento "proposto" (pedido → proposto) com a prestadora convidada', r.s === 200 && evs.length === 2 && evs[1].acao === 'proposto' && evs[1].status_anterior === 'pedido' && evs[1].status_novo === 'proposto' && evs[1].prestadora_id === pa.id && evs[1].ator_perfil === 'administrador', resumo(evs));

  r = await http('POST', A(`/${X}/reatribuir`), { prestadora_id: pb.id }, tAdm);
  evs = await eventosDe(X);
  check('reatribuir o convite pra outra: evento "reatribuido" (proposto → proposto) com a NOVA prestadora', r.s === 200 && evs.length === 3 && evs[2].acao === 'reatribuido' && evs[2].status_anterior === 'proposto' && evs[2].status_novo === 'proposto' && evs[2].prestadora_id === pb.id, resumo(evs));
  r = await http('POST', A(`/${X}/reatribuir`), { prestadora_id: pb.id }, tAdm);
  check('reatribuir pra mesma prestadora (nada muda): nenhum evento novo', r.s === 200 && (await eventosDe(X)).length === 3);

  r = await http('POST', `/atendimentos/prestadora/me/${X}/recusar`, null, tB);
  evs = await eventosDe(X);
  check('prestadora recusa: evento "recusado" (proposto → recusado) feito por ela, com o id dela', r.s === 200 && evs.length === 4 && evs[3].acao === 'recusado' && evs[3].status_novo === 'recusado' && evs[3].prestadora_id === pb.id && evs[3].ator_perfil === 'prestadora' && evs[3].ator_id === pb.id, resumo(evs));
  r = await http('POST', `/atendimentos/prestadora/me/${X}/recusar`, null, tB);
  check('recusar de novo (já não é convite dela): 404 e nenhum evento', r.s === 404 && (await eventosDe(X)).length === 4);

  r = await http('POST', A(`/${X}/reatribuir`), { prestadora_id: pa.id }, tAdm);
  evs = await eventosDe(X);
  check('reconvidar depois da recusa: evento "proposto" (recusado → proposto)', r.s === 200 && evs.length === 5 && evs[4].acao === 'proposto' && evs[4].status_anterior === 'recusado' && evs[4].status_novo === 'proposto' && evs[4].prestadora_id === pa.id, resumo(evs));

  r = await http('POST', `/atendimentos/prestadora/me/${X}/aceitar`, null, tA);
  check('aceitar com a data a mais de 2 dias (400): nenhum evento', r.s === 400 && (await eventosDe(X)).length === 5);
  await pool.query('update atendimentos set data_atendimento = $2, hora_atendimento = $3 where id = $1', [X, amanha, '04:00']);
  r = await http('POST', `/atendimentos/prestadora/me/${X}/aceitar`, null, tA);
  evs = await eventosDe(X);
  check('prestadora aceita: evento "aceito" (proposto → aceito) feito por ela', r.s === 200 && evs.length === 6 && evs[5].acao === 'aceito' && evs[5].status_anterior === 'proposto' && evs[5].status_novo === 'aceito' && evs[5].prestadora_id === pa.id && evs[5].ator_perfil === 'prestadora' && evs[5].ator_id === pa.id, resumo(evs));
  check('a ordem dos eventos é a do que aconteceu (ids crescentes, horários não regridem)', evs.every((e, i) => i === 0 || e.quando >= evs[i - 1].quando));

  // ---------------------------------------------------------------- cancelar e reabrir
  console.log('\n== Cancelar e reabrir ==');
  r = await http('POST', A(`/${X}/situacao`), { situacao: 'cancelado', cancelado_por: 'ninguem' }, tAdm);
  check('quem cancelou inválido: 400, nada muda', r.s === 400 && (await statusDe(X)) === 'aceito' && (await eventosDe(X)).length === 6);
  r = await http('POST', A(`/${X}/situacao`), { situacao: 'cancelado', motivo: 'x'.repeat(301) }, tAdm);
  check('motivo com mais de 300 caracteres: 400, nada muda', r.s === 400 && (await statusDe(X)) === 'aceito' && (await eventosDe(X)).length === 6);
  r = await http('POST', A(`/${X}/situacao`), { situacao: 'cancelado', cancelado_por: 'cliente', motivo: '  Viagem inesperada  ' }, tAdm);
  evs = await eventosDe(X);
  check('cancelar com quem pediu e motivo: evento "cancelado" (aceito → cancelado), cliente, motivo sem espaços sobrando, prestadora que estava no atendimento',
    r.s === 200 && evs.length === 7 && evs[6].acao === 'cancelado' && evs[6].status_anterior === 'aceito' && evs[6].cancelado_por === 'cliente' && evs[6].motivo === 'Viagem inesperada' && evs[6].prestadora_id === pa.id && evs[6].ator_perfil === 'administrador', resumo(evs) + ' ' + JSON.stringify(evs[6]));
  r = await http('POST', A(`/${X}/situacao`), { situacao: 'cancelado', cancelado_por: 'franquia', motivo: 'outro motivo' }, tAdm);
  check('cancelar o que já está cancelado: nenhum evento novo (e o motivo original fica)', r.s === 200 && (await eventosDe(X)).length === 7);
  r = await http('POST', A(`/${X}/situacao`), { situacao: 'programado' }, tAdm);
  evs = await eventosDe(X);
  check('reativar como programado: evento "reaberto" (cancelado → aceito), sem quem/motivo de cancelamento', r.s === 200 && evs.length === 8 && evs[7].acao === 'reaberto' && evs[7].status_anterior === 'cancelado' && evs[7].status_novo === 'aceito' && evs[7].cancelado_por === null && evs[7].motivo === null, resumo(evs));
  r = await http('POST', A(`/${X}/situacao`), { situacao: 'cancelado' }, tSub);
  evs = await eventosDe(X);
  check('cancelar sem informar nada (os dois são opcionais), feito por funcionário: perfil "sub_administrador" e quem/motivo vazios',
    r.s === 200 && evs.length === 9 && evs[8].acao === 'cancelado' && evs[8].ator_perfil === 'sub_administrador' && evs[8].ator_id === sub.id && evs[8].cancelado_por === null && evs[8].motivo === null, JSON.stringify(evs[8]));

  // programado em convite com prestadora: o administrador "dá como combinado" — é aceito, mas NÃO pela prestadora
  const conv = await ins('proposto', '2040-03-07', '09:00', pa.id);
  r = await http('POST', A(`/${conv}/situacao`), { situacao: 'programado' }, tAdm);
  evs = await eventosDe(conv);
  check('administrador dá o convite como combinado: evento "aceito" com ator administrador (não conta como resposta da prestadora)', r.s === 200 && evs.length === 1 && evs[0].acao === 'aceito' && evs[0].status_anterior === 'proposto' && evs[0].ator_perfil === 'administrador', resumo(evs));

  // ---------------------------------------------------------------- série: cancelar tudo
  console.log('\n== Cancelar a série ==');
  r = await http('POST', A(`/serie/${serieId}/cancelar`), { cancelado_por: 'ninguem' }, tAdm);
  check('série: quem cancelou inválido → 400 e nada cancelado', r.s === 400 && (await pool.query("select count(*)::int as n from atendimentos where serie_id = $1 and status = 'cancelado'", [serieId])).rows[0].n === 0);
  r = await http('POST', A(`/serie/${serieId}/cancelar`), { cancelado_por: 'franquia', motivo: 'Contrato encerrado' }, tAdm);
  const { rows: cs } = await pool.query("select count(*)::int as n, count(distinct atendimento_id)::int as d from atendimento_eventos where atendimento_id = any($1::uuid[]) and acao = 'cancelado' and cancelado_por = 'franquia' and motivo = 'Contrato encerrado' and status_anterior = 'pedido'", [idsSerie]);
  check(`série: ${idsSerie.length} cancelados, cada um com o seu evento (franquia, mesmo motivo)`, r.s === 200 && r.j.cancelados === idsSerie.length && cs[0].n === idsSerie.length && cs[0].d === idsSerie.length, JSON.stringify(cs[0]));
  r = await http('POST', A(`/serie/${serieId}/cancelar`), {}, tAdm);
  const { rows: [cs2] } = await pool.query("select count(*)::int as n from atendimento_eventos where atendimento_id = any($1::uuid[]) and acao = 'cancelado'", [idsSerie]);
  check('cancelar a série de novo: nada a cancelar, nenhum evento a mais', r.s === 200 && r.j.cancelados === 0 && cs2.n === idsSerie.length, JSON.stringify(cs2));

  // ---------------------------------------------------------------- conclusão (sistema e administrador) e falta
  console.log('\n== Concluir sozinho, concluir à mão e falta ==');
  const passado = await ins('aceito', '2020-02-03', '09:00', pa.id);
  r = await http('POST', A(`/${passado}/situacao`), { situacao: 'falta' }, tAdm);
  evs = await eventosDe(passado);
  check('marcar falta num aceito que já terminou: o sistema conclui primeiro ("concluido_auto") e a falta vem depois (concluído → falta)',
    r.s === 200 && evs.length === 2 && evs[0].acao === 'concluido_auto' && evs[0].status_anterior === 'aceito' && evs[0].ator_perfil === 'sistema' && evs[0].ator_id === null
      && evs[1].acao === 'falta' && evs[1].status_anterior === 'concluido' && evs[1].status_novo === 'falta' && evs[1].ator_perfil === 'administrador' && evs[1].prestadora_id === pa.id, resumo(evs));
  r = await http('POST', A(`/${passado}/situacao`), { situacao: 'falta' }, tAdm);
  check('marcar falta de novo: nenhum evento novo', r.s === 200 && (await eventosDe(passado)).length === 2);
  r = await http('POST', A(`/${passado}/situacao`), { situacao: 'concluido' }, tAdm);
  evs = await eventosDe(passado);
  check('desfazer a falta (voltar a concluído): evento "reaberto" (falta → concluído)', r.s === 200 && evs.length === 3 && evs[2].acao === 'reaberto' && evs[2].status_anterior === 'falta' && evs[2].status_novo === 'concluido', resumo(evs));

  const manual = await ins('aceito', '2020-02-04', '09:00', pa.id);
  r = await http('POST', A(`/${manual}/concluir`), null, tAdm);
  evs = await eventosDe(manual);
  check('concluir à mão (aceito que já terminou): evento "concluido" feito pelo administrador', r.s === 200 && evs.length === 1 && evs[0].acao === 'concluido' && evs[0].status_anterior === 'aceito' && evs[0].ator_perfil === 'administrador', resumo(evs));

  const semResposta = await ins('proposto', '2020-02-05', '09:00', pa.id);
  r = await http('GET', '/atendimentos/prestadora/me/convites', null, tA);
  evs = await eventosDe(semResposta);
  check('convite que ninguém respondeu e já passou: o sistema conclui (proposto → concluído, "concluido_auto")', r.s === 200 && evs.length === 1 && evs[0].acao === 'concluido_auto' && evs[0].status_anterior === 'proposto' && evs[0].status_novo === 'concluido' && evs[0].ator_perfil === 'sistema', resumo(evs));

  // convite cujo horário começou e ainda não terminou: o sistema confirma. A data e a hora vêm do mesmo instante (30 min atrás), sem erro na virada do dia
  const { rows: [agora] } = await pool.query("select to_char((now() at time zone 'America/Sao_Paulo') - interval '30 minutes', 'YYYY-MM-DD HH24:MI:SS') as t");
  const emAndamento = (await pool.query(
    `insert into atendimentos (unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, hora_atendimento, duracao_horas, status, origem)
     values ($1,$2,$3,'qa-ev-andamento', ($4::timestamp)::date, ($4::timestamp)::time, 3, 'proposto', 'manual') returning id`, [car.id, cli.id, pb.id, agora.t])).rows[0].id;
  await Promise.all([1, 2, 3, 4, 5].map(() => http('GET', '/atendimentos/prestadora/me/convites', null, tB)));
  evs = await eventosDe(emAndamento);
  check('convite que já começou: confirmado pelo sistema (proposto → aceito, "confirmado_auto"); 5 telas abrindo ao mesmo tempo gravam UM evento só',
    evs.length === 1 && evs[0].acao === 'confirmado_auto' && evs[0].status_anterior === 'proposto' && evs[0].status_novo === 'aceito' && evs[0].ator_perfil === 'sistema' && evs[0].prestadora_id === pb.id, resumo(evs));

  // ---------------------------------------------------------------- o que os relatórios mostram a partir do histórico
  console.log('\n== Relatórios (junho de 2040) ==');
  const novo = async (dia, hora, extra = {}) => (await http('POST', A(''), { tipo_servico: 'qa-ev-rel', data_atendimento: dia, hora_atendimento: hora, duracao_horas: 2, ...extra }, tAdm)).j.id;
  const R1 = await novo('2040-06-05', '10:00', { prestadora_id: pa.id });          // convite à A, que recusa
  await http('POST', `/atendimentos/prestadora/me/${R1}/recusar`, null, tA);
  const R2 = await novo('2040-06-05', '14:00', { prestadora_id: pb.id });          // convite à B, passado pra A (B: trocado; A: em aberto)
  await http('POST', A(`/${R2}/reatribuir`), { prestadora_id: pa.id }, tAdm);
  const R3 = await novo('2040-06-06', '10:00', { valor: 150 });
  const R4 = await novo('2040-06-06', '14:00', { valor: 100 });
  const R5 = await novo('2040-06-07', '10:00', { valor: 80 });
  await http('POST', A(`/${R3}/situacao`), { situacao: 'cancelado', cancelado_por: 'cliente', motivo: 'Viagem' }, tAdm);
  await http('POST', A(`/${R4}/situacao`), { situacao: 'cancelado', cancelado_por: 'franquia', motivo: 'viagem.' }, tAdm);
  await http('POST', A(`/${R5}/situacao`), { situacao: 'cancelado' }, tSub);

  r = await http('GET', '/relatorios/carazinho/agenda?de=2040-06-01&ate=2040-06-30', null, tAdm);
  const ag = r.j;
  check('Agenda abre com os blocos novos (resposta_convites, cancelamentos, funil_real, historico)', r.s === 200 && ag.resposta_convites && ag.cancelamentos && ag.funil_real && ag.historico, JSON.stringify(Object.keys(ag)).slice(0, 200));
  const rcA = ag.resposta_convites.por_prestadora.find(p => p.prestadora_id === pa.id), rcB = ag.resposta_convites.por_prestadora.find(p => p.prestadora_id === pb.id);
  check('tempo de resposta: A recebeu 2 convites (recusou 1 em poucos segundos, o outro segue em aberto)', rcA && rcA.convites === 2 && rcA.recusados === 1 && rcA.em_aberto === 1 && rcA.tempo_medio_h >= 0 && rcA.tempo_medio_h < 1, JSON.stringify(rcA));
  check('tempo de resposta: B recebeu 1 convite que foi passado pra outra antes de ela responder', rcB && rcB.convites === 1 && rcB.trocados === 1 && rcB.respondidos === 0 && rcB.tempo_medio_h === null, JSON.stringify(rcB));
  const pA = ag.prestadoras.find(p => p.prestadora_id === pa.id);
  check('a tabela de prestadoras traz a resposta média dela', pA && pA.respondidos === 1 && typeof pA.resposta_media_h === 'number', JSON.stringify(pA));
  const cq = Object.fromEntries(ag.cancelamentos.por_quem.map(x => [x.quem, x.qtd]));
  check('cancelamentos: 3 (cliente 1, franquia 1, não informado 1), todos com registro', ag.cancelamentos.total === 3 && cq.cliente === 1 && cq.franquia === 1 && cq.nao_informado === 1 && ag.cancelamentos.sem_registro === 0, JSON.stringify(ag.cancelamentos.por_quem));
  check('motivos: "Viagem" e "viagem." juntos (2) e 1 sem motivo', ag.cancelamentos.motivos.map(m => `${m.motivo}:${m.qtd}`).join() === 'Viagem:2,null:1', JSON.stringify(ag.cancelamentos.motivos));
  check('antecedência: cancelados 14 anos antes, nenhum com menos de 24 h', ag.cancelamentos.antecedencia.avaliados === 3 && ag.cancelamentos.antecedencia.menos_24h === 0 && ag.cancelamentos.antecedencia.mediana_h > 24 * 365, JSON.stringify(ag.cancelamentos.antecedencia));
  const fr = ag.funil_real, et = Object.fromEntries(fr.etapas.map(e => [e.etapa, e.qtd]));
  check('funil real: 5 pedidos → 2 convidados → 0 confirmados; 1 recusa e 3 cancelamentos', fr.base === 5 && et.proposto === 2 && et.aceito === 0 && et.concluido === 0 && fr.desfechos.recusados === 1 && fr.desfechos.cancelados === 3, JSON.stringify(fr));
  check('todos os atendimentos do período têm histórico e o relatório diz desde quando ele existe', ag.historico.sem_historico === 0 && !!ag.historico.desde, JSON.stringify(ag.historico));

  r = await http('GET', '/relatorios/carazinho/financeiro?de=2040-06-01&ate=2040-06-30', null, tAdm);
  const pcanc = r.j.perdido?.cancelados;
  check('Financeiro: receita perdida com cancelamentos = 150 + 100 + 80 = 330', r.s === 200 && pcanc.qtd === 3 && pcanc.receita === 330, JSON.stringify(pcanc));
  check('Financeiro: por quem cancelou — cliente 150, franquia 100, não informado 80', pcanc.por_quem.map(x => `${x.quem}:${x.receita}`).join() === 'cliente:150,franquia:100,nao_informado:80', JSON.stringify(pcanc.por_quem));
  check('Financeiro: por motivo — Viagem 250 (2) e sem motivo 80 (1)', pcanc.por_motivo.map(x => `${x.motivo}:${x.qtd}:${x.receita}`).join() === 'Viagem:2:250,null:1:80', JSON.stringify(pcanc.por_motivo));

  // ---------------------------------------------------------------- integridade
  console.log('\n== Integridade ==');
  const { rows: [semEvento] } = await pool.query(
    `select count(*)::int as n from atendimentos a
     where (a.tipo_servico ilike 'qa-ev-%' and a.tipo_servico <> 'qa-ev-direto' or a.codigo_externo ilike 'QA-EV-%')
       and not exists (select 1 from atendimento_eventos e where e.atendimento_id = a.id)`);
  check('todo atendimento criado pela API tem ao menos o evento de criação', semEvento.n === 0, JSON.stringify(semEvento));
  const { rows: [incoerentes] } = await pool.query(
    `select count(*)::int as n from (
       select e.atendimento_id, e.status_anterior, lag(e.status_novo) over (partition by e.atendimento_id order by e.id) as anterior_gravado
       from atendimento_eventos e join atendimentos a on a.id = e.atendimento_id where a.tipo_servico ilike 'qa-ev-%' or a.codigo_externo ilike 'QA-EV-%') t
     where anterior_gravado is not null and status_anterior is distinct from anterior_gravado`);
  check('a cadeia de eventos de cada atendimento é coerente (o "status de antes" de um é o "status de depois" do anterior)', incoerentes.n === 0, JSON.stringify(incoerentes));
  const { rows: [atual] } = await pool.query(
    `select count(*)::int as n from atendimentos a
     where a.tipo_servico in ('qa-ev-fluxo', 'qa-ev-serie', 'qa-ev-site', 'qa-ev-avulso') and exists (select 1 from atendimento_eventos e where e.atendimento_id = a.id)
       and a.status::text <> (select e.status_novo::text from atendimento_eventos e where e.atendimento_id = a.id order by e.id desc limit 1)`);
  check('o último evento de cada atendimento sempre bate com o status atual dele', atual.n === 0, JSON.stringify(atual));
  const antesDel = (await pool.query('select count(*)::int as n from atendimento_eventos where atendimento_id = $1', [X])).rows[0].n;
  await pool.query('delete from atendimentos where id = $1', [X]);
  const depoisDel = (await pool.query('select count(*)::int as n from atendimento_eventos where atendimento_id = $1', [X])).rows[0].n;
  check('apagar o atendimento apaga o histórico dele junto (sem sobra)', antesDel > 0 && depoisDel === 0);

  await limpar();
  const { rows: [sobrou] } = await pool.query("select (select count(*) from atendimentos where tipo_servico ilike 'qa-ev-%' or codigo_externo ilike 'QA-EV-%') + (select count(*) from prestadoras where nome ilike 'qa-ev%') + (select count(*) from clientes where nome ilike 'qa-ev%') + (select count(*) from administradores where email like 'qa-ev-%') as n");
  check('limpeza: nada de teste sobrou no banco', Number(sobrou.n) === 0, JSON.stringify(sobrou));

  console.log(`\n${falhas ? 'COM FALHAS' : 'TUDO CERTO'} — ${ok} ok, ${falhas} falha(s)`);
  await pool.end();
  process.exit(falhas ? 1 : 0);
})().catch(async (e) => { console.error('ERRO NO TESTE:', e); try { await limpar(); } catch { } process.exit(1); });
