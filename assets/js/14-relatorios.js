/* Portal da Maria — Relatórios
   Agenda, Financeiro e Satisfação por período, com gráficos, tabelas, CSV e impressão. */

/* ===== Relatórios =====
   Os números vêm prontos da API (/api/relatorios/<unidade>/agenda|financeiro|satisfacao); aqui só se desenha.
   Só o administrador completo abre esta aba (ela mostra faltas, metas e margem). O período é o do SERVIÇO (data do
   atendimento): "atendimento" = tudo que não foi cancelado nem falta; cancelado e falta não geram receita nem repasse. */
let relAba = 'agenda';
let relPeriodo = { modo: 'preset', preset: 'mes', mes: null, de: '', ate: '' }; // modo: 'preset' | 'mes' (AAAA-MM) | 'custom'
let relEscopo = 'unidade';     // 'unidade' (a aberta no topo) | 'todas' (soma das unidades do administrador)
let relDados = null;           // última resposta carregada da aba aberta (também é a base da planilha CSV)
let relSeq = 0;                // descarta resposta de pedido antigo (a pessoa trocou de aba/período no meio)
let relPersonalizadoAberto = false;

const REL_PRESETS = [['mes', 'Este mês'], ['mes_anterior', 'Mês passado'], ['30d', '30 dias'], ['90d', '90 dias'], ['ano', 'Este ano'], ['12m', '12 meses']];
const REL_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const REL_DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const REL_SITUACAO = { pedido: 'Pedido sem prestadora', proposto: 'Convite enviado', recusado: 'Recusado', aceito: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', falta: 'Falta da prestadora' };
const REL_ORIGEM = { site: 'Pelo site', whatsapp: 'Por WhatsApp', manual: 'Cadastro manual', importacao: 'Planilha importada' };
const REL_GRAN = { dia: 'dia', semana: 'semana', mes: 'mês' };

const relInt = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR'));
const relDec = (n, c = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }));
const relPct = v => (v === null || v === undefined ? '—' : relDec(v, 1) + '%');
const relHoras = h => (h === null || h === undefined ? '—' : relDec(h, Number.isInteger(h) ? 0 : 1) + ' h');
const relReais = v => (v === null || v === undefined ? '—' : finReais(v));
const relMoeda = v => (v === null || v === undefined ? '—' : '<small>R$</small> ' + finNum(v));

// "▲ 12% vs. anterior" — verde quando melhorou; em indicador que é melhor quando cai (faltas, cancelamentos) a cor se inverte
function relVar(atual, antes, menorMelhor = false) {
  if (atual === null || atual === undefined || antes === null || antes === undefined) return '';
  if (antes === 0) return atual > 0 ? ' · novo (nada no período anterior)' : '';
  const d = Math.round((atual - antes) / antes * 100);
  if (d === 0) return ' · igual ao período anterior';
  const bom = menorMelhor ? d < 0 : d > 0;
  return ` · <span class="${bom ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span> vs. anterior`;
}
// rótulo de um balde do gráfico: curto no eixo, completo na dica
function relRotulo(chave, gran, longo) {
  const [a, m, d] = chave.split('-');
  if (gran === 'mes') return longo ? finRotuloMes(chave) : REL_MESES[+m - 1] + '/' + a.slice(2);
  if (gran === 'semana') return longo ? `Semana de ${d}/${m}` : `${d}/${m}`;
  return longo ? `${d}/${m}/${a} (${REL_DIAS[new Date(+a, +m - 1, +d).getDay()]})` : d;
}
function relEhMes(per) {
  const [a, m] = per.de.split('-').map(Number);
  return per.de.endsWith('-01') && per.ate === per.de.slice(0, 8) + String(new Date(a, m, 0).getDate()).padStart(2, '0');
}

// ---------- blocos de desenho ----------
function relCard(rotulo, valor, trend, cls = '') {
  return `<div class="stat ${cls}"><div class="stat-label">${rotulo}</div><div class="stat-value">${valor}</div><div class="stat-trend">${trend}</div></div>`;
}
const relPainel = (titulo, corpo, contagem = '') => `<div class="panel"><div class="panel-head"><h2>${titulo}</h2>${contagem ? `<span class="count">${contagem}</span>` : ''}</div>${corpo}</div>`;
const relTexto = t => `<p class="fin-nota">${t}</p>`;
const relVazio = t => `<div class="empty">${t}</div>`;
const relAlertas = lista => lista.map(a => `<div class="fin-alerta">⚠ ${a}</div>`).join('');

// barras horizontais: itens já ordenados; cor(i) devolve '', 'ruim', 'azul' ou 'ambar'
function relBarras(itens, { valor, rotulo, texto, cor = () => '' }) {
  if (!itens.length) return relVazio('Sem dados neste período.');
  const max = Math.max(...itens.map(valor), 0) || 1;
  return `<div class="rel-barras">${itens.map(i => {
    const v = valor(i), largura = v > 0 ? Math.max(2, v / max * 100) : 0;
    return `<div class="rel-linha"><span class="rel-rot" title="${escapeHtml(rotulo(i))}">${escapeHtml(rotulo(i))}</span><span class="rel-trilho"><span class="rel-preench ${cor(i)}" style="width:${largura}%"></span></span><span class="rel-val">${texto(i)}</span></div>`;
  }).join('')}</div>`;
}

// colunas por período: modo 'empilhado' (partes somam) ou 'lado' (partes lado a lado). baldes: [{ chave, partes: [{ v, cls }], dica }]
function relColunas(baldes, gran, { modo, legenda, fmtMax = relInt, max = null, escala = true }) {
  const soma = b => b.partes.reduce((s, p) => s + p.v, 0);
  const topo = max || Math.max(...baldes.map(b => (modo === 'empilhado' ? soma(b) : Math.max(...b.partes.map(p => p.v)))), 0) || 1;
  const passo = Math.max(1, Math.ceil(baldes.length / 8));
  const altura = v => (v > 0 ? `max(2px, ${(v / topo * 100).toFixed(2)}%)` : '0');
  const cols = baldes.map(b => {
    const barras = modo === 'empilhado'
      ? `<span class="rel-pilha">${b.partes.map(p => `<span class="rel-seg ${p.cls}" style="height:${altura(p.v)}"></span>`).join('')}</span>`
      : `<span class="rel-par">${b.partes.map(p => `<span class="rel-bar ${p.cls}" style="height:${altura(p.v)}"></span>`).join('')}</span>`;
    return `<div class="rel-col" title="${escapeHtml(b.dica)}">${barras}</div>`;
  }).join('');
  const eixo = baldes.map((b, i) => `<span>${i % passo === 0 ? relRotulo(b.chave, gran, false) : ''}</span>`).join('');
  const leg = legenda ? `<div class="rel-legenda">${legenda.map(([cls, t]) => `<span><i class="${cls}"></i>${t}</span>`).join('')}</div>` : '';
  return `<div class="rel-grafico">${escala ? `<div class="rel-escala">máx. ${fmtMax(topo)}</div>` : ''}<div class="rel-area">${cols}</div><div class="rel-eixo">${eixo}</div>${leg}</div>`;
}

// tabela: cabecalho [[texto, 'num'?]]; linhas = matriz de células JÁ em HTML (escape feito por quem monta)
function relTabela(cabecalho, linhas) {
  if (!linhas.length) return relVazio('Sem dados neste período.');
  return `<div class="rel-rolagem"><table class="rel-tab"><thead><tr>${cabecalho.map(([t, c]) => `<th class="${c || ''}">${t}</th>`).join('')}</tr></thead><tbody>${
    linhas.map(l => `<tr>${l.map((c, i) => `<td class="${cabecalho[i][1] || ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// mapa de calor: dia da semana × hora de início
function relCalor(calor) {
  const cel = calor.celulas;
  if (!cel.length) return relVazio('Nenhum atendimento com horário neste período.');
  const h0 = Math.min(...cel.map(c => c.hora)), h1 = Math.max(...cel.map(c => c.hora));
  const max = Math.max(...cel.map(c => c.qtd));
  const mapa = new Map(cel.map(c => [c.dow + ':' + c.hora, c.qtd]));
  const dias = [1, 2, 3, 4, 5, 6].concat(cel.some(c => c.dow === 7) ? [7] : []);
  const nomes = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const colunas = h1 - h0 + 1;
  let html = `<div class="rel-rolagem"><div class="rel-calor" style="grid-template-columns:44px repeat(${colunas}, minmax(24px, 1fr))"><span></span>`;
  for (let h = h0; h <= h1; h++) html += `<span class="h">${h}h</span>`;
  for (const dow of dias) {
    html += `<span class="d">${nomes[dow]}</span>`;
    for (let h = h0; h <= h1; h++) {
      const q = mapa.get(dow + ':' + h) || 0, i = q / max;
      html += `<span class="rel-cel ${i > 0.55 ? 'forte' : ''}" style="--i:${q ? (0.18 + 0.82 * i).toFixed(2) : 0}" title="${nomes[dow]}, ${h}h: ${plural(q, 'atendimento', 'atendimentos')}"><span>${q || ''}</span></span>`;
    }
  }
  return html + `</div></div>${calor.sem_horario ? relTexto(`${plural(calor.sem_horario, 'atendimento está', 'atendimentos estão')} sem horário definido e não aparece${calor.sem_horario === 1 ? '' : 'm'} no mapa.`) : ''}`;
}

const relStatusChip = s => ({ aprovada: '<span class="chip chip-on">aprovada</span>', pendente: '<span class="chip chip-off">aguardando moderação</span>', recusada: '<span class="chip chip-off">recusada</span>' }[s] || '');
const relNomePrestadora = p => escapeHtml(p.nome) + (p.ativa === false ? ' <span class="chip chip-off">inativa</span>' : '');
// quem pediu o cancelamento (do histórico de status)
const REL_QUEM_CANCELOU = { cliente: 'O cliente pediu', franquia: 'A franquia cancelou', prestadora: 'A prestadora cancelou', nao_informado: 'Não informado', sem_registro: 'Anterior ao histórico' };
const REL_COR_QUEM = { cliente: 'azul', franquia: '', prestadora: 'ruim', nao_informado: 'ambar', sem_registro: 'ambar' };
const relMotivo = m => (m === null ? 'Sem motivo informado' : m);
const relDiasOuHoras = h => (h === null || h === undefined ? '—' : Math.abs(h) >= 48 ? relDec(h / 24, 1) + ' dias' : relHoras(h));
// o histórico de status só existe desde o dia em que passou a ser gravado: o que é anterior fica de fora desses indicadores
function relAvisoHistorico(h) {
  if (!h || !h.sem_historico) return '';
  return relTexto(`${plural(h.sem_historico, 'atendimento do período é anterior', 'atendimentos do período são anteriores')} ao histórico de status${h.desde ? ' (gravado desde ' + dataHoraBR(h.desde) + ')' : ''}: ${h.sem_historico === 1 ? 'fica' : 'ficam'} de fora do funil real, do tempo de resposta aos convites e do motivo dos cancelamentos.`);
}

// ---------- carregamento e controles ----------
function relQuery() {
  const p = relPeriodo, q = [];
  if (p.modo === 'custom') q.push('de=' + encodeURIComponent(p.de), 'ate=' + encodeURIComponent(p.ate));
  else if (p.modo === 'mes' && p.mes) q.push('mes=' + p.mes);
  else q.push('preset=' + p.preset);
  if (relEscopo === 'todas') q.push('escopo=todas');
  return '?' + q.join('&');
}
function relMarcarAba() {
  // funcionário sem a permissão Financeiro: sem a aba de receita/margem
  const podeFin = permissoesAtuais().financeiro;
  document.getElementById('rel-aba-financeiro').style.display = podeFin ? '' : 'none';
  if (!podeFin && relAba === 'financeiro') relAba = 'agenda';
  ['agenda', 'financeiro', 'satisfacao'].forEach(a => {
    const b = document.getElementById('rel-aba-' + a);
    b.classList.toggle('active', a === relAba); b.setAttribute('aria-selected', a === relAba ? 'true' : 'false');
  });
}
function relRenderControles() {
  const d = relDados, per = d?.periodo;
  const mesAtual = d ? d.hoje.slice(0, 7) : null;
  const ativo = relPersonalizadoAberto || relPeriodo.modo === 'custom' ? 'custom'
    : relPeriodo.modo === 'mes' ? (relPeriodo.mes === mesAtual ? 'mes' : '') : relPeriodo.preset;
  const chips = REL_PRESETS.map(([id, rot]) => `<button class="rel-chip ${ativo === id ? 'active' : ''}" onclick="relEscolherPreset('${id}')">${rot}</button>`).join('')
    + `<button class="rel-chip ${ativo === 'custom' ? 'active' : ''}" onclick="relAbrirPersonalizado()">Personalizado</button>`;
  const passo = per && relEhMes(per)
    ? `<div class="rel-passo"><button class="btn-sm ghost" onclick="relMudarMes(-1)" aria-label="Mês anterior">‹</button><strong>${finRotuloMes(per.de.slice(0, 7))}</strong><button class="btn-sm ghost" onclick="relMudarMes(1)" aria-label="Próximo mês">›</button></div>` : '';
  document.getElementById('rel-chips').innerHTML = passo + chips;
}
async function renderRelatorios() {
  document.getElementById('rel-unit').textContent = unidades[currentUnit].nome;
  const slugs = unidadesDoLogin(), varias = slugs.length > 1;
  document.getElementById('rel-escopo-wrap').style.display = varias ? '' : 'none';
  if (!varias) relEscopo = 'unidade';
  else {
    const sel = document.getElementById('rel-escopo');
    sel.innerHTML = `<option value="unidade">Só ${escapeHtml(unidades[currentUnit].nome)}</option><option value="todas">Todas as minhas unidades (${slugs.length})</option>`;
    sel.value = relEscopo;
  }
  document.getElementById('rel-custom').style.display = relPersonalizadoAberto ? 'flex' : 'none';
  relMarcarAba();
  relRenderControles();
  await relCarregar({ mostrarCarregando: true });
}
// Sem `mostrarCarregando` (atualização em segundo plano) o relatório antigo fica na tela até o novo chegar.
async function relCarregar(opcoes = {}) {
  if (!currentUnit) return;
  const seq = ++relSeq, aba = relAba, alvo = document.getElementById('rel-conteudo');
  if (opcoes.mostrarCarregando) alvo.innerHTML = relVazio('Carregando o relatório…');
  let d;
  try { d = await api(`/relatorios/${currentUnit}/${aba}${relQuery()}`); }
  catch (err) { if (seq === relSeq && opcoes.mostrarCarregando) alvo.innerHTML = `<div class="atd-aviso">${escapeHtml(err.message)}</div>`; return; }
  if (seq !== relSeq) return; // chegou depois de a pessoa já ter pedido outra coisa
  relDados = { aba, ...d };
  relRenderControles();
  const per = d.periodo, nomes = d.unidades.map(u => u.nome);
  document.getElementById('rel-info').innerHTML = `<b class="rel-so-impressao">Relatório de ${{ agenda: 'Agenda', financeiro: 'Financeiro', satisfacao: 'Satisfação' }[aba]} · </b><b>${dataBR(per.de)} a ${dataBR(per.ate)}</b> · ${d.escopo === 'todas' && nomes.length > 1 ? 'todas as unidades (' + escapeHtml(nomes.join(', ')) + ')' : 'unidade ' + escapeHtml(nomes[0] || '')}`
    + ` · comparado com ${dataBR(per.anterior.de)} a ${dataBR(per.anterior.ate)} · por serviço realizado (data do atendimento)`;
  alvo.innerHTML = { agenda: relHtmlAgenda, financeiro: relHtmlFinanceiro, satisfacao: relHtmlSatisfacao }[aba](d);
}
function relAbrirAba(aba) { relAba = aba; relDados = null; relMarcarAba(); relCarregar({ mostrarCarregando: true }); }
function relMudarEscopo(valor) { relEscopo = valor === 'todas' ? 'todas' : 'unidade'; relCarregar({ mostrarCarregando: true }); }
function relEscolherPreset(id) {
  relPeriodo = { modo: 'preset', preset: id, mes: null, de: '', ate: '' };
  relPersonalizadoAberto = false; document.getElementById('rel-custom').style.display = 'none';
  relRenderControles(); relCarregar({ mostrarCarregando: true });
}
function relMudarMes(delta) {
  const base = relDados?.periodo.de.slice(0, 7);
  if (!base) return;
  const [a, m] = base.split('-').map(Number), n = new Date(a, m - 1 + delta, 1);
  relPeriodo = { modo: 'mes', preset: 'mes', mes: n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'), de: '', ate: '' };
  relPersonalizadoAberto = false; document.getElementById('rel-custom').style.display = 'none';
  relCarregar({ mostrarCarregando: true });
}
function relAbrirPersonalizado() {
  relPersonalizadoAberto = true;
  document.getElementById('rel-custom').style.display = 'flex';
  if (relDados) { document.getElementById('rel-de').value = relDados.periodo.de; document.getElementById('rel-ate').value = relDados.periodo.ate; }
  relRenderControles();
}
function relAplicarPersonalizado() {
  const de = document.getElementById('rel-de').value, ate = document.getElementById('rel-ate').value;
  if (!de || !ate) { toast('Escolha a data inicial e a final.'); return; }
  if (de > ate) { toast('A data inicial não pode ser depois da final.'); return; }
  relPeriodo = { modo: 'custom', preset: 'mes', mes: null, de, ate };
  relPersonalizadoAberto = false;
  relRenderControles(); relCarregar({ mostrarCarregando: true });
}

// ---------- AGENDA ----------
function relHtmlAgenda(d) {
  const r = d.resumo, a = d.anterior, per = d.periodo, gran = per.granularidade;
  const pctRec = (d.recorrencia.recorrentes + d.recorrencia.avulsos) ? d.recorrencia.recorrentes / (d.recorrencia.recorrentes + d.recorrencia.avulsos) * 100 : null;
  const cards = `<section class="stats">`
    + relCard('Atendimentos', relInt(r.total), `${relInt(r.concluidos)} concluídos · ${relInt(r.programados)} programados${relVar(r.total, a.total)}`)
    + relCard('Horas realizadas', relHoras(r.horas_realizadas), `${relHoras(r.horas_programadas)} ainda programadas${relVar(r.horas_realizadas, a.horas_realizadas)}`, 'b')
    + relCard('Cancelamentos', relInt(r.cancelados), `${relPct(r.taxa_cancelamento_pct)} do que foi agendado${relVar(r.cancelados, a.cancelados, true)}`, 'a')
    + relCard('Faltas da prestadora', relInt(r.faltas), `${relPct(r.taxa_faltas_pct)} do que devia acontecer${relVar(r.faltas, a.faltas, true)}`, 'a')
    + `</section><section class="stats">`
    + relCard('Taxa de recusa', relPct(d.recusas.taxa_pct), `${plural(d.recusas.total, 'recusa', 'recusas')} em ${plural(d.recusas.convites, 'convite', 'convites')}`)
    + relCard('Clientes atendidos', relInt(d.clientes.ativos), `${relInt(d.clientes.voltaram)} voltaram a agendar · ${relInt(d.clientes.novos)} novos cadastros`, 'b')
    + relCard('Atendimentos recorrentes', relInt(d.recorrencia.recorrentes), `${relPct(pctRec === null ? null : Math.round(pctRec * 10) / 10)} do total · ${relInt(d.recorrencia.avulsos)} avulsos`)
    + relCard('Prestadoras sem atendimento', relInt(d.ociosas.length), d.ociosas.length ? escapeHtml(d.ociosas.slice(0, 3).map(p => p.nome).join(', ')) + (d.ociosas.length > 3 ? '…' : '') : 'todas as ativas trabalharam', 'a')
    + `</section>`;

  const al = d.alertas, avisos = [];
  if (al.sem_prestadora_passados) avisos.push(`<b>${plural(al.sem_prestadora_passados, 'atendimento passou', 'atendimentos passaram')}</b> sem prestadora atribuída — ninguém foi escalado para ${al.sem_prestadora_passados === 1 ? 'ele' : 'eles'}.`);
  if (al.sem_prestadora_futuros) avisos.push(`<b>${plural(al.sem_prestadora_futuros, 'atendimento futuro', 'atendimentos futuros')}</b> ainda sem prestadora.`);
  if (al.choques.atendimentos) avisos.push(`<b>${plural(al.choques.atendimentos, 'atendimento', 'atendimentos')}</b> com horário sobreposto para a mesma prestadora (${plural(al.choques.prestadoras, 'prestadora', 'prestadoras')}).`);
  if (al.sem_vinculo_planilha) avisos.push(`<b>${plural(al.sem_vinculo_planilha, 'atendimento', 'atendimentos')}</b> com profissional da planilha sem cadastro no portal — não entram nos números por prestadora.`);
  if (al.convites_vencidos) avisos.push(`<b>${plural(al.convites_vencidos, 'convite', 'convites')}</b> venceram sem resposta.`);
  const acima = d.prestadoras.filter(p => p.acima_meta);
  if (acima.length) avisos.push(`<b>${escapeHtml(acima.map(p => p.nome).join(', '))}</b> ${acima.length === 1 ? 'está' : 'estão'} acima da meta de faltas.`);

  const serie = relColunas(d.serie.map(s => ({
    chave: s.chave, partes: [{ v: s.concluidos, cls: 'k-conc' }, { v: s.programados, cls: 'k-prog' }],
    dica: `${relRotulo(s.chave, gran, true)}: ${plural(s.total, 'atendimento', 'atendimentos')} (${s.concluidos} concluído(s), ${s.programados} programado(s))${s.cancelados ? ' · ' + s.cancelados + ' cancelado(s)' : ''}${s.faltas ? ' · ' + s.faltas + ' falta(s)' : ''}`,
  })), gran, { modo: 'empilhado', legenda: [['k-conc', 'Concluídos'], ['k-prog', 'Programados']] });

  const funil = relBarras(d.funil.filter(f => f.qtd > 0 || ['concluido', 'aceito', 'pedido'].includes(f.status)), {
    valor: f => f.qtd, rotulo: f => REL_SITUACAO[f.status], texto: f => relInt(f.qtd), cor: f => (['cancelado', 'falta'].includes(f.status) ? 'ruim' : f.status === 'concluido' ? '' : 'azul'),
  });
  const semana = relBarras(d.dia_semana.filter(x => x.dow < 7 || x.qtd > 0), { valor: x => x.qtd, rotulo: x => x.nome, texto: x => relInt(x.qtd) });
  const servicos = relBarras(d.por_servico, { valor: s => s.qtd, rotulo: s => s.tipo_servico, texto: s => `${relInt(s.qtd)} · ${relHoras(s.horas)}` });
  const origem = relBarras(d.por_origem, { valor: o => o.qtd, rotulo: o => REL_ORIGEM[o.origem] || o.origem, texto: o => relInt(o.qtd), cor: () => 'azul' });

  const prest = relTabela(
    [['Prestadora'], ['Concluídos', 'num'], ['Programados', 'num'], ['Horas', 'num'], ['Faltas', 'num'], ['Recusas', 'num'], ['Cancel.', 'num'], ['Resposta', 'num']],
    d.prestadoras.map(p => [
      relNomePrestadora(p), relInt(p.concluidos), relInt(p.programados), relHoras(p.horas_realizadas),
      `<span class="${p.acima_meta ? 'rel-ruim' : ''}" title="${p.meta_pct === null ? 'Meta de faltas não definida (Equipe → Meta de faltas)' : 'Meta: até ' + relPct(p.meta_pct)}">${p.faltas ? p.faltas + ' (' + relPct(p.taxa_faltas_pct) + ')' : '0'}${p.acima_meta ? ' ⚠' : ''}</span>`,
      p.recusas ? `${p.recusas} (${relPct(p.taxa_recusa_pct)})` : '0',
      `<span title="${p.cancelou_ela ? 'Cancelamentos pedidos por ela: ' + p.cancelou_ela : ''}">${relInt(p.cancelados)}${p.cancelou_ela ? ' (' + p.cancelou_ela + ' por ela)' : ''}</span>`,
      p.respondidos ? `<span title="Tempo médio até aceitar ou recusar um convite (${plural(p.respondidos, 'resposta', 'respostas')})">${relDiasOuHoras(p.resposta_media_h)}</span>` : '—',
    ]));
  const clientes = relTabela([['Cliente'], ['Atend.', 'num'], ['Concluídos', 'num']], d.clientes.top.map(c => [escapeHtml(c.cliente), relInt(c.qtd), relInt(c.concluidos)]));
  const locais = relBarras(d.por_local, { valor: l => l.qtd, rotulo: l => l.area, texto: l => relInt(l.qtd), cor: () => 'azul' });
  const avisosPrest = d.avisos.enviados
    ? `<div class="tablerow"><div class="tr-body"><strong>${plural(d.avisos.enviados, 'aviso de cancelamento enviado', 'avisos de cancelamento enviados')}</strong><span>${d.avisos.lidos} lido(s) · ${d.avisos.nao_lidos} ainda sem ler${d.avisos.horas_ate_ler === null ? '' : ' · ' + relHoras(d.avisos.horas_ate_ler) + ' em média até a prestadora ler'}</span></div></div>`
    : relVazio('Nenhum aviso de cancelamento enviado neste período.');
  // ----- do histórico de status -----
  const fr = d.funil_real;
  const funilReal = fr.base
    ? relBarras(fr.etapas, { valor: e => e.qtd, rotulo: e => e.rotulo, texto: e => (e.etapa === 'pedido' ? relInt(e.qtd) : `${relInt(e.qtd)} · ${relPct(e.pct_do_inicio)}`), cor: e => (e.etapa === 'concluido' ? '' : 'azul') })
      + relTexto(`Por quantas etapas cada atendimento passou (quem chegou a uma etapa também passou pelas anteriores). No caminho, ${plural(fr.desfechos.recusados, 'atendimento teve convite recusado', 'atendimentos tiveram convite recusado')}, `
        + `${plural(fr.desfechos.cancelados, 'foi cancelado', 'foram cancelados')} e ${plural(fr.desfechos.faltas, 'teve falta', 'tiveram falta')}. Dos confirmados, ${plural(fr.aceitos_pela_prestadora, 'foi aceito', 'foram aceitos')} pela própria prestadora; nos demais a unidade deu como combinado ou o sistema confirmou quando o horário chegou. `
        + `Atendimentos futuros ainda não chegaram ao fim.${fr.importados ? ` Ficam de fora ${plural(fr.importados, 'atendimento da planilha', 'atendimentos da planilha')} (entram prontos, sem o caminho).` : ''}`)
    : relVazio('Ainda não há histórico de status para os atendimentos deste período.');

  const rc = d.resposta_convites;
  const respostaConvites = rc.convites
    ? `<p class="fin-nota" style="margin:0 0 10px"><b>${plural(rc.convites, 'convite enviado', 'convites enviados')}</b> · ${plural(rc.respondidos, 'respondido', 'respondidos')} (${rc.aceitos} ${rc.aceitos === 1 ? 'aceite' : 'aceites'}, ${plural(rc.recusados, 'recusa', 'recusas')})`
      + `${rc.respondidos ? ` · tempo médio <b>${relDiasOuHoras(rc.tempo_medio_h)}</b> (mediana ${relDiasOuHoras(rc.mediana_h)}; ${relPct(rc.ate_24h_pct)} em até 24 h)` : ''}`
      + `${rc.sem_resposta ? ` · ${plural(rc.sem_resposta, 'sem resposta dela', 'sem resposta delas')}` : ''}${rc.em_aberto ? ` · ${rc.em_aberto} em aberto` : ''}${rc.trocados ? ` · ${plural(rc.trocados, 'passou', 'passaram')} a outra prestadora/cancelou antes da resposta` : ''}</p>`
      + relTabela([['Prestadora'], ['Convites', 'num'], ['Aceites', 'num'], ['Recusas', 'num'], ['Sem resposta', 'num'], ['Tempo médio', 'num'], ['Mediana', 'num'], ['Em até 24 h', 'num']],
        rc.por_prestadora.map(p => [relNomePrestadora(p), relInt(p.convites), relInt(p.aceitos), relInt(p.recusados), relInt(p.sem_resposta + p.trocados + p.em_aberto), relDiasOuHoras(p.tempo_medio_h), relDiasOuHoras(p.mediana_h), relPct(p.ate_24h_pct)]))
      + relTexto('Tempo de resposta = do convite até ela aceitar ou recusar. O aceite só abre 2 dias antes do atendimento: num convite feito com mais antecedência o tempo conta a partir dessa abertura (a recusa conta desde o convite). '
        + 'Sem resposta = a unidade deu como combinado, o sistema confirmou/concluiu quando o horário chegou, ou o convite foi passado a outra prestadora, cancelado ou segue em aberto. Quem demora mais aparece primeiro. Isto é controle interno da franquia: a prestadora não vê.')
    : relVazio('Nenhum convite com histórico neste período.');

  const cn = d.cancelamentos, ant = cn.antecedencia;
  const cancelQuem = cn.total
    ? relBarras(cn.por_quem.filter(x => x.qtd > 0), { valor: x => x.qtd, rotulo: x => REL_QUEM_CANCELOU[x.quem], texto: x => `${relInt(x.qtd)} · ${relPct(x.pct)}`, cor: x => REL_COR_QUEM[x.quem] })
      + (ant.avaliados ? relTexto(`${relPct(ant.menos_24h_pct)} dos cancelamentos (${ant.menos_24h} de ${ant.avaliados}) foram feitos com menos de 24 h para o início${ant.depois_do_inicio ? `, ${ant.depois_do_inicio} deles já depois de o atendimento começar` : ''}. Mediana: ${relDiasOuHoras(ant.mediana_h)} de antecedência.`) : '')
    : relVazio('Nenhum cancelamento neste período.');
  const cancelMotivos = cn.total
    ? relBarras(cn.motivos, { valor: m => m.qtd, rotulo: m => relMotivo(m.motivo), texto: m => relInt(m.qtd), cor: m => (m.motivo === null ? 'ambar' : 'azul') })
      + relTexto('O motivo é opcional e digitado pela unidade ao cancelar; escritas parecidas ("Viagem", "viagem.") são somadas.')
    : relVazio('Nenhum cancelamento neste período.');

  const unidades = d.por_unidade.length ? `<div class="rel-bloco">${relPainel('Comparativo entre unidades', relTabela(
    [['Unidade'], ['Atendimentos', 'num'], ['Concluídos', 'num'], ['Programados', 'num'], ['Cancel.', 'num'], ['Faltas', 'num'], ['Horas realizadas', 'num']],
    d.por_unidade.map(u => [escapeHtml(u.nome), relInt(u.total), relInt(u.concluidos), relInt(u.programados), relInt(u.cancelados), relInt(u.faltas), relHoras(u.horas_realizadas)])))}</div>` : '';

  return cards + relAlertas(avisos)
    + `<div class="rel-bloco">${relPainel(`Atendimentos por ${REL_GRAN[gran]}`, serie, relInt(r.total) + ' no período')}</div>`
    + `<div class="rel-2">${relPainel('Situação dos atendimentos', funil)}${relPainel('Dias da semana', semana)}</div>`
    + `<div class="rel-bloco">${relPainel('Do pedido ao atendimento concluído', funilReal, fr.base ? plural(fr.base, 'atendimento', 'atendimentos') : '')}</div>`
    + `<div class="rel-bloco">${relPainel('Horários mais movimentados', relCalor(d.calor))}</div>`
    + `<div class="rel-2">${relPainel('Serviços mais pedidos', servicos)}${relPainel('Origem dos pedidos', origem)}</div>`
    + `<div class="rel-bloco">${relPainel('Prestadoras', prest, plural(d.prestadoras.length, 'com movimento', 'com movimento'))}${relTexto('Faltas: taxa = faltas ÷ (concluídos + faltas), comparada com a meta definida na Equipe. Recusas: convites que ela recusou ÷ convites que recebeu. Isto é controle interno da franquia: a prestadora não vê.')}</div>`
    + `<div class="rel-bloco">${relPainel('Resposta das prestadoras aos convites', respostaConvites, rc.respondidos ? plural(rc.respondidos, 'resposta', 'respostas') : '')}</div>`
    + `<div class="rel-2">${relPainel('Quem cancelou', cancelQuem, plural(cn.total, 'cancelamento', 'cancelamentos'))}${relPainel('Motivos dos cancelamentos', cancelMotivos)}</div>`
    + `<div class="rel-2">${relPainel('Clientes que mais agendam', clientes)}${relPainel('Locais mais atendidos', locais)}</div>`
    + `<div class="rel-bloco">${relPainel('Avisos às prestadoras', avisosPrest)}</div>`
    + unidades
    + relAvisoHistorico(d.historico);
}

// ---------- FINANCEIRO ----------
function relHtmlFinanceiro(d) {
  const re = d.realizado, an = d.anterior, pv = d.previsto, per = d.periodo, gran = per.granularidade, rep = d.repasses, pd = d.perdido;
  const cards = `<section class="stats">`
    + relCard('Receita realizada', relMoeda(re.receita), `${plural(re.qtd, 'atendimento concluído', 'atendimentos concluídos')}${relVar(re.receita, an.receita)}`)
    + relCard('Custo (repasses)', relMoeda(re.custo), `${relReais(rep.pendente)} a pagar${relVar(re.custo, an.custo, true)}`, 'b')
    + relCard('Margem', relMoeda(re.margem), `${relPct(re.margem_pct)}${re.completos < re.qtd ? ` · calculada em ${re.completos} de ${re.qtd}` : ''}${relVar(re.margem, an.margem)}`, 'a')
    + relCard('Ticket médio', relMoeda(re.ticket_medio), `${relReais(re.receita_hora)} por hora trabalhada${relVar(re.ticket_medio, an.ticket_medio)}`)
    + `</section><section class="stats">`
    + relCard('A realizar no período', relMoeda(pv.receita), `${plural(pv.qtd, 'atendimento', 'atendimentos')} · custo previsto ${relReais(pv.custo)}`)
    + relCard('Receita perdida', relMoeda(pd.receita), `${relReais(pd.cancelados.receita)} em ${plural(pd.cancelados.qtd, 'cancelamento', 'cancelamentos')} · ${relReais(pd.faltas.receita)} em ${plural(pd.faltas.qtd, 'falta', 'faltas')}`, 'a')
    + relCard('Repasses pagos', relMoeda(rep.pago), `de ${relReais(rep.total)} no total`, 'b')
    + relCard('Maior cliente', relPct(d.concentracao.top1_pct), `da receita · os 3 maiores: ${relPct(d.concentracao.top3_pct)}`)
    + `</section>`;

  const al = d.alertas, avisos = [];
  if (al.realizados_sem_valor) avisos.push(`<b>${plural(al.realizados_sem_valor, 'atendimento concluído', 'atendimentos concluídos')}</b> sem valor cobrado — a receita está subestimada. <a style="cursor:pointer;text-decoration:underline" onclick="adminView('financeiro')">Corrigir no Financeiro</a>`);
  if (al.realizados_sem_custo) avisos.push(`<b>${plural(al.realizados_sem_custo, 'atendimento concluído', 'atendimentos concluídos')}</b> sem custo (prestadora sem valor por atendimento, ou sem prestadora) — o custo está subestimado e a margem só considera os completos.`);
  if (pv.sem_prestadora_qtd) avisos.push(`<b>${plural(pv.sem_prestadora_qtd, 'atendimento futuro', 'atendimentos futuros')}</b> ainda sem prestadora.`);
  if (pv.sem_valor_qtd) avisos.push(`<b>${plural(pv.sem_valor_qtd, 'atendimento futuro', 'atendimentos futuros')}</b> sem valor cadastrado — a previsão está subestimada.`);
  if (al.convites_vencidos) avisos.push(`<b>${plural(al.convites_vencidos, 'convite', 'convites')}</b> venceram sem a prestadora aceitar.`);
  if (d.concentracao.top1_pct !== null && d.concentracao.top1_pct >= 40 && d.concentracao.clientes > 1) avisos.push(`Um único cliente responde por <b>${relPct(d.concentracao.top1_pct)}</b> da receita do período — dependência alta.`);

  const serie = relColunas(d.serie.map(s => ({
    chave: s.chave, partes: [{ v: s.receita, cls: 'k-receita' }, { v: s.custo, cls: 'k-custo' }],
    dica: `${relRotulo(s.chave, gran, true)}: receita ${relReais(s.receita)} · custo ${relReais(s.custo)} · margem ${relReais(s.margem)}${s.prevista ? ' · previsto ' + relReais(s.prevista) : ''}`,
  })), gran, { modo: 'lado', legenda: [['k-receita', 'Receita realizada'], ['k-custo', 'Custo']], fmtMax: relReais });
  const evolucao = relColunas(d.evolucao.map(e => ({
    chave: e.mes + '-01', partes: [{ v: e.receita, cls: 'k-receita' }, { v: e.custo, cls: 'k-custo' }, { v: Math.max(e.margem, 0), cls: 'k-margem' }],
    dica: `${finRotuloMes(e.mes)}: ${plural(e.qtd, 'atendimento', 'atendimentos')} · receita ${relReais(e.receita)} · custo ${relReais(e.custo)} · margem ${relReais(e.margem)}`,
  })), 'mes', { modo: 'lado', legenda: [['k-receita', 'Receita'], ['k-custo', 'Custo'], ['k-margem', 'Margem']], fmtMax: relReais });

  const servicos = relTabela([['Serviço'], ['Atend.', 'num'], ['Receita', 'num'], ['Ticket', 'num'], ['Margem', 'num']],
    d.por_servico.map(s => [escapeHtml(s.tipo_servico), relInt(s.qtd), relReais(s.receita), relReais(s.ticket_medio), s.margem_pct === null ? '—' : `${relReais(s.margem)} · ${relPct(s.margem_pct)}`]));
  const clientes = relTabela([['Cliente'], ['Atend.', 'num'], ['Receita', 'num'], ['% da receita', 'num']],
    d.por_cliente.map(c => [escapeHtml(c.cliente), relInt(c.qtd), relReais(c.receita), relPct(c.pct_receita)]));
  const prest = relTabela([['Prestadora'], ['Atend.', 'num'], ['Receita gerada', 'num'], ['Custo', 'num'], ['Margem', 'num'], ['A pagar', 'num'], ['Pago', 'num']],
    d.por_prestadora.map(p => [escapeHtml(p.prestadora), relInt(p.qtd), relReais(p.receita), relReais(p.custo), p.margem_pct === null ? '—' : `${relReais(p.margem)} · ${relPct(p.margem_pct)}`,
      `${relReais(p.pendente)}${p.sem_custo_qtd ? ` <span title="Atendimentos sem valor por atendimento definido">(${p.sem_custo_qtd} sem custo)</span>` : ''}`, relReais(p.pago)]));
  // receita perdida com cancelamentos (do histórico de status): quem pediu e por quê; as faltas só aparecem como total
  const pc = d.perdido.cancelados, pfa = d.perdido.faltas;
  const perdaQuem = pc.qtd
    ? relBarras(pc.por_quem, { valor: x => x.receita ?? 0, rotulo: x => `${REL_QUEM_CANCELOU[x.quem]} (${x.qtd})`, texto: x => (x.com_valor ? relReais(x.receita) : 'sem valor'), cor: x => REL_COR_QUEM[x.quem] })
    : relVazio('Nenhum cancelamento neste período.');
  const perdaMotivo = pc.qtd
    ? relBarras(pc.por_motivo, { valor: m => m.receita ?? 0, rotulo: m => `${relMotivo(m.motivo)} (${m.qtd})`, texto: m => relReais(m.receita), cor: m => (m.motivo === null ? 'ambar' : 'azul') })
    : relVazio('Nenhum cancelamento neste período.');
  const perdaNota = relTexto(`${relReais(pc.receita)} perdidos em ${plural(pc.qtd, 'cancelamento', 'cancelamentos')}${pc.com_valor < pc.qtd ? ` (${pc.qtd - pc.com_valor} sem valor cadastrado)` : ''}`
    + `${pfa.qtd ? ` e ${relReais(pfa.receita)} em ${plural(pfa.qtd, 'falta da prestadora', 'faltas da prestadora')}` : ''}. Quem pediu e o motivo vêm do histórico: cancelamentos anteriores a ele aparecem como "Anterior ao histórico".`);
  const unidades = d.por_unidade.length ? `<div class="rel-bloco">${relPainel('Comparativo entre unidades', relTabela(
    [['Unidade'], ['Atend.', 'num'], ['Receita', 'num'], ['Custo', 'num'], ['Margem', 'num']],
    d.por_unidade.map(u => [escapeHtml(u.nome), relInt(u.qtd), relReais(u.receita), relReais(u.custo), u.margem_pct === null ? '—' : `${relReais(u.margem)} · ${relPct(u.margem_pct)}`])))}</div>` : '';

  return cards + relAlertas(avisos)
    + `<div class="rel-bloco">${relPainel(`Receita e custo por ${REL_GRAN[gran]}`, serie, relReais(re.receita))}${relTexto('Só atendimentos concluídos. A receita prevista dos dias futuros aparece na dica de cada coluna.')}</div>`
    + `<div class="rel-bloco">${relPainel('Evolução dos últimos 12 meses', evolucao)}${relTexto('Os 12 meses terminam no mês final do período escolhido. A margem considera só os atendimentos com valor e custo.')}</div>`
    + `<div class="rel-2">${relPainel('Receita por serviço', servicos)}${relPainel('Maiores clientes', clientes, plural(d.concentracao.clientes, 'cliente', 'clientes'))}</div>`
    + (pc.qtd || pfa.qtd ? `<div class="rel-2">${relPainel('Receita perdida: quem cancelou', perdaQuem + perdaNota)}${relPainel('Receita perdida: motivos', perdaMotivo)}</div>` : '')
    + `<div class="rel-bloco">${relPainel('Resultado por prestadora', prest)}${relTexto('A pagar = custo dos atendimentos concluídos ainda não marcados como pagos (o pagamento se marca no Financeiro).')}</div>`
    + unidades
    + relTexto('Receita = o que o cliente paga. Custo = o que a franquia repassa à prestadora (valor travado no aceite, ou a tarifa atual dela). Cancelados e faltas não geram receita nem repasse; o valor deles aparece só como receita perdida.');
}

// ---------- SATISFAÇÃO ----------
function relHtmlSatisfacao(d) {
  const r = d.resumo, a = d.anterior, c = d.cobertura, q = d.qualidade, per = d.periodo, gran = per.granularidade;
  const cards = `<section class="stats">`
    + relCard('Nota média', r.nota_media === null ? '—' : relDec(r.nota_media, 1) + ' <small>/ 5</small>', `só avaliações aprovadas${relVar(r.nota_media, a.nota_media)}`)
    + relCard('Clientes satisfeitos', relPct(r.satisfeitos_pct), `notas 4 e 5 · ${relPct(r.insatisfeitos_pct)} insatisfeitos (1 e 2)`, 'b')
    + relCard('Avaliações', relInt(r.aprovadas), `${relInt(r.pendentes)} aguardando moderação · ${relInt(r.recusadas)} recusadas${relVar(r.aprovadas, a.aprovadas)}`)
    + relCard('Clientes que avaliam', relPct(c.taxa_resposta_pct), `${relInt(c.avaliados)} avaliações em ${plural(c.concluidos, 'atendimento concluído', 'atendimentos concluídos')}`, 'a')
    + `</section><section class="stats">`
    + relCard('Tempo até avaliar', relHoras(r.horas_ate_avaliar), 'do fim do atendimento até a avaliação')
    + relCard('Tempo de moderação', relHoras(r.horas_moderacao), `${relPct(r.taxa_aprovacao_pct)} das moderadas foram aprovadas`, 'b')
    + relCard('Faltas', relInt(q.faltas), `${relPct(q.taxa_faltas_pct)} do que devia acontecer · cancelamentos: ${relInt(q.cancelados)}`, 'a')
    + relCard('Recusas de convite', relInt(q.recusas), `${relPct(q.taxa_recusa_pct)} dos convites`)
    + `</section>`;

  const avisos = [];
  if (r.pendentes) avisos.push(`<b>${plural(r.pendentes, 'avaliação aguarda', 'avaliações aguardam')}</b> moderação — enquanto isso a prestadora não a vê. <a style="cursor:pointer;text-decoration:underline" onclick="adminView('avaliacoes')">Moderar agora</a>`);
  const baixas = d.por_prestadora.filter(p => p.avaliacoes >= 3 && p.nota_media !== null && p.nota_media < 3.5);
  if (baixas.length) avisos.push(`Nota média abaixo de 3,5 (com 3 ou mais avaliações): <b>${escapeHtml(baixas.map(p => p.nome + ' (' + relDec(p.nota_media, 1) + ')').join(', '))}</b>.`);
  const acima = d.por_prestadora.filter(p => p.acima_meta);
  if (acima.length) avisos.push(`<b>${escapeHtml(acima.map(p => p.nome).join(', '))}</b> ${acima.length === 1 ? 'está' : 'estão'} acima da meta de faltas.`);

  const dist = relBarras(r.distribuicao, {
    valor: x => x.qtd, rotulo: x => '★'.repeat(x.nota) + ' ' + x.nota, texto: x => `${relInt(x.qtd)} · ${relPct(x.pct)}`, cor: x => (x.nota >= 4 ? '' : x.nota === 3 ? 'ambar' : 'ruim'),
  });
  const serie = relColunas(d.serie.map(s => ({
    chave: s.chave, partes: [{ v: s.nota_media || 0, cls: 'k-nota' }],
    dica: `${relRotulo(s.chave, gran, true)}: ${s.nota_media === null ? 'sem avaliações' : 'nota ' + relDec(s.nota_media, 2) + ' em ' + plural(s.qtd, 'avaliação', 'avaliações')}`,
  })), gran, { modo: 'lado', max: 5, fmtMax: () => '5,0', legenda: [['k-nota', 'Nota média das avaliações aprovadas (por data do atendimento)']] });

  const ranking = relTabela(
    [['Prestadora'], ['Nota', 'num'], ['Avaliações', 'num'], ['Satisfeitos', 'num'], ['Concluídos', 'num'], ['Faltas', 'num'], ['Recusas', 'num'], ['Cancel.', 'num'], ['A moderar', 'num']],
    d.por_prestadora.map(p => [
      escapeHtml(p.nome),
      `<span class="${p.avaliacoes >= 3 && p.nota_media !== null && p.nota_media < 3.5 ? 'rel-ruim' : ''}">${p.nota_media === null ? '—' : relDec(p.nota_media, 2)}</span>`,
      relInt(p.avaliacoes), relPct(p.satisfeitos_pct), relInt(p.concluidos),
      `<span class="${p.acima_meta ? 'rel-ruim' : ''}" title="${p.meta_pct === null ? 'Meta de faltas não definida' : 'Meta: até ' + relPct(p.meta_pct)}">${p.faltas ? p.faltas + ' (' + relPct(p.taxa_faltas_pct) + ')' : '0'}${p.acima_meta ? ' ⚠' : ''}</span>`,
      relInt(p.recusas), relInt(p.cancelados), relInt(p.pendentes),
    ]));
  const servicos = relBarras(d.por_servico, { valor: s => s.nota_media || 0, rotulo: s => s.tipo_servico, texto: s => `${relDec(s.nota_media, 1)} · ${plural(s.avaliacoes, 'aval.', 'aval.')}`, cor: s => (s.nota_media >= 4 ? '' : s.nota_media >= 3 ? 'ambar' : 'ruim') });
  const item = x => `<div class="tablerow"><div class="tr-body"><strong>${starsHTML(x.nota)} ${relStatusChip(x.status)}</strong>${x.comentario ? `<div class="rel-comentario">“${escapeHtml(x.comentario)}”</div>` : ''}<span>${escapeHtml(x.prestadora)} · ${escapeHtml(x.cliente)} · ${escapeHtml(x.tipo_servico)} · ${dataBR(x.dia)}</span></div></div>`;
  const atencao = d.atencao.length ? d.atencao.map(item).join('') : relVazio('Nenhuma avaliação com nota 3 ou menos neste período.');
  const elogios = d.elogios.length ? d.elogios.map(item).join('') : relVazio('Nenhum elogio com comentário neste período.');
  const unidades = d.por_unidade.length ? `<div class="rel-bloco">${relPainel('Comparativo entre unidades', relTabela(
    [['Unidade'], ['Nota média', 'num'], ['Avaliações', 'num'], ['Satisfeitos', 'num']],
    d.por_unidade.map(u => [escapeHtml(u.nome), u.nota_media === null ? '—' : relDec(u.nota_media, 2), relInt(u.avaliacoes), relPct(u.satisfeitos_pct)])))}</div>` : '';

  return cards + relAlertas(avisos)
    + `<div class="rel-2">${relPainel('Distribuição das notas', dist, plural(r.aprovadas, 'avaliação', 'avaliações'))}${relPainel('Nota por serviço', servicos)}</div>`
    + `<div class="rel-bloco">${relPainel(`Nota média por ${REL_GRAN[gran]}`, serie)}</div>`
    + `<div class="rel-bloco">${relPainel('Ranking de prestadoras', ranking)}${relTexto('Nota e satisfeitos consideram só avaliações aprovadas na moderação. Com poucas avaliações a média oscila muito — olhe a coluna “Avaliações”. Faltas, recusas e cancelamentos são controle interno: a prestadora não os vê.')}</div>`
    + `<div class="rel-2">${relPainel('Pontos de atenção (nota até 3)', atencao, plural(d.atencao.length, 'avaliação', 'avaliações'))}${relPainel('Elogios recentes', elogios)}</div>`
    + unidades
    + relTexto('A “nota média” é a média das notas de 1 a 5 (não é NPS). O NPS de verdade exige perguntar “você indicaria?” de 0 a 10, o que o portal ainda não pergunta.');
}

// ---------- planilha (CSV) ----------
// [título, cabeçalho, linhas]: número entra como número (vírgula decimal), texto entre aspas
function relSecoesCsv(d) {
  const per = d.periodo, gran = REL_GRAN[per.granularidade], rot = chave => relRotulo(chave, per.granularidade, true);
  if (d.aba === 'agenda') {
    const r = d.resumo;
    return [
      ['Resumo', ['Indicador', 'Valor'], [['Atendimentos', r.total], ['Concluídos', r.concluidos], ['Programados', r.programados], ['Cancelados', r.cancelados], ['Faltas', r.faltas], ['Horas realizadas', r.horas_realizadas], ['Horas programadas', r.horas_programadas], ['Taxa de cancelamento (%)', r.taxa_cancelamento_pct], ['Taxa de faltas (%)', r.taxa_faltas_pct], ['Recusas', d.recusas.total], ['Taxa de recusa (%)', d.recusas.taxa_pct]]],
      [`Atendimentos por ${gran}`, ['Período', 'Atendimentos', 'Concluídos', 'Programados', 'Cancelados', 'Faltas'], d.serie.map(s => [rot(s.chave), s.total, s.concluidos, s.programados, s.cancelados, s.faltas])],
      ['Situação', ['Situação', 'Quantidade'], d.funil.map(f => [REL_SITUACAO[f.status], f.qtd])],
      ['Dias da semana', ['Dia', 'Atendimentos', 'Concluídos'], d.dia_semana.map(x => [x.nome, x.qtd, x.concluidos])],
      ['Serviços', ['Serviço', 'Atendimentos', 'Concluídos', 'Horas'], d.por_servico.map(s => [s.tipo_servico, s.qtd, s.concluidos, s.horas])],
      ['Origem dos pedidos', ['Origem', 'Quantidade'], d.por_origem.map(o => [REL_ORIGEM[o.origem] || o.origem, o.qtd])],
      ['Prestadoras', ['Prestadora', 'Concluídos', 'Programados', 'Horas realizadas', 'Faltas', 'Taxa de faltas (%)', 'Meta de faltas (%)', 'Recusas', 'Taxa de recusa (%)', 'Cancelados'],
        d.prestadoras.map(p => [p.nome, p.concluidos, p.programados, p.horas_realizadas, p.faltas, p.taxa_faltas_pct, p.meta_pct, p.recusas, p.taxa_recusa_pct, p.cancelados])],
      ['Resposta aos convites', ['Prestadora', 'Convites', 'Aceites', 'Recusas', 'Sem resposta dela', 'Passou a outra/cancelado', 'Em aberto', 'Tempo médio (h)', 'Mediana (h)', 'Em até 24 h (%)'],
        d.resposta_convites.por_prestadora.map(p => [p.nome, p.convites, p.aceitos, p.recusados, p.sem_resposta, p.trocados, p.em_aberto, p.tempo_medio_h, p.mediana_h, p.ate_24h_pct])],
      ['Do pedido ao concluído (histórico)', ['Etapa', 'Atendimentos', '% do total', '% da etapa anterior'], d.funil_real.etapas.map(e => [e.rotulo, e.qtd, e.pct_do_inicio, e.pct_do_anterior])],
      ['Cancelamentos - quem pediu', ['Quem', 'Cancelamentos', '%'], d.cancelamentos.por_quem.filter(x => x.qtd > 0).map(x => [REL_QUEM_CANCELOU[x.quem], x.qtd, x.pct])],
      ['Cancelamentos - motivos', ['Motivo', 'Cancelamentos'], d.cancelamentos.motivos.map(m => [relMotivo(m.motivo), m.qtd])],
      ['Clientes que mais agendam', ['Cliente', 'Atendimentos', 'Concluídos'], d.clientes.top.map(c => [c.cliente, c.qtd, c.concluidos])],
      ...(d.por_unidade.length ? [['Por unidade', ['Unidade', 'Atendimentos', 'Concluídos', 'Programados', 'Cancelados', 'Faltas', 'Horas realizadas'], d.por_unidade.map(u => [u.nome, u.total, u.concluidos, u.programados, u.cancelados, u.faltas, u.horas_realizadas])]] : []),
    ];
  }
  if (d.aba === 'financeiro') {
    const re = d.realizado;
    return [
      ['Resumo', ['Indicador', 'Valor'], [['Atendimentos concluídos', re.qtd], ['Receita realizada (R$)', re.receita], ['Custo (R$)', re.custo], ['Margem (R$)', re.margem], ['Margem (%)', re.margem_pct], ['Ticket médio (R$)', re.ticket_medio], ['Receita por hora (R$)', re.receita_hora], ['A realizar (R$)', d.previsto.receita], ['Receita perdida (R$)', d.perdido.receita], ['Repasses a pagar (R$)', d.repasses.pendente], ['Repasses pagos (R$)', d.repasses.pago]]],
      [`Por ${gran}`, ['Período', 'Atendimentos', 'Receita (R$)', 'Custo (R$)', 'Margem (R$)', 'Previsto (R$)'], d.serie.map(s => [rot(s.chave), s.qtd, s.receita, s.custo, s.margem, s.prevista])],
      ['Últimos 12 meses', ['Mês', 'Atendimentos', 'Receita (R$)', 'Custo (R$)', 'Margem (R$)'], d.evolucao.map(e => [finRotuloMes(e.mes), e.qtd, e.receita, e.custo, e.margem])],
      ['Por serviço', ['Serviço', 'Atendimentos', 'Receita (R$)', 'Custo (R$)', 'Margem (R$)', 'Margem (%)', 'Ticket médio (R$)'], d.por_servico.map(s => [s.tipo_servico, s.qtd, s.receita, s.custo, s.margem, s.margem_pct, s.ticket_medio])],
      ['Maiores clientes', ['Cliente', 'Atendimentos', 'Receita (R$)', '% da receita'], d.por_cliente.map(c => [c.cliente, c.qtd, c.receita, c.pct_receita])],
      ['Por prestadora', ['Prestadora', 'Atendimentos', 'Receita (R$)', 'Custo (R$)', 'Margem (R$)', 'A pagar (R$)', 'Pago (R$)'], d.por_prestadora.map(p => [p.prestadora, p.qtd, p.receita, p.custo, p.margem, p.pendente, p.pago])],
      ['Receita perdida - quem cancelou', ['Quem', 'Cancelamentos', 'Receita perdida (R$)'], d.perdido.cancelados.por_quem.map(x => [REL_QUEM_CANCELOU[x.quem], x.qtd, x.receita])],
      ['Receita perdida - motivos', ['Motivo', 'Cancelamentos', 'Receita perdida (R$)'], d.perdido.cancelados.por_motivo.map(m => [relMotivo(m.motivo), m.qtd, m.receita])],
      ...(d.por_unidade.length ? [['Por unidade', ['Unidade', 'Atendimentos', 'Receita (R$)', 'Custo (R$)', 'Margem (R$)'], d.por_unidade.map(u => [u.nome, u.qtd, u.receita, u.custo, u.margem])]] : []),
    ];
  }
  const r = d.resumo;
  return [
    ['Resumo', ['Indicador', 'Valor'], [['Avaliações aprovadas', r.aprovadas], ['Pendentes de moderação', r.pendentes], ['Recusadas', r.recusadas], ['Nota média', r.nota_media], ['Satisfeitos - notas 4 e 5 (%)', r.satisfeitos_pct], ['Insatisfeitos - notas 1 e 2 (%)', r.insatisfeitos_pct], ['Clientes que avaliam (%)', d.cobertura.taxa_resposta_pct], ['Tempo até avaliar (h)', r.horas_ate_avaliar], ['Tempo de moderação (h)', r.horas_moderacao]]],
    ['Distribuição das notas', ['Nota', 'Avaliações', '%'], r.distribuicao.map(x => [x.nota, x.qtd, x.pct])],
    [`Nota média por ${gran}`, ['Período', 'Avaliações', 'Nota média'], d.serie.map(s => [rot(s.chave), s.qtd, s.nota_media])],
    ['Ranking de prestadoras', ['Prestadora', 'Nota média', 'Avaliações', 'Satisfeitos (%)', 'Concluídos', 'Faltas', 'Taxa de faltas (%)', 'Recusas', 'Cancelados', 'A moderar'],
      d.por_prestadora.map(p => [p.nome, p.nota_media, p.avaliacoes, p.satisfeitos_pct, p.concluidos, p.faltas, p.taxa_faltas_pct, p.recusas, p.cancelados, p.pendentes])],
    ['Nota por serviço', ['Serviço', 'Avaliações', 'Nota média'], d.por_servico.map(s => [s.tipo_servico, s.avaliacoes, s.nota_media])],
    ['Pontos de atenção (nota até 3)', ['Data', 'Nota', 'Situação', 'Prestadora', 'Cliente', 'Serviço', 'Comentário'], d.atencao.map(x => [dataBR(x.dia), x.nota, x.status, x.prestadora, x.cliente, x.tipo_servico, x.comentario || ''])],
    ...(d.por_unidade.length ? [['Por unidade', ['Unidade', 'Nota média', 'Avaliações', 'Satisfeitos (%)'], d.por_unidade.map(u => [u.nome, u.nota_media, u.avaliacoes, u.satisfeitos_pct])]] : []),
  ];
}
function relBaixarCsv() {
  const d = relDados;
  if (!d) { toast('O relatório ainda está carregando.'); return; }
  const texto = c => { let s = String(c ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const celula = c => (typeof c === 'number' ? String(c).replace('.', ',') : texto(c));
  const nomeAba = { agenda: 'Agenda', financeiro: 'Financeiro', satisfacao: 'Satisfação' }[d.aba];
  const linhas = [texto(`Relatório de ${nomeAba} — ${d.escopo === 'todas' ? 'todas as unidades' : d.unidades[0]?.nome} — ${dataBR(d.periodo.de)} a ${dataBR(d.periodo.ate)}`), ''];
  for (const [titulo, cab, regs] of relSecoesCsv(d)) {
    linhas.push(texto(titulo), cab.map(texto).join(';'), ...regs.map(l => l.map(celula).join(';')), '');
  }
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const nomeUnidade = (d.escopo === 'todas' ? 'todas-as-unidades' : d.unidades[0]?.slug) || 'unidade';
  link.download = `relatorio-${d.aba}-${nomeUnidade}-${d.periodo.de}_a_${d.periodo.ate}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
