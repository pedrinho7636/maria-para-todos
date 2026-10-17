/* Portal da Maria — Área da prestadora
   Convites, agenda, avisos de cancelamento, calendário e aceitar/recusar. */

/* prestadora */
// Prestadora só pode confirmar (aceitar) a partir de 2 dias antes do
// atendimento — antes disso o convite fica visível mas o botão desabilitado.
function statusConfirmacaoConvite(c) {
  const hojeISO = hojeISOBrasil();
  const dataISO = String(c.data).slice(0, 10);
  const diasRestantes = Math.round((new Date(dataISO + 'T00:00:00Z') - new Date(hojeISO + 'T00:00:00Z')) / 86400000);
  return diasRestantes <= 2
    ? { podeConfirmar: true, aviso: '' }
    : { podeConfirmar: false, aviso: `Você poderá confirmar a partir de 2 dias antes do atendimento (faltam ${diasRestantes} dias).` };
}
// Etiquetas VERMELHAS, com formas diferentes: pendente (preenchida, ⏳) e conflito (só contorno, ⚠)
const STATUS_ATIVOS_PREST = ['proposto', 'aceito', 'concluido'];
const emConflito = (a) => a.conflitos.length > 0 && STATUS_ATIVOS_PREST.includes(a.status);
function tagsPrestadora(a) {
  const tags = [];
  if (a.status === 'proposto') tags.push('<span class="tag-pendente">⏳ Aguardando aceite</span>');
  if (emConflito(a)) tags.push('<span class="tag-conflito">⚠ Conflito de horário</span>');
  return tags.length ? `<div class="tags-linha">${tags.join('')}</div>` : '';
}
const detalheConflito = (a) => emConflito(a)
  ? `<span style="color:var(--red);display:block">Conflita com: ${a.conflitos.slice(0, 2).map(c => `${escapeHtml(c.servico)} ${c.hora}–${c.hora_fim}${c.cliente ? ' (' + escapeHtml(c.cliente) + ')' : ''}`).join('; ')}${a.conflitos.length > 2 ? '…' : ''}</span>` : '';
const classeLinhaPrestadora = (a) => (a.status === 'proposto' ? ' pendente' : '') + (emConflito(a) ? ' conflito' : '') + (a.status === 'cancelado' ? ' cancelado-p' : '');

function renderPrestadora() {
  document.getElementById('ps-saudacao').textContent = 'Olá, ' + primeiroNome(prestadora.nome) + '.';
  document.getElementById('ps-unidade').textContent = (cidades[prestadora.unidade] || {}).nome || '—';
  document.querySelector('#screen-prestadora .data-hoje').textContent = dataPorExtensoHoje();
  renderAvisosPrestadora();
  const il = document.getElementById('invitelist');
  il.innerHTML = convites.length === 0 ? '<div class="empty">Nenhum convite no momento. Você está em dia! 🎉</div>'
    : convites.map(c => {
      const { podeConfirmar, aviso } = statusConfirmacaoConvite(c);
      // não dá pra confirmar dois atendimentos ao mesmo tempo: o servidor barra; aqui o botão já vem desabilitado
      const jaConfirmado = c.conflitos.filter(x => x.status === 'aceito' || x.status === 'concluido');
      const botaoAceitar = podeConfirmar && !jaConfirmado.length
        ? `<button class="btn-accept" onclick="aceitar('${c.id}')">Aceitar</button>`
        : `<button class="btn-accept" disabled style="opacity:.5;cursor:not-allowed">Aceitar</button>`;
      // local, cliente e valor só aparecem quando existem (sem "·" sobrando nem campo vazio)
      const meta = [`<b>${dataBR(c.data)} · ${horarioFaixa(c)}</b>`, c.cliente ? 'Cliente: ' + escapeHtml(c.cliente) : '', c.area ? escapeHtml(c.area) : '', c.valor ? `<b>${c.valor}</b>` : '']
        .filter(Boolean).join(' &nbsp;·&nbsp; ');
      const avisoConflito = jaConfirmado.length
        ? `<div class="warn"><span>Você já tem um atendimento <b>confirmado</b> nesse horário — não dá pra aceitar os dois. Fale com a unidade.</span></div>` : '';
      return `<div class="invite${classeLinhaPrestadora(c)}"><div class="invite-top"><strong>${escapeHtml(c.serv)}</strong></div><div class="invite-meta">${meta}${detalheConflito(c)}</div>${tagsPrestadora(c)}${avisoConflito}${aviso && !jaConfirmado.length ? `<div class="warn"><span>${aviso}</span></div>` : ''}<div class="invite-actions">${botaoAceitar}<button class="btn-decline" onclick="recusar('${c.id}')">Recusar</button></div></div>`;
    }).join('');
  const ag = document.getElementById('prest-agenda');
  ag.innerHTML = agendaPrestadora.length === 0 ? '<div class="empty">Você ainda não aceitou atendimentos para hoje.</div>'
    : agendaPrestadora.slice().sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || ''))).map(j => `<div class="job${classeLinhaPrestadora(j)}"><div class="job-time">${j.hora || '--:--'}</div><div class="job-body"><strong>${escapeHtml(j.serv)}</strong><span>${dataBR(j.data)} · ${horarioFaixa(j)}${j.cliente ? ' · Cliente: ' + escapeHtml(j.cliente) : ''}</span>${detalheJob(j)}${detalheConflito(j)}${tagsPrestadora(j)}</div><div class="job-status ${j.emAndamento ? 'st-route' : 'st-ok'}">${j.emAndamento ? 'em andamento' : 'aceito'}</div></div>`).join('');
  document.getElementById('ag-count').textContent = agendaPrestadora.length;
  const hojeISO = hojeISOBrasil();
  document.getElementById('ps-aceitos').textContent = agendaPrestadora.filter(a => a.data === hojeISO).length;
  document.getElementById('ps-pend').textContent = convites.length;

  // Valores vêm calculados da API: tarifa por atendimento (definida pelo admin) × atendimentos aceitos.
  const r = resumoPrestadora || { valor_por_atendimento: null, semana: { qtd: 0, total: 0 }, mes: { realizados_qtd: 0, realizados_total: 0, previstos_qtd: 0, previstos_total: 0 } };
  const semTarifa = r.valor_por_atendimento === null;
  const dinheiro = v => (semTarifa && !v ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  document.getElementById('ps-previsto-valor').textContent = dinheiro(r.semana.total);
  document.getElementById('ps-previsto-qtd').textContent = plural(r.semana.qtd, 'atendimento', 'atendimentos');
  document.getElementById('ps-tarifa').textContent = semTarifa ? 'valor ainda não definido' : formatarReais(r.valor_por_atendimento) + ' cada';
  document.getElementById('ps-mes-valor').textContent = dinheiro(r.mes.realizados_total + r.mes.previstos_total);
  document.getElementById('ps-mes-detalhe').textContent = `${plural(r.mes.realizados_qtd, 'realizado', 'realizados')} · ${r.mes.previstos_qtd} a realizar`
    + (r.mes.pago_total ? ` · ${formatarReais(r.mes.pago_total)} já pago` : '');
  renderPrestAval();
}

/* Avisos da unidade pra prestadora (hoje: atendimento CANCELADO pelo administrador). Ficam até ela marcar "Entendi". */
function renderAvisosPrestadora() {
  const el = document.getElementById('prest-avisos');
  if (!avisosPrestadora.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-head"><h2>Avisos da unidade</h2>${avisosPrestadora.length > 1 ? '<a style="cursor:pointer" onclick="marcarAvisosLidos()">Marcar todos como lidos</a>' : ''}</div>`
    + avisosPrestadora.map(av => {
      const d = av.dados || {};
      return `<div class="aviso-cancelamento"><div style="font-size:22px" aria-hidden="true">🚫</div><div class="aviso-corpo"><b>Atendimento cancelado pela unidade</b><br>${escapeHtml(d.servico || '')}${d.cliente ? ' · Cliente: ' + escapeHtml(d.cliente) : ''}<br>${d.data ? dataBR(d.data) : ''}${d.hora ? ' · ' + d.hora + (d.hora_fim ? '–' + d.hora_fim : '') : ''}${d.area ? ' · ' + escapeHtml(d.area) : ''}<br><span style="color:var(--muted)">Ele saiu da sua agenda.</span></div><button class="btn-sm ghost" onclick="marcarAvisoLido('${av.id}')">Entendi</button></div>`;
    }).join('');
}
async function marcarAvisoLido(id) {
  try { await api(`/atendimentos/prestadora/me/avisos/${id}/lida`, { method: 'POST' }); avisosPrestadora = avisosPrestadora.filter(a => a.id !== id); renderAvisosPrestadora(); }
  catch (err) { toast('Erro: ' + err.message); }
}
async function marcarAvisosLidos() {
  try { await api('/atendimentos/prestadora/me/avisos/lidas', { method: 'POST' }); avisosPrestadora = []; renderAvisosPrestadora(); }
  catch (err) { toast('Erro: ' + err.message); }
}

/* Calendário da prestadora: tudo que é DELA no mês (convites, confirmados, concluídos e cancelados), vindo da API
   só dela. Ao escolher um dia, a lista mostra cliente, início–término, serviço, local, valor e status. */
let mesAtualCalendarioPrestadora = new Date();
let diaSelecionadoCalendarioPrestadora = null;
let calendarioPrestadora = { mes: null, itens: [] };
const mesISODe = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
async function carregarCalendarioPrestadora() {
  const mes = mesISODe(mesAtualCalendarioPrestadora);
  const itens = await api('/atendimentos/prestadora/me/calendario?mes=' + mes);
  calendarioPrestadora = { mes, itens: itens.map(a => itemPrestadora(a)) };
}
async function renderCalendarioPrestadora() {
  mesAtualCalendarioPrestadora = new Date();
  await selecionarDiaCalendarioPrestadora(hojeISOBrasil());
}
async function mudarMesCalendarioPrestadora(delta) {
  mesAtualCalendarioPrestadora = new Date(mesAtualCalendarioPrestadora.getFullYear(), mesAtualCalendarioPrestadora.getMonth() + delta, 1);
  try { await carregarCalendarioPrestadora(); } catch (err) { toast('Erro ao carregar o mês: ' + err.message); }
  construirCalendarioMesPrestadora();
}
function construirCalendarioMesPrestadora() {
  const ano = mesAtualCalendarioPrestadora.getFullYear(), mes = mesAtualCalendarioPrestadora.getMonth();
  document.getElementById('ps-cal-mes-label').textContent = mesAtualCalendarioPrestadora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const porDia = {};
  for (const a of calendarioPrestadora.itens) (porDia[a.data] = porDia[a.data] || []).push(a);
  const inicioSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const hojeISO = hojeISOBrasil();

  let html = '';
  for (let i = 0; i < inicioSemana; i++) html += '<div class="cal-day outro-mes"></div>';
  for (let d = 1; d <= diasNoMes; d++) {
    const dataISO = ano + '-' + String(mes + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const doDia = (porDia[dataISO] || []).filter(a => a.status !== 'cancelado');
    const classes = ['cal-day'];
    if (dataISO === hojeISO) classes.push('hoje');
    if (dataISO === diaSelecionadoCalendarioPrestadora) classes.push('selecionado');
    if (doDia.length) classes.push('tem-atendimento');
    if (doDia.some(a => a.status === 'proposto')) classes.push('tem-pendencia');
    if (doDia.some(emConflito)) classes.push('tem-conflito');
    html += `<div class="${classes.join(' ')}" onclick="selecionarDiaCalendarioPrestadora('${dataISO}')">${d}</div>`;
  }
  document.getElementById('ps-cal-grid').innerHTML = html;
}
const ROTULO_STATUS_PREST = { aceito: ['confirmado', 'st-ok'], concluido: ['concluído', 'st-ok'], cancelado: ['cancelado', 'st-wait'], proposto: ['convite', 'st-new'] };
async function selecionarDiaCalendarioPrestadora(dataISO) {
  diaSelecionadoCalendarioPrestadora = dataISO;
  const [a, m] = dataISO.split('-').map(Number);
  const alvo = new Date(a, m - 1, 1);
  if (mesISODe(alvo) !== calendarioPrestadora.mes) { // dia de outro mês: busca o mês dele
    mesAtualCalendarioPrestadora = alvo;
    try { await carregarCalendarioPrestadora(); } catch (err) { toast('Erro ao carregar o calendário: ' + err.message); }
  }
  construirCalendarioMesPrestadora();
  const d = new Date(dataISO + 'T00:00:00');
  document.getElementById('ps-cal-dia-label').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  const doDia = calendarioPrestadora.itens.filter(x => x.data === dataISO).sort((x, y) => (x.hora || '').localeCompare(y.hora || ''));
  document.getElementById('ps-cal-lista').innerHTML = doDia.length === 0 ? '<div class="empty">Nada agendado neste dia.</div>'
    : doDia.map(x => {
      const [rotulo, cls] = x.emAndamento ? ['em andamento', 'st-route'] : (ROTULO_STATUS_PREST[x.status] || [x.status, 'st-wait']);
      const info = [x.cliente ? 'Cliente: ' + escapeHtml(x.cliente) : '', x.area ? escapeHtml(x.area) : '', x.valor || ''].filter(Boolean).join(' · ');
      return `<div class="job${classeLinhaPrestadora(x)}"><div class="job-time" style="width:auto;min-width:46px">${x.hora || '--:--'}${x.fim ? '<br><span style="color:var(--muted);font-weight:400">' + x.fim + '</span>' : ''}</div><div class="job-body"><strong>${escapeHtml(x.serv)}</strong><span>${horarioFaixa(x)}${info ? ' · ' + info : ''}</span>${detalheConflito(x)}${tagsPrestadora(x)}</div><div class="job-status ${cls}">${rotulo}</div></div>`;
    }).join('');
}
async function aceitar(id) {
  const convite = convites.find(c => c.id === id);
  const aba = abrirAbaEmBranco();
  try {
    await api(`/atendimentos/prestadora/me/${id}/aceitar`, { method: 'POST' });
    await carregarDadosPrestadora(); renderPrestadora(); renderCalendarioPrestadora();
    toast('Atendimento aceito — já foi para a agenda da unidade.');
    const telUnidade = (cidades[prestadora.unidade] || {}).tel;
    if (aba && telUnidade && convite) {
      const mensagem = `${prestadora.nome} confirmou o atendimento: ${convite.serv}${convite.area ? ' — ' + convite.area : ''}, `
        + `${convite.data}${convite.hora ? ' às ' + convite.hora : ''}.`;
      aba.location.href = linkWhatsApp(telUnidade, mensagem);
    } else if (aba) { aba.close(); }
  } catch (err) {
    if (aba) aba.close();
    toast(err.codigo === 'CONFLITO_HORARIO' ? err.message : 'Erro ao aceitar no banco: ' + err.message);
    if (err.codigo === 'CONFLITO_HORARIO') { try { await carregarDadosPrestadora(); renderPrestadora(); } catch (e) { } }
  }
}
async function recusar(id) {
  try {
    await api(`/atendimentos/prestadora/me/${id}/recusar`, { method: 'POST' });
    await carregarDadosPrestadora(); renderPrestadora(); renderCalendarioPrestadora();
    toast('Convite recusado.');
  } catch (err) { toast('Erro ao recusar no banco: ' + err.message); }
}
