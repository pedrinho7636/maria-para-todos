/* Portal da Maria — Financeiro
   Receita, custo, margem, repasses às prestadoras e pendências. */

/* ===== Financeiro =====
   Os números vêm prontos da API (/api/financeiro/...); aqui só se desenha.
   Receita = o que o CLIENTE paga · custo = repasse à PRESTADORA · realizado = concluído
   (a API conclui sozinha o atendimento aceito cuja data/hora já passou). */
let finMes = null;            // 'AAAA-MM' em exibição (null = mês atual, que a API devolve)
let finDados = null;
let finOcupado = false;
const finAbertas = new Set(); // prestadoras com a lista de atendimentos aberta
const finDetalhes = {};       // prestadoraId -> resposta de /repasses (usada no CSV)

const finReais = v => (v === null || v === undefined ? '—' : formatarReais(v));
const finNum = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const finRotuloMes = mes => { const [a, m] = mes.split('-').map(Number); const t = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const finIniciais = nome => String(nome).split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();

function finMudarMes(delta) {
  if (delta === 0) finMes = null;
  else {
    const base = finMes || finDados?.mes_atual;
    if (!base) return;
    const [a, m] = base.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    finMes = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  finAbertas.clear();
  renderFinanceiro();
}

async function renderFinanceiro() {
  document.getElementById('fin-unit').textContent = unidades[currentUnit].nome;
  try {
    finDados = await api(`/financeiro/${currentUnit}/resumo${finMes ? '?mes=' + finMes : ''}`);
  } catch (err) { toast('Erro ao carregar o financeiro: ' + err.message); return; }
  finMes = finDados.mes;
  const d = finDados, r = d.realizado, p = d.previsto;
  document.getElementById('fin-mes-label').textContent = finRotuloMes(d.mes);
  document.getElementById('fin-mes-hoje').style.display = d.mes === d.mes_atual ? 'none' : '';

  const variacao = (atual, antes) => (antes > 0 && atual !== null ? ` · ${atual >= antes ? '▲' : '▼'} ${Math.abs(Math.round((atual - antes) / antes * 100))}% vs. mês anterior` : '');
  const card = (cls, rotulo, valor, trend) => `<div class="stat ${cls}"><div class="stat-label">${rotulo}</div><div class="stat-value"><small>R$</small> ${valor}</div><div class="stat-trend up">${trend}</div></div>`;
  document.getElementById('fin-cards').innerHTML =
    card('', 'Receita (realizada)', finNum(r.receita), `${plural(r.qtd, 'atendimento concluído', 'atendimentos concluídos')}${variacao(r.receita, d.anterior.receita)}`)
    + card('b', 'Custo (repasses)', finNum(r.custo), `${finReais(d.alertas.repasses_pendentes)} a pagar${variacao(r.custo, d.anterior.custo)}`)
    + card('a', 'Margem', finNum(r.margem), `${r.margem_pct === null ? '—' : String(r.margem_pct).replace('.', ',') + '%'}${r.completos < r.qtd ? ` · calculada em ${r.completos} de ${r.qtd}` : ''}`)
    + card('', 'A realizar no mês', finNum(p.receita), `${plural(p.qtd, 'atendimento', 'atendimentos')} · custo previsto ${finReais(p.custo)}`);

  // alertas: tudo que deixa os números incompletos
  const al = d.alertas, avisos = [];
  if (al.realizados_sem_valor) avisos.push(`<b>${plural(al.realizados_sem_valor, 'atendimento concluído', 'atendimentos concluídos')}</b> sem valor cobrado — a receita está subestimada.`);
  if (al.realizados_sem_custo) avisos.push(`<b>${plural(al.realizados_sem_custo, 'atendimento concluído', 'atendimentos concluídos')}</b> sem custo (prestadora sem valor por atendimento definido, ou sem prestadora) — o custo está subestimado.`);
  if (p.sem_prestadora_qtd) avisos.push(`<b>${plural(p.sem_prestadora_qtd, 'atendimento futuro', 'atendimentos futuros')}</b> ainda sem prestadora.`);
  if (al.convites_vencidos) avisos.push(`<b>${plural(al.convites_vencidos, 'convite', 'convites')}</b> venceram sem a prestadora aceitar.`);
  document.getElementById('fin-alertas').innerHTML = avisos.map(a => `<div class="fin-alerta">⚠ ${a}</div>`).join('');

  // repasses
  document.getElementById('fin-repasse-total').textContent = d.por_prestadora.length ? `${finReais(al.repasses_pendentes)} a pagar` : '';
  document.getElementById('fin-repasses').innerHTML = d.por_prestadora.length === 0
    ? '<div class="empty">Nenhum atendimento concluído neste mês.</div>'
    : d.por_prestadora.map(x => {
      const quitado = x.pendentes_qtd === 0 && x.pagos_qtd > 0;
      const chip = quitado ? '<span class="chip chip-on">pago</span>' : x.pendentes_qtd > 0 ? '<span class="chip chip-off">a pagar</span>' : '<span class="chip chip-off">sem valor</span>';
      const aberto = finAbertas.has(x.prestadora_id);
      return `<div class="tablerow"><div class="tr-av">${escapeHtml(finIniciais(x.prestadora))}</div>
          <div class="tr-body"><strong>${escapeHtml(x.prestadora)}</strong>
            <span>${plural(x.qtd, 'atendimento', 'atendimentos')} · total ${finReais(x.a_pagar_total)} · pago ${finReais(x.pago)} · pendente <b>${finReais(x.pendente)}</b>${x.sem_custo_qtd ? ` · ${x.sem_custo_qtd} sem valor definido (defina na Equipe)` : ''}</span></div>
          ${chip}
          <div class="fin-acoes">
            <button class="btn-sm ghost" onclick="finVer('${x.prestadora_id}')">${aberto ? 'Ocultar' : 'Ver'}</button>
            ${x.pendentes_qtd > 0 ? `<button class="btn-sm" onclick="finPagar('${x.prestadora_id}', false)">Marcar como pago</button>` : ''}
            ${x.pagos_qtd > 0 ? `<button class="btn-sm ghost" onclick="finPagar('${x.prestadora_id}', true)">Desfazer pagamento</button>` : ''}
          </div></div>
          <div class="fin-det" id="fin-det-${x.prestadora_id}" style="display:${aberto ? 'block' : 'none'}"></div>`;
    }).join('');

  const linhaMargem = (titulo, sub, x) => `<div class="tablerow"><div class="tr-body"><strong>${escapeHtml(titulo)}</strong><span>${sub}</span></div><span class="tr-meta">${x.margem_pct === null ? (x.completos === 0 ? 'sem valores' : finReais(x.receita)) : finReais(x.margem) + ' · ' + String(x.margem_pct).replace('.', ',') + '%'}</span></div>`;
  document.getElementById('fin-servicos').innerHTML = d.por_servico.length === 0 ? '<div class="empty">Sem atendimentos concluídos.</div>'
    : d.por_servico.map(x => linhaMargem(x.tipo_servico, `${plural(x.qtd, 'atendimento', 'atendimentos')} · receita ${finReais(x.receita)} · custo ${finReais(x.custo)}`, x)).join('');
  document.getElementById('fin-clientes').innerHTML = d.por_cliente.length === 0 ? '<div class="empty">Sem clientes no período.</div>'
    : d.por_cliente.map(x => `<div class="tablerow"><div class="tr-body"><strong>${escapeHtml(x.cliente)}</strong><span>${plural(x.qtd, 'atendimento', 'atendimentos')}</span></div><span class="tr-meta">${finReais(x.receita)}</span></div>`).join('');

  document.getElementById('fin-pend-painel').style.display = d.pendencias.length ? '' : 'none';
  document.getElementById('fin-pend-count').textContent = d.pendencias.length ? `${d.pendencias.length}${d.pendencias.length === 30 ? '+' : ''}` : '';
  const rotuloFalta = { valor: 'valor cobrado', custo: 'valor da prestadora', prestadora: 'prestadora' };
  document.getElementById('fin-pendencias').innerHTML = d.pendencias.map(x =>
    `<div class="tablerow fin-clicavel" onclick="finIrParaDia('${x.dia}')"><div class="tr-body"><strong>${escapeHtml(x.tipo_servico)}</strong><span>${dataBR(x.dia)}${x.hora ? ' · ' + x.hora : ''}${x.cliente ? ' · ' + escapeHtml(x.cliente) : ''}</span></div><span class="chip chip-off">falta: ${x.falta.map(f => rotuloFalta[f]).join(', ')}</span></div>`).join('');

  for (const id of finAbertas) await finCarregarDetalhe(id); // listas abertas continuam abertas (e atualizadas)
}

async function finCarregarDetalhe(prestadoraId) {
  const alvo = document.getElementById('fin-det-' + prestadoraId);
  if (!alvo) { finAbertas.delete(prestadoraId); return; }
  try {
    const r = await api(`/financeiro/${currentUnit}/repasses/${prestadoraId}?mes=${finMes}`);
    finDetalhes[prestadoraId] = r;
    alvo.innerHTML = `<table><thead><tr><th>Data</th><th>Serviço</th><th>Cliente</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>`
      + r.atendimentos.map(a => `<tr><td>${dataBR(a.dia)}${a.hora ? ' ' + a.hora : ''}</td><td>${escapeHtml(a.tipo_servico)}</td><td>${escapeHtml(a.cliente || '—')}</td><td class="num">${finReais(a.custo)}</td><td>${a.repasse_pago_em ? 'pago em ' + dataBR(String(a.repasse_pago_em).slice(0, 10)) : (a.custo === null ? 'sem valor' : 'a pagar')}</td></tr>`).join('')
      + `</tbody></table><div style="margin-top:10px"><button class="btn-sm ghost" onclick="finBaixarCsv('${prestadoraId}')">Baixar planilha (CSV)</button></div>`;
  } catch (err) { alvo.innerHTML = `<div class="atd-aviso">${escapeHtml(err.message)}</div>`; }
}

async function finVer(prestadoraId) {
  const alvo = document.getElementById('fin-det-' + prestadoraId);
  if (!alvo) return;
  if (finAbertas.has(prestadoraId)) { finAbertas.delete(prestadoraId); alvo.style.display = 'none'; }
  else { finAbertas.add(prestadoraId); alvo.style.display = 'block'; alvo.innerHTML = '<div class="atd-aviso">Carregando…</div>'; await finCarregarDetalhe(prestadoraId); }
  // o texto do botão "Ver/Ocultar" acompanha
  const linha = alvo.previousElementSibling?.querySelector('.fin-acoes button');
  if (linha) linha.textContent = finAbertas.has(prestadoraId) ? 'Ocultar' : 'Ver';
}

async function finPagar(prestadoraId, desfazer) {
  if (finOcupado) return;
  const x = finDados.por_prestadora.find(p => p.prestadora_id === prestadoraId);
  if (!x) return;
  const pergunta = desfazer
    ? `Desfazer o pagamento dos atendimentos de ${x.prestadora} em ${finRotuloMes(finMes)}? Eles voltam a "a pagar".`
    : `Marcar como PAGO o repasse de ${x.prestadora} (${finReais(x.pendente)}) referente a ${finRotuloMes(finMes)}?`;
  if (!window.confirm(pergunta)) return;
  finOcupado = true;
  try {
    const r = await api(`/financeiro/${currentUnit}/repasses/${prestadoraId}/pagar`, { method: 'POST', body: JSON.stringify({ mes: finMes, desfazer }) });
    toast(desfazer ? `Pagamento desfeito (${plural(r.atualizados, 'atendimento', 'atendimentos')}).` : `Repasse marcado como pago (${plural(r.atualizados, 'atendimento', 'atendimentos')}).`);
    await renderFinanceiro();
  } catch (err) { toast('Erro ao atualizar o repasse: ' + err.message); }
  finally { finOcupado = false; }
}

// Planilha do repasse de uma prestadora (abre direto no Excel pt-BR: separador ";", vírgula
// decimal, BOM do UTF-8). Textos que começam com = + - @ ganham um apóstrofo: o Excel
// trataria como fórmula (o nome do serviço/cliente vem da planilha importada).
function finBaixarCsv(prestadoraId) {
  const r = finDetalhes[prestadoraId];
  if (!r) return;
  const texto = c => { let s = String(c ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const linhas = [['Data', 'Horário', 'Serviço', 'Cliente', 'Valor (R$)', 'Situação'].map(texto).join(';')];
  for (const a of r.atendimentos) {
    linhas.push([texto(dataBR(a.dia)), texto(a.hora), texto(a.tipo_servico), texto(a.cliente), a.custo === null ? '' : a.custo.toFixed(2).replace('.', ','),
      texto(a.repasse_pago_em ? 'pago em ' + dataBR(String(a.repasse_pago_em).slice(0, 10)) : (a.custo === null ? 'sem valor' : 'a pagar'))].join(';'));
  }
  const total = r.atendimentos.reduce((s, a) => s + (a.custo ?? 0), 0);
  linhas.push(['', '', '', texto('Total'), total.toFixed(2).replace('.', ','), ''].join(';'));
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `repasse-${r.prestadora.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${r.mes}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Pendência clicada: abre a Agenda no dia daquele atendimento pra completar o que falta
function finIrParaDia(dia) { adminView('agenda', dia); }
