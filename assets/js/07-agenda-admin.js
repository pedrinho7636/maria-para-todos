/* Portal da Maria — Agenda do administrador
   Calendário do mês, linha do tempo do dia, balão do atendimento (trocar prestadora, cancelar, marcar falta). */

/* ===== Agenda: calendário do mês + linha do tempo do dia ===== */
const AGENDA_HORA_INICIO = 7, AGENDA_HORA_FIM = 20; // faixa exibida na linha do tempo (07h-20h)
let mesAtualCalendario = new Date();
let diaSelecionadoAgenda = null;
let resumoMensalPorDia = {};
let prestadorasAgenda = {}; // slug -> lista enxuta p/ atribuição, liberada por 'agenda'

// diaInicial (opcional, 'AAAA-MM-DD'): abre a agenda direto naquele dia (usado pelas pendências do Financeiro)
function renderAgendaAdmin(diaInicial) {
  renderHorasGutter();
  if (diaInicial) {
    const [a, m, d] = diaInicial.split('-').map(Number);
    mesAtualCalendario = new Date(a, m - 1, 1);
    const dia = new Date(a, m - 1, d);
    if (dia.getDay() === 0) dia.setDate(dia.getDate() + 1); // domingo bloqueado: cai pra segunda
    diaSelecionadoAgenda = dia.getFullYear() + '-' + String(dia.getMonth() + 1).padStart(2, '0') + '-' + String(dia.getDate()).padStart(2, '0');
    carregarPrestadorasAgenda(currentUnit);
    renderCalendarioMes();
    return;
  }
  // "hoje" no horário de Brasília (toISOString() é UTC e, depois das ~21h, já cai no dia seguinte)
  const [ah, mh, dh] = hojeISOBrasil().split('-').map(Number);
  mesAtualCalendario = new Date(ah, mh - 1, 1);
  const hoje = new Date(ah, mh - 1, dh);
  if (hoje.getDay() === 0) hoje.setDate(hoje.getDate() + 1); // domingo bloqueado: cai pra segunda
  diaSelecionadoAgenda = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
  carregarPrestadorasAgenda(currentUnit);
  renderCalendarioMes();
}
async function carregarPrestadorasAgenda(slug) {
  try {
    prestadorasAgenda[slug] = await api(`/atendimentos/admin/${slug}/prestadoras`);
  } catch (err) { prestadorasAgenda[slug] = []; }
}
function renderHorasGutter() {
  let html = '';
  for (let h = AGENDA_HORA_INICIO; h < AGENDA_HORA_FIM; h++) html += `<span>${String(h).padStart(2, '0')}:00</span>`;
  document.getElementById('agv-tl-horas').innerHTML = html;
}
function mudarMesCalendario(delta) {
  mesAtualCalendario = new Date(mesAtualCalendario.getFullYear(), mesAtualCalendario.getMonth() + delta, 1);
  renderCalendarioMes();
}
async function renderCalendarioMes() {
  const ano = mesAtualCalendario.getFullYear(), mes = mesAtualCalendario.getMonth();
  const mesStr = ano + '-' + String(mes + 1).padStart(2, '0');
  document.getElementById('agv-mes-label').textContent =
    mesAtualCalendario.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  try {
    const resumo = await api(`/atendimentos/admin/${currentUnit}/agenda/resumo-mensal?mes=${mesStr}`);
    resumoMensalPorDia = {};
    resumo.forEach(r => { resumoMensalPorDia[r.data] = r.total; });
  } catch (err) { resumoMensalPorDia = {}; }

  construirGridMes(ano, mes);
  if (diaSelecionadoAgenda) selecionarDiaAgenda(diaSelecionadoAgenda);
}
function construirGridMes(ano, mes) {
  const grid = document.getElementById('agv-cal-grid');
  const inicioSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const hojeISO = hojeISOBrasil();

  let html = '';
  for (let i = 0; i < inicioSemana; i++) html += '<div class="cal-day outro-mes"></div>';
  for (let d = 1; d <= diasNoMes; d++) {
    const dataISO = ano + '-' + String(mes + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const ehDomingo = new Date(ano, mes, d).getDay() === 0;
    const classes = ['cal-day'];
    if (dataISO === hojeISO) classes.push('hoje');
    if (dataISO === diaSelecionadoAgenda) classes.push('selecionado');
    if (resumoMensalPorDia[dataISO]) classes.push('tem-atendimento');
    if (ehDomingo) {
      classes.push('bloqueado');
      html += `<div class="${classes.join(' ')}" title="Domingo não disponível">${d}</div>`;
    } else {
      html += `<div class="${classes.join(' ')}" onclick="selecionarDiaAgenda('${dataISO}')">${d}</div>`;
    }
  }
  grid.innerHTML = html;
}
async function selecionarDiaAgenda(dataISO) {
  if (new Date(dataISO + 'T00:00:00').getDay() === 0) { toast('Domingo não está disponível pra agenda.'); return; }
  fecharReatribuirPop(); // balão do dia anterior não vale pro dia novo
  diaSelecionadoAgenda = dataISO;
  construirGridMes(mesAtualCalendario.getFullYear(), mesAtualCalendario.getMonth());
  const d = new Date(dataISO + 'T00:00:00');
  document.getElementById('agv-dia-label').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  try {
    // cancelados vêm junto (riscados) pra poderem ser reativados, mas não entram na contagem
    const atendimentos = await api(`/atendimentos/admin/${currentUnit}/agenda?data=${dataISO}&incluir_cancelados=1`);
    document.getElementById('agv-count').textContent = atendimentos.filter(a => a.status !== 'cancelado' && a.status !== 'falta').length;
    renderTimelineDia(atendimentos);
  } catch (err) { toast('Erro ao carregar agenda do dia: ' + err.message); }
}
// Posiciona os atendimentos do dia por horário; quando dois se sobrepõem,
// divide em colunas dentro do grupo que se sobrepõe (mesma lógica clássica
// de calendário de agenda). A altura do bloco vem de duracao_horas (planilha
// importada ou cadastro único); sem duração, assume 1h.
function hhmm(minutos) { return String(Math.floor(minutos / 60)).padStart(2, '0') + ':' + String(minutos % 60).padStart(2, '0'); }
function renderTimelineDia(atendimentos) {
  const track = document.getElementById('agv-tl-track');
  const vazio = document.getElementById('agv-tl-vazio');
  track.innerHTML = '';
  track.style.height = ((AGENDA_HORA_FIM - AGENDA_HORA_INICIO) * 60) + 'px';

  const itens = atendimentos
    .filter(a => a.hora_atendimento)
    .map(a => {
      const [h, m] = a.hora_atendimento.slice(0, 5).split(':').map(Number);
      const inicioMin = h * 60 + m;
      const duracaoMin = Math.round((Number(a.duracao_horas) || 1) * 60);
      return Object.assign({}, a, { inicioMin, duracaoMin, fimMin: inicioMin + duracaoMin });
    })
    .sort((a, b) => a.inicioMin - b.inicioMin);

  vazio.style.display = itens.length === 0 ? 'block' : 'none';
  if (itens.length === 0) return;

  const clusters = [];
  let clusterAtual = [], fimClusterAtual = -Infinity;
  for (const item of itens) {
    if (clusterAtual.length && item.inicioMin >= fimClusterAtual) {
      clusters.push(clusterAtual); clusterAtual = []; fimClusterAtual = -Infinity;
    }
    clusterAtual.push(item);
    fimClusterAtual = Math.max(fimClusterAtual, item.fimMin);
  }
  if (clusterAtual.length) clusters.push(clusterAtual);

  for (const cluster of clusters) {
    const colunas = []; // guarda o fim (min) do último item de cada coluna
    for (const item of cluster) {
      let col = colunas.findIndex(fim => fim <= item.inicioMin);
      if (col === -1) { col = colunas.length; colunas.push(item.fimMin); }
      else colunas[col] = item.fimMin;
      item.coluna = col;
    }
    const totalColunas = colunas.length;
    for (const item of cluster) {
      const limite = (AGENDA_HORA_FIM - AGENDA_HORA_INICIO) * 60;
      const top = Math.max(0, item.inicioMin - AGENDA_HORA_INICIO * 60);
      const altura = Math.max(30, Math.min(item.duracaoMin, limite - top) - 6); // 6px de respiro entre blocos
      const largura = 100 / totalColunas;
      const { cls, rotulo } = classificarBlocoAgenda(item);
      const div = document.createElement('div');
      div.className = 'tl-block' + cls;
      div.style.top = top + 'px';
      div.style.height = altura + 'px';
      div.style.left = (largura * item.coluna) + '%';
      div.style.width = `calc(${largura}% - 6px)`;
      // cliente só aparece quando o bloco é alto o bastante pra uma terceira linha
      const linhaCliente = altura >= 90 && item.cliente_nome ? `<span class="tl-linha">${escapeHtml(item.cliente_nome)}</span>` : '';
      div.innerHTML = `<strong class="tl-linha">${item.hora_atendimento.slice(0, 5)} · ${escapeHtml(item.tipo_servico)}</strong><span class="tl-linha">${rotulo}</span>${linhaCliente}`;
      div.title = `${hhmm(item.inicioMin)}–${hhmm(item.fimMin)} · ${item.tipo_servico}`
        + (item.area ? ` · Local: ${item.area}` : '')
        + (item.valor !== null && item.valor !== undefined ? ` · Valor: ${formatarReais(item.valor)}` : '')
        + (item.cliente_nome ? ` · Cliente: ${item.cliente_nome}` : '')
        + (item.prestadora_nome || item.profissional_externo ? ` · ${item.prestadora_nome || item.profissional_externo}` : '');
      div.onclick = ev => abrirReatribuir(ev, item);
      track.appendChild(div);
    }
  }
}
// Cor/rótulo do bloco conforme o estado do atendimento:
// aceito = verde (padrão) · sem prestadora = âmbar · proposto fora da janela
// de confirmação (>2 dias) = azul · proposto dentro da janela (<=2 dias,
// já pode ser confirmado pela prestadora) = laranja, pra chamar atenção.
function classificarBlocoAgenda(item) {
  if (item.status === 'falta') {
    return { cls: ' falta', rotulo: (item.prestadora_nome ? escapeHtml(item.prestadora_nome) + ' · ' : '') + '✖ prestadora não foi' };
  }
  if (item.em_andamento) {
    return { cls: ' em-andamento', rotulo: (item.prestadora_nome ? escapeHtml(item.prestadora_nome) + ' · ' : '') + '▶ atendimento em andamento' };
  }
  if (item.status === 'cancelado') {
    const quem = item.prestadora_nome || item.profissional_externo || '';
    return { cls: ' cancelado', rotulo: (quem ? escapeHtml(quem) + ' · ' : '') + 'cancelado' };
  }
  if (item.status === 'concluido') {
    const quem = item.prestadora_nome || item.profissional_externo || '';
    const semCadastro = !item.prestadora_id && item.profissional_externo ? ' · prestadora sem cadastro no Portal da Maria' : '';
    return { cls: ' concluido', rotulo: (quem ? escapeHtml(quem) + ' · ' : '') + 'concluído' + semCadastro };
  }
  const recusaram = (item.recusas || []).map(r => r.nome);
  const antes = recusaram.length ? ' · já recusado por ' + escapeHtml(recusaram.join(', ')) : '';
  if (!item.prestadora_id && recusaram.length && item.status === 'recusado') {
    return { cls: ' recusado', rotulo: '↩ recusado por ' + escapeHtml(recusaram.join(', ')) + ' — escolha outra prestadora' };
  }
  if (!item.prestadora_id) {
    // profissional_externo = nome que veio da planilha importada e ainda não casou com uma prestadora cadastrada
    return { cls: ' sem-prestadora', rotulo: item.profissional_externo ? escapeHtml(item.profissional_externo) + ' · prestadora sem cadastro no Portal da Maria' : 'sem prestadora' };
  }
  const nomePrestadora = escapeHtml(item.prestadora_nome || '');
  if (item.status !== 'proposto') return { cls: '', rotulo: nomePrestadora + antes };

  const hojeISO = hojeISOBrasil();
  const dataISO = String(item.data_atendimento).slice(0, 10);
  const diffDias = Math.round((new Date(dataISO + 'T00:00:00Z') - new Date(hojeISO + 'T00:00:00Z')) / 86400000);
  return diffDias <= 2
    ? { cls: ' pendente-confirmacao', rotulo: nomePrestadora + ' · aguardando confirmação' + antes }
    : { cls: ' aguardando-janela', rotulo: nomePrestadora + ' · confirma em breve' + antes };
}
// Balão do atendimento: troca a prestadora e corrige o local. O campo de local
// fica sempre aqui pro admin poder preencher/apagar; nas telas de quem lê
// (prestadora, avisos de WhatsApp) atendimento sem local simplesmente não mostra a linha.
// O que o administrador pode escolher em "Situação", conforme a FASE do atendimento (relógio de Brasília):
//  antes de começar → programado ou cancelado · em andamento → falta da prestadora ou cancelado ·
//  depois do término (o sistema conclui sozinho) → só "prestadora não foi" · falta → só voltar pra concluído.
function situacoesDisponiveis(item) {
  const FALTA = ['falta', 'Prestadora não foi (falta)'];
  if (item.status === 'falta') return { atual: 'falta', opcoes: [FALTA, ['concluido', 'Concluído']] };
  if (item.status === 'concluido') return { atual: 'concluido', opcoes: [['concluido', 'Concluído'], FALTA] };
  if (item.status === 'cancelado') return { atual: 'cancelado', opcoes: [['programado', 'Programado'], ['cancelado', 'Cancelado (não conta)']] };
  if (item.status === 'aceito' && item.fim_passou) { // terminou, e o sistema ainda vai concluir (roda a cada poucos minutos)
    return { atual: 'programado', opcoes: [['programado', 'Programado'], ['concluido', 'Concluído'], FALTA, ['cancelado', 'Cancelado (não conta)']] };
  }
  const base = [['programado', item.em_andamento ? 'Atendimento em andamento' : 'Programado']];
  if (item.em_andamento) base.push(FALTA);
  base.push(['cancelado', 'Cancelado (não conta)']);
  return { atual: 'programado', opcoes: base };
}
const prestadoraTravada = (item) => ['concluido', 'cancelado', 'falta'].includes(item.status);

let reatribuirItem = null;
function abrirReatribuir(ev, item) {
  fecharReatribuirPop();
  reatribuirItem = item;
  const concluido = item.status === 'concluido' || item.status === 'falta'; // concluído: a prestadora não troca, mas o local ainda pode ser corrigido
  const cancelado = item.status === 'cancelado';
  const situacoes = situacoesDisponiveis(item);
  const rect = ev.currentTarget.getBoundingClientRect();
  const recusasItem = item.recusas || [];
  const jaRecusou = new Set(recusasItem.map(r => r.prestadora_id));
  const listaPrest = (prestadorasAgenda[currentUnit] || []).slice();
  if (item.prestadora_id && !listaPrest.some(p => p.id === item.prestadora_id)) listaPrest.push({ id: item.prestadora_id, nome: (item.prestadora_nome || 'Prestadora') + ' (inativa)' });
  const opcoes = listaPrest
    .map(p => `<option value="${p.id}" ${p.id === item.prestadora_id ? 'selected' : ''}>${escapeHtml(p.nome)}${jaRecusou.has(p.id) ? ' (já recusou)' : ''}</option>`).join('');
  const pop = document.createElement('div');
  pop.className = 'reatribuir-pop';
  pop.id = 'reatribuir-pop';
  pop.innerHTML = `
    <label style="font-size:12px;font-weight:500;display:block;margin-bottom:6px">Situação</label>
    <select id="reatribuir-situacao" onchange="mostrarCamposCancelamento()">
      ${situacoes.opcoes.map(([valor, rotulo]) => `<option value="${valor}" ${valor === situacoes.atual ? 'selected' : ''}>${rotulo}</option>`).join('')}
    </select>
    <div id="reatribuir-cancelamento" style="display:none">
      <label style="font-size:12px;font-weight:500;display:block;margin-bottom:6px">Quem pediu o cancelamento? <span style="font-weight:400">(opcional)</span></label>
      <select id="reatribuir-cancel-quem">
        <option value="">Não informar</option>
        <option value="cliente">O cliente pediu</option>
        <option value="franquia">A franquia cancelou</option>
        <option value="prestadora">A prestadora cancelou</option>
      </select>
      <label style="font-size:12px;font-weight:500;display:block;margin-bottom:6px">Motivo <span style="font-weight:400">(opcional)</span></label>
      <input id="reatribuir-cancel-motivo" maxlength="300" autocomplete="off" placeholder="Ex.: cliente viajou">
      <p style="font-size:11.5px;margin:-4px 0 10px">Fica só no histórico da franquia e alimenta os relatórios de cancelamento: a prestadora não vê.</p>
    </div>
    ${item.status === 'concluido' ? '<p style="font-size:11.5px;margin:-4px 0 10px">Depois de concluído só dá pra marcar <b>prestadora não foi</b>. Isso é controle interno da franquia: a prestadora não vê.</p>' : ''}
    ${item.em_andamento ? '<p style="font-size:11.5px;margin:-4px 0 10px">Começou e ainda não terminou. Se a prestadora não foi, marque a falta (controle interno: ela não vê).</p>' : ''}
    ${recusasItem.length ? `<div class="fin-alerta" style="font-size:12px;margin:0 0 10px">↩ <b>Já recusou(aram) este atendimento:</b> ${recusasItem.map(r => escapeHtml(r.nome) + ' (' + dataHoraBR(r.em) + ')').join(', ')}.
      Ao escolher uma delas de novo, o sistema pergunta antes de enviar.</div>` : ''}
    <label style="font-size:12px;font-weight:500;display:block;margin-bottom:6px">Prestadora${concluido ? ' <span style="font-weight:400">(atendimento concluído)</span>' : cancelado ? ' <span style="font-weight:400">(cancelado)</span>' : ''}</label>
    <select id="reatribuir-select" ${concluido || cancelado ? 'disabled' : ''}><option value="">Sem prestadora</option>${opcoes}</select>
    <label style="font-size:12px;font-weight:500;display:block;margin-bottom:6px">Local / bairro</label>
    <input id="reatribuir-local" maxlength="500" value="${escapeHtml(item.area || '')}" placeholder="Sem local — deixe vazio pra ocultar">
    <label style="font-size:12px;font-weight:500;display:block;margin-bottom:6px">Valor do atendimento (R$)</label>
    <input id="reatribuir-valor" inputmode="numeric" data-moeda autocomplete="off" value="${moedaParaCampo(item.valor)}" placeholder="0,00">
    ${item.valor_mensal ? `<p style="font-size:11.5px;margin:-4px 0 10px">Parte do valor mensal de ${formatarReais(item.valor_mensal)}, dividido entre os atendimentos do mês.</p>` : ''}
    ${!item.prestadora_id && item.profissional_externo ? `<div class="fin-alerta" style="font-size:12px;margin:0 0 10px">⚠ <b>${escapeHtml(item.profissional_externo)}</b> está na agenda,
      mas é uma <b>prestadora sem cadastro no Portal da Maria</b>. ${usuarioLogado?.tipo === 'administrador' ? `<a href="#" onclick="event.preventDefault();abrirNovaPrestadora(${escapeHtml(JSON.stringify(item.profissional_externo))});fecharReatribuirPop()">Cadastrar agora</a>` : 'Peça ao administrador para cadastrá-la.'}</div>` : ''}
    <div class="form-actions">
      <button class="btn-sm ghost" onclick="fecharReatribuirPop()">Cancelar</button>
      <button class="btn-sm" onclick="salvarReatribuicao('${item.id}')">Salvar</button>
    </div>`;
  document.body.appendChild(pop);
  pop.style.left = Math.min(rect.right + window.scrollX + 8, window.innerWidth - 276) + 'px';
  pop.style.top = (rect.top + window.scrollY) + 'px';
}
function fecharReatribuirPop() { document.getElementById('reatribuir-pop')?.remove(); }
// quem pediu e o motivo só aparecem quando a situação escolhida é "cancelado" e o atendimento ainda não estava cancelado
function mostrarCamposCancelamento() {
  const pergunta = reatribuirItem?.status !== 'cancelado' && document.getElementById('reatribuir-situacao')?.value === 'cancelado';
  const bloco = document.getElementById('reatribuir-cancelamento');
  if (bloco) bloco.style.display = pergunta ? '' : 'none';
}

// Preenche a aba de WhatsApp (já aberta no clique, ver salvarReatribuicao) com o
// aviso de novo atendimento pra prestadora. A confirmação só acontece no portal
// (o sistema não lê respostas do WhatsApp), então a mensagem leva o link de
// acesso à conta dela; e a confirmação só abre 2 dias antes — avisa quando ainda não abriu.
function avisarPrestadoraPorWhatsApp(aba, prest, atendimento) {
  if (!aba) return;
  if (!prest || !prest.telefone) { aba.close(); return; }
  const dataFmt = String(atendimento.data_atendimento).slice(0, 10);
  const diasAteLa = Math.round((new Date(dataFmt + 'T00:00:00Z') - new Date(hojeISOBrasil() + 'T00:00:00Z')) / 86400000);
  const mensagem = `Olá, ${prest.nome}! Você tem um novo atendimento pela Maria Brasileira:\n`
    + `Serviço: ${atendimento.tipo_servico}${atendimento.area ? ' — ' + atendimento.area : ''}\n`
    + `Data: ${dataFmt}${atendimento.hora_atendimento ? ' às ' + atendimento.hora_atendimento.slice(0, 5) : ''}\n`
    // valor_pago = o que a franquia paga a ela (nunca o preço do cliente); sem tarifa definida, a linha some
    + (atendimento.valor_pago ? `Valor a receber: ${formatarReais(atendimento.valor_pago)}\n` : '')
    + `\nPara confirmar ou recusar, acesse a sua conta no Portal da Maria:\n${linkAcessoPrestadora()}\n`
    + (diasAteLa > 2 ? `\nA confirmação fica disponível a partir de 2 dias antes do atendimento.\n` : '')
    + `\nQualquer dúvida, é só responder aqui.`;
  aba.location.href = linkWhatsApp(prest.telefone, mensagem);
}
async function salvarReatribuicao(atendimentoId) {
  const item = reatribuirItem;
  if (!item || item.id !== atendimentoId) { fecharReatribuirPop(); return; }
  const situacaoAtual = situacoesDisponiveis(item).atual;
  const situacao = document.getElementById('reatribuir-situacao').value;
  const mudouSituacao = situacao !== situacaoAtual;
  const prestadoraId = prestadoraTravada(item) ? (item.prestadora_id || null) : (document.getElementById('reatribuir-select').value || null);
  const local = document.getElementById('reatribuir-local').value.trim();
  const valor = lerReais(document.getElementById('reatribuir-valor').value);
  if (Number.isNaN(valor)) { toast('Valor inválido — use números, ex.: 150,00.'); return; }
  const mudouPrestadora = prestadoraId !== (item.prestadora_id || null);
  const mudouLocal = local !== (item.area || '');
  const mudouValor = valor !== (item.valor === null || item.valor === undefined ? null : Number(item.valor));
  if (!mudouSituacao && !mudouPrestadora && !mudouLocal && !mudouValor) { fecharReatribuirPop(); return; }
  // ao cancelar, vai junto quem pediu e o motivo (lidos agora, antes de a janelinha fechar)
  const dadosCancelamento = situacao === 'cancelado' && item.status !== 'cancelado'
    ? { cancelado_por: document.getElementById('reatribuir-cancel-quem')?.value || null, motivo: (document.getElementById('reatribuir-cancel-motivo')?.value || '').trim() } : {};
  const mudarSituacao = () => apiComConfirmacao(`/atendimentos/admin/${currentUnit}/${atendimentoId}/situacao`, { method: 'POST', body: JSON.stringify({ situacao, ...dadosCancelamento }) });

  // Abre a aba em branco ANTES do await: depois que a resposta da API chega
  // o navegador já não considera mais isso "gesto do usuário" e bloqueia o
  // popup — abrir agora e só trocar a URL depois contorna isso.
  const aba = mudouPrestadora && prestadoraId ? abrirAbaEmBranco() : null;
  try {
    let atendimento = item;
    // reativar (cancelado/concluído → programado) vem antes: só então prestadora e valor voltam a poder mudar
    if (mudouSituacao && situacao === 'programado') atendimento = await mudarSituacao();
    // o local vai primeiro: o aviso de WhatsApp da nova prestadora já sai com o local certo
    if (mudouLocal) atendimento = await api(`/atendimentos/admin/${currentUnit}/${atendimentoId}/local`, { method: 'PATCH', body: JSON.stringify({ area: local }) });
    if (mudouValor) atendimento = await api(`/atendimentos/admin/${currentUnit}/${atendimentoId}/valor`, { method: 'PATCH', body: JSON.stringify({ valor }) });
    if (mudouPrestadora) atendimento = await apiComConfirmacao(`/atendimentos/admin/${currentUnit}/${atendimentoId}/reatribuir`, { method: 'POST', body: JSON.stringify({ prestadora_id: prestadoraId }) });
    // concluir/cancelar vem por último, com os demais campos já salvos
    if (mudouSituacao && situacao !== 'programado') atendimento = await mudarSituacao();
    fecharReatribuirPop();
    const alterados = [mudouSituacao && 'situação', mudouPrestadora && 'prestadora', mudouLocal && 'local', mudouValor && 'valor'].filter(Boolean);
    toast(alterados.length === 1
      ? { 'situação': { programado: 'Atendimento reativado como programado.', concluido: 'Atendimento marcado como concluído.', falta: 'Falta registrada: a prestadora não foi. É um controle interno da franquia — ela não é avisada nem vê isso.', cancelado: 'Atendimento cancelado — não entra mais nas contagens' + (atendimento.prestadora_avisada ? ' e a prestadora foi avisada no portal.' : '.') }[situacao], prestadora: 'Prestadora atualizada.', local: local ? 'Local atualizado.' : 'Local removido.', valor: valor === null ? 'Valor removido.' : 'Valor atualizado.' }[alterados[0]]
      : 'Atendimento atualizado (' + alterados.join(', ') + ').');
    if (mudouPrestadora) avisarPrestadoraPorWhatsApp(aba, (prestadorasAgenda[currentUnit] || []).find(p => p.id === prestadoraId), atendimento);
    selecionarDiaAgenda(diaSelecionadoAgenda);
  } catch (err) {
    if (aba) aba.close();
    toast(err.cancelado ? 'Nada foi alterado.' : 'Erro ao salvar: ' + err.message);
    selecionarDiaAgenda(diaSelecionadoAgenda); // se só uma das duas chamadas passou, a agenda mostra o que de fato ficou salvo
  }
}
