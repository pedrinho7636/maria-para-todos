/* Portal da Maria — Equipe
   Navegação interna do administrador, lista de prestadoras, nova prestadora, valor por atendimento, meta de faltas, ativar/desativar e contato. */

/* ===== dados do admin (Equipe e Clientes) =====
   equipeData / clientesData / avaliacoes já são carregados da API
   local em carregarEquipeClientesAvaliacoes() (topo do script) */
let currentUnit = null; // unidade aberta no painel (definida no login)
function starsHTML(n) { return '<span class="stars">' + [1, 2, 3, 4, 5].map(i => '<span class="' + (i <= n ? '' : 's-off') + '">★</span>').join('') + '</span>'; }

/* navegação interna do admin */
function adminView(name, arg) {
  fecharReatribuirPop(); // o balão não fecha mais ao clicar fora; não pode ficar órfão em outra tela
  const mapaModulo = { visaogeral: 'dashboard', agenda: 'agenda', equipe: 'equipe', clientes: 'clientes', avaliacoes: 'avaliacoes', financeiro: 'financeiro', relatorios: 'relatorios', subadmins: 'subadmins' };
  const p = permissoesAtuais();
  const modulo = mapaModulo[name];
  if (modulo && p[modulo] === false) { toast('Você não tem permissão para acessar este módulo.'); return; }

  document.querySelectorAll('#screen-franqueado .adminview').forEach(v => v.style.display = 'none');
  const view = document.getElementById('av-' + name); if (view) view.style.display = 'block';
  document.querySelectorAll('#screen-franqueado .topnav a').forEach(a => a.classList.remove('active'));
  const nav = document.getElementById('nav-' + name); if (nav) nav.classList.add('active');
  if (name === 'agenda') renderAgendaAdmin(arg);
  else if (name === 'equipe') renderEquipe();
  else if (name === 'clientes') renderClientes();
  else if (name === 'avaliacoes') renderAvaliacoesAdmin();
  else if (name === 'financeiro') renderFinanceiro();
  else if (name === 'relatorios') renderRelatorios();
  else if (name === 'subadmins') renderSubadmins();
  guardarVisao({ tela: 'franqueado', view: name, unit: currentUnit });
  window.scrollTo(0, 0);
}
function renderEquipe() {
  const arr = equipeData[currentUnit] || [];
  document.getElementById('eqv-unit').textContent = unidades[currentUnit].nome;
  const podeEditarValor = usuarioLogado?.tipo === 'administrador'; // dinheiro: funcionário só enxerga
  document.getElementById('eqv-nova').style.display = podeEditarValor ? '' : 'none'; // criar login: só administrador
  document.getElementById('eqv-list').innerHTML = arr.map(p => {
    const valor = p.tarifa === null ? '<span class="tr-meta">sem valor definido</span>' : `<span class="tr-meta">${formatarReais(p.tarifa)} / atendimento</span>`;
    const botao = podeEditarValor ? `<button class="btn-sm ghost" onclick="abrirTarifa('${p.id}')">${p.tarifa === null ? 'Definir valor' : 'Alterar valor'}</button><button class="btn-sm ghost" onclick="abrirContatoPrestadora('${p.id}')">Contato</button><button class="btn-sm ghost" onclick="abrirMetaFaltas('${p.id}')">Meta de faltas</button><button class="btn-sm ghost" onclick="alternarAtivaPrestadora('${p.id}', ${!p.ativa})">${p.ativa ? 'Desativar' : 'Reativar'}</button>` : '';
    const contato = p.telefone ? escapeHtml(exibirTelefone(p.telefone)) : '<i>sem telefone</i>';
    const pendente = p.pendente ? ' · <b title="Ainda não confirmou o e-mail nem trocou a senha padrão">primeiro acesso pendente</b>' : '';
    // faltas: controle interno da franquia (a prestadora nunca vê). Taxa = faltas ÷ atendimentos que deviam ter acontecido.
    const taxa = p.devidos ? (p.faltas / p.devidos) * 100 : 0;
    const acima = p.limiteFaltas !== null && p.devidos > 0 && taxa > p.limiteFaltas;
    const pct = (n) => n.toFixed(1).replace('.', ',') + '%';
    const faltasTxt = 'Faltas: ' + (p.devidos ? p.faltas + ' de ' + p.devidos + ' (' + pct(taxa) + ')' : 'nenhum atendimento ainda')
      + (p.limiteFaltas !== null ? ' · aceitável até ' + pct(p.limiteFaltas) : ' · limite não definido') + (acima ? ' · ⚠ acima do aceitável' : '');
    const faltasLinha = '<span' + (acima ? ' style="color:var(--red);font-weight:600"' : '') + '>' + faltasTxt + '</span>';
    return `<div class="tablerow"${p.ativa ? '' : ' style="opacity:.65"'}><div class="tr-av">${escapeHtml(p.ini)}</div><div class="tr-body"><strong>${escapeHtml(p.nome)}</strong><span>${p.serv} atendimentos · nota ${p.nota.toFixed(1)} ★</span><span>${contato}${pendente}</span>${faltasLinha}</div>${valor}${botao}<span class="chip ${p.ativa ? 'chip-on' : 'chip-off'}">${p.ativa ? 'ativa' : 'inativa'}</span></div>`;
  }).join('');
}

// Lê um valor em reais digitado ("1.200,50", "R$ 80", "80.5"): null se vazio, NaN se inválido.
// Os campos de valor são de texto de propósito — <input type="number"> descarta a vírgula
// em alguns navegadores ("120,50" virava 12050).
function lerReais(texto) {
  let t = String(texto ?? '').trim().replace(/^R\$\s*/i, '');
  if (t === '') return null;
  if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // "1.200,50" -> "1200.50"
  return /^\d{1,8}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}

/* Nova prestadora (cadastrada pelo administrador, na Equipe ou a partir de um atendimento da agenda
   cuja prestadora ainda não tem cadastro no Portal). Se o sistema gerou a senha, ela aparece UMA vez
   no resultado, com o atalho de enviar o acesso por WhatsApp. */
let novaPrestadoraOcupada = false, acessoGerado = null;
function abrirNovaPrestadora(nomeInicial) {
  ['np-nome', 'np-email', 'np-tel', 'np-senha'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('np-nome').value = nomeInicial || '';
  document.getElementById('np-unidade').textContent = (cidades[currentUnit] || {}).nome || currentUnit;
  const aviso = document.getElementById('np-aviso-agenda');
  aviso.style.display = nomeInicial ? 'block' : 'none';
  aviso.innerHTML = nomeInicial ? `<b>${escapeHtml(nomeInicial)}</b> aparece na agenda como <b>prestadora sem cadastro no Portal da Maria</b>. Ao cadastrar,
    os atendimentos que estão com esse nome passam a ser dela.` : '';
  document.getElementById('np-form').style.display = 'block';
  document.getElementById('np-resultado').style.display = 'none';
  acessoGerado = null;
  document.getElementById('modal-nova-prestadora').classList.add('show');
  document.getElementById(nomeInicial ? 'np-email' : 'np-nome').focus();
}
function fecharNovaPrestadora() { document.getElementById('modal-nova-prestadora').classList.remove('show'); acessoGerado = null; }
async function criarPrestadora() {
  if (novaPrestadoraOcupada) return;
  const corpo = {
    nome: document.getElementById('np-nome').value.trim(), email: document.getElementById('np-email').value.trim(),
    telefone: document.getElementById('np-tel').value.trim(), senha: document.getElementById('np-senha').value,
  };
  if (!corpo.nome) { toast('Informe o nome da prestadora.'); return; }
  if (!corpo.email && !corpo.telefone) { toast('Informe o e-mail e/ou o telefone: é com um deles que ela entra.'); return; }
  novaPrestadoraOcupada = true;
  const botao = document.getElementById('np-criar'); botao.disabled = true;
  try {
    const r = await api(`/unidades/${currentUnit}/admin/equipe`, { method: 'POST', body: JSON.stringify(corpo) });
    const login = r.prestadora.email || r.prestadora.telefone;
    acessoGerado = { nome: r.prestadora.nome, login, senha: r.senha_provisoria || corpo.senha, telefone: r.prestadora.telefone || corpo.telefone };
    document.getElementById('np-resultado-texto').innerHTML = `<b>${escapeHtml(r.prestadora.nome)}</b> cadastrada!`
      + (r.atendimentos_ligados ? ` ${plural(r.atendimentos_ligados, 'atendimento da agenda foi ligado', 'atendimentos da agenda foram ligados')} a ela.` : '')
      + `<br><br>Acesso: <b>${escapeHtml(login)}</b><br>Senha${r.senha_provisoria ? ' provisória (gerada agora — anote, ela não aparece de novo)' : ''}: <b>${escapeHtml(acessoGerado.senha)}</b>`;
    document.getElementById('np-whats').style.display = acessoGerado.telefone ? '' : 'none';
    document.getElementById('np-form').style.display = 'none';
    document.getElementById('np-resultado').style.display = 'block';
    await carregarPrestadorasAgenda(currentUnit);
    await carregarEquipeClientesAvaliacoes(currentUnit);
    if (document.getElementById('av-equipe')?.style.display === 'block') renderEquipe();
    if (document.getElementById('av-agenda')?.style.display === 'block') selecionarDiaAgenda(diaSelecionadoAgenda);
  } catch (err) { toast('Erro ao cadastrar: ' + err.message); }
  finally { novaPrestadoraOcupada = false; botao.disabled = false; }
}
// Chamado direto do clique (sem await antes): é o que o navegador exige pra deixar abrir o WhatsApp.
function enviarAcessoPrestadoraWhats() {
  if (!acessoGerado || !acessoGerado.telefone) return;
  const mensagem = `Olá, ${acessoGerado.nome}! Seu acesso ao Portal da Maria (${(cidades[currentUnit] || {}).nome || ''}) foi criado.\n`
    + `Entre em: ${linkAcessoPrestadora()}\nLogin: ${acessoGerado.login}\nSenha provisória: ${acessoGerado.senha}\n\nTroque a senha no "Meu perfil" depois de entrar.`;
  abrirAbaExterna(linkWhatsApp(acessoGerado.telefone, mensagem));
}

/* Valor por atendimento (quanto a franquia paga a cada prestadora) */
let tarifaPrestadoraId = null, tarifaOcupada = false;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
function formatarReais(v) { return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function abrirTarifa(prestadoraId) {
  const p = (equipeData[currentUnit] || []).find(x => x.id === prestadoraId);
  if (!p) return;
  tarifaPrestadoraId = prestadoraId;
  document.getElementById('tarifa-nome').textContent = p.nome;
  document.getElementById('tarifa-valor').value = moedaParaCampo(p.tarifa);
  document.getElementById('modal-tarifa').classList.add('show');
  document.getElementById('tarifa-valor').focus();
}
function fecharTarifa() { document.getElementById('modal-tarifa').classList.remove('show'); }
async function salvarTarifa() {
  if (tarifaOcupada || !tarifaPrestadoraId) return;
  const valor = lerReais(document.getElementById('tarifa-valor').value);
  if (Number.isNaN(valor) || (valor !== null && valor >= 100000)) { toast('Informe um valor válido (ex.: 80,00).'); return; }
  tarifaOcupada = true;
  const botao = document.getElementById('tarifa-salvar'); botao.disabled = true;
  try {
    await api(`/unidades/${currentUnit}/admin/equipe/${tarifaPrestadoraId}`, { method: 'PATCH', body: JSON.stringify({ valor_por_atendimento: valor }) });
    fecharTarifa();
    await carregarEquipeClientesAvaliacoes(currentUnit);
    renderEquipe();
    toast(valor === null ? 'Valor removido.' : 'Valor por atendimento atualizado.');
  } catch (err) { toast('Erro ao salvar o valor: ' + err.message); }
  finally { tarifaOcupada = false; botao.disabled = false; }
}
/* Meta de faltas: percentual de faltas que a franquia aceita de cada prestadora (controle interno; só administrador). */
let metaFaltasId = null, metaFaltasOcupada = false;
function abrirMetaFaltas(id) {
  const p = (equipeData[currentUnit] || []).find(x => x.id === id);
  if (!p) return;
  metaFaltasId = id;
  document.getElementById('meta-nome').textContent = p.nome;
  document.getElementById('meta-valor').value = p.limiteFaltas === null ? '' : String(p.limiteFaltas).replace('.', ',');
  document.getElementById('modal-meta-faltas').classList.add('show');
  document.getElementById('meta-valor').focus();
}
function fecharMetaFaltas() { document.getElementById('modal-meta-faltas').classList.remove('show'); }
async function salvarMetaFaltas() {
  if (metaFaltasOcupada || !metaFaltasId) return;
  const bruto = document.getElementById('meta-valor').value.trim().replace('%', '').replace(',', '.');
  const n = bruto === '' ? null : Number(bruto);
  if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) { toast('Informe um percentual entre 0 e 100 (ex.: 5).'); return; }
  metaFaltasOcupada = true;
  try {
    await api('/unidades/' + currentUnit + '/admin/equipe/' + metaFaltasId, { method: 'PATCH', body: JSON.stringify({ faltas_aceitavel_pct: n }) });
    fecharMetaFaltas();
    await carregarEquipeClientesAvaliacoes(currentUnit);
    renderEquipe();
    toast(n === null ? 'Meta de faltas removida.' : 'Meta de faltas definida em ' + String(n).replace('.', ',') + '%.');
  } catch (err) { toast('Erro ao salvar: ' + err.message); }
  finally { metaFaltasOcupada = false; }
}

/* Ativar/desativar prestadora (só administrador completo). Inativa: não recebe atendimento novo, some da lista de
   atribuição e não entra mais no portal; o histórico e os atendimentos já feitos continuam. Os que ainda estão com ela
   (convite/confirmado, de hoje em diante) o administrador reatribui na agenda. */
async function alternarAtivaPrestadora(id, ativa) {
  const p = (equipeData[currentUnit] || []).find(x => x.id === id);
  if (!p) return;
  if (!ativa && !window.confirm('Desativar ' + p.nome + '?\n\nEla deixa de receber atendimentos e não consegue mais entrar no portal. O histórico dela continua. Você pode reativar quando quiser.')) return;
  try {
    const r = await api('/unidades/' + currentUnit + '/admin/equipe/' + id, { method: 'PATCH', body: JSON.stringify({ ativa }) });
    await carregarPrestadorasAgenda(currentUnit);
    await carregarEquipeClientesAvaliacoes(currentUnit);
    renderEquipe();
    toast(ativa ? p.nome + ' reativada.' : p.nome + ' desativada.' + (r.atendimentos_abertos ? ' Ainda há ' + plural(r.atendimentos_abertos, 'atendimento futuro', 'atendimentos futuros') + ' com ela: reatribua na agenda.' : ''));
  } catch (err) { toast('Não foi possível alterar: ' + err.message); }
}

/* Contato da prestadora (administrador): corrigir/preencher o telefone — principalmente das contas
   criadas pela planilha, que nascem sem telefone — e mandar o acesso pelo WhatsApp. */
const SENHA_PADRAO_IMPORTADAS = 'senha123';
let contatoPrestadoraId = null, contatoOcupado = false;
function abrirContatoPrestadora(prestadoraId) {
  const p = (equipeData[currentUnit] || []).find(x => x.id === prestadoraId);
  if (!p) return;
  contatoPrestadoraId = prestadoraId;
  document.getElementById('contato-nome').textContent = p.nome;
  document.getElementById('contato-email').textContent = p.pendente ? 'e-mail ainda não confirmado' : (p.email || 'sem e-mail');
  document.getElementById('contato-tel').value = formatarTelefone(p.telefone);
  const aviso = document.getElementById('contato-pendente');
  aviso.style.display = p.pendente ? 'block' : 'none';
  aviso.innerHTML = p.pendente
    ? `Conta criada pela planilha: <b>primeiro acesso pendente</b>. Ela entra com o <b>nome</b> (${escapeHtml(p.nome)}) e a senha padrão <b>${SENHA_PADRAO_IMPORTADAS}</b>;
       ao entrar, o portal pede o e-mail dela (com código de confirmação) e uma senha só dela.` : '';
  document.getElementById('contato-whats').style.display = p.pendente ? '' : 'none';
  document.getElementById('modal-contato').classList.add('show');
  document.getElementById('contato-tel').focus();
}
function fecharContatoPrestadora() { document.getElementById('modal-contato').classList.remove('show'); }
async function salvarContatoPrestadora() {
  if (contatoOcupado || !contatoPrestadoraId) return;
  const telefone = document.getElementById('contato-tel').value.trim();
  contatoOcupado = true;
  const botao = document.getElementById('contato-salvar'); botao.disabled = true;
  try {
    await api(`/unidades/${currentUnit}/admin/equipe/${contatoPrestadoraId}`, { method: 'PATCH', body: JSON.stringify({ telefone }) });
    fecharContatoPrestadora();
    await carregarEquipeClientesAvaliacoes(currentUnit);
    renderEquipe();
    toast(telefone ? 'Telefone atualizado.' : 'Telefone removido.');
  } catch (err) { toast('Erro ao salvar o telefone: ' + err.message); }
  finally { contatoOcupado = false; botao.disabled = false; }
}
// Chamado direto do clique (sem await antes): é o que o navegador exige pra deixar abrir o WhatsApp.
function enviarAcessoPendenteWhats() {
  const p = (equipeData[currentUnit] || []).find(x => x.id === contatoPrestadoraId);
  const telefone = document.getElementById('contato-tel').value.trim();
  if (!p) return;
  if (!telefone) { toast('Preencha o telefone dela para enviar o acesso por WhatsApp.'); return; }
  const mensagem = `Olá, ${p.nome}! Seu acesso ao Portal da Maria (${(cidades[currentUnit] || {}).nome || ''}) foi criado.\n`
    + `Entre em: ${linkAcessoPrestadora()}\nLogin: seu nome completo (${p.nome})\nSenha provisória: ${SENHA_PADRAO_IMPORTADAS}\n\n`
    + `No primeiro acesso o portal pede o seu e-mail (você recebe um código para confirmar) e uma senha nova, só sua.`;
  abrirAbaExterna(linkWhatsApp(telefone, mensagem));
}
