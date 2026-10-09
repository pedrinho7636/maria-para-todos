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
// com os provedores zerados e o limite de cadastro folgado (o teste faz dezenas de cadastros):
//   $env:SMTP_USER=''; $env:SMTP_PASS=''; $env:RESEND_API_KEY=''; $env:LIMITE_CADASTRO='1000'; npm start
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

  // ---------- ADMINISTRADOR: EMPRESA NOVA (CNPJ novo cria empresa + 1ª unidade) ----------
  console.log('\nAdministrador — CNPJ novo cria a empresa e a primeira unidade');
  const gerarCnpj = (base12) => { // calcula os dois dígitos verificadores
    const dv = (b) => { let s = 0, p = b.length - 7; for (const n of b) { s += Number(n) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    const d1 = dv(base12), d2 = dv(base12 + d1);
    return base12 + d1 + d2;
  };
  const formatar = (d) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  const base = String(Date.now()).slice(-8).padStart(8, '1');
  const cnpjEmpresa = formatar(gerarCnpj(base + '0001')), cnpjOutra = formatar(gerarCnpj(base + '0002'));
  const nomeUnA = `QA Cidade ${id}`;
  const adm = {
    nome: 'QA', sobrenome: 'Admin', email: emailQa('admin'), senha: 'senha-qa-123',
    cnpj: cnpjEmpresa.replace(/\D/g, ''), // só dígitos: a pontuação é opcional
    unidade: { nome: nomeUnA, uf: 'RS', telefone: '(54) 9 9999-0001', endereco: 'Rua QA, 1' },
  };
  criados.emails.push(adm.email);
  const a1 = await http('POST', '/auth/cadastro/admin', adm);
  ok(a1.status === 200 && a1.json.aguardandoConfirmacao && a1.json.novaEmpresa, 'CNPJ novo (sem pontuação) pede o código por e-mail', `(HTTP ${a1.status} ${a1.json.erro || ''})`);
  const codAdm = await codigoDe(adm.email);
  const aErrado = await http('POST', '/auth/cadastro/admin/confirmar', { ...adm, codigo: '000000' });
  ok(aErrado.status === 400, 'código errado é recusado');
  const t0 = performance.now();
  const a2 = await http('POST', '/auth/cadastro/admin/confirmar', { ...adm, codigo: codAdm });
  ok(a2.status === 201 && a2.json.token && a2.json.unidadeCriada?.slug, 'código certo cria a conta E a unidade (mesmo depois de um erro antes)', JSON.stringify(a2.json).slice(0, 160));
  if (a2.json.administrador) criados.admins.push(a2.json.administrador.id);
  const slugA = a2.json.unidadeCriada?.slug;
  const { rows: [uA] } = await pool.query('select cnpj, telefone, endereco, nome from unidades where slug = $1', [slugA]);
  ok(uA?.cnpj === cnpjEmpresa && uA.telefone === '(54) 9 9999-0001' && uA.endereco === 'Rua QA, 1' && uA.nome === nomeUnA, 'a unidade nasce com o CNPJ (formatado), telefone, endereço e nome informados', JSON.stringify(uA));
  const aLogin = await http('POST', '/auth/login', { perfil: 'administrador', identificador: adm.email.toUpperCase(), senha: adm.senha });
  const aPainel = await http('GET', `/unidades/${slugA}/admin/dashboard`, null, aLogin.json.token);
  ok(aLogin.status === 200 && aLogin.json.usuario.unidades_slugs?.includes(slugA) && aPainel.status === 200, 'entra e abre o painel da unidade logo em seguida',
    `(${Math.round(performance.now() - t0)} ms do código confirmado até o painel)`);
  const pub = await http('GET', '/unidades');
  ok(pub.json.some(u => u.slug === slugA && u.nome === nomeUnA), 'a unidade nova já aparece na lista pública (home e cadastros de cliente/prestadora)');

  const aRepetido = await http('POST', '/auth/cadastro/admin', { ...adm, cnpj: cnpjOutra });
  ok(aRepetido.status === 409, 'e-mail que já é de administrador não cria outra empresa (409)');
  const aCnpjRuim = await http('POST', '/auth/cadastro/admin', { ...adm, email: emailQa('admin2'), cnpj: '123' });
  ok(aCnpjRuim.status === 400, 'CNPJ com menos de 14 dígitos é recusado', `("${aCnpjRuim.json.erro}")`);
  const cnpjDvRuim = cnpjOutra.replace(/\d$/, d => String((Number(d) + 1) % 10));
  const aDv = await http('POST', '/auth/cadastro/admin', { ...adm, email: emailQa('admin3'), cnpj: cnpjDvRuim });
  ok(aDv.status === 400 && /inválido/.test(aDv.json.erro), 'CNPJ NOVO com dígito verificador errado é recusado', `("${aDv.json.erro}")`);
  const aUf = await http('POST', '/auth/cadastro/admin', { ...adm, email: emailQa('admin4'), cnpj: cnpjOutra, unidade: { ...adm.unidade, uf: 'XX' } });
  ok(aUf.status === 400 && /UF/.test(aUf.json.erro), 'UF inválida da unidade é recusada', `("${aUf.json.erro}")`);
  const aSemNome = await http('POST', '/auth/cadastro/admin', { ...adm, email: emailQa('admin5'), cnpj: cnpjOutra, unidade: { uf: 'RS' } });
  ok(aSemNome.status === 400, 'cadastro sem nome da unidade é recusado');
  const aTel = await http('POST', '/auth/cadastro/admin', { ...adm, email: emailQa('admin6'), cnpj: cnpjOutra, unidade: { ...adm.unidade, telefone: '123' } });
  ok(aTel.status === 400, 'telefone inválido da unidade é recusado');

  // ---------- ADMINISTRADOR: CNPJ QUE JÁ EXISTE (só o dono acrescenta unidade) ----------
  console.log('\nAdministrador — CNPJ que já existe: só o dono (nome + e-mail + senha) acrescenta unidade');
  const nomeUnB = `QA Filial ${id}`;
  const comoOutro = (extra) => ({ ...adm, unidade: { nome: nomeUnB, uf: 'RS' }, ...extra });
  const msgs = new Set();
  for (const [rotulo, corpo] of [
    ['senha errada', comoOutro({ senha: 'senha-errada-999' })],
    ['e-mail diferente', comoOutro({ email: emailQa('intruso') })],
    ['nome diferente', comoOutro({ nome: 'Outro' })],
    ['sobrenome diferente', comoOutro({ sobrenome: 'Outro' })],
  ]) {
    const r = await http('POST', '/auth/cadastro/admin', corpo);
    msgs.add(r.json.erro);
    ok(r.status === 403, `CNPJ existente + ${rotulo}: barrado (403)`, `(HTTP ${r.status})`);
  }
  ok(msgs.size === 1, 'a mensagem é sempre a mesma (não revela qual dado falhou)');
  const { rows: [semUnidadeNova] } = await pool.query('select count(*)::int as n from unidades where nome = $1', [nomeUnB]);
  ok(semUnidadeNova.n === 0, 'nenhuma unidade foi criada nessas tentativas');

  const e1 = await http('POST', '/auth/cadastro/admin', comoOutro({ unidade: { nome: nomeUnB, uf: 'RS', telefone: '(54) 9 9999-0002' } }));
  ok(e1.status === 201 && e1.json.token && e1.json.empresaExistente && e1.json.unidadeCriada?.nome === nomeUnB,
    'CNPJ existente + os mesmos nome, e-mail e senha do dono: acrescenta a unidade e já entra (sem código)', JSON.stringify(e1.json).slice(0, 160));
  const slugB = e1.json.unidadeCriada?.slug;
  const { rows: [uB] } = await pool.query('select cnpj from unidades where slug = $1', [slugB]);
  ok(uB?.cnpj === cnpjEmpresa, 'a unidade nova herda o CNPJ da empresa');
  const eDup = await http('POST', '/auth/cadastro/admin', comoOutro({ unidade: { nome: nomeUnB.toUpperCase(), uf: 'RS' } }));
  ok(eDup.status === 409 && /já tem uma unidade/.test(eDup.json.erro), 'nome de unidade repetido na mesma empresa é recusado (maiúscula/minúscula não importa)', `("${eDup.json.erro}")`);

  // alternar entre as unidades da mesma empresa com UM login
  const aLogin2 = await http('POST', '/auth/login', { perfil: 'administrador', identificador: adm.email, senha: adm.senha });
  const tokenAdm = aLogin2.json.token;
  ok(aLogin2.json.usuario.unidades_slugs?.length === 2 && aLogin2.json.usuario.unidades_slugs.includes(slugA) && aLogin2.json.usuario.unidades_slugs.includes(slugB), 'o login traz as duas unidades da empresa (dá pra alternar)');
  const pA = await http('GET', `/unidades/${slugA}/admin/dashboard`, null, tokenAdm);
  const pB = await http('GET', `/unidades/${slugB}/admin/dashboard`, null, tokenAdm);
  ok(pA.status === 200 && pB.status === 200, 'o mesmo login abre o painel das duas unidades');

  // adicionar unidade estando logado (Meu perfil → Adicionar unidade)
  const nomeUnC = `QA Terceira ${id}`;
  const add1 = await http('POST', '/unidades', { nome: nomeUnC, uf: 'sc', telefone: '(49) 9 9999-0003' }, tokenAdm);
  ok(add1.status === 201 && add1.json.unidade?.uf === 'SC' && add1.json.cnpj === cnpjEmpresa && add1.json.unidades_slugs.length === 3, 'logado, "Adicionar unidade" usa o CNPJ da própria empresa (UF maiúscula) e devolve as unidades', JSON.stringify(add1.json).slice(0, 160));
  const add2 = await http('POST', '/unidades', { nome: nomeUnC, uf: 'SC' }, tokenAdm);
  ok(add2.status === 409, 'adicionar unidade com nome repetido: 409');
  const add3 = await http('POST', '/unidades', { nome: 'Sem UF' }, tokenAdm);
  ok(add3.status === 400, 'adicionar unidade sem UF: 400');
  const addSemLogin = await http('POST', '/unidades', { nome: 'X', uf: 'RS' });
  ok(addSemLogin.status === 401, 'adicionar unidade sem estar logado: 401');
  const perfilAdm = await http('GET', '/perfil', null, tokenAdm);
  ok(perfilAdm.json.empresa?.cnpj === cnpjEmpresa && perfilAdm.json.empresa.unidades.length === 3, 'o perfil mostra o CNPJ da empresa e as 3 unidades');
  const corrAdd = await Promise.all([1, 2, 3].map(() => http('POST', '/unidades', { nome: `QA Corrida ${id}`, uf: 'RS' }, tokenAdm)));
  const resAdd = corrAdd.map(r => r.status).sort();
  ok(resAdd.filter(s => s === 201).length === 1 && resAdd.filter(s => s === 409).length === 2, 'três pedidos simultâneos da mesma unidade: só um cria (sem duplicar nome)', `(${resAdd.join(', ')})`);

  // outra empresa = outro login, sem acesso às unidades desta
  const empresaB = { nome: 'QA', sobrenome: 'Outra', email: emailQa('outra'), senha: 'senha-qa-123', cnpj: cnpjOutra, unidade: { nome: `QA Outra ${id}`, uf: 'PR' } };
  criados.emails.push(empresaB.email);
  await http('POST', '/auth/cadastro/admin', empresaB);
  const o2 = await http('POST', '/auth/cadastro/admin/confirmar', { ...empresaB, codigo: await codigoDe(empresaB.email) });
  ok(o2.status === 201, 'um CNPJ diferente cria uma EMPRESA separada, com login próprio');
  if (o2.json.administrador) criados.admins.push(o2.json.administrador.id);
  const oPainelA = await http('GET', `/unidades/${slugA}/admin/dashboard`, null, o2.json.token);
  ok(oPainelA.status === 403, 'o login da outra empresa NÃO abre as unidades desta');
  const oAdd = await http('POST', '/unidades', { nome: `QA Outra Filial ${id}`, uf: 'PR' }, o2.json.token);
  ok(oAdd.status === 201 && oAdd.json.cnpj === cnpjOutra, 'e "Adicionar unidade" dela usa o CNPJ dela, não o da primeira');

  // corrida no cadastro: dois cadastros simultâneos com o MESMO CNPJ novo — só um cria a empresa
  const cnpjCorr = formatar(gerarCnpj(base + '0003'));
  const corr1 = { nome: 'QA', sobrenome: 'Corr1', email: emailQa('corr1'), senha: 'senha-qa-123', cnpj: cnpjCorr, unidade: { nome: `QA Corr ${id}`, uf: 'RS' } };
  const corr2 = { ...corr1, sobrenome: 'Corr2', email: emailQa('corr2') };
  criados.emails.push(corr1.email, corr2.email);
  await Promise.all([http('POST', '/auth/cadastro/admin', corr1), http('POST', '/auth/cadastro/admin', corr2)]);
  const [cod1, cod2] = [await codigoDe(corr1.email), await codigoDe(corr2.email)];
  const corridaEmpresa = await Promise.all([
    http('POST', '/auth/cadastro/admin/confirmar', { ...corr1, codigo: cod1 }),
    http('POST', '/auth/cadastro/admin/confirmar', { ...corr2, codigo: cod2 }),
  ]);
  for (const r of corridaEmpresa) if (r.json.administrador) criados.admins.push(r.json.administrador.id);
  const resultados = corridaEmpresa.map(r => r.status).sort();
  ok(resultados[0] === 201 && resultados[1] === 409, 'duas confirmações simultâneas do mesmo CNPJ novo: uma cria a empresa, a outra é barrada', `(${resultados.join(' e ')})`);

  // limite de tentativas: chutar a senha do dono pelo cadastro conta como erro (por e-mail + IP)
  let travou = false;
  const alvo = { ...adm, email: emailQa('chute'), unidade: { nome: 'QA Chute', uf: 'RS' } };
  for (let i = 0; i < 12; i++) {
    const r = await http('POST', '/auth/cadastro/admin', { ...alvo, senha: 'chute-numero-' + i });
    if (r.status === 429) { travou = true; break; }
  }
  ok(travou, 'chutar a senha pelo cadastro de CNPJ existente é bloqueado depois de algumas tentativas (429)');

  // ---------- FUNCIONÁRIO ----------
  console.log('\nFuncionário (criado pelo administrador)');
  const sub = { nome: 'QA', sobrenome: 'Func', email: emailQa('func'), senha: 'senha-qa-123', permissoes: { agenda: true } };
  const sFraca = await http('POST', `/sub-administradores/${slugA}`, { ...sub, senha: '1' }, tokenAdm);
  ok(sFraca.status === 400, 'senha de 1 caractere é recusada');
  const sEmailAdmin = await http('POST', `/sub-administradores/${slugA}`, { ...sub, email: adm.email }, tokenAdm);
  ok(sEmailAdmin.status === 409, 'e-mail que já é de administrador é recusado');
  const s1 = await http('POST', `/sub-administradores/${slugA}`, sub, tokenAdm);
  ok(s1.status === 201, 'cria o funcionário');
  if (s1.json.id) criados.subs.push(s1.json.id);
  const sLogin = await http('POST', '/auth/login', { perfil: 'administrador', identificador: sub.email, senha: sub.senha });
  const sAgenda = await http('GET', `/atendimentos/admin/${slugA}/agenda`, null, sLogin.json.token);
  const sEquipe = await http('GET', `/unidades/${slugA}/admin/equipe`, null, sLogin.json.token);
  ok(sLogin.status === 200 && sLogin.json.perfil === 'sub_administrador', 'entra logo em seguida como funcionário');
  ok(sAgenda.status === 200 && sEquipe.status === 403, 'vê a agenda mas não a equipe (permissão por módulo)');
  // funcionário é POR UNIDADE: quem cuida da agenda de uma franquia não ganha acesso à outra do mesmo dono
  const sOutraUnidade = await http('GET', `/atendimentos/admin/${slugB}/agenda`, null, sLogin.json.token);
  ok(sOutraUnidade.status === 403, 'o funcionário de uma unidade NÃO enxerga a agenda de outra unidade da mesma empresa');
  const sFuncB = { ...sub, email: emailQa('funcb'), permissoes: { agenda: true, equipe: true } };
  const s2 = await http('POST', `/sub-administradores/${slugB}`, sFuncB, tokenAdm);
  ok(s2.status === 201, 'o administrador cria um funcionário SÓ da outra unidade, com outras permissões');
  if (s2.json.id) criados.subs.push(s2.json.id);
  const sListaA = await http('GET', `/sub-administradores/${slugA}`, null, tokenAdm);
  ok(sListaA.json.length === 1 && sListaA.json[0].email === sub.email, 'a lista de funcionários de cada unidade mostra só os dela');
  const sBLogin = await http('POST', '/auth/login', { perfil: 'administrador', identificador: sFuncB.email, senha: sFuncB.senha });
  const sBEquipeA = await http('GET', `/unidades/${slugA}/admin/equipe`, null, sBLogin.json.token);
  const sBEquipeB = await http('GET', `/unidades/${slugB}/admin/equipe`, null, sBLogin.json.token);
  ok(sBEquipeB.status === 200 && sBEquipeA.status === 403, 'o funcionário da unidade B vê a equipe de B e é barrado em A');

  // ---------- PRESTADORA ----------
  console.log('\nPrestadora');
  const tel = telefoneQa(1);
  const prest = { nome: 'QA Prestadora', telefone: '+55 (' + tel.slice(0, 2) + ') ' + tel.slice(2), email: emailQa('prest'), senha: 'senha-qa-123', unidade_slug: slugA };
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

  // ---------- PRESTADORA CADASTRADA PELO ADMINISTRADOR (aba Equipe) ----------
  console.log('\nPrestadora criada pelo administrador (aba Equipe)');
  const { rows: [uQa] } = await pool.query('select id from unidades where slug = $1', [slugA]);
  for (const [dia, nomeExt] of [['2026-12-01', 'JOANA D ARC'], ['2026-12-02', 'joana d arc'], ['2026-12-03', 'Outra Pessoa']]) {
    await pool.query(`insert into atendimentos (unidade_id, tipo_servico, data_atendimento, hora_atendimento, status, origem, profissional_externo) values ($1,'QA Teste',$2,'09:00','pedido','importacao',$3)`, [uQa.id, dia, nomeExt]);
  }
  const emailJoana = emailQa('joana'), telJoana = telefoneQa(7);
  const np1 = await http('POST', `/unidades/${slugA}/admin/equipe`, { nome: 'Joana D Arc', email: emailJoana, telefone: telJoana }, tokenAdm);
  ok(np1.status === 201 && np1.json.senha_provisoria?.length >= 8, 'cria a prestadora e devolve uma senha provisória gerada', JSON.stringify(np1.json).slice(0, 120));
  if (np1.json.prestadora) criados.prestadoras.push(np1.json.prestadora.id);
  ok(np1.json.atendimentos_ligados === 2, 'os atendimentos "sem cadastro" com o nome dela (maiúscula/minúscula não importa) foram ligados', JSON.stringify(np1.json));
  const { rows: ligados } = await pool.query(`select prestadora_id, profissional_externo, status from atendimentos where tipo_servico = 'QA Teste' and unidade_id = $1 order by data_atendimento`, [uQa.id]);
  ok(ligados[0].prestadora_id && ligados[0].profissional_externo === null && ligados[0].status === 'proposto' && !ligados[2].prestadora_id && ligados[2].profissional_externo === 'Outra Pessoa',
    'os ligados viram convite e perdem o nome provisório; o de outra pessoa continua sem cadastro');
  const lJ1 = await http('POST', '/auth/login', { perfil: 'prestadora', identificador: emailJoana, senha: np1.json.senha_provisoria });
  const lJ2 = await http('POST', '/auth/login', { perfil: 'prestadora', identificador: telJoana, senha: np1.json.senha_provisoria });
  ok(lJ1.status === 200 && lJ2.status === 200, 'ela entra com a senha provisória, por e-mail e por telefone');
  const convJ = await http('GET', '/atendimentos/prestadora/me/convites', null, lJ1.json.token);
  ok(convJ.json.length === 2, 'e já vê os convites ligados à conta dela');
  const npDup = await http('POST', `/unidades/${slugA}/admin/equipe`, { nome: 'Outra', email: emailJoana.toUpperCase() }, tokenAdm);
  ok(npDup.status === 409, 'e-mail de prestadora repetido é recusado');
  const npTelDup = await http('POST', `/unidades/${slugA}/admin/equipe`, { nome: 'Outra', telefone: telJoana }, tokenAdm);
  ok(npTelDup.status === 409, 'telefone repetido é recusado');
  const npSem = await http('POST', `/unidades/${slugA}/admin/equipe`, { nome: 'Sem Contato' }, tokenAdm);
  ok(npSem.status === 400, 'sem e-mail nem telefone é recusado');
  const npCurta = await http('POST', `/unidades/${slugA}/admin/equipe`, { nome: 'Senha Curta', email: emailQa('curta'), senha: '123' }, tokenAdm);
  ok(npCurta.status === 400, 'senha informada com menos de 8 caracteres é recusada');
  const npSenha = await http('POST', `/unidades/${slugA}/admin/equipe`, { nome: 'Com Senha', email: emailQa('comsenha'), senha: 'minha-senha-1' }, tokenAdm);
  ok(npSenha.status === 201 && npSenha.json.senha_provisoria === null, 'senha escolhida pelo administrador vale e não é devolvida de volta');
  if (npSenha.json.prestadora) criados.prestadoras.push(npSenha.json.prestadora.id);
  const npOutra = await http('POST', '/unidades/unidade-que-nao-e-dele/admin/equipe', { nome: 'Fora Daqui', email: emailQa('fora') }, tokenAdm);
  ok(npOutra.status === 403, 'unidade que não é do administrador: 403');
  const npPrest = await http('POST', `/unidades/${slugA}/admin/equipe`, { nome: 'Por Prestadora', email: emailQa('pp') }, lJ1.json.token);
  ok(npPrest.status === 403, 'uma prestadora não cria outras contas (403)');
  await pool.query(`delete from atendimentos where tipo_servico = 'QA Teste' and unidade_id = $1`, [uQa.id]);

  // ---------- SÉRIE SEMANAL UNIFICADA (vários dias + valor do mês + cliente novo) ----------
  console.log('\nAtendimento que se repete toda semana (terça e quinta, valor do mês inteiro)');
  const mesQ = new Date(); mesQ.setUTCMonth(mesQ.getUTCMonth() + 1, 1); // 1º dia do mês que vem
  const inicioSerie = mesQ.toISOString().slice(0, 10);
  const itensSerie = [2, 4].map(d => ({ dia_semana: d, hora_atendimento: '08:00', tipo_servico: 'QA Serie', duracao_horas: 3 }));
  const sr = await http('POST', `/atendimentos/admin/${slugA}/recorrente`, { data_inicio: inicioSerie, horizonte_meses: 1, itens: itensSerie, valor_mensal_total: '1000,00', cliente_novo: { nome: `QA Cliente Série ${id}`, telefone: '(54) 9 9999-0009' } }, tokenAdm);
  ok(sr.status === 201 && sr.json.quantidade_gerada >= 8, 'cria a série com terça e quinta', JSON.stringify(sr.json).slice(0, 120));
  const doMes1 = (sr.json.atendimentos || []).filter(a => String(a.data_atendimento).slice(0, 7) === inicioSerie.slice(0, 7));
  const somaMes1 = doMes1.reduce((s, a) => s + Math.round(Number(a.valor) * 100), 0);
  ok(somaMes1 === 100000, 'o valor do MÊS (R$ 1.000) é dividido entre todas as ocorrências do mês e a soma fecha exata', `(${doMes1.length} ocorrências somam ${somaMes1 / 100})`);
  ok((sr.json.atendimentos || []).every(a => Number(a.duracao_horas) === 3), 'a duração informada vale pra todas as ocorrências (antes a recorrência não guardava duração)');
  const { rows: cliSerie } = await pool.query(`select id from clientes where unidade_id = $1 and nome = $2`, [uQa.id, `QA Cliente Série ${id}`]);
  ok(cliSerie.length === 1 && (sr.json.atendimentos || []).every(a => a.cliente_id === cliSerie[0].id), 'o cliente novo foi criado UMA vez e ligado a todas as ocorrências');
  if (cliSerie[0]) criados.clientes.push(cliSerie[0].id);
  const srRuim = await http('POST', `/atendimentos/admin/${slugA}/recorrente`, { data_inicio: inicioSerie, itens: itensSerie, valor_mensal_total: 'abc' }, tokenAdm);
  ok(srRuim.status === 400, 'valor do mês inválido: 400');
  const srDur = await http('POST', `/atendimentos/admin/${slugA}/recorrente`, { data_inicio: inicioSerie, itens: itensSerie.map(i => ({ ...i, duracao_horas: 99 })) }, tokenAdm);
  ok(srDur.status === 400, 'duração absurda: 400');
  await pool.query(`delete from atendimentos where tipo_servico = 'QA Serie' and unidade_id = $1`, [uQa.id]);

  // ---------- PAINEL INICIAL POR UNIDADE ----------
  console.log('\nLayout do painel inicial (por unidade)');
  const pn0 = await http('GET', `/unidades/${slugA}/admin/painel`, null, tokenAdm);
  ok(pn0.status === 200 && pn0.json.ordem.length === 6 && pn0.json.ocultos.length === 0, 'sem nada salvo: padrão (6 atalhos, nada oculto)', JSON.stringify(pn0.json).slice(0, 100));
  const pn1 = await http('PUT', `/unidades/${slugA}/admin/painel`, { ordem: ['financeiro', 'agenda', 'equipe', 'clientes', 'avaliacoes', 'relatorios'], ocultos: ['relatorios', 'nps'] }, tokenAdm);
  ok(pn1.status === 200, 'administrador salva um layout');
  const pn2 = await http('GET', `/unidades/${slugA}/admin/painel`, null, tokenAdm);
  ok(pn2.json.ordem[0] === 'financeiro' && pn2.json.ocultos.includes('nps') && pn2.json.ocultos.includes('relatorios'), 'o layout salvo volta na próxima leitura');
  const pnB = await http('GET', `/unidades/${slugB}/admin/painel`, null, tokenAdm);
  ok(pnB.json.ordem[0] === 'agenda' && pnB.json.ocultos.length === 0, 'cada unidade tem o seu: a outra unidade da empresa continua no padrão');
  const pnRuim = await http('PUT', `/unidades/${slugA}/admin/painel`, { ordem: ['agenda', 'agenda'], ocultos: [] }, tokenAdm);
  ok(pnRuim.status === 400, 'atalho repetido: 400');
  const pnInv = await http('PUT', `/unidades/${slugA}/admin/painel`, { ordem: ['hackear'], ocultos: [] }, tokenAdm);
  ok(pnInv.status === 400, 'atalho inexistente: 400');
  const pnSub = await http('PUT', `/unidades/${slugA}/admin/painel`, { ordem: ['agenda'], ocultos: [] }, sLogin.json.token);
  ok(pnSub.status === 403, 'funcionário não altera o layout (403)');
  const pnEmpB = await http('PUT', `/unidades/${slugA}/admin/painel`, { ordem: ['agenda'], ocultos: [] }, empresaB.json?.token || o2.json.token);
  ok(pnEmpB.status === 403, 'administrador de OUTRA empresa não altera (403)');

  // ---------- MODELO E IMPORTAÇÃO DA PLANILHA (com Valor e Custo) ----------
  console.log('\nModelo e importação da planilha');
  const modelo = await fetch(BASE + `/atendimentos/admin/${slugA}/modelo-importacao`, { headers: { Authorization: 'Bearer ' + tokenAdm } });
  const bytesModelo = Buffer.from(await modelo.arrayBuffer());
  ok(modelo.status === 200 && /spreadsheetml/.test(modelo.headers.get('content-type')) && bytesModelo.subarray(0, 2).toString('latin1') === 'PK', 'baixa o modelo .xlsx de verdade (arquivo zip do Excel)');
  const modeloSemLogin = await fetch(BASE + `/atendimentos/admin/${slugA}/modelo-importacao`);
  ok(modeloSemLogin.status === 401, 'o modelo exige login');
  const importar = (corpo) => http('POST', `/atendimentos/admin/${slugA}/importar`, corpo, tokenAdm);
  const planilhaDe = async (linhas) => {
    const escreve = require('write-excel-file/node').default;
    const cab = ['Número', 'Data', 'Horário', 'Serviço', 'Tipo', 'Horas', 'Cliente', 'Profissionais', 'Situação', 'Valor', 'Custo'];
    return (await escreve([[...cab], ...linhas]).toBuffer()).toString('base64');
  };
  const nomeImp = `QA Importada ${id}`;
  const arq = await planilhaDe([
    [`QA-${id}-1`, '15/12/2026', '08:00', 'Limpeza', 'Comercial', 4, `QA Empresa ${id} | (54) 3333-4444`, nomeImp, 'Previsto', '600,00', '150,00'],
    [`QA-${id}-2`, '16/12/2026', '09:00', 'Passadoria', '', 2, `QA Empresa ${id}`, nomeImp, 'Concluído', 200, ''],
    [`EXEMPLO-${id}`, '17/12/2026', '10:00', 'Limpeza', 'Residencial', 3, 'Exemplo', 'Ninguém', 'Previsto', '', ''],
  ]);
  const imp0 = await importar({ arquivo_base64: arq });
  ok(imp0.status === 200 && imp0.json.resumo.novas === 2 && imp0.json.resumo.com_valor === 2 && imp0.json.resumo.com_custo === 1, 'pré-visualização: 2 novas (a linha EXEMPLO é ignorada), 2 com valor e 1 com custo', JSON.stringify(imp0.json.resumo).slice(0, 200));
  const imp1 = await importar({ arquivo_base64: arq, confirmar: true });
  ok(imp1.status === 200 && imp1.json.importados === 2 && imp1.json.prestadoras_criadas?.length === 1, 'confirma: importa 2 e cadastra a prestadora que não existia', JSON.stringify(imp1.json).slice(0, 160));
  const { rows: impBanco } = await pool.query(`select codigo_externo, valor, valor_prestadora, status, prestadora_id from atendimentos where unidade_id = $1 and codigo_externo like $2 order by codigo_externo`, [uQa.id, `QA-${id}-%`]);
  ok(Number(impBanco[0].valor) === 600 && Number(impBanco[0].valor_prestadora) === 150 && impBanco[0].status === 'proposto', 'Valor e Custo da planilha entram (valor 600; custo 150 vira o repasse combinado)', JSON.stringify(impBanco[0]));
  ok(Number(impBanco[1].valor) === 200 && impBanco[1].status === 'concluido' && impBanco[1].prestadora_id, 'a linha concluída entra com valor e ligada à prestadora');
  const { rows: prestImp } = await pool.query(`select id, email from prestadoras where unidade_id = $1 and nome = $2`, [uQa.id, nomeImp]);
  ok(prestImp.length === 1 && prestImp[0].email === `qaimportada${id}@gmail.com`, 'a prestadora da planilha nasce com e-mail nome@gmail.com', JSON.stringify(prestImp));
  if (prestImp[0]) criados.prestadoras.push(prestImp[0].id);
  const imp2 = await importar({ arquivo_base64: arq, confirmar: true });
  ok(imp2.json.importados === 0 && imp2.json.ja_existentes === 2, 'reimportar o mesmo arquivo não duplica nada');
  await pool.query(`delete from atendimentos where unidade_id = $1 and codigo_externo like $2`, [uQa.id, `QA-${id}-%`]);
  await pool.query(`delete from clientes where unidade_id = $1 and nome like $2`, [uQa.id, `QA Empresa ${id}%`]);

  // ---------- CLIENTE ----------
  console.log('\nCliente');
  const cli = { nome: 'QA Cliente', email: emailQa('cliente'), telefone: '(54) 99999-0000', senha: 'senha-qa-123', unidade_slug: slugA };
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
  const vAdmin0 = (await sync(tokenAdm, '?unidade=' + slugA)).json.versao;
  const vCli0 = (await sync(cLogin.json.token)).json.versao;
  const criou = await http('POST', `/atendimentos/admin/${slugA}`, {
    tipo_servico: 'QA Teste', data_atendimento: '2026-12-15', hora_atendimento: '10:00', prestadora_id: p2.json.prestadora.id, cliente_id: c2.json.cliente.id,
  }, tokenAdm);
  ok(criou.status === 201, 'administrador cria um atendimento pra prestadora e o cliente');
  const vPrest1 = await sync(pLogin.json.token);
  const vAdmin1 = await sync(tokenAdm, '?unidade=' + slugA);
  const vCli1 = await sync(cLogin.json.token);
  ok(vPrest1.json.versao !== vPrest0, 'a prestadora percebe a mudança (convite novo) na próxima checagem', `(${vPrest1.ms} ms)`);
  ok(vAdmin1.json.versao !== vAdmin0, 'o administrador percebe a mudança');
  ok(vCli1.json.versao !== vCli0, 'o cliente percebe a mudança');
  const vPrest2 = await sync(pLogin.json.token);
  ok(vPrest2.json.versao === vPrest1.json.versao, 'sem mudança nenhuma, a impressão não varia (não recarrega à toa)');
  const semAcesso = await sync(sLogin.json.token, '?unidade=' + slugB);
  ok(semAcesso.status === 403, 'funcionário não sincroniza uma unidade que não é a dele (mesmo sendo da mesma empresa)');

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
  await pool.query(`delete from administrador_unidades where unidade_id in (select id from unidades where cnpj = any($1::text[]))`, [[cnpjEmpresa, cnpjOutra, cnpjCorr]]);
  await pool.query('delete from unidades where cnpj = any($1::text[])', [[cnpjEmpresa, cnpjOutra, cnpjCorr]]);
  await pool.query('delete from codigos_verificacao where destino like $1', [`qa-%-${id}@qa.invalid`]);

  console.log(falhas === 0 ? '\nTudo certo — todas as verificações passaram.\n' : `\n${falhas} verificação(ões) FALHARAM.\n`);
  await pool.end();
  process.exit(falhas === 0 ? 0 : 1);
})().catch(async (erro) => {
  console.error('\nO teste quebrou:', erro.message);
  await pool.end().catch(() => {});
  process.exit(2);
});
