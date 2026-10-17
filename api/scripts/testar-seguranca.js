// Uso: npm run teste:seguranca   (a API precisa estar rodando; API_URL muda o endereço)
//
// Cobre as correções da varredura de segurança: cabeçalhos e CSP, arquivos servidos, e-mail com vários destinatários,
// sessão (token) que cai quando a senha muda, algoritmo do token, troca de e-mail só com a senha atual, foto de perfil,
// pedido público (campos e conta de outro cliente), dados internos que não podem vazar pro cliente, avaliação em duplicidade,
// telefone da unidade, corpo grande sem login, "bomba de zip" na planilha e id inválido virando 400 (e não 500).
// Os limites de requisição (por e-mail e geral) são testados numa API própria que o teste sobe numa porta à parte.
// Cria e apaga uma unidade "qa-seg-*" só dele: não toca nas unidades reais.
//   PowerShell:  $env:PORT='3011'; $env:SMTP_USER=''; $env:SMTP_PASS=''; $env:RESEND_API_KEY=''; $env:LIMITE_CADASTRO='1000'; node src/server.js
//   e então:     $env:API_URL='http://localhost:3011'; npm run teste:seguranca
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { gerarModeloImportacao } = require('../src/utils/modeloPlanilha');

const URL_BASE = process.env.API_URL || 'http://localhost:3001';
const BASE = URL_BASE + '/api';
const pool = new Pool({ host: process.env.PGHOST, port: process.env.PGPORT, database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD });
let ok = 0, falhas = 0;
const check = (nome, cond, extra = '') => { if (cond) { ok++; console.log('  ok  ', nome); } else { falhas++; console.log('  FALHA', nome, extra); } };
const http = async (metodo, rota, corpo, token, base = BASE) => {
  const r = await fetch(base + rota, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo === undefined || corpo === null ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
  let j = {}; try { j = await r.json(); } catch (e) { }
  return { s: r.status, j, h: r.headers };
};
const login = async (perfil, identificador, senha) => (await http('POST', '/auth/login', { perfil, identificador, senha })).j.token;
const SENHA = 'senhaQa123', NOVA = 'senhaNova456';
const sufixo = Math.random().toString(36).slice(2, 8);
const email = (n) => `qa-seg-${n}-${sufixo}@teste.local`;

// zip de UM item (deflate) com o tamanho "declarado" que a gente quiser — pra montar uma bomba de zip de brinquedo
function zipDe(nome, dados, tamanhoDeclarado = dados.length) {
  const comp = zlib.deflateRawSync(dados), crc = zlib.crc32(dados), n = Buffer.from(nome);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(tamanhoDeclarado, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(tamanhoDeclarado, 24); central.writeUInt16LE(n.length, 28);
  const inicioDiretorio = local.length + n.length + comp.length;
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10); fim.writeUInt32LE(central.length + n.length, 12); fim.writeUInt32LE(inicioDiretorio, 16);
  return Buffer.concat([local, n, comp, central, n, fim]);
}

async function subirApiIsolada(porta, extraEnv) {
  const env = { ...process.env, PORT: String(porta), SMTP_USER: '', SMTP_PASS: '', RESEND_API_KEY: '', LIMITE_CADASTRO: '', LIMITE_API: '', ...extraEnv };
  const filho = spawn(process.execPath, ['src/server.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://localhost:${porta}/api/ping`)).ok) return filho; } catch (e) { }
    await new Promise(r => setTimeout(r, 250));
  }
  filho.kill(); throw new Error('API isolada não subiu na porta ' + porta);
}

let unidadeId = null;
async function limpar() {
  if (!unidadeId) {
    const { rows } = await pool.query("select id from unidades where slug like 'qa-seg-%'");
    if (!rows.length) return;
    unidadeId = rows.map(r => r.id);
  } else unidadeId = [unidadeId];
  await pool.query('delete from avaliacoes where prestadora_id in (select id from prestadoras where unidade_id = any($1))', [unidadeId]);
  await pool.query('delete from atendimentos where unidade_id = any($1)', [unidadeId]);
  await pool.query('delete from prestadoras where unidade_id = any($1)', [unidadeId]);
  await pool.query('delete from clientes where unidade_id = any($1)', [unidadeId]);
  await pool.query('delete from sub_administradores where unidade_id = any($1)', [unidadeId]);
  await pool.query("delete from administrador_unidades where administrador_id in (select id from administradores where email like 'qa-seg-%')");
  await pool.query("delete from administradores where email like 'qa-seg-%'");
  await pool.query('delete from unidades where id = any($1)', [unidadeId]);
  await pool.query("delete from codigos_verificacao where destino like '%qa-seg-%'");
  unidadeId = null;
}

(async () => {
  await limpar();
  const hash = await bcrypt.hash(SENHA, 10);
  const slug = 'qa-seg-' + sufixo;
  const { rows: [un] } = await pool.query("insert into unidades (slug, nome, uf, cnpj, telefone) values ($1,'QA Seg','RS','11222333000181','54999990000') returning id", [slug]);
  unidadeId = un.id;
  const { rows: [adm] } = await pool.query("insert into administradores (nome, sobrenome, email, senha_hash) values ('qa','Seg',$1,$2) returning id", [email('adm'), hash]);
  await pool.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1,$2)', [adm.id, un.id]);
  const { rows: [sub] } = await pool.query("insert into sub_administradores (nome, sobrenome, email, senha_hash, unidade_id, pode_agenda) values ('qa','SegSub',$1,$2,$3,true) returning id", [email('sub'), hash, un.id]);
  const { rows: [pa] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id, valor_por_atendimento) values ('qa-seg-A','54999993001',$1,$2,$3,80) returning id", [email('pa'), hash, un.id]);
  const { rows: [pb] } = await pool.query("insert into prestadoras (nome, telefone, email, senha_hash, unidade_id, valor_por_atendimento) values ('qa-seg-B','54999993002',$1,$2,$3,90) returning id", [email('pb'), hash, un.id]);
  const { rows: [cli] } = await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-seg-Cliente',$1,$2,$3) returning id", [email('cli'), hash, un.id]);
  const { rows: [cli2] } = await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-seg-Cliente2',$1,$2,$3) returning id", [email('cli2'), hash, un.id]);
  const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const ins = async (status, prest, cliente, d, extra = {}) => (await pool.query(
    `insert into atendimentos (unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, hora_atendimento, duracao_horas, valor, valor_prestadora, status, origem, repasse_pago_em, codigo_externo)
     values ($1,$2,$3,'qa-seg-serv',$4,'09:00',2,300,$5,$6,'manual',$7,$8) returning id`,
    [un.id, cliente, prest, d, extra.valorPrest ?? null, status, extra.pago ? new Date() : null, extra.codigo ?? null])).rows[0].id;
  const concluido = await ins('concluido', pa.id, cli.id, dia(-5), { valorPrest: 77, pago: true, codigo: 'X-1' });
  const concluidoSemPrest = await ins('concluido', null, cli.id, dia(-6));

  let ra = null;
  try {
    // ---------------------------------------------------------------- cabeçalhos e arquivos
    console.log('\n== Cabeçalhos e arquivos servidos ==');
    let r = await fetch(URL_BASE + '/');
    const csp = r.headers.get('content-security-policy') || '';
    check('a página inicial responde com Content-Security-Policy', /default-src 'self'/.test(csp), csp);
    check('CSP: só fala com a própria API, sem objeto/base de fora e sem iframe de outro site', /connect-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp));
    check('CSP: script só do próprio site (nenhum script de domínio de fora)', /script-src 'self'/.test(csp) && !/script-src[^;]*https?:/.test(csp));
    check('X-Frame-Options, nosniff e Permissions-Policy presentes', r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff' && /camera=\(\)/.test(r.headers.get('permissions-policy') || ''));
    r = await fetch(BASE + '/ping');
    check('a API também manda os cabeçalhos de segurança', !!r.headers.get('content-security-policy') && r.headers.get('x-frame-options') === 'DENY');
    r = await fetch(URL_BASE + '/assets/js/18-iniciar.js');
    check('/assets entrega os scripts do site (JavaScript, sem cache velho)', r.status === 200 && /javascript/.test(r.headers.get('content-type')) && /no-cache/.test(r.headers.get('cache-control')));
    for (const rota of ['/assets/../api/.env', '/assets/%2e%2e/api/.env', '/assets/..%2fapi%2f.env', '/api/.env', '/.env', '/banco-schema.sql', '/api/src/server.js', '/api/package.json', '/.git/config', '/assets/js/', '/assets/']) {
      const x = await fetch(URL_BASE + rota, { redirect: 'manual' });
      const txt = await x.text();
      check(`GET ${rota} não entrega arquivo do projeto (${x.status})`, x.status >= 400 && !/PGPASSWORD|JWT_SECRET|create table|require\(/.test(txt));
    }

    // ---------------------------------------------------------------- e-mail com vários destinatários
    console.log('\n== E-mail: um endereço só ==');
    const emailsRuins = ['eu@x.com,vitima@y.com', 'eu@x.com;vitima@y.com', 'eu@x.com vitima@y.com', '<b>x</b>@y.com', 'a"b@y.com', 'x@y.com\nBcc: z@w.com', 'a'.repeat(250) + '@y.com'];
    for (const e of emailsRuins) {
      r = await http('POST', '/auth/cadastro/cliente', { nome: 'QA Seg Teste', email: e, senha: SENHA, unidade_slug: slug });
      check(`cadastro recusa e-mail "${e.slice(0, 28).replace(/\n/g, '\\n')}…" (400)`, r.s === 400, `HTTP ${r.s}`);
    }
    r = await http('POST', '/auth/cadastro/cliente', { nome: 'QA Seg Teste', email: email('novo'), senha: SENHA, unidade_slug: slug });
    check('e-mail normal continua passando (pede o código)', r.s === 200 && r.j.aguardandoConfirmacao === true, JSON.stringify(r.j));

    // ---------------------------------------------------------------- token: algoritmo e conta apagada
    console.log('\n== Token (JWT) ==');
    const tCli = await login('cliente', email('cli'), SENHA);
    r = await http('GET', '/perfil', null, tCli);
    check('login do cliente e acesso com o token', r.s === 200);
    const semAssinatura = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ id: cli.id, perfil: 'cliente' })).toString('base64url') + '.';
    r = await http('GET', '/perfil', null, semAssinatura);
    check('token sem assinatura (alg: none): 401', r.s === 401);
    const hs512 = jwt.sign({ id: cli.id, perfil: 'cliente' }, process.env.JWT_SECRET, { algorithm: 'HS512', expiresIn: '1h' });
    r = await http('GET', '/perfil', null, hs512);
    check('token assinado com outro algoritmo (HS512): 401 — só HS256 vale', r.s === 401);
    const tokenForjado = jwt.sign({ id: cli.id, perfil: 'cliente' }, 'segredo-errado-com-mais-de-32-caracteres-x', { algorithm: 'HS256' });
    r = await http('GET', '/perfil', null, tokenForjado);
    check('token assinado com outro segredo: 401', r.s === 401);
    const perfilInventado = jwt.sign({ id: cli.id, perfil: 'superadmin' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    r = await http('GET', '/perfil', null, perfilInventado);
    check('token com perfil que não existe: 401', r.s === 401);
    const { rows: [efemero] } = await pool.query("insert into clientes (nome, email, senha_hash, unidade_id) values ('qa-seg-Efemero',$1,$2,$3) returning id", [email('efemero'), hash, un.id]);
    const tEfemero = await login('cliente', email('efemero'), SENHA);
    check('cliente temporário entra', (await http('GET', '/perfil', null, tEfemero)).s === 200);
    await pool.query('delete from clientes where id = $1', [efemero.id]);
    await new Promise(r => setTimeout(r, 10500)); // a conferência da conta fica 10 s em memória
    r = await http('GET', '/perfil', null, tEfemero);
    check('conta apagada: o token dela deixa de valer (401)', r.s === 401, `HTTP ${r.s}`);

    // ---------------------------------------------------------------- sessão cai quando a senha muda
    console.log('\n== A sessão cai quando a senha muda ==');
    let tCli1 = await login('cliente', email('cli2'), SENHA);
    const tCli1b = await login('cliente', email('cli2'), SENHA); // "outro aparelho"
    r = await http('PATCH', '/perfil/senha', { senha_atual: 'errada-errada', senha_nova: NOVA }, tCli1);
    check('trocar a senha com a senha atual errada: 401', r.s === 401);
    r = await http('PATCH', '/perfil/senha', { senha_atual: SENHA, senha_nova: NOVA }, tCli1);
    check('troca de senha: 200 e devolve um token novo', r.s === 200 && typeof r.j.token === 'string', JSON.stringify(r.j));
    const tCli2 = r.j.token;
    check('o token de ANTES (outro aparelho / roubado) deixa de valer na hora: 401', (await http('GET', '/perfil', null, tCli1b)).s === 401);
    check('o token usado na troca também caiu (o novo o substitui)', (await http('GET', '/perfil', null, tCli1)).s === 401);
    check('o token novo vale', (await http('GET', '/perfil', null, tCli2)).s === 200);
    check('a senha nova entra; a antiga não', !!(await login('cliente', email('cli2'), NOVA)) && !(await login('cliente', email('cli2'), SENHA)));

    // recuperação de senha
    const tRec = await login('cliente', email('cli2'), NOVA);
    r = await http('POST', '/auth/recuperar-senha', { perfil: 'cliente', identificador: email('cli2') });
    const { rows: [cod] } = await pool.query('select codigo from codigos_verificacao where destino = $1 and usado = false order by criado_em desc limit 1', [`recuperar:cliente:${email('cli2')}`]);
    r = await http('POST', '/auth/recuperar-senha/confirmar', { perfil: 'cliente', identificador: email('cli2'), codigo: cod.codigo, senha: SENHA });
    check('redefinir a senha pelo "esqueci": 200', r.s === 200, JSON.stringify(r.j));
    check('depois de redefinir, o token antigo (de quem estava logado) cai: 401', (await http('GET', '/perfil', null, tRec)).s === 401);
    check('e a nova senha entra', !!(await login('cliente', email('cli2'), SENHA)));

    // administrador troca a senha do funcionário
    const tAdm = await login('administrador', email('adm'), SENHA);
    const tSub = await login('administrador', email('sub'), SENHA);
    check('funcionário entra (token válido)', (await http('GET', '/perfil', null, tSub)).s === 200);
    r = await http('PATCH', `/sub-administradores/${slug}/${sub.id}`, { senha: NOVA + 'x' }, tAdm);
    check('administrador troca a senha do funcionário: 200', r.s === 200);
    check('a sessão que o funcionário tinha cai: 401', (await http('GET', '/perfil', null, tSub)).s === 401);
    const tSub2 = await login('administrador', email('sub'), NOVA + 'x');
    check('com a senha nova ele entra de novo', !!tSub2);

    // ---------------------------------------------------------------- trocar e-mail exige a senha atual
    console.log('\n== Trocar o e-mail exige a senha atual ==');
    const tPa = await login('prestadora', email('pa'), SENHA);
    r = await http('POST', '/perfil/email/solicitar', { email: email('pa-novo') }, tPa);
    check('sem a senha atual: 401', r.s === 401, JSON.stringify(r.j));
    r = await http('POST', '/perfil/email/solicitar', { email: email('pa-novo'), senha_atual: 'errada-errada' }, tPa);
    check('com a senha errada: 401', r.s === 401);
    r = await http('POST', '/perfil/email/solicitar', { email: 'x@y.com,z@w.com', senha_atual: SENHA }, tPa);
    check('e-mail com vírgula: 400', r.s === 400);
    r = await http('POST', '/perfil/email/solicitar', { email: email('pa-novo'), senha_atual: SENHA }, tPa);
    check('com a senha certa: 200 (código enviado)', r.s === 200 && r.j.aguardandoConfirmacao === true, JSON.stringify(r.j));
    const { rows: [codEmail] } = await pool.query('select codigo from codigos_verificacao where destino = $1 and usado = false order by criado_em desc limit 1', [email('pa-novo')]);
    r = await http('POST', '/perfil/email/confirmar', { email: email('pa-novo'), codigo: codEmail.codigo }, tPa);
    check('confirmar o código SEM a senha atual: 401 (o código não é gasto)', r.s === 401);
    r = await http('POST', '/perfil/email/confirmar', { email: email('pa-novo'), codigo: codEmail.codigo, senha_atual: SENHA }, tPa);
    check('confirmar com a senha atual: e-mail trocado', r.s === 200 && r.j.email === email('pa-novo'), JSON.stringify(r.j).slice(0, 120));
    // chutar a senha tem teto por conta (5 erros); depois disso nem a certa passa
    const tPb = await login('prestadora', email('pb'), SENHA);
    let ultimo = 0;
    for (let i = 0; i < 6; i++) ultimo = (await http('POST', '/perfil/email/solicitar', { email: email('pb-novo'), senha_atual: 'chute' + i }, tPb)).s;
    check('depois de 5 senhas erradas a conta é travada por um tempo (429)', ultimo === 429, `HTTP ${ultimo}`);
    r = await http('POST', '/perfil/email/solicitar', { email: email('pb-novo'), senha_atual: SENHA }, tPb);
    check('…mesmo com a senha certa, enquanto durar o bloqueio', r.s === 429);

    // ---------------------------------------------------------------- foto de perfil
    console.log('\n== Foto de perfil ==');
    const tCliFoto = await login('cliente', email('cli'), SENHA);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    for (const [nome, foto] of [['texto depois do base64 (aspas e tag)', 'data:image/png;base64,AAAA"><script>alert(1)</script>'], ['fecha o url() do CSS', 'data:image/png;base64,AAAA);background:url(http://evil.test/x'], ['SVG', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='], ['não é texto', { a: 1 }], ['javascript:', 'javascript:alert(1)'], ['com espaço', 'data:image/png;base64,AA AA']]) {
      r = await http('PATCH', '/perfil', { foto }, tCliFoto);
      check(`foto recusada: ${nome} (400)`, r.s === 400, `HTTP ${r.s}`);
    }
    r = await http('PATCH', '/perfil', { foto: png }, tCliFoto);
    check('PNG de verdade em base64 continua valendo', r.s === 200 && r.j.foto === png);
    r = await http('PATCH', '/perfil', { foto: null }, tCliFoto);
    check('remover a foto continua valendo', r.s === 200 && r.j.foto === null);

    // ---------------------------------------------------------------- pedido público
    console.log('\n== Pedido público (sem login) ==');
    const pedido = (o) => http('POST', '/atendimentos', { unidade_slug: slug, tipo_servico: 'qa-seg-serv', data_atendimento: dia(10), ...o });
    check('data que não existe (30/02): 400', (await pedido({ data_atendimento: '2027-02-30' })).s === 400);
    check('data fora do formato: 400', (await pedido({ data_atendimento: '10/10/2027' })).s === 400);
    check('data absurda (ano 9999): 400', (await pedido({ data_atendimento: '9999-01-01' })).s === 400);
    check('serviço que não é texto (objeto): 400', (await pedido({ tipo_servico: { a: 1 } })).s === 400);
    check('serviço em branco: 400', (await pedido({ tipo_servico: '   ' })).s === 400);
    check('área que não é texto: 400', (await pedido({ area: 12345 })).s === 400);
    check('horário inválido (25:99): 400', (await pedido({ hora_atendimento: '25:99' })).s === 400);
    check('unidade que não é texto: 400', (await pedido({ unidade_slug: ['a'] })).s === 400);
    r = await pedido({ hora_atendimento: '10:30', cliente_nome: 'qa-seg Avulso', cliente_telefone: '(54) 9 9999-1111' });
    check('pedido válido: 201', r.s === 201, JSON.stringify(r.j).slice(0, 120));
    const avulsoId = r.j.cliente_id;
    r = await pedido({ cliente_nome: 'QA-SEG AVULSO' });
    check('o mesmo nome (sem conta) reaproveita o cliente avulso', r.s === 201 && r.j.cliente_id === avulsoId);
    r = await pedido({ cliente_nome: 'qa-seg-Cliente' }); // nome de um cliente que TEM conta
    const { rows: [ped] } = await pool.query('select cliente_id from atendimentos where id = $1', [r.j.id]);
    check('o nome de um cliente COM conta nunca cai na conta dele (cria um avulso)', r.s === 201 && ped.cliente_id !== cli.id && !!ped.cliente_id, `cliente_id=${ped.cliente_id}`);
    const tCliVe = await login('cliente', email('cli'), SENHA);
    const meus = await http('GET', '/atendimentos/cliente/me/atendimentos', null, tCliVe);
    check('e o pedido falso não aparece no histórico do cliente de verdade', meus.s === 200 && !meus.j.atendimentos.some(a => a.id === r.j.id));

    // ---------------------------------------------------------------- dados internos que não vazam pro cliente
    console.log('\n== O cliente não recebe dados internos da franquia ==');
    r = await http('GET', '/atendimentos/cliente/me/pendentes-avaliacao', null, tCliVe);
    const campos = Object.keys(r.j[0] || {}).sort().join(',');
    check('pendentes de avaliação: só os campos que a tela usa', r.s === 200 && campos === 'area,data_atendimento,hora_atendimento,id,prestadora_id,prestadora_nome,status,tipo_servico', campos);
    const texto = JSON.stringify(r.j);
    check('não vem valor pago à prestadora (77), nem repasse, nem código da planilha, nem unidade', !/valor_prestadora|repasse_pago_em|codigo_externo|orcamento|unidade_id|"valor"|situacao_manual/.test(texto), texto.slice(0, 200));
    check('traz o nome da prestadora (a tela mostra)', r.j.some(a => a.prestadora_nome === 'qa-seg-A'));

    // ---------------------------------------------------------------- avaliação em duplicidade
    console.log('\n== Avaliação: uma por atendimento ==');
    r = await http('POST', '/avaliacoes', { atendimento_id: concluido, nota: 5, comentario: 'ótimo' }, tCliVe);
    check('primeira avaliação: 201', r.s === 201, JSON.stringify(r.j));
    r = await http('POST', '/avaliacoes', { atendimento_id: concluido, nota: 1, comentario: 'de novo' }, tCliVe);
    check('segunda avaliação do mesmo atendimento: 409', r.s === 409, JSON.stringify(r.j));
    const { rows: [qtdAv] } = await pool.query('select count(*)::int as n from avaliacoes where atendimento_id = $1', [concluido]);
    check('só ficou uma no banco', qtdAv.n === 1);
    r = await http('POST', '/avaliacoes', { atendimento_id: concluidoSemPrest, nota: 5 }, tCliVe);
    check('atendimento sem prestadora não pode ser avaliado: 400', r.s === 400, JSON.stringify(r.j));
    r = await http('POST', '/avaliacoes', { atendimento_id: 'nao-e-uuid', nota: 5 }, tCliVe);
    check('id que não é UUID: 400', r.s === 400);
    r = await http('POST', '/avaliacoes', { atendimento_id: concluido, nota: 5, comentario: { x: 1 } }, tCliVe);
    check('comentário que não é texto: 400', r.s === 400);

    // ---------------------------------------------------------------- aceite de convite
    console.log('\n== Convite: só quem é dono dele aceita ==');
    const convite = await ins('proposto', pa.id, cli.id, dia(1));
    const tPaAtual = await login('prestadora', email('pa-novo'), SENHA); // o e-mail dela mudou acima: o login por e-mail novo
    const tPbDeNovo = await login('prestadora', email('pb'), SENHA);
    r = await http('POST', `/atendimentos/prestadora/me/${convite}/aceitar`, {}, tPbDeNovo);
    check('outra prestadora tentando aceitar convite que não é dela: 404', r.s === 404, JSON.stringify(r.j));
    r = await http('POST', `/atendimentos/prestadora/me/${convite}/aceitar`, {}, tPaAtual);
    check('a dona do convite aceita: 200', r.s === 200 && r.j.status === 'aceito', JSON.stringify(r.j));
    r = await http('POST', `/atendimentos/prestadora/me/${convite}/aceitar`, {}, tPaAtual);
    check('aceitar de novo o que já foi aceito: 404 (não está mais "proposto")', r.s === 404);

    // ---------------------------------------------------------------- telefone da unidade
    console.log('\n== Telefone da unidade (aparece no site público) ==');
    const tAdm2 = await login('administrador', email('adm'), SENHA);
    for (const t of ['<script>alert(1)</script>', 'abc', '123', '5'.repeat(40), '"><img src=x onerror=alert(1)>']) {
      r = await http('PATCH', `/unidades/${slug}/telefone`, { telefone: t }, tAdm2);
      check(`telefone recusado: "${t.slice(0, 24)}…" (400)`, r.s === 400, `HTTP ${r.s}`);
    }
    r = await http('PATCH', `/unidades/${slug}/telefone`, { telefone: '(54) 9 9999-0000' }, tAdm2);
    check('telefone de verdade: 200', r.s === 200 && r.j.telefone === '(54) 9 9999-0000');

    // ---------------------------------------------------------------- corpo grande sem login e id inválido
    console.log('\n== Corpo grande sem login, id inválido e erros de entrada ==');
    const grande = JSON.stringify({ arquivo_base64: 'A'.repeat(3 * 1024 * 1024) });
    let t0 = Date.now();
    r = await http('POST', `/atendimentos/admin/${slug}/importar`, grande, null);
    check('importar planilha SEM login: 401 (o corpo de vários MB nem é lido)', r.s === 401, `HTTP ${r.s}`);
    r = await http('PATCH', '/perfil', JSON.stringify({ foto: 'A'.repeat(3 * 1024 * 1024) }), null);
    check('foto de perfil SEM login: 401', r.s === 401);
    r = await http('PATCH', '/perfil', JSON.stringify({ foto: 'A'.repeat(3 * 1024 * 1024) }), tCliVe);
    check('foto acima de 2 MB COM login: 413', r.s === 413, `HTTP ${r.s}`);
    r = await http('POST', '/atendimentos', JSON.stringify({ unidade_slug: slug, tipo_servico: 'x'.repeat(200 * 1024), data_atendimento: dia(3) }));
    check('corpo de 200 KB numa rota comum: 413', r.s === 413, `HTTP ${r.s}`);
    r = await http('POST', `/atendimentos/admin/${slug}/nao-e-um-uuid/situacao`, { situacao: 'cancelado' }, tAdm2);
    check('id de atendimento que não é UUID: 400 (e não 500)', r.s === 400, `HTTP ${r.s}`);
    r = await http('GET', `/atendimentos/admin/${slug}/agenda?data=ontem`, null, tAdm2);
    check('data de agenda inválida: 400 (e não 500)', r.s === 400, `HTTP ${r.s}`);
    r = await http('PATCH', `/unidades/${slug}/admin/equipe/nao-e-uuid`, { valor_por_atendimento: 10 }, tAdm2);
    check('id de prestadora inválido: 400 (e não 500)', r.s === 400, `HTTP ${r.s}`);
    r = await http('POST', '/auth/login', '{ isto nao é json', null);
    check('JSON quebrado: 400', r.s === 400);

    // ---------------------------------------------------------------- bomba de zip
    console.log('\n== Planilha: bomba de zip ==');
    const bomba = zipDe('xl/worksheets/sheet1.xml', Buffer.alloc(200 * 1024 * 1024)); // ~200 MB de zeros que cabem em ~200 KB
    check('a bomba de brinquedo é pequena (cabe nos 6 MB aceitos)', bomba.length < 1024 * 1024, `${bomba.length} bytes`);
    r = await http('POST', `/atendimentos/admin/${slug}/importar`, { arquivo_base64: bomba.toString('base64') }, tAdm2);
    check('bomba de zip: 400 "grande demais" (sem derrubar a API)', r.s === 400 && /grande demais/.test(r.j.erro || ''), JSON.stringify(r.j).slice(0, 160));
    const mentirosa = zipDe('xl/worksheets/sheet1.xml', Buffer.alloc(200 * 1024 * 1024), 100); // o cabeçalho "diz" 100 bytes
    r = await http('POST', `/atendimentos/admin/${slug}/importar`, { arquivo_base64: mentirosa.toString('base64') }, tAdm2);
    check('zip que MENTE o tamanho no cabeçalho: também recusado', r.s === 400, JSON.stringify(r.j).slice(0, 160));
    r = await http('GET', '/auth/sessao', null, tAdm2);
    check('a API continua respondendo depois das bombas', r.s === 200);
    const modelo = Buffer.from(await gerarModeloImportacao());
    r = await http('POST', `/atendimentos/admin/${slug}/importar`, { arquivo_base64: modelo.toString('base64') }, tAdm2);
    check('o modelo .xlsx de verdade continua sendo lido (200)', r.s === 200 && r.j.confirmado === false, JSON.stringify(r.j).slice(0, 160));
    r = await http('POST', `/atendimentos/admin/${slug}/importar`, { arquivo_base64: Buffer.from('PK' + 'x'.repeat(200)).toString('base64') }, tAdm2);
    check('arquivo que começa com PK mas não é zip: 400', r.s === 400);

    // ---------------------------------------------------------------- login: tempo igual com e sem conta
    console.log('\n== Login: conta que não existe demora igual a senha errada ==');
    const mede = async (identificador) => { const t = Date.now(); const x = await http('POST', '/auth/login', { perfil: 'cliente', identificador, senha: 'senha-errada-123' }); return { ms: Date.now() - t, s: x.s }; };
    const comConta = [], semConta = [];
    for (let i = 0; i < 4; i++) { comConta.push(await mede(email('cli'))); semConta.push(await mede(`qa-seg-fantasma${i}-${sufixo}@teste.local`)); }
    if ([...comConta, ...semConta].some(x => x.s === 429)) console.log('  (pulado: o limite de tentativas de login já estourou nesta API de teste)');
    else {
      const mediana = (l) => l.map(x => x.ms).sort((a, b) => a - b)[Math.floor(l.length / 2)];
      const a = mediana(comConta), b = mediana(semConta);
      check(`tempo parecido: com conta ${a} ms × sem conta ${b} ms (a conta inexistente também gasta a comparação da senha)`, b >= 20 && b >= a * 0.5, `${a} × ${b}`);
    }

    // ---------------------------------------------------------------- limites (API isolada)
    console.log('\n== Limites de requisição (API própria na porta 3013) ==');
    ra = await subirApiIsolada(3013, { LIMITE_API: '120' });
    const B2 = 'http://localhost:3013/api';
    const emailAlvo = email('alvo');
    const codigos = [];
    for (let i = 0; i < 8; i++) codigos.push((await http('POST', '/auth/cadastro/cliente', { nome: 'QA Seg Teste', email: emailAlvo, senha: SENHA, unidade_slug: slug }, null, B2)).s);
    check('e-mail de cadastro: 6 pedidos por e-mail, o 7º em diante leva 429', codigos.slice(0, 6).every(s => s === 200) && codigos.slice(6).every(s => s === 429), codigos.join(','));
    r = await http('POST', '/auth/cadastro/cliente', { nome: 'QA Seg Teste', email: email('outro-alvo'), senha: SENHA, unidade_slug: slug }, null, B2);
    check('…mas outro e-mail, do mesmo IP, passa (o limite é por destinatário)', r.s === 200, `HTTP ${r.s}`);
    const conf = [];
    for (let i = 0; i < 12; i++) conf.push((await http('POST', '/auth/cadastro/cliente/confirmar', { nome: 'QA Seg Teste', email: email('chute'), senha: SENHA, unidade_slug: slug, codigo: String(100000 + i) }, null, B2)).s);
    check('chutar o código de um e-mail: 10 erros e o resto leva 429', conf.slice(0, 10).every(s => s === 400) && conf.slice(10).every(s => s === 429), conf.join(','));
    const ping = []; for (let i = 0; i < 60; i++) ping.push((await fetch(B2 + '/ping')).status);
    check('/api/ping (health check da hospedagem) nunca é limitado', ping.every(s => s === 200));
    const gerais = []; for (let i = 0; i < 160; i++) gerais.push((await fetch(B2 + '/unidades')).status);
    check('teto geral por IP: passa do limite (120/min nesta API de teste) e vem 429', gerais[0] === 200 && gerais.slice(-5).every(s => s === 429) && gerais.filter(s => s === 200).length > 60, `${gerais.filter(s => s === 200).length} × 200`);
    check('/api/ping continua livre mesmo depois do teto estourado', (await fetch(B2 + '/ping')).status === 200);
  } finally {
    if (ra) ra.kill();
    await limpar();
  }
  const { rows: [sobrou] } = await pool.query("select (select count(*) from unidades where slug like 'qa-seg-%') + (select count(*) from administradores where email like 'qa-seg-%') + (select count(*) from prestadoras where nome like 'qa-seg-%') + (select count(*) from clientes where nome ilike 'qa-seg%') as n");
  check('limpeza: nada de teste sobrou no banco', Number(sobrou.n) === 0, String(sobrou.n));

  console.log(`\n${falhas ? 'COM FALHAS' : 'TUDO CERTO'} — ${ok} ok, ${falhas} falha(s)`);
  await pool.end();
  process.exit(falhas ? 1 : 0);
})().catch(async (e) => { console.error('ERRO NO TESTE:', e); try { await limpar(); } catch { } process.exit(1); });
