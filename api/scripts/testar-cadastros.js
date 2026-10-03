// Uso: npm run teste:cadastros   (a API precisa estar rodando; API_URL muda o endereço)
//
// Teste de ponta a ponta do que mais importa: criar uma conta de CADA tipo
// (administrador, funcionário, prestadora, cliente) e conseguir entrar nela na
// hora; mais as falhas que antes travavam gente (código errado, telefone/CNPJ em
// outro formato, conta duplicada), a sincronização entre usuários e o limite de
// login. Lê os códigos de verificação direto do banco (em vez do e-mail) e
// apaga tudo que criou no final. Usa e-mails @qa.invalid, que não existem.
//
// Dica: pra não disparar e-mail de verdade durante o teste, suba a API de teste
// com os provedores zerados: SMTP_USER= SMTP_PASS= RESEND_API_KEY= npm start
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../src/db');

const BASE = (process.env.API_URL || 'http://localhost:3001') + '/api';
const id = Date.now().toString(36);
const emailQa = (nome) => `qa-${nome}-${id}@qa.invalid`;
const telefoneQa = (n) => '5499' + String(Date.now()).slice(-6) + n; // 54 + 99 + 6 dígitos + 1 = 11 dígitos

let falhas = 0;
function ok(condicao, descricao, extra = '') {
  console.log(`${condicao ? '  ok ' : ' FALHA'}  ${descricao}${extra ? '  ' + extra : ''}`);
  if (!condicao) falhas++;
}
async function http(metodo, rota, corpo, token) {
  const t0 = performance.now();
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ms: Math.round(performance.now() - t0) };
}
async function codigoDe(email) {
  const { rows: [r] } = await pool.query(
    'select codigo from codigos_verificacao where destino = $1 and usado = false order by criado_em desc limit 1', [email]);
  return r?.codigo;
}

(async () => {
  const criados = { admins: [], subs: [], prestadoras: [], clientes: [], emails: [] };
  console.log(`\nAPI em ${BASE}\n`);

  const saude = await http('GET', '/health');
  ok(saude.status === 200 && saude.json.banco === 'ok', 'API no ar e conectada ao banco', `(${saude.ms} ms)`);

  // ---------- ADMINISTRADOR ----------
  console.log('\nAdministrador');
  const adm = { nome: 'QA', sobrenome: 'Admin', email: emailQa('admin'), senha: 'senha-qa-123', cnpjs: ['12345678000190'] }; // CNPJ só com dígitos
  criados.emails.push(adm.email);
  const a1 = await http('POST', '/auth/cadastro/admin', adm);
  ok(a1.status === 200 && a1.json.aguardandoConfirmacao, 'pede código aceitando CNPJ sem pontuação', `(HTTP ${a1.status})`);
  const codAdm = await codigoDe(adm.email);
  const aErrado = await http('POST', '/auth/cadastro/admin/confirmar', { ...adm, codigo: '000000' });
  ok(aErrado.status === 400, 'código errado é recusado');
  const t0 = performance.now();
  const a2 = await http('POST', '/auth/cadastro/admin/confirmar', { ...adm, codigo: codAdm });
  ok(a2.status === 201 && a2.json.token, 'código certo cria a conta (mesmo depois de um erro antes)');
  if (a2.json.administrador) criados.admins.push(a2.json.administrador.id);
  const aLogin = await http('POST', '/auth/login', { perfil: 'administrador', identificador: adm.email.toUpperCase(), senha: adm.senha });
  const aPainel = await http('GET', '/unidades/carazinho/admin/dashboard', null, aLogin.json.token);
  ok(aLogin.status === 200 && aPainel.status === 200, 'entra e abre o painel logo em seguida',
    `(${Math.round(performance.now() - t0)} ms do código confirmado até o painel)`);
  const aRepetido = await http('POST', '/auth/cadastro/admin', adm);
  ok(aRepetido.status === 409, 'e-mail já cadastrado é recusado');
  const aCnpjRuim = await http('POST', '/auth/cadastro/admin', { ...adm, email: emailQa('admin2'), cnpjs: ['123'] });
  ok(aCnpjRuim.status === 400, 'CNPJ inválido é recusado com mensagem clara', `("${aCnpjRuim.json.erro}")`);

  // ---------- FUNCIONÁRIO ----------
  console.log('\nFuncionário (criado pelo administrador)');
  const tokenAdm = aLogin.json.token;
  const sub = { nome: 'QA', sobrenome: 'Func', email: emailQa('func'), senha: 'senha-qa-123', permissoes: { agenda: true } };
  const sFraca = await http('POST', '/sub-administradores/carazinho', { ...sub, senha: '1' }, tokenAdm);
  ok(sFraca.status === 400, 'senha de 1 caractere é recusada');
  const sEmailAdmin = await http('POST', '/sub-administradores/carazinho', { ...sub, email: adm.email }, tokenAdm);
  ok(sEmailAdmin.status === 409, 'e-mail que já é de administrador é recusado');
  const s1 = await http('POST', '/sub-administradores/carazinho', sub, tokenAdm);
  ok(s1.status === 201, 'cria o funcionário');
  if (s1.json.id) criados.subs.push(s1.json.id);
  const sLogin = await http('POST', '/auth/login', { perfil: 'administrador', identificador: sub.email, senha: sub.senha });
  const sAgenda = await http('GET', '/atendimentos/admin/carazinho/agenda', null, sLogin.json.token);
  const sEquipe = await http('GET', '/unidades/carazinho/admin/equipe', null, sLogin.json.token);
  ok(sLogin.status === 200 && sLogin.json.perfil === 'sub_administrador', 'entra logo em seguida como funcionário');
  ok(sAgenda.status === 200 && sEquipe.status === 403, 'vê a agenda mas não a equipe (permissão por módulo)');

  // ---------- PRESTADORA ----------
  console.log('\nPrestadora');
  const tel = telefoneQa(1);
  const prest = { nome: 'QA Prestadora', telefone: '+55 (' + tel.slice(0, 2) + ') ' + tel.slice(2), email: emailQa('prest'), senha: 'senha-qa-123', unidade_slug: 'carazinho' };
  criados.emails.push(prest.email);
  const pFone = await http('POST', '/auth/cadastro/prestadora', { ...prest, telefone: '123' });
  ok(pFone.status === 400, 'telefone inválido é recusado');
  const p1 = await http('POST', '/auth/cadastro/prestadora', prest);
  ok(p1.status === 200 && p1.json.aguardandoConfirmacao, 'pede código (telefone digitado com +55 e parênteses)');
  const p2 = await http('POST', '/auth/cadastro/prestadora/confirmar', { ...prest, codigo: await codigoDe(prest.email) });
  ok(p2.status === 201, 'confirma e cria a conta');
  if (p2.json.prestadora) criados.prestadoras.push(p2.json.prestadora.id);
  for (const [rotulo, ident] of [['telefone sem formatação', tel], ['telefone com +55', '+55' + tel], ['telefone formatado', `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`], ['e-mail', prest.email]]) {
    const l = await http('POST', '/auth/login', { perfil: 'prestadora', identificador: ident, senha: prest.senha });
    ok(l.status === 200, `entra logo em seguida por ${rotulo}`, `(${l.ms} ms)`);
  }
  const pLogin = await http('POST', '/auth/login', { perfil: 'prestadora', identificador: tel, senha: prest.senha });
  const pConvites = await http('GET', '/atendimentos/prestadora/me/convites', null, pLogin.json.token);
  ok(pConvites.status === 200, 'abre a área dela (convites)');

  // atomicidade: se a conta não puder ser criada, o código NÃO pode ser "gasto"
  const tel2 = telefoneQa(2);
  const prest2 = { ...prest, nome: 'QA Prestadora 2', telefone: tel2, email: emailQa('prest2') };
  criados.emails.push(prest2.email);
  await http('POST', '/auth/cadastro/prestadora', prest2);
  const codigo2 = await codigoDe(prest2.email);
  const { rows: [corrida] } = await pool.query(
    `insert into prestadoras (nome, telefone, senha_hash, unidade_id) select 'QA corrida', $1, 'x', id from unidades where slug='carazinho' returning id`, [tel2]);
  criados.prestadoras.push(corrida.id); // alguém pegou o telefone entre o pedido e a confirmação
  const p3 = await http('POST', '/auth/cadastro/prestadora/confirmar', { ...prest2, codigo: codigo2 });
  const { rows: [aposFalha] } = await pool.query('select usado from codigos_verificacao where destino = $1 and codigo = $2', [prest2.email, codigo2]);
  ok(p3.status === 409 && aposFalha.usado === false, 'telefone tomado no meio do caminho: 409 e o código continua válido (não é queimado)');

  // ---------- CLIENTE ----------
  console.log('\nCliente');
  const cli = { nome: 'QA Cliente', email: emailQa('cliente'), telefone: '(54) 99999-0000', senha: 'senha-qa-123', unidade_slug: 'carazinho' };
  criados.emails.push(cli.email);
  await http('POST', '/auth/cadastro/cliente', cli);
  const c2 = await http('POST', '/auth/cadastro/cliente/confirmar', { ...cli, codigo: await codigoDe(cli.email) });
  ok(c2.status === 201, 'pede código, confirma e cria a conta');
  if (c2.json.cliente) criados.clientes.push(c2.json.cliente.id);
  const cLogin = await http('POST', '/auth/login', { perfil: 'cliente', identificador: cli.email, senha: cli.senha });
  const cArea = await http('GET', '/atendimentos/cliente/me/pendentes-avaliacao', null, cLogin.json.token);
  ok(cLogin.status === 200 && cArea.status === 200, 'entra e abre a área dele logo em seguida');
  const cDup = await http('POST', '/auth/cadastro/cliente', cli);
  ok(cDup.status === 409, 'e-mail repetido é recusado');

  // ---------- SINCRONIZAÇÃO ENTRE USUÁRIOS ----------
  console.log('\nSincronização entre usuários');
  const sync = (token, q = '') => http('GET', '/sync' + q, null, token);
  const vPrest0 = (await sync(pLogin.json.token)).json.versao;
  const vAdmin0 = (await sync(tokenAdm, '?unidade=carazinho')).json.versao;
  const vCli0 = (await sync(cLogin.json.token)).json.versao;
  const criou = await http('POST', '/atendimentos/admin/carazinho', {
    tipo_servico: 'QA Teste', data_atendimento: '2026-12-15', hora_atendimento: '10:00', prestadora_id: p2.json.prestadora.id, cliente_id: c2.json.cliente.id,
  }, tokenAdm);
  ok(criou.status === 201, 'administrador cria um atendimento pra prestadora e o cliente');
  const vPrest1 = await sync(pLogin.json.token);
  const vAdmin1 = await sync(tokenAdm, '?unidade=carazinho');
  const vCli1 = await sync(cLogin.json.token);
  ok(vPrest1.json.versao !== vPrest0, 'a prestadora percebe a mudança (convite novo) na próxima checagem', `(${vPrest1.ms} ms)`);
  ok(vAdmin1.json.versao !== vAdmin0, 'o administrador percebe a mudança');
  ok(vCli1.json.versao !== vCli0, 'o cliente percebe a mudança');
  const vPrest2 = await sync(pLogin.json.token);
  ok(vPrest2.json.versao === vPrest1.json.versao, 'sem mudança nenhuma, a impressão não varia (não recarrega à toa)');
  const semAcesso = await sync(sLogin.json.token, '?unidade=panambi');
  ok(semAcesso.status === 403, 'funcionário não sincroniza uma unidade que não é a dele');

  // ---------- LIMITE DE LOGIN ----------
  console.log('\nLimite de tentativas de login');
  let bloqueouCerto = false;
  for (let i = 0; i < 12; i++) {
    const l = await http('POST', '/auth/login', { perfil: 'cliente', identificador: cli.email, senha: cli.senha });
    if (l.status === 429) bloqueouCerto = true;
  }
  ok(!bloqueouCerto, '12 logins CERTOS seguidos não são bloqueados (só tentativa errada conta)');
  let bloqueou = false;
  for (let i = 0; i < 12; i++) {
    const l = await http('POST', '/auth/login', { perfil: 'cliente', identificador: cli.email, senha: 'errada-errada' });
    if (l.status === 429) { bloqueou = true; ok(l.json.erro?.includes('Muitas tentativas'), 'a mensagem de bloqueio está em português'); break; }
  }
  ok(bloqueou, 'senha errada várias vezes na mesma conta é bloqueada');
  const outra = await http('POST', '/auth/login', { perfil: 'prestadora', identificador: tel, senha: prest.senha });
  ok(outra.status === 200, 'enquanto isso, OUTRA conta continua entrando normalmente');

  // ---------- LIMPEZA ----------
  await pool.query(`delete from atendimentos where tipo_servico = 'QA Teste'`);
  await pool.query('delete from sub_administradores where id = any($1::uuid[])', [criados.subs]);
  await pool.query('delete from administrador_unidades where administrador_id = any($1::uuid[])', [criados.admins]);
  await pool.query('delete from administradores where id = any($1::uuid[])', [criados.admins]);
  await pool.query('delete from prestadoras where id = any($1::uuid[])', [criados.prestadoras]);
  await pool.query('delete from clientes where id = any($1::uuid[])', [criados.clientes]);
  await pool.query('delete from codigos_verificacao where destino like $1', [`qa-%-${id}@qa.invalid`]);

  console.log(falhas === 0 ? '\nTudo certo — todas as verificações passaram.\n' : `\n${falhas} verificação(ões) FALHARAM.\n`);
  await pool.end();
  process.exit(falhas === 0 ? 0 : 1);
})().catch(async (erro) => {
  console.error('\nO teste quebrou:', erro.message);
  await pool.end().catch(() => {});
  process.exit(2);
});
