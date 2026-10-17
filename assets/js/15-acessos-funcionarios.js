/* Portal da Maria — Acessos (funcionários)
   Cadastro de funcionários com permissão por módulo. */

/* Acessos: CRUD de sub-administradores (funcionários com permissão por módulo) */
let subadminsCache = [];
let subadminEditandoId = null; // null = formulário em modo "criar"
const SA_MODULOS = ['agenda', 'avaliacoes', 'equipe', 'clientes', 'dashboard', 'financeiro', 'relatorios'];
const SA_ROTULOS = { agenda: 'Agenda', avaliacoes: 'Avaliações', equipe: 'Equipe', clientes: 'Clientes', dashboard: 'Visão geral', financeiro: 'Financeiro', relatorios: 'Relatórios' };

async function renderSubadmins() {
  document.getElementById('sa-unit').textContent = unidades[currentUnit].nome;
  document.getElementById('sa-func-unidade').textContent = unidades[currentUnit].nome;
  try {
    subadminsCache = await api(`/sub-administradores/${currentUnit}`);
  } catch (err) { toast('Erro ao carregar acessos: ' + err.message); subadminsCache = []; }
  document.getElementById('sa-list').innerHTML = subadminsCache.length === 0 ? '<div class="empty">Nenhum funcionário cadastrado ainda.</div>'
    : subadminsCache.map(s => {
      const modulos = SA_MODULOS.filter(m => s['pode_' + m]).map(m => SA_ROTULOS[m]).join(', ') || 'sem módulos';
      return `<div class="tablerow">
        <div class="tr-body"><strong>${escapeHtml(s.nome)} ${escapeHtml(s.sobrenome)}</strong><span>${escapeHtml(s.email)} · ${modulos}</span></div>
        <span class="chip ${s.ativo ? 'chip-on' : 'chip-off'}">${s.ativo ? 'ativo' : 'inativo'}</span>
        <button class="btn-sm ghost" onclick="editarSubadmin('${s.id}')">Editar</button>
        <button class="btn-sm ghost" onclick="toggleSubadmin('${s.id}', ${!s.ativo})">${s.ativo ? 'Desativar' : 'Reativar'}</button>
      </div>`;
    }).join('');
}
// Abre o mesmo formulário de cadastro em modo edição — não cria um usuário
// novo, só ajusta nome/permissões/senha do sub-admin já existente.
function editarSubadmin(id) {
  const s = subadminsCache.find(x => x.id === id);
  if (!s) return;
  subadminEditandoId = id;
  document.getElementById('sa-nome').value = s.nome;
  document.getElementById('sa-sobrenome').value = s.sobrenome;
  document.getElementById('sa-email').value = s.email;
  document.getElementById('sa-email').disabled = true; // e-mail não é editável (é o login)
  document.getElementById('sa-senha').value = '';
  document.getElementById('sa-senha-label').textContent = 'Nova senha (deixe em branco pra manter)';
  SA_MODULOS.forEach(m => document.getElementById('sa-perm-' + m).checked = !!s['pode_' + m]);
  document.getElementById('sa-form-titulo').textContent = 'Editar acesso de ' + s.nome;
  document.getElementById('sa-form-botao').textContent = 'Salvar alterações';
  document.getElementById('sa-form-cancelar').style.display = '';
  document.getElementById('sa-nome').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelarEdicaoSubadmin() {
  subadminEditandoId = null;
  ['sa-nome', 'sa-sobrenome', 'sa-email', 'sa-senha'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sa-email').disabled = false;
  document.getElementById('sa-senha-label').textContent = 'Senha';
  SA_MODULOS.forEach(m => document.getElementById('sa-perm-' + m).checked = false);
  document.getElementById('sa-form-titulo').textContent = 'Adicionar funcionário';
  document.getElementById('sa-form-botao').textContent = 'Criar acesso';
  document.getElementById('sa-form-cancelar').style.display = 'none';
}
async function salvarSubadmin() {
  const permissoes = Object.fromEntries(SA_MODULOS.map(m => [m, document.getElementById('sa-perm-' + m).checked]));
  const nome = document.getElementById('sa-nome').value.trim();
  const sobrenome = document.getElementById('sa-sobrenome').value.trim();
  const senha = document.getElementById('sa-senha').value;

  if (subadminEditandoId) {
    const body = { nome, sobrenome, permissoes };
    if (senha) body.senha = senha;
    try {
      await api(`/sub-administradores/${currentUnit}/${subadminEditandoId}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast('Acesso atualizado.');
      cancelarEdicaoSubadmin();
      renderSubadmins();
    } catch (err) { toast('Erro ao salvar alterações: ' + err.message); }
    return;
  }

  const email = document.getElementById('sa-email').value.trim();
  if (!nome || !sobrenome || !email || !senha) { toast('Preencha nome, sobrenome, e-mail e senha.'); return; }
  try {
    await api(`/sub-administradores/${currentUnit}`, { method: 'POST', body: JSON.stringify({ nome, sobrenome, email, senha, permissoes }) });
    cancelarEdicaoSubadmin();
    toast('Acesso criado.');
    renderSubadmins();
  } catch (err) { toast('Erro ao criar acesso: ' + err.message); }
}
async function toggleSubadmin(id, ativar) {
  try {
    await api(`/sub-administradores/${currentUnit}/${id}/${ativar ? 'ativar' : 'desativar'}`, { method: 'POST' });
    renderSubadmins();
  } catch (err) { toast('Erro ao atualizar acesso: ' + err.message); }
}

/* prestadora: últimas 3 em destaque + histórico */
function renderPrestAval() {
  const mine = avaliacoes.filter(a => a.status === 'aprovada');
  const avg = mine.length ? (mine.reduce((s, a) => s + a.nota, 0) / mine.length).toFixed(1) : '—';
  document.getElementById('prest-aval-avg').textContent = avg;
  document.getElementById('prest-aval-total').textContent = mine.length;
  const top = mine.slice(0, 3), rest = mine.slice(3);
  document.getElementById('prest-aval-top').innerHTML = top.length === 0 ? '<div class="empty" style="grid-column:1/-1">Ainda sem avaliações aprovadas.</div>'
    : top.map(a => `<div class="rev-card"><div class="rc-top"><strong>${escapeHtml(a.cliente)}</strong>${starsHTML(a.nota)}</div><span style="font-size:11.5px;color:var(--muted)">${escapeHtml(a.servico)} · ${a.data}</span>${a.comentario ? '<p>“' + escapeHtml(a.comentario) + '”</p>' : ''}</div>`).join('');
  document.getElementById('prest-aval-hist').innerHTML = rest.length === 0 ? '<div class="empty">Sem avaliações anteriores além das recentes.</div>'
    : rest.map(a => `<div class="tablerow"><div class="tr-body"><strong>${escapeHtml(a.cliente)} · ${escapeHtml(a.servico)}</strong><span>${a.data}${a.comentario ? ' — “' + escapeHtml(a.comentario) + '”' : ''}</span></div>${starsHTML(a.nota)}</div>`).join('');
}
