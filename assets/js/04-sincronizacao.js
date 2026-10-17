/* Portal da Maria — Sincronização
   O que outras pessoas fazem aparece sozinho (consulta periódica à API) e permissões do funcionário que mudam na hora. */

/* ===== Sincronização: o que outras pessoas fazem aparece aqui sozinho =====
   Antes a tela buscava os dados UMA vez (no login) e só buscava de novo quando a
   própria pessoa agia — então um convite criado pelo administrador só chegava
   na prestadora quando ela relogava. Agora, a cada poucos segundos (e na hora
   em que a aba volta ao foco), pergunta pra API uma "impressão digital" barata
   do que o usuário enxerga; só se ela mudou é que recarrega os dados. */
const SYNC_INTERVALO_MS = 4000;
let syncTimer = null, syncVersao = null, syncOcupado = false;

const ehAdminTipo = () => usuarioLogado && (usuarioLogado.tipo === 'administrador' || usuarioLogado.tipo === 'sub_administrador');
function iniciarSincronizacao() {
  pararSincronizacao();
  syncTimer = setInterval(verificarAtualizacoes, SYNC_INTERVALO_MS);
  verificarAtualizacoes(); // fixa a impressão inicial
}
function pararSincronizacao() {
  clearInterval(syncTimer);
  syncTimer = null; syncVersao = null;
}
async function verificarAtualizacoes() {
  if (!authToken || !usuarioLogado) { pararSincronizacao(); return; }
  if (document.hidden || syncOcupado) return; // aba em segundo plano: espera voltar ao foco
  syncOcupado = true;
  const unidadeChecada = currentUnit;
  try {
    const { versao } = await api('/sync' + (ehAdminTipo() ? '?unidade=' + encodeURIComponent(unidadeChecada) : ''));
    if (!usuarioLogado || (ehAdminTipo() && unidadeChecada !== currentUnit)) return; // trocou de unidade/saiu durante a chamada
    const mudou = syncVersao !== null && versao !== syncVersao;
    syncVersao = versao;
    if (mudou) await aplicarAtualizacoes();
  } catch (err) {
    // conta desativada pelo administrador: sai na hora, com o motivo
    if (/desativad/i.test(err.message)) { toast(err.message); logout(); }
    // qualquer outra falha (rede, API reiniciando) é silenciosa: tenta de novo no próximo ciclo
  } finally { syncOcupado = false; }
}

async function aplicarAtualizacoes() {
  const tipo = usuarioLogado.tipo;
  if (tipo === 'prestadora') {
    const tinha = new Set(convites.map(c => c.id));
    const avisosAntes = new Set(avisosPrestadora.map(a => a.id));
    await carregarDadosPrestadora();
    const novos = convites.filter(c => !tinha.has(c.id)).length;
    const avisosNovos = avisosPrestadora.filter(a => !avisosAntes.has(a.id)).length;
    if (avisosNovos) toast(avisosNovos === 1 ? 'Um atendimento seu foi cancelado pela unidade — veja os avisos.' : `${avisosNovos} atendimentos seus foram cancelados pela unidade — veja os avisos.`);
    renderPrestadora();
    selecionarDiaCalendarioPrestadora(diaSelecionadoCalendarioPrestadora || hojeISOBrasil()); // mantém o dia que ela estava olhando
    if (novos) toast(novos === 1 ? 'Você recebeu um novo convite de atendimento.' : `Você recebeu ${novos} novos convites de atendimento.`);
  } else if (tipo === 'cliente') {
    // o que a pessoa já digitou/marcou numa avaliação em andamento não pode sumir no recarregamento
    const rascunhos = {};
    document.querySelectorAll('#cli-aval textarea').forEach(t => { rascunhos[t.id] = t.value; });
    await carregarDadosCliente();
    renderClienteAval();
    renderClienteAtendimentos();
    for (const [id, valor] of Object.entries(rascunhos)) { const el = document.getElementById(id); if (el) el.value = valor; }
    Object.keys(selRating).forEach(id => setStar(id, selRating[id]));
  } else {
    const slug = currentUnit;
    await atualizarPermissoesFuncionario();
    await Promise.all([carregarUnidadeAdmin(slug), carregarEquipeClientesAvaliacoes(slug)]);
    if (!usuarioLogado || slug !== currentUnit) return;
    setUnitUI(slug);
    updateAvalBadge();
    // re-desenha só a tela aberta, no mesmo ponto em que a pessoa estava (sem voltar pra hoje)
    const aberta = id => document.getElementById('av-' + id)?.style.display === 'block';
    if (aberta('agenda')) { await carregarPrestadorasAgenda(slug); await renderCalendarioMes(); }
    else if (aberta('equipe')) renderEquipe();
    else if (aberta('financeiro')) renderFinanceiro();
    else if (aberta('relatorios')) relCarregar(); // sem piscar: o relatório novo só entra no lugar quando chega
    else if (aberta('clientes')) renderClientes();
    else if (aberta('avaliacoes')) renderAvaliacoesAdmin();
  }
}

// Funcionário: se o administrador mudou as permissões dele, a tela acompanha na hora.
async function atualizarPermissoesFuncionario() {
  if (usuarioLogado.tipo !== 'sub_administrador') return;
  const antes = JSON.stringify(permissoesAtuais());
  usuarioLogado.dados = { ...usuarioLogado.dados, ...(await api('/perfil')) };
  if (JSON.stringify(permissoesAtuais()) === antes) return;
  aplicarPermissoesAdminUI();
  toast('Suas permissões foram atualizadas pelo administrador.');
  const p = permissoesAtuais();
  const modulos = [['visaogeral', 'dashboard'], ['agenda', 'agenda'], ['avaliacoes', 'avaliacoes'], ['equipe', 'equipe'], ['clientes', 'clientes'], ['financeiro', 'financeiro'], ['relatorios', 'relatorios']];
  const aberta = modulos.find(([v]) => document.getElementById('av-' + v)?.style.display === 'block');
  if (aberta && !p[aberta[1]]) adminView((modulos.find(([, m]) => p[m]) || ['agenda'])[0]); // a tela atual deixou de ser permitida
}

// A aba voltou ao foco (ou a internet voltou): confere na hora, sem esperar o próximo ciclo.
document.addEventListener('visibilitychange', () => { if (!document.hidden) verificarAtualizacoes(); });
window.addEventListener('online', verificarAtualizacoes);
