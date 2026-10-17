/* Portal da Maria — Clientes e avaliações (administrador)
   Lista de clientes, convite e substituição de perfil provisório e moderação de avaliações. */

/* Convite pra cliente SEM cadastro criar o próprio perfil (migra quem só existia nos agendamentos pra um perfil completo).
   Abre o WhatsApp com a mensagem pronta e o link do cadastro (já na cidade da unidade) e registra o envio —
   é o registro que libera "Substituir perfil". */
function convidarClienteWhats(id) {
  const c = (clientesData[currentUnit] || []).find(x => x.id === id);
  if (!c || !c.telefone) { toast('Este cliente não tem telefone cadastrado.'); return; }
  const un = cidades[currentUnit] || {};
  const link = location.origin + location.pathname + '?cadastro=cliente&unidade=' + encodeURIComponent(currentUnit);
  const mensagem = `Olá, ${primeiroNome(c.nome)}! Aqui é a Maria Brasileira ${un.nome || ''}.\n\n`
    + `Convidamos você a criar o seu perfil no Portal da Maria. Com ele você acompanha seus atendimentos, vê quem é a profissional que vai até você (com foto), `
    + `confere data e horário e pode pedir novos serviços.\n\nÉ rápido, o cadastro é por aqui:\n${link}\n\nUse o mesmo nome e telefone dos nossos atendimentos para manter o seu histórico.`;
  abrirAbaExterna(linkWhatsApp(c.telefone, mensagem)); // direto do clique: o navegador só deixa abrir assim
  api(`/unidades/${currentUnit}/admin/clientes/${id}/convite`, { method: 'POST' })
    .then(async () => { await carregarEquipeClientesAvaliacoes(currentUnit); if (document.getElementById('av-clientes')?.style.display === 'block') renderClientes(); })
    .catch(err => toast('O WhatsApp abriu, mas não consegui registrar o convite: ' + err.message));
}

let substituirOrigemId = null, substituirOcupado = false;
const candidatosSubstituicao = (origemId) => (clientesData[currentUnit] || []).filter(x => x.temConta && x.registrados === 0 && x.id !== origemId);
function abrirSubstituir(id) {
  const c = (clientesData[currentUnit] || []).find(x => x.id === id);
  if (!c || c.temConta || !c.convite) return;
  const candidatos = candidatosSubstituicao(id);
  if (!candidatos.length) {
    toast('Ainda não há um perfil criado pelo cliente (com conta e sem nenhum atendimento) para receber a substituição. Quando ele se cadastrar, volte aqui.');
    return;
  }
  substituirOrigemId = id;
  document.getElementById('sub-nome').textContent = c.nome;
  document.getElementById('sub-qtd').textContent = c.registrados === 0 ? 'nada ainda' : plural(c.registrados, 'atendimento', 'atendimentos') + ', com avaliações e histórico';
  document.getElementById('sub-destino').innerHTML = '<option value="">Escolha o perfil…</option>'
    + candidatos.map(x => `<option value="${x.id}">${escapeHtml(x.nome)}${x.email ? ' · ' + escapeHtml(x.email) : ''}</option>`).join('');
  substituirAtualizar();
  document.getElementById('modal-substituir').classList.add('show');
}
function substituirAtualizar() {
  const aviso = document.getElementById('sub-aviso');
  const d = (clientesData[currentUnit] || []).find(x => x.id === document.getElementById('sub-destino').value);
  aviso.style.display = d ? 'block' : 'none';
  aviso.innerHTML = d ? `O perfil <b>${escapeHtml(d.nome)}</b> (${escapeHtml(d.email || 'sem e-mail')}) não tem nenhum atendimento e vai receber tudo do provisório.` : '';
}
function fecharSubstituir() { document.getElementById('modal-substituir').classList.remove('show'); substituirOrigemId = null; }
async function confirmarSubstituicao() {
  if (substituirOcupado || !substituirOrigemId) return;
  const destinoId = document.getElementById('sub-destino').value;
  if (!destinoId) { toast('Escolha o perfil que o cliente criou.'); return; }
  const lista = clientesData[currentUnit] || [];
  const origem = lista.find(x => x.id === substituirOrigemId), destino = lista.find(x => x.id === destinoId);
  if (!window.confirm(`Substituir "${origem.nome}" (provisório) por "${destino.nome}"?\n\nTudo que está ligado ao provisório passa para o novo perfil e o provisório deixa de existir como cliente. Não dá pra desfazer.`)) return;
  substituirOcupado = true;
  const botao = document.getElementById('sub-confirmar'); botao.disabled = true;
  try {
    const r = await api(`/unidades/${currentUnit}/admin/clientes/${substituirOrigemId}/substituir`, { method: 'POST', body: JSON.stringify({ destino_id: destinoId }) });
    fecharSubstituir();
    await carregarEquipeClientesAvaliacoes(currentUnit);
    renderClientes();
    const mov = r.movidos || {};
    toast(`Perfil substituído: ${plural(mov.atendimentos || 0, 'atendimento transferido', 'atendimentos transferidos')} para ${r.destino}.`);
  } catch (err) { toast('Não foi possível substituir: ' + err.message); }
  finally { substituirOcupado = false; botao.disabled = false; }
}
function updateAvalBadge() {
  const n = avaliacoes.filter(a => a.status === 'pendente').length;
  const b = document.getElementById('mAval'); if (b) b.textContent = n + ' pendente' + (n === 1 ? '' : 's');
}
function renderAvaliacoesAdmin() {
  const pend = avaliacoes.filter(a => a.status === 'pendente');
  const hist = avaliacoes.filter(a => a.status !== 'pendente');
  document.getElementById('adm-aval-count').textContent = pend.length;
  document.getElementById('adm-aval-pend').innerHTML = pend.length === 0 ? '<div class="empty">Nenhuma avaliação aguardando aprovação.</div>'
    : pend.map(a => `<div class="invite"><div class="invite-top"><strong>${escapeHtml(a.servico)} · ${escapeHtml(a.prestadora)}</strong>${starsHTML(a.nota)}</div><div class="invite-meta">De <b>${escapeHtml(a.cliente)}</b> · ${a.data}${a.comentario ? ' — “' + escapeHtml(a.comentario) + '”' : ''}</div><div class="mod-actions"><button class="btn-sm" onclick="aprovarAval('${a.id}')">Aprovar e enviar à prestadora</button><button class="btn-sm ghost" onclick="recusarAval('${a.id}')">Recusar</button></div></div>`).join('');
  document.getElementById('adm-aval-hist').innerHTML = hist.length === 0 ? '<div class="empty">Nada moderado ainda.</div>'
    : hist.map(a => `<div class="tablerow"><div class="tr-body"><strong>${escapeHtml(a.servico)} · ${escapeHtml(a.prestadora)}</strong><span>${escapeHtml(a.cliente)} · ${a.data}</span></div>${starsHTML(a.nota)}<span class="chip ${a.status === 'aprovada' ? 'chip-on' : 'chip-off'}">${a.status}</span></div>`).join('');
  updateAvalBadge();
}
async function aprovarAval(id) {
  try {
    await api(`/avaliacoes/admin/${currentUnit}/${id}/aprovar`, { method: 'POST' });
    await carregarEquipeClientesAvaliacoes(currentUnit); renderAvaliacoesAdmin();
    toast('Avaliação aprovada — agora aparece para a prestadora.');
  } catch (err) { toast('Erro ao aprovar no banco: ' + err.message); }
}
async function recusarAval(id) {
  try {
    await api(`/avaliacoes/admin/${currentUnit}/${id}/recusar`, { method: 'POST' });
    await carregarEquipeClientesAvaliacoes(currentUnit); renderAvaliacoesAdmin();
    toast('Avaliação recusada — não foi enviada à prestadora.');
  } catch (err) { toast('Erro ao recusar no banco: ' + err.message); }
}
