// Uso: npm run teste:agenda   (a API precisa estar rodando; API_URL muda o endereço)
//
// Teste de ponta a ponta da agenda entre os perfis: CNPJ (inclusive alfanumérico), conflitos de horário da prestadora,
// aviso de cancelamento, recusas que ficam no atendimento, calendário da prestadora, atendimentos do cliente,
// convite de cadastro e substituição de perfil provisório. Cria tudo com e-mails @qa.invalid e apaga no final.
//
// Suba a API de teste com os provedores de e-mail zerados (senão ele tenta mandar e-mail de verdade):
//   $env:SMTP_USER=''; $env:SMTP_PASS=''; $env:RESEND_API_KEY=''; $env:LIMITE_CADASTRO='1000'; $env:PORT='3011'; npm start
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../src/db');

const BASE = (process.env.API_URL || 'http://localhost:3001') + '/api';
const id = Date.now().toString(36);
const idU = id.charAt(0).toUpperCase() + id.slice(1);
const emailQa = (nome) => `qa-${nome}-${id}@qa.invalid`;
const telQa = (n) => '5498' + String(Date.now()).slice(-6) + n;

let falhas = 0;
function ok(condicao, descricao, extra = '') {
  console.log(`${condicao ? '  ok ' : ' FALHA'}  ${descricao}${extra ? '  ' + extra : ''}`);
  if (!condicao) falhas++;
}
async function http(metodo, rota, corpo, token) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const codigoDe = async (email) => (await pool.query('select codigo from codigos_verificacao where destino = $1 and usado = false order by criado_em desc limit 1', [email])).rows[0]?.codigo;
const gerarCnpj = (base12) => {
  const dv = (b) => { let s = 0, p = b.length - 7; for (const c of b) { s += (c.charCodeAt(0) - 48) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base12), d2 = dv(base12 + d1);
  return base12 + d1 + d2;
};

(async () => {
  console.log(`\nAPI em ${BASE}\n`);
  const unidadesCriadas = [];

  // ---------- 1. CNPJ ----------
  console.log('CNPJ: qualquer CNPJ válido (com ou sem pontuação, numérico ou alfanumérico)');
  const mk = (n, cnpj, uni) => ({ nome: 'QA', sobrenome: 'Agenda', email: emailQa(n), senha: 'senha-qa-123', cnpj, unidade: { nome: `QA ${uni} ${idU}`, uf: 'RS', telefone: '(54) 9 9999-0001' } });
  // 12.ABC.345/01DE-35 é o exemplo oficial da Receita (CNPJ alfanumérico)
  const alfa = await http('POST', '/auth/cadastro/admin', mk('alfa', '12ABC34501DE35', 'Alfa'));
  ok(alfa.status === 200 && alfa.json.novaEmpresa, 'CNPJ alfanumérico oficial (12.ABC.345/01DE-35), sem pontuação, é aceito', `(HTTP ${alfa.status} ${alfa.json.erro || ''})`);
  const alfaPont = await http('POST', '/auth/cadastro/admin', { ...mk('alfa2', '12.abc.345/01de-35', 'Alfa2') });
  ok(alfaPont.status === 200, 'o mesmo CNPJ com pontuação e em minúsculas também (é normalizado)', `(HTTP ${alfaPont.status})`);
  const alfaErrado = await http('POST', '/auth/cadastro/admin', mk('alfa3', '12ABC34501DE36', 'Alfa3'));
  ok(alfaErrado.status === 400 && /verificadores/.test(alfaErrado.json.erro), 'dígito verificador errado no alfanumérico: recusado com mensagem clara', `("${alfaErrado.json.erro}")`);
  for (const real of ['33.000.167/0001-01', '60.746.948/0001-12', '07.526.557/0001-00', '29.931.382/0001-59']) {
    const r = await http('POST', '/auth/cadastro/admin', mk('real' + real.slice(0, 2), real, 'Real'));
    ok(r.status === 200, `CNPJ real ${real} é aceito (não só um CNPJ específico)`, `(HTTP ${r.status} ${r.json.erro || ''})`);
  }
  let aleatorios = 0;
  for (let i = 0; i < 2000; i++) {
    const base = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
    const c = gerarCnpj(base);
    if (!/^(\d)\1+$/.test(c) && require('../src/utils/normalizacao').cnpjValido(c)) aleatorios++;
    else if (!/^(\d)\1+$/.test(c)) { aleatorios = -99999; break; }
  }
  ok(aleatorios > 1900, 'o validador aceita os CNPJs numéricos válidos sorteados (2.000 testados)', `(${aleatorios})`);

  // empresa de verdade pro resto do teste (CNPJ alfanumérico: confirma e usa)
  const confirma = await http('POST', '/auth/cadastro/admin/confirmar', { ...mk('alfa', '12ABC34501DE35', 'Alfa'), codigo: await codigoDe(emailQa('alfa')) });
  ok(confirma.status === 201 && confirma.json.unidadeCriada?.slug, 'confirma o código e cria a empresa com o CNPJ alfanumérico', JSON.stringify(confirma.json).slice(0, 100));
  const slug = confirma.json.unidadeCriada.slug;
  unidadesCriadas.push(slug);
  const tokenAdm = confirma.json.token;
  const { rows: [uni] } = await pool.query('select id, cnpj from unidades where slug = $1', [slug]);
  ok(uni.cnpj === '12.ABC.345/01DE-35', 'o CNPJ fica gravado formatado (12.ABC.345/01DE-35)', uni.cnpj);
  const dono = await http('POST', '/auth/cadastro/admin', { ...mk('intruso', '12.ABC.345/01DE-35', 'Filial') });
  ok(dono.status === 403, 'o mesmo CNPJ (agora existente), digitado com outra pontuação, é reconhecido como já cadastrado (403 pra quem não é o dono)', `(HTTP ${dono.status})`);

  // ---------- cenário ----------
  const { rows: [{ hoje }] } = await pool.query(`select (now() at time zone 'America/Sao_Paulo')::date::text as hoje`);
  const soma = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const naoDomingo = (iso) => { let d = iso; while (new Date(d + 'T00:00:00Z').getUTCDay() === 0) d = soma(d, 1); return d; };
  const D = (() => { const a = soma(hoje, 1); return new Date(a + 'T00:00:00Z').getUTCDay() === 0 ? soma(hoje, 2) : a; })(); // dentro da janela de 2 dias, sem ser domingo
  const futuro = naoDomingo(soma(hoje, 20));

  const novaPrest = async (nome, n) => {
    const r = await http('POST', `/unidades/${slug}/admin/equipe`, { nome, email: emailQa(n), telefone: telQa(n === 'pa' ? 1 : 2) }, tokenAdm);
    const l = await http('POST', '/auth/login', { perfil: 'prestadora', identificador: emailQa(n), senha: r.json.senha_provisoria });
    return { id: r.json.prestadora?.id, token: l.json.token };
  };
  const A = await novaPrest('QA Ana', 'pa'), B = await novaPrest('QA Bia', 'pb');
  ok(A.id && A.token && B.id && B.token, 'cria duas prestadoras (Ana e Bia) e entra com elas');
  const atd = (extra = {}, token = tokenAdm) => http('POST', `/atendimentos/admin/${slug}`, { tipo_servico: 'QA Agenda', data_atendimento: D, hora_atendimento: '09:00', duracao_horas: 2, cliente_novo: { nome: `QA Cliente ${idU}`, telefone: '(54) 9 9111-2222' }, ...extra }, token);

  // ---------- 3. conflitos de horário ----------
  console.log('\nConflitos de horário');
  const a1 = await atd({ prestadora_id: A.id });
  ok(a1.status === 201 && a1.json.status === 'proposto', 'convite pra Ana, 09:00–11:00');
  const a2 = await atd({ prestadora_id: A.id, hora_atendimento: '10:00', duracao_horas: 1 });
  ok(a2.status === 409 && a2.json.codigo === 'CONFLITO_HORARIO' && a2.json.conflitos?.length === 1, 'outro convite pra Ana 10:00–11:00 (sobreposição) avisa o administrador: 409 CONFLITO_HORARIO', `(HTTP ${a2.status})`);
  ok(/Atribuir mesmo assim/.test(a2.json.erro || ''), 'a mensagem pergunta se quer atribuir mesmo assim', `("${(a2.json.erro || '').slice(0, 90)}…")`);
  const { rows: [semGravar] } = await pool.query(`select count(*)::int as n from atendimentos where unidade_id = $1 and hora_atendimento = '10:00'`, [uni.id]);
  ok(semGravar.n === 0, 'enquanto o administrador não confirma, nada é gravado');
  const a2b = await atd({ prestadora_id: A.id, hora_atendimento: '10:00', duracao_horas: 1, forcar_conflito: true });
  ok(a2b.status === 201, 'confirmando "mesmo assim", o convite é criado');
  const a3 = await atd({ prestadora_id: A.id, hora_atendimento: '11:00', duracao_horas: 1 });
  ok(a3.status === 201, 'um atendimento que começa exatamente quando o outro termina (11:00) NÃO conflita');
  const a4 = await atd({ prestadora_id: A.id, hora_atendimento: '08:30', duracao_horas: 0.5 });
  ok(a4.status === 201, 'um que termina exatamente quando o outro começa (08:30–09:00) também não');
  const a5 = await atd({ prestadora_id: A.id, hora_atendimento: '08:30', duracao_horas: 1 });
  ok(a5.status === 409, 'sobreposição parcial (08:30–09:30 invade o das 09:00) conflita');
  const hInvalida = await atd({ hora_atendimento: '25:00' });
  ok(hInvalida.status === 400, 'horário fora de 24 h (25:00) é recusado');
  const hAmPm = await atd({ hora_atendimento: '9:00 PM' });
  ok(hAmPm.status === 400, 'horário com AM/PM é recusado — só formato 24 h');
  const hOk = await atd({ hora_atendimento: '22:00', duracao_horas: 1 });
  ok(hOk.status === 201, 'horário 22:00 (24 h) é aceito');

  const convA = await http('GET', '/atendimentos/prestadora/me/convites', null, A.token);
  const i1 = convA.json.find(x => x.id === a1.json.id), i2 = convA.json.find(x => x.id === a2b.json.id), i3 = convA.json.find(x => x.id === a3.json.id);
  ok(i1?.conflitos.length === 1 && i1.conflitos[0].id === a2b.json.id && i2?.conflitos.length === 1, 'na lista da prestadora, os dois que se sobrepõem vêm marcados (cada um aponta o outro)');
  ok(i3?.conflitos.length === 0 && i1.hora_fim === '11:00' && i1.cliente_nome === `QA Cliente ${idU}`, 'o que não conflita vem sem marcação; cada item traz horário de término e cliente', JSON.stringify({ fim: i1?.hora_fim, c: i1?.cliente_nome }));
  const aceita1 = await http('POST', `/atendimentos/prestadora/me/${a1.json.id}/aceitar`, null, A.token);
  ok(aceita1.status === 200, 'Ana aceita o das 09:00');
  const aceita2 = await http('POST', `/atendimentos/prestadora/me/${a2b.json.id}/aceitar`, null, A.token);
  ok(aceita2.status === 409 && aceita2.json.codigo === 'CONFLITO_HORARIO', 'e NÃO consegue confirmar o das 10:00: já tem um confirmado nesse horário (409)', `("${(aceita2.json.erro || '').slice(0, 80)}…")`);
  const aceita3 = await http('POST', `/atendimentos/prestadora/me/${a3.json.id}/aceitar`, null, A.token);
  ok(aceita3.status === 200, 'o das 11:00 (sem sobreposição) ela confirma normalmente');

  // série com conflito
  const dSerie = new Date(D + 'T00:00:00Z').getUTCDay();
  const corpoSerie = { data_inicio: D, horizonte_meses: 1, itens: [{ dia_semana: dSerie, hora_atendimento: '09:30', tipo_servico: 'QA Serie Agenda', duracao_horas: 1, prestadora_id: A.id }] };
  const serie1 = await http('POST', `/atendimentos/admin/${slug}/recorrente`, corpoSerie, tokenAdm);
  ok(serie1.status === 409 && serie1.json.codigo === 'CONFLITO_HORARIO' && serie1.json.atendimentos_em_conflito >= 1, 'série que cai em horário já ocupado da prestadora avisa antes de criar', `(HTTP ${serie1.status})`);
  const { rows: [serieGravada] } = await pool.query(`select count(*)::int as n from atendimentos where unidade_id = $1 and tipo_servico = 'QA Serie Agenda'`, [uni.id]);
  ok(serieGravada.n === 0, 'e não deixa nada pela metade (transação desfeita)');
  const serie2 = await http('POST', `/atendimentos/admin/${slug}/recorrente`, { ...corpoSerie, forcar_conflito: true }, tokenAdm);
  ok(serie2.status === 201 && serie2.json.quantidade_gerada >= 1, 'confirmando, a série é criada');

  // ---------- 5. calendário da prestadora ----------
  console.log('\nCalendário da prestadora');
  const mesD = D.slice(0, 7);
  const cal = await http('GET', `/atendimentos/prestadora/me/calendario?mes=${mesD}`, null, A.token);
  const doDia = (cal.json || []).filter(x => x.dia === D);
  ok(cal.status === 200 && doDia.length >= 4, 'o calendário traz tudo dela no mês (convites, confirmados...)', `(${doDia.length} no dia)`);
  const c1 = doDia.find(x => x.id === a1.json.id);
  ok(c1 && c1.cliente_nome && c1.hora_atendimento.slice(0, 5) === '09:00' && c1.hora_fim === '11:00' && c1.tipo_servico && c1.status === 'aceito', 'cada atendimento do dia traz cliente, início, término, serviço e status');
  const calB = await http('GET', `/atendimentos/prestadora/me/calendario?mes=${mesD}`, null, B.token);
  ok(calB.status === 200 && calB.json.every(x => x.id !== a1.json.id), 'outra prestadora NÃO vê os atendimentos da Ana (só os dela)');
  const calRuim = await http('GET', '/atendimentos/prestadora/me/calendario?mes=2026-13', null, A.token);
  ok(calRuim.status === 400, 'mês inválido: 400');
  const calSemLogin = await http('GET', `/atendimentos/prestadora/me/calendario?mes=${mesD}`);
  const calAdmin = await http('GET', `/atendimentos/prestadora/me/calendario?mes=${mesD}`, null, tokenAdm);
  ok(calSemLogin.status === 401 && calAdmin.status === 403, 'sem login (401) e administrador (403) não usam o calendário da prestadora');

  // ---------- 6. recusas ----------
  console.log('\nRecusas ficam no atendimento');
  const r1 = await atd({ prestadora_id: B.id, hora_atendimento: '15:00', duracao_horas: 1 });
  ok(r1.status === 201, 'convite pra Bia, 15:00');
  const rec = await http('POST', `/atendimentos/prestadora/me/${r1.json.id}/recusar`, null, B.token);
  ok(rec.status === 200 && rec.json.status === 'recusado', 'Bia recusa');
  const ag1 = await http('GET', `/atendimentos/admin/${slug}/agenda?data=${D}`, null, tokenAdm);
  const linhaR = ag1.json.find(x => x.id === r1.json.id);
  ok(linhaR && linhaR.status === 'recusado' && linhaR.prestadora_id === null && linhaR.recusas.length === 1 && linhaR.recusas[0].nome === 'QA Bia', 'o administrador vê na agenda QUEM recusou (QA Bia)', JSON.stringify(linhaR?.recusas));
  const reB = await http('POST', `/atendimentos/admin/${slug}/${r1.json.id}/reatribuir`, { prestadora_id: B.id }, tokenAdm);
  ok(reB.status === 409 && reB.json.codigo === 'JA_RECUSOU' && /já recusou/.test(reB.json.erro), 'tentar enviar de novo pra Bia avisa que ela já recusou (409 JA_RECUSOU)', `("${(reB.json.erro || '').slice(0, 70)}…")`);
  const proporB = await http('POST', `/atendimentos/admin/${slug}/${r1.json.id}/propor`, { prestadora_id: B.id }, tokenAdm);
  ok(proporB.status === 409 || proporB.status === 404, 'o /propor também não deixa passar batido', `(HTTP ${proporB.status})`);
  const reA = await http('POST', `/atendimentos/admin/${slug}/${r1.json.id}/reatribuir`, { prestadora_id: A.id }, tokenAdm);
  ok(reA.status === 200 && reA.json.status === 'proposto', 'mandar pra OUTRA prestadora (Ana, sem conflito às 15:00) funciona');
  const ag2 = await http('GET', `/atendimentos/admin/${slug}/agenda?data=${D}`, null, tokenAdm);
  const linhaR2 = ag2.json.find(x => x.id === r1.json.id);
  ok(linhaR2.prestadora_id === A.id && linhaR2.recusas.length === 1 && linhaR2.recusas[0].nome === 'QA Bia', 'a recusa da Bia continua visível mesmo com o atendimento já na Ana');
  const reB2 = await http('POST', `/atendimentos/admin/${slug}/${r1.json.id}/reatribuir`, { prestadora_id: B.id, forcar_recusa: true }, tokenAdm);
  ok(reB2.status === 200, 'confirmando "mesmo assim", reenviar pra Bia é permitido');
  const recB2 = await http('POST', `/atendimentos/prestadora/me/${r1.json.id}/recusar`, null, B.token);
  const { rows: recs } = await pool.query('select count(*)::int as n from recusas_atendimento where atendimento_id = $1', [r1.json.id]);
  ok(recB2.status === 200 && recs[0].n === 2, 'cada recusa fica registrada (duas recusas da Bia neste atendimento)');

  // ---------- 2. cancelamento avisa a prestadora ----------
  console.log('\nCancelamento avisa a prestadora');
  const avAntes = await http('GET', '/atendimentos/prestadora/me/avisos', null, A.token);
  ok(avAntes.status === 200 && avAntes.json.length === 0, 'antes: nenhum aviso');
  const cancela = await http('POST', `/atendimentos/admin/${slug}/${a1.json.id}/situacao`, { situacao: 'cancelado' }, tokenAdm);
  ok(cancela.status === 200 && cancela.json.status === 'cancelado' && cancela.json.prestadora_avisada === true, 'administrador cancela o atendimento confirmado da Ana → prestadora_avisada');
  const avDepois = await http('GET', '/atendimentos/prestadora/me/avisos', null, A.token);
  const av = avDepois.json[0];
  ok(avDepois.json.length === 1 && av.tipo === 'cancelamento' && av.dados.cliente === `QA Cliente ${idU}` && av.dados.data === D && av.dados.hora === '09:00' && av.dados.hora_fim === '11:00' && av.dados.servico === 'QA Agenda',
    'o aviso identifica o atendimento: cliente, data, horário e serviço', JSON.stringify(av?.dados));
  const agA = await http('GET', '/atendimentos/prestadora/me/agenda', null, A.token);
  ok(!agA.json.some(x => x.id === a1.json.id), 'o cancelado some da agenda da prestadora (não aparece mais como ativo)');
  const calA = await http('GET', `/atendimentos/prestadora/me/calendario?mes=${mesD}`, null, A.token);
  ok(calA.json.find(x => x.id === a1.json.id)?.status === 'cancelado', 'no calendário ele aparece como "cancelado"');
  const syncA = await http('GET', '/sync', null, A.token);
  ok(syncA.status === 200 && !!syncA.json.versao, 'a sincronização da prestadora responde (percebe o aviso novo)');
  const cancelaDeNovo = await http('POST', `/atendimentos/admin/${slug}/${a1.json.id}/situacao`, { situacao: 'cancelado' }, tokenAdm);
  const avDepois2 = await http('GET', '/atendimentos/prestadora/me/avisos', null, A.token);
  ok(cancelaDeNovo.status === 200 && avDepois2.json.length === 1, 'cancelar de novo o que já está cancelado não duplica o aviso');
  const semPrest = await atd({ hora_atendimento: '17:00', duracao_horas: 1 });
  const cancelaSem = await http('POST', `/atendimentos/admin/${slug}/${semPrest.json.id}/situacao`, { situacao: 'cancelado' }, tokenAdm);
  ok(cancelaSem.status === 200 && cancelaSem.json.prestadora_avisada === false, 'atendimento sem prestadora: ninguém a avisar');
  const lida = await http('POST', `/atendimentos/prestadora/me/avisos/${av.id}/lida`, null, A.token);
  const avDepois3 = await http('GET', '/atendimentos/prestadora/me/avisos', null, A.token);
  ok(lida.status === 200 && avDepois3.json.length === 0, 'marcar como lido tira o aviso da lista');
  const lidaB = await http('POST', `/atendimentos/prestadora/me/avisos/${av.id}/lida`, null, B.token);
  ok(lidaB.status === 200 && lidaB.json.lidos === 0, 'outra prestadora não mexe no aviso alheio');
  // série cancelada avisa uma vez por ocorrência
  const serieId = serie2.json.serie_id;
  const cancelaSerie = await http('POST', `/atendimentos/admin/${slug}/serie/${serieId}/cancelar`, null, tokenAdm);
  const avSerie = await http('GET', '/atendimentos/prestadora/me/avisos', null, A.token);
  ok(cancelaSerie.status === 200 && cancelaSerie.json.cancelados >= 1 && avSerie.json.length === cancelaSerie.json.avisos_enviados, 'cancelar a série inteira avisa a prestadora de cada ocorrência cancelada', JSON.stringify(cancelaSerie.json));
  const lidas = await http('POST', '/atendimentos/prestadora/me/avisos/lidas', null, A.token);
  ok(lidas.status === 200 && lidas.json.lidos === avSerie.json.length, '"marcar todos como lidos" limpa a lista');

  // ---------- 7. cliente acompanha ----------
  console.log('\nCliente acompanha os atendimentos');
  const cli = { nome: `QA Cliente Conta ${idU}`, email: emailQa('cliente'), telefone: '(54) 99999-3333', senha: 'senha-qa-123', unidade_slug: slug };
  await http('POST', '/auth/cadastro/cliente', cli);
  const cCad = await http('POST', '/auth/cadastro/cliente/confirmar', { ...cli, codigo: await codigoDe(cli.email) });
  const cliId = cCad.json.cliente?.id;
  const cLogin = await http('POST', '/auth/login', { perfil: 'cliente', identificador: cli.email, senha: cli.senha });
  ok(cCad.status === 201 && cLogin.status === 200, 'cliente se cadastra e entra');
  const foto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const fotoOk = await http('PATCH', '/perfil', { foto }, A.token);
  ok(fotoOk.status === 200, 'a Ana coloca uma foto de perfil');
  const dc = naoDomingo(soma(hoje, 3));
  const cA = await http('POST', `/atendimentos/admin/${slug}`, { tipo_servico: 'QA Cli Aceito', data_atendimento: dc, hora_atendimento: '14:00', duracao_horas: 3, cliente_id: cliId, prestadora_id: A.id }, tokenAdm);
  const cB = await http('POST', `/atendimentos/admin/${slug}`, { tipo_servico: 'QA Cli Convite', data_atendimento: dc, hora_atendimento: '20:00', duracao_horas: 1, cliente_id: cliId, prestadora_id: B.id }, tokenAdm);
  const cC = await http('POST', `/atendimentos/admin/${slug}`, { tipo_servico: 'QA Cli Cancelado', data_atendimento: dc, hora_atendimento: '07:00', duracao_horas: 1, cliente_id: cliId }, tokenAdm);
  await http('POST', `/atendimentos/admin/${slug}/${cC.json.id}/situacao`, { situacao: 'cancelado' }, tokenAdm);
  await pool.query(`update atendimentos set status = 'aceito', data_atendimento = $2 where id = $1`, [cA.json.id, dc]); // confirmado pela Ana (sem a regra dos 2 dias)
  const meus = await http('GET', '/atendimentos/cliente/me/atendimentos', null, cLogin.json.token);
  const mA = meus.json.atendimentos?.find(x => x.id === cA.json.id), mB = meus.json.atendimentos?.find(x => x.id === cB.json.id), mC = meus.json.atendimentos?.find(x => x.id === cC.json.id);
  ok(meus.status === 200 && mA && mB && mC, 'o cliente vê os atendimentos dele (confirmado, convite e cancelado)');
  ok(mA.status === 'aceito' && mA.dia === dc && mA.hora === '14:00' && mA.hora_fim === '17:00' && mA.tipo_servico === 'QA Cli Aceito' && mA.codigo.length === 8, 'com serviço, data, horário (24 h), status e um código de referência');
  ok(mA.prestadora_id === A.id && meus.json.prestadoras[A.id]?.nome === 'QA Ana' && meus.json.prestadoras[A.id]?.foto === foto, 'o confirmado traz a prestadora responsável: nome e foto');
  ok(mB.prestadora_id === null && Object.keys(meus.json.prestadoras).length === 1, 'enquanto é só convite, a prestadora NÃO aparece pro cliente (ela ainda pode recusar)');
  ok(mC.status === 'cancelado', 'o cancelado aparece como cancelado');
  const outroCli = { ...cli, nome: `QA Outro Cliente ${idU}`, email: emailQa('cliente2') };
  await http('POST', '/auth/cadastro/cliente', outroCli);
  const cCad2 = await http('POST', '/auth/cadastro/cliente/confirmar', { ...outroCli, codigo: await codigoDe(outroCli.email) });
  const cLogin2 = await http('POST', '/auth/login', { perfil: 'cliente', identificador: outroCli.email, senha: outroCli.senha });
  const meus2 = await http('GET', '/atendimentos/cliente/me/atendimentos', null, cLogin2.json.token);
  ok(meus2.status === 200 && meus2.json.atendimentos.length === 0, 'outro cliente não vê os atendimentos dele (só os próprios)');
  const semPerm = await http('GET', '/atendimentos/cliente/me/atendimentos', null, A.token);
  ok(semPerm.status === 403, 'prestadora não usa a rota do cliente (403)');
  const pedidoCancel = await http('POST', `/atendimentos/cliente/me/${cA.json.id}/cancelar`, null, cLogin.json.token);
  const { rows: [aindaAceito] } = await pool.query('select status from atendimentos where id = $1', [cA.json.id]);
  ok(pedidoCancel.status === 404 && aindaAceito.status === 'aceito', 'o cliente NÃO consegue cancelar (não existe rota pra isso): o atendimento segue "aceito" — cancelar é só do administrador');

  // ---------- 8 e 9. convite e substituição de perfil ----------
  console.log('\nConvite de cadastro e substituição de perfil provisório');
  const prov = await http('POST', `/atendimentos/admin/${slug}`, { tipo_servico: 'QA Prov', data_atendimento: futuro, hora_atendimento: '10:00', cliente_novo: { nome: `QA Provisorio ${idU}`, telefone: '(54) 3333-4444' } }, tokenAdm);
  const provId = prov.json.cliente_id;
  const lista0 = await http('GET', `/unidades/${slug}/admin/clientes`, null, tokenAdm);
  const lp = lista0.json.find(c => c.cliente_id === provId);
  ok(lp && lp.tem_conta === false && lp.convite_enviado_em === null && lp.telefone === '(54) 3333-4444' && lp.total_registrados === 1, 'a lista de clientes diz quem não tem cadastro, o telefone, se foi convidado e quantos atendimentos tem');
  const lc = lista0.json.find(c => c.cliente_id === cliId);
  ok(lc && lc.tem_conta === true, 'e quem tem conta aparece como "com conta"');
  const subAntes = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/substituir`, { destino_id: cCad2.json.cliente.id }, tokenAdm);
  ok(subAntes.status === 400 && /convite/.test(subAntes.json.erro), 'regra 1: sem convite enviado, a substituição é recusada', `("${subAntes.json.erro}")`);
  const convComConta = await http('POST', `/unidades/${slug}/admin/clientes/${cliId}/convite`, null, tokenAdm);
  ok(convComConta.status === 404, 'convidar quem já tem conta não faz sentido (404)');
  const conv = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/convite`, null, tokenAdm);
  ok(conv.status === 200 && conv.json.convite_enviado_em, 'registra o envio do convite (botão de WhatsApp)');
  const destComAtendimento = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/substituir`, { destino_id: cliId }, tokenAdm);
  ok(destComAtendimento.status === 409 && /atendimento/.test(destComAtendimento.json.erro), 'regra 2: o perfil de destino que já tem atendimento não pode receber (409)', `("${destComAtendimento.json.erro}")`);
  const igual = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/substituir`, { destino_id: provId }, tokenAdm);
  ok(igual.status === 400, 'origem e destino iguais: 400');
  const prov2 = await http('POST', `/atendimentos/admin/${slug}`, { tipo_servico: 'QA Prov2', data_atendimento: futuro, hora_atendimento: '11:00', cliente_novo: { nome: `QA Provisorio Dois ${idU}` } }, tokenAdm);
  const destProvisorio = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/substituir`, { destino_id: prov2.json.cliente_id }, tokenAdm);
  ok(destProvisorio.status === 400 && /completo|login/.test(destProvisorio.json.erro), 'o destino precisa ser um cadastro completo (com login), não outro provisório', `("${destProvisorio.json.erro}")`);
  const semAdmin = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/substituir`, { destino_id: cCad2.json.cliente.id }, cLogin.json.token);
  ok(semAdmin.status === 401 || semAdmin.status === 403, 'cliente não substitui perfis', `(HTTP ${semAdmin.status})`);
  // dá uma avaliação ao provisório pra conferir que ela também é transferida
  await pool.query(`update atendimentos set status = 'concluido', prestadora_id = $2 where id = $1`, [prov.json.id, A.id]);
  await pool.query(`insert into avaliacoes (atendimento_id, cliente_id, prestadora_id, nota, status) values ($1, $2, $3, 5, 'aprovada')`, [prov.json.id, provId, A.id]);
  const antes = (await pool.query('select count(*)::int as n from atendimentos where unidade_id = $1', [uni.id])).rows[0].n;
  const sub = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/substituir`, { destino_id: cCad2.json.cliente.id }, tokenAdm);
  ok(sub.status === 200 && sub.json.movidos.atendimentos === 1 && sub.json.movidos.avaliacoes === 1, 'condições atendidas: atendimentos E avaliações do provisório passam pro novo perfil', JSON.stringify(sub.json));
  const depois = (await pool.query('select count(*)::int as n from atendimentos where unidade_id = $1', [uni.id])).rows[0].n;
  ok(antes === depois, 'nenhum atendimento foi excluído ou duplicado');
  const { rows: [novoDono] } = await pool.query('select cliente_id from atendimentos where id = $1', [prov.json.id]);
  const { rows: [avTrans] } = await pool.query('select cliente_id from avaliacoes where atendimento_id = $1', [prov.json.id]);
  ok(novoDono.cliente_id === cCad2.json.cliente.id && avTrans.cliente_id === cCad2.json.cliente.id, 'o histórico agora pertence ao perfil cadastrado pelo cliente');
  const { rows: sumiu } = await pool.query('select 1 from clientes where id = $1', [provId]);
  const lista1 = await http('GET', `/unidades/${slug}/admin/clientes`, null, tokenAdm);
  ok(sumiu.length === 0 && !lista1.json.some(c => c.cliente_id === provId), 'o provisório deixa de existir e de aparecer como cliente');
  const { rows: [tel] } = await pool.query('select telefone from clientes where id = $1', [cCad2.json.cliente.id]);
  ok(!!tel.telefone, 'o perfil novo segue com telefone');
  const subDeNovo = await http('POST', `/unidades/${slug}/admin/clientes/${provId}/substituir`, { destino_id: cCad2.json.cliente.id }, tokenAdm);
  ok(subDeNovo.status === 404, 'repetir a substituição não faz nada (o provisório já não existe): 404');
  const outraConta = await http('POST', `/unidades/${slug}/admin/clientes/${prov2.json.cliente_id}/convite`, null, tokenAdm);
  const { rows: [antesConflito] } = await pool.query('select count(*)::int as n from atendimentos where cliente_id = $1', [prov2.json.cliente_id]);
  const subAtomica = await http('POST', `/unidades/${slug}/admin/clientes/${prov2.json.cliente_id}/substituir`, { destino_id: cCad2.json.cliente.id }, tokenAdm);
  const { rows: [depoisConflito] } = await pool.query('select count(*)::int as n from atendimentos where cliente_id = $1', [prov2.json.cliente_id]);
  ok(outraConta.status === 200 && subAtomica.status === 409 && antesConflito.n === depoisConflito.n && depoisConflito.n === 1, 'substituição recusada no meio (destino agora tem atendimento) não move nada: os dados ficam como estavam');

  // ---------- limpeza ----------
  const { rows: unis } = await pool.query(`select id from unidades where cnpj = '12.ABC.345/01DE-35' or slug like $1`, [`qa-%${id}%`]);
  const uids = unis.map(u => u.id);
  await pool.query('delete from avaliacoes where prestadora_id in (select id from prestadoras where unidade_id = any($1::uuid[]))', [uids]);
  await pool.query('delete from atendimentos where unidade_id = any($1::uuid[])', [uids]);
  await pool.query('delete from clientes where unidade_id = any($1::uuid[])', [uids]);
  await pool.query('delete from prestadoras where unidade_id = any($1::uuid[])', [uids]);
  await pool.query('delete from administrador_unidades where unidade_id = any($1::uuid[])', [uids]);
  await pool.query(`delete from administradores where email like $1`, [`qa-%-${id}@qa.invalid`]);
  await pool.query('delete from unidades where id = any($1::uuid[])', [uids]);
  await pool.query('delete from codigos_verificacao where destino like $1', [`%${id}@qa.invalid`]);

  console.log(falhas === 0 ? '\nTudo certo — todas as verificações passaram.\n' : `\n${falhas} verificação(ões) FALHARAM.\n`);
  await pool.end();
  process.exit(falhas === 0 ? 0 : 1);
})().catch(async (erro) => {
  console.error('\nO teste quebrou:', erro);
  await pool.end().catch(() => {});
  process.exit(2);
});
