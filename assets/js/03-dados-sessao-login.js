/* Portal da Maria — Dados, sessão e login
   Links do WhatsApp, permissões do painel, carregamento dos dados (unidades, admin, prestadora, cliente), troca de cidade, login, entrada na área do usuário e sair. */

/* Links "clique pra conversar" do WhatsApp (wa.me) — sem API de negócios,
   sem token, sem conta verificada: abre o app/web já com o número certo e
   a mensagem pronta, mas quem abriu ainda precisa apertar enviar. Todo
   telefone é salvo como DDD+número (sem código de país), por isso sempre
   prefixamos 55 aqui, nunca condicional (o DDD de Panambi é 55 também,
   então checar "já começa com 55" ia confundir DDD com código de país). */
function linkWhatsApp(telefoneArmazenado, mensagem) {
  const digitos = (telefoneArmazenado || '').replace(/\D/g, '');
  return 'https://wa.me/55' + digitos + '?text=' + encodeURIComponent(mensagem);
}
// Abas externas (WhatsApp) abrem SEM acesso à janela do portal (window.opener): a página de fora não pode redirecionar nem
// mexer nesta. abrirAbaExterna abre já com o endereço; abrirAbaEmBranco reserva a aba no clique (o navegador só deixa abrir
// assim) pra preencher o endereço depois de uma chamada à API, e solta o vínculo com esta janela.
function abrirAbaExterna(url) { return window.open(url, '_blank', 'noopener,noreferrer'); }
function abrirAbaEmBranco() { const aba = window.open('', '_blank'); if (aba) aba.opener = null; return aba; }
// Endereço do próprio site (onde quer que ele esteja hospedado) já apontando
// pro login da prestadora — ver o tratamento de ?perfil=prestadora no boot.
function linkAcessoPrestadora() {
  return location.origin + location.pathname + '?perfil=prestadora';
}
// Uso direto num onclick síncrono (sem await no meio) — pode abrir a aba na hora.
function abrirWhatsApp(telefoneArmazenado, mensagem) {
  if (!telefoneArmazenado) { toast('Esta unidade ainda não tem telefone de WhatsApp cadastrado.'); return; }
  abrirAbaExterna(linkWhatsApp(telefoneArmazenado, mensagem));
}

// Permissões do painel administrativo: administrador completo enxerga tudo;
// sub_administrador só o que foi marcado nele (colunas pode_* vindas do login).
function permissoesAtuais() {
  if (!usuarioLogado || usuarioLogado.tipo === 'administrador') {
    return { dashboard: true, agenda: true, avaliacoes: true, equipe: true, clientes: true, financeiro: true, relatorios: true, subadmins: true };
  }
  const u = usuarioLogado.dados || {};
  return {
    dashboard: !!u.pode_dashboard, agenda: !!u.pode_agenda, avaliacoes: !!u.pode_avaliacoes,
    equipe: !!u.pode_equipe, clientes: !!u.pode_clientes, financeiro: !!u.pode_financeiro,
    // Relatórios: Agenda e Satisfação com pode_relatorios; o relatório Financeiro exige também pode_financeiro
    relatorios: !!u.pode_relatorios, subadmins: false
  };
}
function aplicarPermissoesAdminUI() {
  const p = permissoesAtuais();
  const setDisplay = (id, visivel) => { const el = document.getElementById(id); if (el) el.style.display = visivel ? '' : 'none'; };
  setDisplay('nav-visaogeral', p.dashboard);
  setDisplay('nav-agenda', p.agenda);
  setDisplay('nav-equipe', p.equipe);
  setDisplay('nav-clientes', p.clientes);
  setDisplay('nav-avaliacoes', p.avaliacoes);
  setDisplay('nav-financeiro', p.financeiro);
  setDisplay('nav-relatorios', p.relatorios);
  setDisplay('nav-subadmins', p.subadmins);
  document.querySelectorAll('#screen-franqueado .mod[data-modulo]').forEach(el => {
    el.style.display = p[el.dataset.modulo] === false ? 'none' : '';
  });
}

const unidadeVazia = () => ({
  nome: '', atend: '0', atendT: '', atendCls: 'up',
  prof: '0', profT: '0 escalados hoje',
  fat: '0', fatT: '', fatCls: 'up',
  nps: '—', npsT: '', npsCls: 'up',
  mAgenda: '0 hoje', mEquipe: '—', mClientes: '—', mFin: '—',
  jobs: []
});

/* Converte um registro de atendimentos (status pedido/proposto/aceito) no
   shape "job" que os renders já esperam (t,c,p,s,st) */
function atendimentoParaJob(a) {
  const statusMap = { pedido: 'novo', proposto: 'aguardando', aceito: 'confirmado', concluido: 'confirmado' };
  const classeMap = { novo: 'st-new', aguardando: 'st-wait', confirmado: 'st-ok' };
  const st = statusMap[a.status] || a.status;
  return {
    t: a.hora_atendimento ? a.hora_atendimento.slice(0, 5) : '—',
    c: a.tipo_servico + (a.area ? ' — ' + a.area : ''),
    p: a.prestadora_nome || '—',
    s: classeMap[st] || 'st-wait',
    st, id: a.id
  };
}

// Tudo que depende da lista de unidades (vinda da API, não fixa): seletor de cidade da home, selects
// dos cadastros de prestadora/cliente e o aviso de "nenhuma unidade ainda".
function renderUnidadesPublicas() {
  const lista = Object.entries(cidades);
  document.getElementById('sem-unidades').style.display = lista.length ? 'none' : '';
  if (!lista.length) {
    document.getElementById('chip-region').textContent = 'Sem unidades';
    ['hc-phone-linha', 'ct-addr-bloco', 'ct-phone-bloco'].forEach(id => { document.getElementById(id).style.display = 'none'; });
    document.getElementById('hc-addr').style.display = 'none';
    document.getElementById('hp-eyebrow').textContent = 'Atendendo a sua região';
    document.getElementById('hp-city').textContent = 'na sua cidade';
    document.getElementById('hc-city').textContent = 'Maria Brasileira';
    document.getElementById('ct-title').textContent = 'Fale com a unidade da sua região';
    document.getElementById('pf-region').textContent = '';
  }
  const pino = '<div class="ro-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div>';
  document.getElementById('region-lista').innerHTML = lista.length
    ? lista.map(([slug, c]) => `<button class="region-opt" onclick="setRegiao('${escapeHtml(slug)}')">${pino}<div><strong>${escapeHtml(c.nome)}</strong><span>e região${c.uf ? ' · ' + escapeHtml(c.uf) : ''}</span></div></button>`).join('')
    : '<p>Nenhuma unidade cadastrada ainda.</p>';
  const opcoes = lista.map(([slug, c]) => `<option value="${escapeHtml(slug)}">${escapeHtml(c.nome)}${c.uf ? ' / ' + escapeHtml(c.uf) : ''}</option>`).join('');
  for (const [id, rotulo] of [['cad-prest-regiao', 'Selecione a sua cidade...'], ['cad-cliente-regiao', 'Selecione...']]) {
    const sel = document.getElementById(id);
    const atual = sel.value;
    sel.innerHTML = `<option value="">${rotulo}</option>` + opcoes;
    sel.value = atual;
  }
  if (cadastroUnidadeConvite && cidades[cadastroUnidadeConvite]) document.getElementById('cad-cliente-regiao').value = cadastroUnidadeConvite;
}

// Dados públicos (home): lista de unidades. As demais listas ficam vazias até o login.
async function carregarDadosPublicos() {
  try {
    const unis = await api('/unidades');
    cidades = {}; unidades = {};
    for (const u of unis) {
      cidades[u.slug] = { nome: u.nome, uf: u.uf, tel: u.telefone, end: u.endereco, endCurto: u.endereco_curto };
      unidades[u.slug] = { ...unidadeVazia(), nome: u.nome };
    }
    bancoCarregado = true;
    document.getElementById('banco-loading')?.remove();
    renderUnidadesPublicas();
    if (!cidades[regiao]) regiao = Object.keys(cidades)[0] || regiao; // a unidade padrão não é mais fixa
    if (cidades[regiao]) setRegiao(regiao);
    console.log('[api local] unidades carregadas de', API_BASE);
  } catch (err) {
    console.error('[api local] falha ao carregar unidades:', err);
    const el = document.getElementById('banco-loading');
    if (el) el.innerHTML = '⚠️ Não foi possível conectar à API local. Confira se "npm start" está rodando em api/ e se API_BASE aponta pra porta certa.';
  }
}

// Dashboard + agenda do dia da unidade — exige admin logado e vinculado à unidade.
// Cada busca respeita sua própria permissão (dashboard/agenda são módulos
// separados no backend); sem a permissão, resolve vazio em vez de dar 403.
async function carregarUnidadeAdmin(slug) {
  const p = permissoesAtuais();
  const [dash, agenda, painel] = await Promise.all([
    p.dashboard ? api(`/unidades/${slug}/admin/dashboard`) : Promise.resolve({}),
    p.agenda ? api(`/atendimentos/admin/${slug}/agenda`) : Promise.resolve([]),
    p.dashboard ? api(`/unidades/${slug}/admin/painel`).catch(() => null) : Promise.resolve(null) // layout do painel (por unidade)
  ]);
  unidades[slug] = {
    painel,
    nome: cidades[slug].nome,
    atend: String(dash.atendimentos_hoje ?? 0), atendT: '', atendCls: 'up',
    prof: String(dash.prestadoras_escaladas_hoje ?? 0), profT: (dash.prestadoras_escaladas_hoje ?? 0) + ' escalados hoje',
    fat: Number(dash.faturamento_mes ?? 0).toLocaleString('pt-BR'), fatT: '', fatCls: 'up',
    nps: String(dash.nps_medio ?? '—'), npsT: '', npsCls: 'up',
    mAgenda: (dash.atendimentos_hoje ?? 0) + ' hoje', mEquipe: '—', mClientes: '—',
    mFin: dash.faturamento_mes === undefined ? '—' : 'R$ ' + Number(dash.faturamento_mes).toLocaleString('pt-BR') + ' no mês',
    jobs: agenda.map(atendimentoParaJob)
  };
}

async function carregarEquipeClientesAvaliacoes(slug) {
  const p = permissoesAtuais();
  const [eq, cl, avs] = await Promise.all([
    p.equipe ? api(`/unidades/${slug}/admin/equipe`) : Promise.resolve([]),
    p.clientes ? api(`/unidades/${slug}/admin/clientes`) : Promise.resolve([]),
    p.avaliacoes ? api(`/avaliacoes/admin/${slug}`) : Promise.resolve([])
  ]);
  equipeData[slug] = eq.map(e => ({ faltas: Number(e.faltas) || 0, devidos: Number(e.atendimentos_devidos) || 0, limiteFaltas: e.faltas_aceitavel_pct === null || e.faltas_aceitavel_pct === undefined ? null : Number(e.faltas_aceitavel_pct), id: e.prestadora_id, nome: e.nome, ini: e.nome.split(' ').map(p => p[0]).slice(0, 2).join(''), serv: Number(e.total_atendimentos), nota: Number(e.nota_media) || 0, ativa: e.ativa, telefone: e.telefone || '', email: e.email || '', pendente: !!e.primeiro_acesso_pendente, tarifa: e.valor_por_atendimento === null || e.valor_por_atendimento === undefined ? null : Number(e.valor_por_atendimento) }));
  clientesData[slug] = cl.map(c => ({ id: c.cliente_id, nome: c.nome, ini: c.nome.split(' ').map(p => p[0]).slice(0, 2).join(''), ultimo: (c.ultimo_atendimento_tipo || '—') + (c.ultimo_atendimento_data ? ' · ' + c.ultimo_atendimento_data : ''), total: Number(c.total_servicos), telefone: c.telefone || '', email: c.email || '', temConta: !!c.tem_conta, convite: c.convite_enviado_em || null, registrados: Number(c.total_registrados) || 0 }));
  avaliacoes = avs.map(a => ({ id: a.id, cliente: a.cliente_nome, prestadora: a.prestadora_nome, servico: a.servico || '', nota: a.nota, comentario: a.comentario, status: a.status, data: (a.criado_em || '').slice(0, 10) }));
}

// Itens da prestadora (convite, confirmado, concluído, cancelado) já no formato da tela. Cada um traz os
// `conflitos`: outros atendimentos DELA que se sobrepõem a ele.
const reaisPrest = v => (v === null || v === undefined ? null : formatarReais(v));
const itemPrestadora = (a, status) => ({
  id: a.id, hora: a.hora_atendimento?.slice(0, 5), fim: a.hora_fim || '', serv: a.tipo_servico, area: a.area, valor: reaisPrest(a.valor_pago),
  data: String(a.dia || a.data_atendimento).slice(0, 10), cliente: a.cliente_nome || '', status: status || a.status, conflitos: a.conflitos || [], emAndamento: !!a.em_andamento,
});
let avisosPrestadora = [];
async function carregarDadosPrestadora() {
  const [conv, ag, avs, resumo, avisos] = await Promise.all([
    api('/atendimentos/prestadora/me/convites'),
    api('/atendimentos/prestadora/me/agenda'),
    api('/avaliacoes/prestadora/me'),
    api('/atendimentos/prestadora/me/resumo'),
    api('/atendimentos/prestadora/me/avisos'),
  ]);
  resumoPrestadora = resumo;
  avisosPrestadora = avisos;
  // valor_pago = o que a FRANQUIA paga a ela por este atendimento (null = tarifa ainda não definida)
  convites = conv.map(c => itemPrestadora(c, 'proposto'));
  agendaPrestadora = ag.map(a => itemPrestadora(a, 'aceito'));
  avaliacoes = avs.map(a => ({ id: a.id, cliente: a.cliente_nome, prestadora: prestadora.nome, servico: a.servico || '', nota: a.nota, comentario: a.comentario, status: a.status, data: (a.criado_em || '').slice(0, 10) }));
  await carregarCalendarioPrestadora();
}

let clienteAtendimentos = { atendimentos: [], prestadoras: {} };
async function carregarDadosCliente() {
  clienteAtendimentos = await api('/atendimentos/cliente/me/atendimentos');
  const conc = await api('/atendimentos/cliente/me/pendentes-avaliacao');
  concluidos = conc.map(c => ({ id: c.id, servico: c.tipo_servico, data: c.data_atendimento, prestadora: c.prestadora_nome || '—', prestadora_id: c.prestadora_id }));
}

/* região */
let regiao = null; // cidade escolhida na home: vem da lista de unidades cadastradas, nenhuma é fixa
function openRegion() { document.getElementById('region-modal').classList.add('show'); }
function setRegiao(key) {
  regiao = key; const c = cidades[key];
  document.getElementById('region-modal').classList.remove('show');
  document.getElementById('chip-region').textContent = c.nome;
  document.getElementById('hp-eyebrow').textContent = 'Atendendo ' + c.nome + ' e região';
  document.getElementById('hp-city').textContent = 'em ' + c.nome;
  document.getElementById('hc-city').textContent = 'Maria Brasileira ' + c.nome;
  aplicarEnderecoNoSite(c);
  // sem telefone cadastrado (unidade ainda sem dono), a linha some em vez de aparecer vazia
  document.getElementById('hc-phone').textContent = c.tel || '';
  document.getElementById('hc-phone-linha').style.display = c.tel ? '' : 'none';
  document.getElementById('ct-title').textContent = 'Unidade de ' + c.nome;
  document.getElementById('ct-phone').textContent = c.tel || '';
  document.getElementById('ct-phone-bloco').style.display = c.tel ? '' : 'none';
  document.getElementById('pf-region').textContent = c.nome + '/' + c.uf;
  document.getElementById('cli-unit').textContent = c.nome;
}
// Endereço da unidade no site: sem endereço cadastrado o campo some (em vez de aparecer vazio).
// No cabeçalho vale o resumido, ou o completo se não houver resumido.
function aplicarEnderecoNoSite(c) {
  const curto = c.endCurto || c.end || '';
  document.getElementById('hc-addr').textContent = curto;
  document.getElementById('hc-addr').style.display = curto ? '' : 'none';
  document.getElementById('ct-addr').textContent = c.end || '';
  document.getElementById('ct-addr-bloco').style.display = c.end ? '' : 'none';
}
function goSection(id) { show('screen-home'); setTimeout(() => document.getElementById(id).scrollIntoView({ behavior: 'smooth' }), 60); }

/* navegação */
let perfil = 'franqueado';
function setProfile(p) {
  perfil = p; ['franqueado', 'prestadora', 'cliente'].forEach(x => document.getElementById('pf-' + x).classList.toggle('active', x === p));
  // prestadora de conta criada pela planilha entra pela primeira vez com o NOME dela
  document.querySelector('label[for="login-user"]').textContent = p === 'prestadora' ? 'Nome, e-mail ou telefone' : 'E-mail ou telefone';
  document.getElementById('login-user').placeholder = p === 'prestadora' ? 'Seu nome completo (1º acesso), e-mail ou telefone' : 'voce@exemplo.com';
}
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(id).classList.add('active'); window.scrollTo(0, 0); }
function goLogin() { show('screen-login'); }
function goCadastro() { show('screen-cadastro'); }
// Trava contra duplo envio (Enter segurado, clique + Enter): cada tentativa
// conta no limite de tentativas de login da API.
let loginEmAndamento = false;
// Sem argumentos (botão "Entrar"/Enter) lê os campos da tela; com argumentos é
// usado logo depois de confirmar um cadastro, pra entrar direto na conta nova.
async function doLogin(identificadorDado, senhaDada) {
  if (loginEmAndamento) return;
  loginEmAndamento = true;
  try { await executarLogin(identificadorDado, senhaDada); } finally { loginEmAndamento = false; }
}
async function executarLogin(identificadorDado, senhaDada) {
  const identificador = typeof identificadorDado === 'string' ? identificadorDado.trim() : document.getElementById('login-user').value.trim();
  const senha = typeof senhaDada === 'string' ? senhaDada : document.getElementById('login-pass').value;
  if (!identificador || !senha) { toast('Preencha e-mail/telefone e senha.'); return; }

  const tipoInterno = { franqueado: 'administrador', prestadora: 'prestadora', cliente: 'cliente' }[perfil];
  let resp;
  try {
    resp = await api('/auth/login', { method: 'POST', body: JSON.stringify({ perfil: tipoInterno, identificador, senha }) });
  } catch (err) { toast('Não foi possível entrar: ' + err.message); return; }

  authToken = resp.token;
  const lembrar = document.getElementById('login-manter') ? document.getElementById('login-manter').checked : true;
  guardarToken(authToken, lembrar || typeof identificadorDado === 'string'); // logo depois de um cadastro (entra direto) lembra sempre
  Progresso.comecar('Carregando os seus dados…', resp.perfil === 'prestadora' ? 6 : (resp.perfil === 'cliente' ? 2 : 9));
  try { await iniciarSessao(resp, { restaurando: false }); } finally { Progresso.terminar(); }
}

// Monta a área do usuário que acabou de entrar (login) ou que voltou ao recarregar a página (sessão guardada).
const MODULO_DA_VISAO = { visaogeral: 'dashboard', agenda: 'agenda', avaliacoes: 'avaliacoes', equipe: 'equipe', clientes: 'clientes', financeiro: 'financeiro', relatorios: 'relatorios', subadmins: 'subadmins' };
async function iniciarSessao(resp, opcoes) {
  // resp.perfil é o perfil resolvido pelo backend ('administrador' ou 'sub_administrador'
  // — a mesma aba de login serve para os dois).
  const tipoInterno = resp.perfil === 'sub_administrador' ? 'administrador' : resp.perfil;
  usuarioLogado = { id: resp.usuario.id, tipo: resp.perfil || tipoInterno, dados: resp.usuario };
  aplicarFotoNoCirculo(avatarTopoAtual(), resp.usuario.foto, resp.usuario.nome);
  // Quem tem unidade fixa (funcionário, prestadora, cliente) entra na cidade
  // dela — não na que estava selecionada na home (ex.: quem chega por um link).
  if (resp.usuario.unidade_slug && cidades[resp.usuario.unidade_slug]) setRegiao(resp.usuario.unidade_slug);
  // Administrador: só as unidades dele (um admin só de Panambi não pode abrir
  // Carazinho) — o seletor de unidade esconde as que não são dele.
  const visao = opcoes && opcoes.restaurando ? lerVisao() : null;
  if (resp.usuario.unidades_slugs) {
    const minhas = resp.usuario.unidades_slugs;
    if (minhas.length && !minhas.includes(regiao) && cidades[minhas[0]]) setRegiao(minhas[0]);
    // recarregou a página: volta pra mesma unidade que estava aberta
    if (visao && visao.unit && minhas.includes(visao.unit) && cidades[visao.unit]) setRegiao(visao.unit);
    // (o seletor com as unidades da empresa é montado em setUnitUI → renderSeletorUnidades)
  }

  try {
    if (tipoInterno === 'administrador') {
      aplicarPermissoesAdminUI();
      await carregarUnidadeAdmin(regiao);
      await carregarEquipeClientesAvaliacoes(regiao);
      show('screen-franqueado'); setUnitUI(regiao);
      const p = permissoesAtuais();
      const ordem = [['visaogeral', 'dashboard'], ['agenda', 'agenda'], ['avaliacoes', 'avaliacoes'], ['equipe', 'equipe'], ['clientes', 'clientes'], ['financeiro', 'financeiro'], ['relatorios', 'relatorios']];
      const primeira = (ordem.find(([, modulo]) => p[modulo])?.[0]) || 'agenda';
      // recarregou a página: volta pra mesma tela (se a permissão dela continua valendo)
      const voltar = visao && MODULO_DA_VISAO[visao.view] && p[MODULO_DA_VISAO[visao.view]] !== false ? visao.view : primeira;
      adminView(voltar); updateAvalBadge();
    } else if (tipoInterno === 'prestadora') {
      prestadora = { id: resp.usuario.id, nome: resp.usuario.nome, unidade: resp.usuario.unidade_slug || regiao };
      const abrirArea = async () => {
        try {
          prestadora.nome = usuarioLogado.dados.nome;
          await carregarDadosPrestadora();
          show('screen-prestadora'); renderPrestadora(); renderCalendarioPrestadora();
        } catch (err) { toast('Erro ao carregar seus dados: ' + err.message); }
        iniciarSincronizacao();
      };
      // Conta criada pela planilha: antes de ver qualquer coisa, confirma o e-mail e troca a senha padrão
      if (resp.usuario.primeiro_acesso_pendente) { abrirPrimeiroAcesso(resp.usuario, abrirArea); return; }
      await carregarDadosPrestadora();
      show('screen-prestadora'); renderPrestadora(); renderCalendarioPrestadora();
    } else {
      await carregarDadosCliente();
      document.getElementById('cli-saudacao').textContent = 'Olá, ' + primeiroNome(resp.usuario.nome) + '.';
      show('screen-cliente'); renderClienteAval(); renderClienteAtendimentos();
    }
  } catch (err) {
    toast((opcoes && opcoes.restaurando ? 'Sessão reaberta, mas' : 'Login ok, mas') + ' houve um erro ao carregar seus dados: ' + err.message);
  }
  iniciarSincronizacao();
}

// Ao abrir/recarregar a página: se há sessão guardada, volta direto pra ela (sem pedir login). Link de convite
// (?perfil=… / ?cadastro=…) mostra a tela pedida. Token vencido ou conta desativada: esquece e fica na home.
async function restaurarSessao() {
  if (!authToken) return;
  const p = new URLSearchParams(location.search);
  if (p.get('perfil') || p.get('cadastro')) return;
  Progresso.comecar('Entrando…', 8);
  try {
    const resp = await api('/auth/sessao');
    try { sessionStorage.setItem('pm-token', authToken); } catch (e) { } // esta aba "adota" a sessão: outra aba entrar em outra conta não a troca
    await iniciarSessao(resp, { restaurando: true });
  } catch (err) {
    if (err.status === 401 || err.status === 403) { const velho = authToken; authToken = null; esquecerToken(velho); } // sessão vencida/conta desativada
    // falha de rede: mantém o token; recarregar de novo tenta outra vez
  } finally { Progresso.terminar(); }
}
function logout() {
  pararSincronizacao();
  const tokenDaSaida = authToken;
  authToken = null; usuarioLogado = null;
  esquecerToken(tokenDaSaida);
  show('screen-home');
}
