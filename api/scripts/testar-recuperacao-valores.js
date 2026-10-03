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
  await pool.query("delete from administradores where email like 'qa-%'");
  await pool.query("delete from sub_administradores where email like 'qa-%'");
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

  // limpeza
  await pool.query("delete from atendimentos where tipo_servico like 'qa-%'");
  await pool.query("delete from administrador_unidades where administrador_id in (select id from administradores where email like 'qa-%')");
  await pool.query("delete from administradores where email like 'qa-%'");
  await pool.query("delete from sub_administradores where email like 'qa-%'");
  await pool.query("delete from prestadoras where nome like 'qa-%'");
  await pool.query("delete from clientes where email like 'qa-%' or nome like 'qa-%'");
  await pool.query("delete from codigos_verificacao where destino like '%qa-%'");
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  await pool.end();
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(2); });

