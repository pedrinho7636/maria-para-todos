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

  // ---------- ADMINISTRADOR COM CNPJ NOVO ----------
  // Unidades de teste (sem administrador), pra não mexer nas unidades reais.
  console.log('\nAdministrador com CNPJ novo (assume uma unidade livre)');
  const gerarCnpj = (base12) => { // calcula os dois dígitos verificadores
    const dv = (b) => { let s = 0, p = b.length - 7; for (const n of b) { s += Number(n) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    const d1 = dv(base12), d2 = dv(base12 + d1);
    return base12 + d1 + d2;
  };
  const formatar = (d) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  const novaUnidade = async (sufixo) => {
    const slug = `qa-un-${id}-${sufixo}`;
    await pool.query(`insert into unidades (slug, nome, uf, cnpj, telefone, endereco, endereco_curto) values ($1, $2, 'RS', '00.000.000/0000-00', '(00) 0 0000-0000', null, null)`, [slug, `QA Unidade ${sufixo}`]);
    return slug;
  };
  const slugA = await novaUnidade('a'), slugB = await novaUnidade('b');
  const base = String(Date.now()).slice(-8).padStart(8, '1');
  const cnpjA = gerarCnpj(base + '0001'), cnpjB = gerarCnpj(base + '0002');
  const admNovo = (nome, extra = {}) => ({ nome: 'QA', sobrenome: nome, email: emailQa(nome), senha: 'senha-qa-123', ...extra });

  const n1 = admNovo('novo1', { cnpjs: [formatar(cnpjA)], unidades: [slugA] });
  criados.emails.push(n1.email);
  const n1a = await http('POST', '/auth/cadastro/admin', n1);
  ok(n1a.status === 200 && n1a.json.cnpjNovo === formatar(cnpjA) && n1a.json.unidades?.[0]?.slug === slugA,
    'CNPJ novo + unidade livre marcada: aceita e avisa qual CNPJ vai valer', `(HTTP ${n1a.status} ${n1a.json.erro || ''})`);
  const n1b = await http('POST', '/auth/cadastro/admin/confirmar', { ...n1, codigo: await codigoDe(n1.email) });
  ok(n1b.status === 201 && n1b.json.token, 'confirma o código e a conta é criada');
  if (n1b.json.administrador) criados.admins.push(n1b.json.administrador.id);
  const { rows: [uA] } = await pool.query('select cnpj from unidades where slug = $1', [slugA]);
  ok(uA.cnpj === formatar(cnpjA), 'o CNPJ digitado passou a ser o CNPJ da unidade', `(${uA.cnpj})`);
  const n1login = await http('POST', '/auth/login', { perfil: 'administrador', identificador: n1.email, senha: n1.senha });
  const n1painel = await http('GET', `/unidades/${slugA}/admin/dashboard`, null, n1login.json.token);
  ok(n1login.status === 200 && n1login.json.usuario.unidades_slugs?.includes(slugA) && n1painel.status === 200, 'entra e abre o painel da unidade assumida');

  // a unidade agora TEM dono: ninguém assume com outro CNPJ
  const n2 = admNovo('novo2', { cnpjs: [formatar(cnpjB)], unidades: [slugA] });
  criados.emails.push(n2.email);
  const n2a = await http('POST', '/auth/cadastro/admin', n2);
  ok(n2a.status === 409 && /já tem administrador/.test(n2a.json.erro), 'unidade que já tem administrador NÃO é assumida com CNPJ novo', `("${n2a.json.erro}")`);
  const n2b = await http('POST', '/auth/cadastro/admin', { ...n2, unidades: [] });
  ok(n2b.status === 400 && /marque a unidade/.test(n2b.json.erro), 'CNPJ novo sem marcar unidade: mensagem diz o que fazer', `("${n2b.json.erro}")`);
  const takeover = await http('POST', '/auth/cadastro/admin', { ...n2, unidades: ['carazinho'] });
  ok(takeover.status === 409, 'tentativa de tomar a unidade Carazinho (que tem dono) com CNPJ novo é barrada');

  // o administrador dono, ou quem digita o CNPJ já cadastrado dela, segue funcionando como antes
  const n3 = admNovo('novo3', { cnpjs: [formatar(cnpjA)] });
  criados.emails.push(n3.email);
  const n3a = await http('POST', '/auth/cadastro/admin', n3);
  ok(n3a.status === 200 && n3a.json.unidades?.some(u => u.slug === slugA) && !n3a.json.cnpjNovo, 'CNPJ já cadastrado na unidade segue vinculando (caminho de sempre)');

  // validações do CNPJ novo
  const cnpjRuim = cnpjB.slice(0, 13) + String((Number(cnpjB[13]) + 1) % 10);
  const n4 = await http('POST', '/auth/cadastro/admin', admNovo('novo4', { cnpjs: [cnpjRuim], unidades: [slugB] }));
  ok(n4.status === 400 && /inválido/.test(n4.json.erro), 'CNPJ novo com dígito verificador errado é recusado', `("${n4.json.erro}")`);
  const n5 = await http('POST', '/auth/cadastro/admin', admNovo('novo5', { cnpjs: [formatar(cnpjB), formatar(gerarCnpj(base + '0003'))], unidades: [slugB] }));
  ok(n5.status === 400 && /único CNPJ novo/.test(n5.json.erro), 'dois CNPJs novos de uma vez: pede um só', `("${n5.json.erro}")`);
  const n6 = await http('POST', '/auth/cadastro/admin', admNovo('novo6', { cnpjs: [formatar(cnpjB)], unidades: ['qa-nao-existe'] }));
  ok(n6.status === 400 && /inexistente/.test(n6.json.erro), 'unidade inexistente é recusada');

  // corrida: dois cadastros ao mesmo tempo pela MESMA unidade livre — só um assume
  const corr1 = admNovo('corr1', { cnpjs: [formatar(cnpjB)], unidades: [slugB] });
  const corr2 = admNovo('corr2', { cnpjs: [formatar(cnpjB)], unidades: [slugB] });
  criados.emails.push(corr1.email, corr2.email);
  await Promise.all([http('POST', '/auth/cadastro/admin', corr1), http('POST', '/auth/cadastro/admin', corr2)]);
  const [cod1, cod2] = [await codigoDe(corr1.email), await codigoDe(corr2.email)];
  const corridaUnidade = await Promise.all([
    http('POST', '/auth/cadastro/admin/confirmar', { ...corr1, codigo: cod1 }),
    http('POST', '/auth/cadastro/admin/confirmar', { ...corr2, codigo: cod2 }),
  ]);
  for (const r of corridaUnidade) if (r.json.administrador) criados.admins.push(r.json.administrador.id);
  const resultados = corridaUnidade.map(r => r.status).sort();
  ok(resultados[0] === 201 && resultados[1] === 409, 'duas confirmações simultâneas pela mesma unidade livre: uma assume, a outra é barrada', `(${resultados.join(' e ')})`);

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
  await pool.query(`delete from administrador_unidades where unidade_id in (select id from unidades where slug like 'qa-un-%')`);
  await pool.query(`delete from unidades where slug like 'qa-un-%'`);
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
