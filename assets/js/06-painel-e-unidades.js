/* Portal da Maria — Painel inicial e unidades
   Seletor de unidades, layout personalizável do painel inicial e troca de unidade. */

/* administrador */
// Unidades que o login atual pode abrir (administrador: as da empresa dele; funcionário: só a dele,
// sem seletor). Todas as unidades de um administrador têm o mesmo CNPJ — por isso um login só alterna.
function unidadesDoLogin() {
  return usuarioLogado?.tipo === 'administrador' ? (usuarioLogado.dados?.unidades_slugs || []) : [];
}
function renderSeletorUnidades() {
  const caixa = document.getElementById('unit-switcher');
  const slugs = unidadesDoLogin();
  caixa.style.display = slugs.length > 1 ? '' : 'none'; // uma unidade só = nada pra escolher
  caixa.toggleAttribute('data-muitas', slugs.length > 3);
  caixa.innerHTML = slugs.map(s =>
    `<button data-slug="${escapeHtml(s)}" class="${s === currentUnit ? 'active' : ''}" onclick="setUnit('${escapeHtml(s)}')"><span class="dot"></span>${escapeHtml((cidades[s] || {}).nome || s)}</button>`).join('')
    + `<select class="unit-select" aria-label="Cidade" onchange="setUnit(this.value)">${slugs.map(s => `<option value="${escapeHtml(s)}" ${s === currentUnit ? 'selected' : ''}>${escapeHtml((cidades[s] || {}).nome || s)}</option>`).join('')}</select>`;
}
/* Layout do painel inicial por unidade: quais atalhos aparecem e em que ordem, e quais cartões de
   resumo ficam visíveis. A configuração vem da API (vale pra toda a equipe da unidade); aqui só se aplica. */
const PAINEL_ROTULOS = {
  agenda: 'Agenda', equipe: 'Equipe', clientes: 'Clientes', avaliacoes: 'Avaliações', financeiro: 'Financeiro', relatorios: 'Relatórios',
  atend: 'Cartão: Atendimentos hoje', prof: 'Cartão: Profissionais ativos', fat: 'Cartão: Faturamento do mês', nps: 'Cartão: Satisfação (NPS)',
  'agenda-hoje': 'Lista: Agenda de hoje',
};
function aplicarLayoutPainel(config) {
  const caixa = document.querySelector('#av-visaogeral .modules');
  if (!caixa) return;
  const ocultos = new Set(config?.ocultos || []);
  const porModulo = Object.fromEntries([...caixa.children].map(el => [el.dataset.modulo, el]));
  for (const m of (config?.ordem || [])) if (porModulo[m]) caixa.appendChild(porModulo[m]); // reordena (o que não foi citado fica no fim)
  for (const [modulo, el] of Object.entries(porModulo)) el.classList.toggle('painel-oculto', ocultos.has(modulo));
  document.querySelectorAll('#av-visaogeral [data-bloco]').forEach(el => el.classList.toggle('painel-oculto', ocultos.has(el.dataset.bloco)));
  document.getElementById('painel-personalizar').style.display = usuarioLogado?.tipo === 'administrador' ? '' : 'none'; // só administrador personaliza
}
let painelEdicao = null; // { ordem: [...], ocultos: Set }
function abrirPersonalizarPainel() {
  const cfg = unidades[currentUnit]?.painel || { ordem: ['agenda', 'equipe', 'clientes', 'avaliacoes', 'financeiro', 'relatorios'], ocultos: [] };
  painelEdicao = { ordem: [...cfg.ordem], ocultos: new Set(cfg.ocultos) };
  document.getElementById('painel-unidade').textContent = unidades[currentUnit].nome;
  renderPersonalizarPainel();
  document.getElementById('modal-painel').classList.add('show');
}
function renderPersonalizarPainel() {
  const item = (id, comSetas, i) => `<div class="painel-item"><label><input type="checkbox" ${painelEdicao.ocultos.has(id) ? '' : 'checked'} onchange="painelAlternar('${id}', this.checked)"> ${PAINEL_ROTULOS[id]}</label>${comSetas ? `<button onclick="painelMover(${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button><button onclick="painelMover(${i}, 1)" ${i === painelEdicao.ordem.length - 1 ? 'disabled' : ''} aria-label="Descer">▼</button>` : ''}</div>`;
  document.getElementById('painel-lista-atalhos').innerHTML = painelEdicao.ordem.map((m, i) => item(m, true, i)).join('');
  document.getElementById('painel-lista-blocos').innerHTML = ['atend', 'prof', 'fat', 'nps', 'agenda-hoje'].map(b => item(b, false, 0)).join('');
}
function painelAlternar(id, visivel) { if (visivel) painelEdicao.ocultos.delete(id); else painelEdicao.ocultos.add(id); }
function painelMover(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= painelEdicao.ordem.length) return;
  [painelEdicao.ordem[i], painelEdicao.ordem[j]] = [painelEdicao.ordem[j], painelEdicao.ordem[i]];
  renderPersonalizarPainel();
}
function restaurarPainelPadrao() {
  painelEdicao = { ordem: ['agenda', 'equipe', 'clientes', 'avaliacoes', 'financeiro', 'relatorios'], ocultos: new Set() };
  renderPersonalizarPainel();
}
function fecharPersonalizarPainel() { document.getElementById('modal-painel').classList.remove('show'); }
async function salvarPersonalizarPainel() {
  const botao = document.getElementById('painel-salvar'); botao.disabled = true;
  try {
    const salvo = await api(`/unidades/${currentUnit}/admin/painel`, { method: 'PUT', body: JSON.stringify({ ordem: painelEdicao.ordem, ocultos: [...painelEdicao.ocultos] }) });
    unidades[currentUnit].painel = salvo;
    aplicarLayoutPainel(salvo);
    fecharPersonalizarPainel();
    toast(`Painel da unidade ${unidades[currentUnit].nome} atualizado.`);
  } catch (err) { toast('Erro ao salvar o painel: ' + err.message); }
  finally { botao.disabled = false; }
}

function setUnitUI(key) {
  currentUnit = key;
  const u = unidades[key];
  renderSeletorUnidades();
  aplicarLayoutPainel(u.painel); // cada unidade tem o seu layout
  document.getElementById('hero-sub').innerHTML = 'Resumo da unidade <strong>' + escapeHtml(u.nome) + '</strong> · ' + dataPorExtensoHoje();
  document.getElementById('panel-unit').textContent = u.nome;
  document.getElementById('foot-unit').textContent = 'perfil: administrador · unidade: ' + key;
  ['atend', 'prof', 'fat', 'nps', 'mAgenda', 'mEquipe', 'mClientes', 'mFin'].forEach(k => { document.querySelectorAll('[data-k="' + k + '"]').forEach(el => el.textContent = u[k]); });
  setTrend('atendT', u.atendT, u.atendCls); document.querySelector('[data-k="profT"]').textContent = u.profT; setTrend('fatT', u.fatT, u.fatCls); setTrend('npsT', u.npsT, u.npsCls);
  document.querySelector('[data-k="jCount"]').textContent = u.jobs.length;
  document.getElementById('joblist').innerHTML = u.jobs.map(j => `<div class="job"><div class="job-time">${j.t}</div><div class="job-body"><strong>${escapeHtml(j.c)}</strong><span>${escapeHtml(j.p)}</span></div><div class="job-status ${j.s}">${j.st}</div></div>`).join('');
}
async function setUnit(key) {
  Progresso.comecar('Abrindo a unidade…', 6);
  try {
    await carregarUnidadeAdmin(key);
    await carregarEquipeClientesAvaliacoes(key);
  } catch (err) { Progresso.terminar(); toast('Erro ao trocar de unidade: ' + err.message); return; }
  Progresso.terminar();
  setUnitUI(key);
  syncVersao = null; // outra unidade = outra impressão digital; a próxima checagem vira o novo ponto de partida
  verificarAtualizacoes();
  if (document.getElementById('av-agenda')?.style.display === 'block') renderAgendaAdmin();
  if (document.getElementById('av-equipe')?.style.display === 'block') renderEquipe();
  if (document.getElementById('av-clientes')?.style.display === 'block') renderClientes();
  if (document.getElementById('av-avaliacoes')?.style.display === 'block') renderAvaliacoesAdmin();
  if (document.getElementById('av-subadmins')?.style.display === 'block') renderSubadmins();
  if (document.getElementById('av-relatorios')?.style.display === 'block') renderRelatorios();
  const aberta =[...document.querySelectorAll('#screen-franqueado .adminview')].find(v => v.style.display === 'block');
  if (aberta) guardarVisao({ tela: 'franqueado', view: aberta.id.replace('av-', ''), unit: key });
}
function setTrend(k, txt, cls) { const el = document.querySelector('[data-k="' + k + '"]'); el.textContent = txt; el.className = 'stat-trend ' + (cls === 'down' ? 'down' : 'up'); }
