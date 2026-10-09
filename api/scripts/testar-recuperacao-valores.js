// Uso: npm run teste:recuperacao   (a API precisa estar rodando; API_URL muda o endereço)
//
// Cobre: recuperação de senha (todos os perfis, abuso/limites), valor por atendimento
// da prestadora (travado no aceite, resumo, permissões), local do atendimento e sync.
// Cria e apaga dados "qa-%" direto no banco.
//
// ATENÇÃO: os pedidos de recuperação disparam e-mail de verdade se a API tiver SMTP/
// Resend configurado (pra endereços @teste.local, que só gerariam rejeição). Rode contra
// uma API de teste sem provedor de e-mail, ex.:
//   PowerShell:  $env:PORT='3002'; $env:SMTP_USER=''; $env:SMTP_PASS=''; $env:RESEND_API_KEY=''; node src/server.js
//   e então:     $env:API_URL='http://localhost:3002'; npm run teste:recuperacao
// Os limites de tentativas ficam na memória da API: reinicie a API de teste entre duas
// execuções seguidas (senão os testes de limite pegam o contador da rodada anterior).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const BASE = (process.env.API_URL || 'http://localhost:3001') + '/api';
const pool = new Pool({ host: process.env.PGHOST, port: process.env.PGPORT, database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD });
let ok = 0, falhas = 0;
const check = (nome, cond, extra = '') => { if (cond) { ok++; console.log('  ok  ', nome); } else { falhas++; console.log('  FALHA', nome, extra); } };
const http = async (metodo, rota, corpo, token) => {
  const r = await fetch(BASE + rota, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { }
  return { s: r.status, j };
};
const ultimoCodigo = async (destino) => (await pool.query('select codigo from codigos_verificacao where destino = $1 and usado = false order by criado_em desc limit 1', [destino])).rows[0]?.codigo;

(async () => {
  const hash = await bcrypt.hash('senhaantiga1', 10);
  const { rows: [carazinho] } = await pool.query("select id from unidades where slug = 'carazinho'");
  const { rows: [panambi] } = await pool.query("select id from unidades where slug = 'panambi'");

  // limpeza prévia
  await pool.query("delete from atendimentos where tipo_servico like 'qa-%'");
  await pool.query("delete from administrador_unidades where administrador_id in (select id from administradores where email like 'qa-%')");
  await pool.query("delete from sub_administradores where email like 'qa-%'"); // antes: a FK criado_por aponta pros administradores
  await pool.query("delete from administradores where email like 'qa-%'");
  await pool.query("delete from prestadoras where nome like 'qa-%'");
  await pool.query("delete from clientes where email like 'qa-%'");
  await pool.query("delete from codigos_verificacao where destino like '%qa-%'");

  const { rows: [adm] } = await pool.query("insert into administradores (nome, sobrenome, email, senha_hash) values ('qa','Admin','qa-adm@teste.local',$1) returning id", [hash]);
  await pool.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1,$2)', [adm.id, carazinho.id]);
  const { rows: [admPan] } = await pool.query("insert into administradores (nome, sobrenome, email, senha_hash) values ('qa','AdminPan','qa-admpan@teste.local',$1) returning id", [hash]);
  await pool.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1,$2)', [admPan.id, panambi.id]);
  await pool.query("insert into sub_administradores (nome, sobrenome, email, senha_hash, unidade_id, pode_agenda, pode_equipe) values ('qa','Sub','qa-sub@teste.local',$1,$2,true,true)", [hash, carazinho.id]);
  const { rows: [prest] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id) values ('qa-Prest','54999990001','qa-prest@teste.local',$1,$2) returning id", [hash, carazinho.id]);
  await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id) values ('qa-Prest2','54999990002','qa-prest@teste.local',$1,$2)", [hash, carazinho.id]); // mesmo e-mail
  await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id) values ('qa-SemEmail','54999990003',null,$1,$2)", [hash, carazinho.id]);
  await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-Cli','qa-cli@teste.local',$1,$2)", [hash, carazinho.id]);
  await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-CliSemSenha','qa-semsenha@teste.local',null,$1)", [carazinho.id]);

  const login = async (perfil, identificador, senha) => http('POST', '/auth/login', { perfil, identificador, senha });

  console.log('\n== Recuperação de senha ==');
  let r = await http('POST', '/auth/recuperar-senha', { perfil: 'cliente', identificador: 'qa-cli@teste.local' });
  const msgReal = r.j.mensagem;
  check('pedido p/ conta existente: 200', r.s === 200 && r.j.ok === true);
  r = await http('POST', '/auth/recuperar-senha', { perfil: 'cliente', identificador: 'qa-naoexiste@teste.local' });
  check('conta inexistente responde IGUAL (sem enumeração)', r.s === 200 && r.j.mensagem === msgReal);
  check('inexistente não gerou código', !(await ultimoCodigo('recuperar:cliente:qa-naoexiste@teste.local')));
  r = await http('POST', '/auth/recuperar-senha', { perfil: 'cliente', identificador: 'qa-semsenha@teste.local' });
  check('cliente sem senha (avulso) não recebe código', r.s === 200 && !(await ultimoCodigo('recuperar:cliente:qa-semsenha@teste.local')));
  r = await http('POST', '/auth/recuperar-senha', { perfil: 'hacker', identificador: 'x' });
  check('perfil inválido: 400', r.s === 400);
  r = await http('POST', '/auth/recuperar-senha', { perfil: 'cliente', identificador: '  ' });
  check('identificador vazio: 400', r.s === 400);

  let cod = await ultimoCodigo('recuperar:cliente:qa-cli@teste.local');
  check('código de 6 dígitos gravado sob chave própria', /^\d{6}$/.test(cod || ''));
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: 'qa-cli@teste.local', codigo: '000000', senha: 'novasenha1' });
  check('código errado: 400', r.s === 400 && /inválido/.test(r.j.erro));
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: 'qa-cli@teste.local', codigo: cod, senha: 'curta' });
  check('senha curta: 400 (e não gasta o código)', r.s === 400);
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: 'qa-inexistente@teste.local', codigo: cod, senha: 'novasenha1' });
  check('conta inexistente = "Código inválido" (igual)', r.s === 400 && /inválido/.test(r.j.erro));
  // código de CADASTRO (chave = e-mail puro) não serve
  await pool.query("insert into codigos_verificacao (destino, codigo, expira_em) values ('qa-cli@teste.local','123456', now() + interval '15 minutes')");
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: 'qa-cli@teste.local', codigo: '123456', senha: 'novasenha1' });
  check('código de cadastro NÃO redefine senha', r.s === 400);
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: 'qa-cli@teste.local', codigo: cod, senha: 'novasenha1' });
  check('código certo + senha boa: 200', r.s === 200 && r.j.ok);
  check('login com a senha nova funciona', (await login('cliente', 'qa-cli@teste.local', 'novasenha1')).s === 200);
  check('senha antiga não funciona mais', (await login('cliente', 'qa-cli@teste.local', 'senhaantiga1')).s === 401);
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: 'qa-cli@teste.local', codigo: cod, senha: 'outrasenha1' });
  check('código não pode ser reutilizado', r.s === 400);

  // administrador (franqueado) e funcionário
  await http('POST', '/auth/recuperar-senha', { perfil: 'administrador', identificador: 'qa-adm@teste.local' });
  cod = await ultimoCodigo('recuperar:administrador:qa-adm@teste.local');
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'administrador', identificador: 'qa-adm@teste.local', codigo: cod, senha: 'admnova123' });
  check('administrador redefine', r.s === 200 && (await login('administrador', 'qa-adm@teste.local', 'admnova123')).s === 200);
  await http('POST', '/auth/recuperar-senha', { perfil: 'administrador', identificador: 'qa-sub@teste.local' });
  cod = await ultimoCodigo('recuperar:administrador:qa-sub@teste.local');
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'administrador', identificador: 'qa-sub@teste.local', codigo: cod, senha: 'subnova123' });
  check('funcionário (sub-admin) redefine', r.s === 200 && (await login('administrador', 'qa-sub@teste.local', 'subnova123')).s === 200);
  await http('POST', '/auth/recuperar-senha', { perfil: 'cliente', identificador: 'qa-adm@teste.local' });
  check('perfil errado não acha a conta (admin não é cliente)', !(await ultimoCodigo('recuperar:cliente:qa-adm@teste.local')));

  // prestadora por telefone (formatado) e por e-mail (compartilhado)
  await http('POST', '/auth/recuperar-senha', { perfil: 'prestadora', identificador: '(54) 9 9999-0001' });
  cod = await ultimoCodigo('recuperar:prestadora:qa-prest@teste.local');
  check('prestadora por telefone formatado gera código p/ o e-mail dela', !!cod);
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'prestadora', identificador: '(54) 9 9999-0001', codigo: cod, senha: 'prestnova1' });
  check('prestadora redefine', r.s === 200 && (await login('prestadora', '54999990001', 'prestnova1')).s === 200);
  await http('POST', '/auth/recuperar-senha', { perfil: 'prestadora', identificador: 'QA-Prest@Teste.local' });
  cod = await ultimoCodigo('recuperar:prestadora:qa-prest@teste.local');
  r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'prestadora', identificador: 'QA-Prest@Teste.local', codigo: cod, senha: 'prestnova2' });
  check('por e-mail (compartilhado): redefine as contas ligadas a ele', r.s === 200 && (await login('prestadora', '54999990002', 'prestnova2')).s === 200 && (await login('prestadora', '54999990001', 'prestnova2')).s === 200);
  await http('POST', '/auth/recuperar-senha', { perfil: 'prestadora', identificador: '54999990003' });
  check('prestadora sem e-mail: resposta genérica, sem código', !(await ultimoCodigo('recuperar:prestadora:null')));

  // limites
  const alvoLimite = 'qa-limite@teste.local';
  await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-Lim',$1,$2,$3)", [alvoLimite, hash, carazinho.id]);
  const codigos = [];
  for (let i = 0; i < 6; i++) codigos.push((await http('POST', '/auth/recuperar-senha', { perfil: 'cliente', identificador: alvoLimite })).s);
  check('6º pedido pra mesma conta é barrado (429) — protege a caixa de e-mail', codigos.slice(0, 5).every(s => s === 200) && codigos[5] === 429, JSON.stringify(codigos));
  const chutes = [];
  for (let i = 0; i < 10; i++) chutes.push((await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: 'qa-chute@teste.local', codigo: String(100000 + i), senha: 'qualquer123' })).s);
  check('chute de código: após 8 erros vira 429', chutes.slice(0, 8).every(s => s === 400) && chutes[8] === 429, JSON.stringify(chutes));

  console.log('\n== Tarifa por atendimento ==');
  const tAdm = (await login('administrador', 'qa-adm@teste.local', 'admnova123')).j.token;
  const tPan = (await login('administrador', 'qa-admpan@teste.local', 'senhaantiga1')).j.token;
  const tSub = (await login('administrador', 'qa-sub@teste.local', 'subnova123')).j.token;
  const tPrest = (await login('prestadora', '54999990001', 'prestnova2')).j.token;

  let eq = await http('GET', '/unidades/carazinho/admin/equipe', null, tAdm);
  const linha = eq.j.find(e => e.prestadora_id === prest.id);
  check('equipe traz valor_por_atendimento (null ao início)', eq.s === 200 && linha && linha.valor_por_atendimento === null);
  r = await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: 'abc' }, tAdm);
  check('valor não numérico: 400', r.s === 400);
  r = await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: -5 }, tAdm);
  check('valor negativo: 400', r.s === 400);
  r = await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: 80 }, tSub);
  check('funcionário NÃO altera tarifa (403)', r.s === 403, JSON.stringify(r));
  r = await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: 80 }, tPan);
  check('admin de outra unidade NÃO altera (403)', r.s === 403);
  r = await http('PATCH', `/unidades/panambi/admin/equipe/${prest.id}`, { valor_por_atendimento: 80 }, tPan);
  check('prestadora de outra unidade: 404', r.s === 404);
  r = await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: '80,5' }, tAdm);
  check('aceita vírgula decimal ("80,5" → 80.50)', r.s === 200 && Number(r.j.valor_por_atendimento) === 80.5, JSON.stringify(r.j));
  r = await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: 80 }, tAdm);
  check('admin define 80,00', r.s === 200 && Number(r.j.valor_por_atendimento) === 80);
  eq = await http('GET', '/unidades/carazinho/admin/equipe', null, tSub);
  check('funcionário (módulo equipe) enxerga a tarifa', eq.s === 200 && Number(eq.j.find(e => e.prestadora_id === prest.id).valor_por_atendimento) === 80);

  // atendimentos
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const dia = (delta) => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); };
  const util = (delta) => { let d = dia(delta); while (new Date(d + 'T12:00:00Z').getUTCDay() === 0) d = dia(delta++ + 1); return d; };
  const criar = (extra) => http('POST', '/atendimentos/admin/carazinho', { tipo_servico: 'qa-limpeza', hora_atendimento: '09:00', duracao_horas: 4, valor: 300, prestadora_id: prest.id, ...extra }, tAdm);
  const a1 = await criar({ data_atendimento: util(1), area: 'Bairro Centro' });
  check('criar com prestadora: 201 e valor_pago = 80 p/ o aviso do WhatsApp', a1.s === 201 && a1.j.valor_pago === 80 && a1.j.status === 'proposto', JSON.stringify(a1.j));

  let cv = await http('GET', '/atendimentos/prestadora/me/convites', null, tPrest);
  const c1 = cv.j.find(c => c.id === a1.j.id);
  check('convite mostra valor_pago = 80', c1 && Number(c1.valor_pago) === 80);
  check('prestadora NÃO recebe o preço do cliente (valor)', c1 && !('valor' in c1) && !('cliente_id' in c1) && !('valor_prestadora' in c1));
  r = await http('POST', `/atendimentos/prestadora/me/${a1.j.id}/aceitar`, null, tPrest);
  check('aceitar (≤2 dias): 200', r.s === 200, JSON.stringify(r));
  const { rows: [tr] } = await pool.query('select valor_prestadora from atendimentos where id = $1', [a1.j.id]);
  check('tarifa travada no aceite (80)', Number(tr.valor_prestadora) === 80);

  await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: 100 }, tAdm);
  const a2 = await criar({ data_atendimento: util(0) });
  r = await http('POST', `/atendimentos/prestadora/me/${a2.j.id}/aceitar`, null, tPrest);
  const ag = (await http('GET', '/atendimentos/prestadora/me/agenda', null, tPrest)).j;
  const v1 = ag.find(x => x.id === a1.j.id), v2 = ag.find(x => x.id === a2.j.id);
  check('após subir p/ 100: o já aceito continua 80', v1 && Number(v1.valor_pago) === 80, JSON.stringify(v1));
  check('o novo aceite trava 100', v2 && Number(v2.valor_pago) === 100);

  const resumo = (await http('GET', '/atendimentos/prestadora/me/resumo', null, tPrest)).j;
  check('resumo traz tarifa atual = 100', resumo.valor_por_atendimento === 100, JSON.stringify(resumo));
  const totalMes = resumo.mes.realizados_total + resumo.mes.previstos_total;
  const qtdMes = resumo.mes.realizados_qtd + resumo.mes.previstos_qtd;
  const mesIgual = (d) => d.slice(0, 7) === hoje.slice(0, 7);
  const esperadoQtd = [util(1), util(0)].filter(mesIgual).length;
  const esperadoTotal = (mesIgual(util(1)) ? 80 : 0) + (mesIgual(util(0)) ? 100 : 0);
  check(`resumo do mês = ${esperadoQtd} atend. / R$ ${esperadoTotal} (80 travado + 100 novo)`, qtdMes === esperadoQtd && totalMes === esperadoTotal, JSON.stringify(resumo.mes));
  check('semana tem qtd/total coerentes (total = soma dos valores travados)', resumo.semana.qtd >= 0 && (resumo.semana.qtd === 0 ? resumo.semana.total === 0 : resumo.semana.total > 0), JSON.stringify(resumo.semana));

  // concluído: atendimento ontem aceito conta como realizado
  const a3 = await criar({ data_atendimento: dia(-2) });
  await pool.query("update atendimentos set status = 'aceito', valor_prestadora = 100 where id = $1", [a3.j.id]);
  const resumo2 = (await http('GET', '/atendimentos/prestadora/me/resumo', null, tPrest)).j;
  const dentroDoMes = mesIgual(dia(-2));
  check('aceito com data passada entra como "realizado"', resumo2.mes.realizados_qtd === resumo.mes.realizados_qtd + (dentroDoMes ? 1 : 0), JSON.stringify(resumo2.mes));

  // reatribuir zera a trava; prestadora sem tarifa
  const a4 = await criar({ data_atendimento: util(3), prestadora_id: undefined });
  r = await http('POST', `/atendimentos/admin/carazinho/${a4.j.id}/propor`, { prestadora_id: prest.id }, tAdm);
  check('propor devolve valor_pago (tarifa atual)', r.s === 200 && r.j.valor_pago === 100);
  r = await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: '' }, tAdm);
  check('limpar tarifa (vazio) → null', r.s === 200 && r.j.valor_por_atendimento === null);
  cv = await http('GET', '/atendimentos/prestadora/me/convites', null, tPrest);
  check('sem tarifa: convite vem com valor_pago null (tela esconde o valor)', cv.j.every(c => c.valor_pago === null));
  const resumo3 = (await http('GET', '/atendimentos/prestadora/me/resumo', null, tPrest)).j;
  check('sem tarifa: resumo.valor_por_atendimento = null', resumo3.valor_por_atendimento === null);

  console.log('\n== Local do atendimento ==');
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/local`, { area: '  Rua das Flores, 100  ' }, tAdm);
  check('admin altera o local (com trim)', r.s === 200 && r.j.area === 'Rua das Flores, 100');
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/local`, { area: '' }, tAdm);
  check('vazio apaga o local (null)', r.s === 200 && r.j.area === null);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/local`, { area: 'x'.repeat(501) }, tAdm);
  check('local > 500: 400', r.s === 400);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/local`, { area: 'Centro' }, tPan);
  check('admin de outra unidade: 403', r.s === 403);
  r = await http('PATCH', `/atendimentos/admin/panambi/${a1.j.id}/local`, { area: 'Centro' }, tPan);
  check('atendimento de outra unidade: 404', r.s === 404);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/local`, { area: 'Centro' }, tSub);
  check('funcionário com módulo agenda altera (200)', r.s === 200);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/local`, { area: 'Centro' }, tPrest);
  check('prestadora NÃO altera local (403)', r.s === 403);
  await pool.query("update atendimentos set status = 'cancelado' where id = $1", [a4.j.id]);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a4.j.id}/local`, { area: 'Centro' }, tAdm);
  check('cancelado: 404', r.s === 404);
  let v = (await http('GET', '/atendimentos/prestadora/me/agenda', null, tPrest)).j.find(x => x.id === a1.j.id);
  check('local alterado pelo funcionário chega na tela da prestadora', v && v.area === 'Centro');
  await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/local`, { area: '' }, tAdm);
  v = (await http('GET', '/atendimentos/prestadora/me/agenda', null, tPrest)).j.find(x => x.id === a1.j.id);
  check('local apagado chega nulo na tela da prestadora', v && v.area === null);

  console.log('\n== Sync reflete tarifa ==');
  const s1 = (await http('GET', '/sync', null, tPrest)).j.versao;
  await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: 55 }, tAdm);
  const s2 = (await http('GET', '/sync', null, tPrest)).j.versao;
  check('mudar a tarifa muda a versão de sync da prestadora', s1 !== s2);
  const s3 = (await http('GET', '/sync?unidade=carazinho', null, tSub)).j.versao;
  await http('PATCH', `/unidades/carazinho/admin/equipe/${prest.id}`, { valor_por_atendimento: 60 }, tAdm);
  const s4 = (await http('GET', '/sync?unidade=carazinho', null, tSub)).j.versao;
  check('e a do funcionário/admin da unidade', s3 !== s4);

  console.log('\n== Valor do atendimento (unitário) ==');
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/valor`, { valor: '150,5' }, tAdm);
  check('admin define o valor (vírgula decimal): 150,50', r.s === 200 && Number(r.j.valor) === 150.5, JSON.stringify(r.j));
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/valor`, { valor: 'abc' }, tAdm);
  check('valor inválido: 400', r.s === 400);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/valor`, { valor: -1 }, tAdm);
  check('valor negativo: 400', r.s === 400);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/valor`, { valor: 99 }, tPrest);
  check('prestadora NÃO altera valor (403)', r.s === 403);
  r = await http('PATCH', `/atendimentos/admin/panambi/${a1.j.id}/valor`, { valor: 99 }, tPan);
  check('atendimento de outra unidade: 404', r.s === 404);
  r = await http('PATCH', `/atendimentos/admin/carazinho/${a1.j.id}/valor`, { valor: '' }, tAdm);
  check('vazio remove o valor (null)', r.s === 200 && r.j.valor === null);
  const criadoComValor = await criar({ data_atendimento: util(5), valor: 275.9 });
  check('cadastro único grava o valor informado', criadoComValor.s === 201 && Number(criadoComValor.j.valor) === 275.9);

  console.log('\n== Valor do mês em atendimento recorrente (em grupo) ==');
  const prox = new Date(hoje + 'T12:00:00Z'); prox.setUTCMonth(prox.getUTCMonth() + 1, 1);
  const inicioSerie = prox.toISOString().slice(0, 10);
  r = await http('POST', '/atendimentos/admin/carazinho/recorrente', { data_inicio: inicioSerie, horizonte_meses: 2, itens: [{ dia_semana: 2, hora_atendimento: '08:00', tipo_servico: 'qa-faxina', valor_mensal: 'xx' }] }, tAdm);
  check('valor do mês inválido: 400', r.s === 400);
  r = await http('POST', '/atendimentos/admin/carazinho/recorrente', { data_inicio: inicioSerie, horizonte_meses: 2, itens: [{ dia_semana: 2, hora_atendimento: '08:00', tipo_servico: 'qa-faxina', valor_mensal: '1200,00' }, { dia_semana: 4, hora_atendimento: '09:00', tipo_servico: 'qa-faxina' }] }, tAdm);
  check('série criada (201)', r.s === 201 && r.j.quantidade_gerada > 0, JSON.stringify(r.j).slice(0, 200));
  const serie = r.j.atendimentos || [];
  const meses = {};
  for (const a of serie.filter(x => x.hora_atendimento.startsWith('08'))) { const m = String(a.data_atendimento).slice(0, 7); (meses[m] ||= []).push(Math.round(Number(a.valor) * 100)); }
  const chaves = Object.keys(meses).sort();
  check('os dois primeiros meses (cheios) somam exatamente R$ 1.200,00', chaves.slice(0, 2).length === 2 && chaves.slice(0, 2).every(m => meses[m].reduce((s, v) => s + v, 0) === 120000), JSON.stringify(meses));
  check('cada atendimento guarda o valor mensal informado (1200)', serie.filter(x => x.hora_atendimento.startsWith('08')).every(x => Number(x.valor_mensal) === 1200));
  check('dia sem valor mensal fica sem valor', serie.filter(x => x.hora_atendimento.startsWith('09')).every(x => x.valor === null && x.valor_mensal === null));

  console.log('\n== Endereço da unidade ==');
  const { rows: [enderecoOriginal] } = await pool.query("select endereco, endereco_curto from unidades where slug = 'carazinho'");
  try {
    r = await http('PATCH', '/unidades/carazinho/endereco', { endereco: '  Av. Teste, 10 — Centro  ', endereco_curto: '' }, tAdm);
    check('admin altera o endereço (trim; sem resumido → null)', r.s === 200 && r.j.endereco === 'Av. Teste, 10 — Centro' && r.j.endereco_curto === null, JSON.stringify(r.j));
    r = await http('GET', '/unidades/carazinho');
    check('endereço novo aparece na rota pública', r.j.endereco === 'Av. Teste, 10 — Centro');
    r = await http('PATCH', '/unidades/carazinho/endereco', { endereco: 'Av. Teste, 10', endereco_curto: 'Av. Teste' }, tAdm);
    check('com resumido', r.s === 200 && r.j.endereco_curto === 'Av. Teste');
    r = await http('PATCH', '/unidades/carazinho/endereco', { endereco: '', endereco_curto: 'sobrou' }, tAdm);
    check('endereço vazio remove o campo (e o resumido junto)', r.s === 200 && r.j.endereco === null && r.j.endereco_curto === null);
    r = await http('PATCH', '/unidades/carazinho/endereco', { endereco: 'x'.repeat(301) }, tAdm);
    check('endereço > 300: 400', r.s === 400);
    r = await http('PATCH', '/unidades/carazinho/endereco', { endereco: 'Qualquer' }, tSub);
    check('funcionário NÃO altera o endereço (403)', r.s === 403);
    r = await http('PATCH', '/unidades/carazinho/endereco', { endereco: 'Qualquer' }, tPan);
    check('admin de outra unidade NÃO altera (403)', r.s === 403);
  } finally {
    await pool.query('update unidades set endereco = $1, endereco_curto = $2 where slug = $3', [enderecoOriginal.endereco, enderecoOriginal.endereco_curto, 'carazinho']);
  }

  console.log('\n== Prestadoras criadas a partir da planilha ==');
  const { garantirPrestadoras } = require('../src/utils/prestadorasImportadas');
  const cli = await pool.connect();
  let criadasPlanilha;
  try {
    await cli.query('BEGIN');
    criadasPlanilha = await garantirPrestadoras(cli, carazinho.id, ['QA MARIA DA SILVA', 'qa maria da silva', 'QA JOÃO D\'ÁVILA', 'QA ANA A.B. DOS REIS']);
    await cli.query('COMMIT');
  } finally { cli.release(); }
  const porEmail = Object.fromEntries(criadasPlanilha.criadas.map(c => [c.email, c.nome]));
  check('mesmo nome (maiúscula/minúscula) vira UMA prestadora só', criadasPlanilha.criadas.filter(c => c.email.startsWith('qamariadasilva')).length === 1);
  check('e-mail = nome sem espaço/acento + @gmail.com', porEmail['qamariadasilva@gmail.com'] === 'Qa Maria da Silva' && 'qajoaodavila@gmail.com' in porEmail, JSON.stringify(porEmail));
  check('sigla com ponto preservada no nome', porEmail['qaanaabdosreis@gmail.com'] === 'Qa Ana A.B. dos Reis', JSON.stringify(porEmail));
  const loginPlanilha = await login('prestadora', 'qamariadasilva@gmail.com', 'senha123');
  check('entra pelo e-mail com a senha padrão senha123', loginPlanilha.s === 200 && loginPlanilha.j.perfil === 'prestadora');
  const { rows: [semTel] } = await pool.query("select telefone from prestadoras where email = 'qamariadasilva@gmail.com'");
  check('prestadora da planilha fica sem telefone (null)', semTel.telefone === null);
  const cli2 = await pool.connect();
  let repetida;
  try { await cli2.query('BEGIN'); repetida = await garantirPrestadoras(cli2, carazinho.id, ['QA Maria da Silva']); await cli2.query('COMMIT'); } finally { cli2.release(); }
  check('rodar de novo não duplica (reaproveita a existente)', repetida.criadas.length === 0);
  const cli3 = await pool.connect();
  let homonima;
  try { await cli3.query('BEGIN'); homonima = await garantirPrestadoras(cli3, panambi.id, ['QA Maria da Silva']); await cli3.query('COMMIT'); } finally { cli3.release(); }
  check('mesmo nome em OUTRA unidade cria outra conta, com e-mail diferente (…2@gmail.com)', homonima.criadas.length === 1 && homonima.criadas[0].email === 'qamariadasilva2@gmail.com', JSON.stringify(homonima.criadas));
  await pool.query("delete from prestadoras where email like 'qa%@gmail.com'");

  console.log('\n== Financeiro (API) ==');
  const { rows: [pf] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id) values ('qa-FinPrest','54999990009','qa-finprest@teste.local',$1,$2) returning id", [hash, carazinho.id]);
  const tPrestFin = (await login('prestadora', '54999990009', 'senhaantiga1')).j.token;
  await http('PATCH', `/unidades/carazinho/admin/equipe/${pf.id}`, { valor_por_atendimento: 80 }, tAdm);
  const { rows: [cliFin] } = await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-FinCli','qa-fin@teste.local',$1,$2) returning id", [hash, carazinho.id]);
  const mesFin = hoje.slice(0, 7);
  const inserirFin = (dia, hora, valor, valorPrest, status = 'concluido') => pool.query(
    `insert into atendimentos (unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, hora_atendimento, duracao_horas, valor, valor_prestadora, status, origem)
     values ($1,$2,$3,'qa-fin',$4,$5,2,$6,$7,$8,'manual') returning id`, [carazinho.id, cliFin.id, pf.id, `${mesFin}-${dia}`, hora, valor, valorPrest, status]);

  const antes = (await http('GET', '/financeiro/carazinho/resumo', null, tAdm)).j;
  check('resumo responde (200) com a estrutura esperada', antes.mes === mesFin && antes.realizado && Array.isArray(antes.por_prestadora) && antes.alertas, JSON.stringify(antes).slice(0, 160));
  await inserirFin('10', '09:00', 300, null);   // custo = tarifa atual (80), ainda não travado
  await inserirFin('11', '09:00', 200, 70);     // custo travado em 70
  await inserirFin('12', '09:00', null, null);  // sem valor cobrado (custo = tarifa 80)
  const depois = (await http('GET', '/financeiro/carazinho/resumo', null, tAdm)).j;
  check('3 concluídos a mais, receita +500, custo +230 (80 da tarifa + 70 travado + 80)', depois.realizado.qtd - antes.realizado.qtd === 3 && Math.round((depois.realizado.receita - antes.realizado.receita) * 100) === 50000 && Math.round((depois.realizado.custo - antes.realizado.custo) * 100) === 23000, JSON.stringify({ a: antes.realizado, d: depois.realizado }));
  check('alerta "sem valor" subiu 1', depois.alertas.realizados_sem_valor - antes.alertas.realizados_sem_valor === 1);
  check('pendências listam o atendimento sem valor', depois.pendencias.some(p => p.tipo_servico === 'qa-fin' && p.falta.includes('valor')));
  const repQa = depois.por_prestadora.find(p => p.prestadora_id === pf.id);
  check('qa-Prest: 3 atendimentos, a pagar 230, nada pago', repQa && repQa.qtd === 3 && repQa.a_pagar_total === 230 && repQa.pago === 0 && repQa.pendentes_qtd === 3, JSON.stringify(repQa));
  check('margem fecha só nos completos: (300−80)+(200−70) = 350 a mais', Math.round((depois.realizado.margem - antes.realizado.margem) * 100) === 35000, `${antes.realizado.margem} -> ${depois.realizado.margem}`);

  // permissões
  r = await http('GET', '/financeiro/carazinho/resumo', null, tSub);
  check('funcionário SEM o módulo financeiro: 403', r.s === 403);
  await pool.query("update sub_administradores set pode_financeiro = true where email = 'qa-sub@teste.local'");
  r = await http('GET', '/financeiro/carazinho/resumo', null, tSub);
  check('funcionário COM o módulo financeiro: 200', r.s === 200);
  const permAntes = (await http('GET', '/sync?unidade=carazinho', null, tSub)).j.versao;
  await pool.query("update sub_administradores set pode_financeiro = false where email = 'qa-sub@teste.local'");
  const permDepois = (await http('GET', '/sync?unidade=carazinho', null, tSub)).j.versao;
  check('mudar a permissão financeiro muda a impressão de sync (a tela do funcionário atualiza)', permAntes !== permDepois);
  r = await http('GET', '/financeiro/carazinho/resumo', null, tPrestFin);
  check('prestadora: 403', r.s === 403);
  r = await http('GET', '/financeiro/carazinho/resumo', null, tPan);
  check('admin de outra unidade: 403', r.s === 403);
  r = await http('GET', '/financeiro/carazinho/resumo?mes=2026-13', null, tAdm);
  check('mês inválido: 400', r.s === 400);
  r = await http('GET', '/financeiro/carazinho/resumo');
  check('sem login: 401', r.s === 401);

  // repasses
  r = await http('GET', `/financeiro/carazinho/repasses/${pf.id}?mes=${mesFin}`, null, tAdm);
  check('folha de repasse: 3 atendimentos concluídos', r.s === 200 && r.j.atendimentos.length === 3, JSON.stringify(r.j).slice(0, 200));
  r = await http('GET', `/financeiro/carazinho/repasses/${pf.id}?mes=${mesFin}`, null, tPan);
  check('folha de outra unidade: 403', r.s === 403);
  r = await http('GET', `/financeiro/panambi/repasses/${pf.id}?mes=${mesFin}`, null, tPan);
  check('prestadora de outra unidade: 404', r.s === 404);
  r = await http('GET', `/financeiro/carazinho/repasses/nao-e-uuid?mes=${mesFin}`, null, tAdm);
  check('id inválido: 400 (e não 500)', r.s === 400);

  r = await http('POST', `/financeiro/carazinho/repasses/${pf.id}/pagar`, { mes: mesFin }, tAdm);
  check('marcar como pago: 3 atendimentos', r.s === 200 && r.j.atualizados === 3, JSON.stringify(r.j));
  const { rows: pagos } = await pool.query("select valor_prestadora, repasse_pago_em from atendimentos where tipo_servico = 'qa-fin' and prestadora_id = $1 order by data_atendimento", [pf.id]);
  check('ao pagar, a tarifa fica TRAVADA nos 3 (80, 70, 80) e o pagamento é registrado', pagos.length === 3 && pagos.every(p => p.repasse_pago_em) && pagos.map(p => Number(p.valor_prestadora)).join() === '80,70,80', JSON.stringify(pagos));
  r = await http('POST', `/financeiro/carazinho/repasses/${pf.id}/pagar`, { mes: mesFin }, tAdm);
  check('pagar de novo não duplica (0 atualizados)', r.s === 200 && r.j.atualizados === 0);
  await http('PATCH', `/unidades/carazinho/admin/equipe/${pf.id}`, { valor_por_atendimento: 999 }, tAdm);
  const pos = (await http('GET', '/financeiro/carazinho/resumo', null, tAdm)).j.por_prestadora.find(p => p.prestadora_id === pf.id);
  check('mudar a tarifa DEPOIS de pagar não altera o que foi pago (230, pago 230, pendente 0)', pos.a_pagar_total === 230 && pos.pago === 230 && pos.pendente === 0 && pos.pagos_qtd === 3, JSON.stringify(pos));
  const resPrest = (await http('GET', '/atendimentos/prestadora/me/resumo', null, tPrestFin)).j;
  check('a prestadora vê quanto do mês já foi pago (230)', resPrest.mes.pago_total >= 230, JSON.stringify(resPrest.mes));
  r = await http('POST', `/financeiro/carazinho/repasses/${pf.id}/pagar`, { mes: mesFin, desfazer: true }, tSub);
  check('funcionário sem o módulo não paga/desfaz (403)', r.s === 403);
  r = await http('POST', `/financeiro/carazinho/repasses/${pf.id}/pagar`, { mes: mesFin, desfazer: true }, tAdm);
  check('desfazer pagamento: 3 voltam a "a pagar"', r.s === 200 && r.j.atualizados === 3 && r.j.desfeito === true);
  r = await http('POST', `/financeiro/carazinho/repasses/${pf.id}/pagar`, { mes: 'abc' }, tAdm);
  check('pagar com mês inválido: 400', r.s === 400);

  console.log('\n== Views do dashboard e da Equipe (não multiplicam mais) ==');
  const { rows: [real] } = await pool.query("select count(*)::int as n from atendimentos where unidade_id = $1 and status <> 'cancelado' and data_atendimento = (now() at time zone 'America/Sao_Paulo')::date", [carazinho.id]);
  const dash = (await http('GET', '/unidades/carazinho/admin/dashboard', null, tAdm)).j;
  check(`atendimentos de hoje no dashboard = contagem real (${real.n}), não multiplicada pelas avaliações`, Number(dash.atendimentos_hoje) === real.n, JSON.stringify(dash));
  const { rows: [avs] } = await pool.query('select count(*)::int as n from avaliacoes');
  console.log(`  (o banco tem ${avs.n} avaliações — com a view antiga, 1 atendimento viraria ${avs.n})`);
  const { rows: [fat] } = await pool.query("select coalesce(sum(valor),0)::numeric as t from atendimentos where unidade_id = $1 and status = 'concluido' and date_trunc('month', data_atendimento) = date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)", [carazinho.id]);
  check('faturamento do mês no dashboard = soma real dos concluídos', Math.round(Number(dash.faturamento_mes) * 100) === Math.round(Number(fat.t) * 100), `${dash.faturamento_mes} vs ${fat.t}`);
  const equipe = (await http('GET', '/unidades/carazinho/admin/equipe', null, tAdm)).j;
  const { rows: reais } = await pool.query("select prestadora_id, count(*)::int as n from atendimentos where unidade_id = $1 and status = 'concluido' group by 1", [carazinho.id]);
  const mapaReal = Object.fromEntries(reais.map(x => [x.prestadora_id, x.n]));
  check('Equipe: total de atendimentos de CADA prestadora = contagem real', equipe.every(e => Number(e.total_atendimentos) === (mapaReal[e.prestadora_id] || 0)), JSON.stringify(equipe.filter(e => Number(e.total_atendimentos) !== (mapaReal[e.prestadora_id] || 0)).slice(0, 3)));

  console.log('\n== Conclusão automática dos atendimentos realizados ==');
  const { concluirAtendimentosRealizados } = require('../src/utils/conclusao');
  const tx = await pool.connect(); // tudo numa transação revertida: o teste não conclui atendimentos REAIS do banco
  try {
    await tx.query('BEGIN');
    await tx.query('update prestadoras set valor_por_atendimento = 80 where id = $1', [prest.id]);
    const ins = async (dia, hora, dur, status = 'aceito') => (await tx.query(
      `insert into atendimentos (unidade_id, prestadora_id, tipo_servico, data_atendimento, hora_atendimento, duracao_horas, status, origem)
       values ($1,$2,'qa-auto',$3,$4,$5,$6,'manual') returning id`, [carazinho.id, prest.id, dia, hora, dur, status])).rows[0].id;
    const ontem = new Date(hoje + 'T12:00:00Z'); ontem.setUTCDate(ontem.getUTCDate() - 1);
    const dOntem = ontem.toISOString().slice(0, 10), amanha = util(1);
    const idOntem = await ins(dOntem, '09:00', 2), idOntemSemHora = await ins(dOntem, null, null), idFuturo = await ins(amanha, '09:00', 2);
    const idHojeTarde = await ins(hoje, '23:30', 2);               // termina depois da meia-noite: ainda não passou
    const idPropostoOntem = await ins(dOntem, '09:00', 2, 'proposto'); // convite nunca aceito não vira concluído
    const n = await concluirAtendimentosRealizados(tx);
    const st = async (id) => (await tx.query('select status, valor_prestadora from atendimentos where id = $1', [id])).rows[0];
    const sOntem = await st(idOntem);
    check('aceito de ontem vira concluído e trava a tarifa (80)', sOntem.status === 'concluido' && Number(sOntem.valor_prestadora) === 80, JSON.stringify(sOntem));
    check('aceito de ontem SEM horário também conclui', (await st(idOntemSemHora)).status === 'concluido');
    check('aceito de amanhã continua aceito', (await st(idFuturo)).status === 'aceito');
    check('aceito de hoje que só termina às 01:30 do dia seguinte continua aceito', (await st(idHojeTarde)).status === 'aceito');
    check('convite (proposto) de ontem não é concluído', (await st(idPropostoOntem)).status === 'proposto');
    check('só os 2 elegíveis dos meus dados entraram na contagem (>= 2)', n >= 2);
    const n2 = await concluirAtendimentosRealizados(tx);
    check('rodar de novo não conclui nada de novo (idempotente)', n2 === 0, String(n2));
  } finally { await tx.query('ROLLBACK'); tx.release(); }

  // limpeza
  await pool.query("delete from atendimentos where tipo_servico like 'qa-%'");
  await pool.query("delete from administrador_unidades where administrador_id in (select id from administradores where email like 'qa-%')");
  await pool.query("delete from sub_administradores where email like 'qa-%'"); // antes: a FK criado_por aponta pros administradores
  await pool.query("delete from administradores where email like 'qa-%'");
  await pool.query("delete from prestadoras where nome like 'qa-%'");
  await pool.query("delete from clientes where email like 'qa-%' or nome like 'qa-%'");
  await pool.query("delete from codigos_verificacao where destino like '%qa-%'");
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  await pool.end();
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(2); });


