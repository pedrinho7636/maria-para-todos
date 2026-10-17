/* Portal da Maria — Núcleo: API, sessão e carregamento
   Endereço da API, sessão guardada no navegador (por aba e "lembrada"), barras de carregamento, chamadas à API (api/apiUpload) e aviso de versão nova.

   API — Node/Express + PostgreSQL (pasta api/).
   Servido pela própria API (site publicado, ou localhost:3001) → mesma origem, "/api".
   Aberto pelo Live Server/`npx serve` (5000/5500) ou direto do arquivo → aponta pra API local em localhost:3001. */

const API_BASE = (location.protocol === 'file:' || ['5000', '5500'].includes(location.port))
  ? "http://localhost:3001/api"
  : location.origin + "/api";
// A sessão (token) fica guardada no navegador: com "Manter conectado" em localStorage (sobrevive a fechar o navegador),
// sem ele em sessionStorage (sobrevive a recarregar a página, some ao fechar a aba). Junto vai a "visão" (qual tela do
// painel e qual unidade estavam abertas) pra recarregar a página voltar exatamente pro mesmo lugar.
// Cada ABA tem a sua própria sessão (sessionStorage): entrar numa conta em outra aba não troca a conta desta, e recarregar
// volta sempre pra quem estava aqui. O localStorage guarda só a sessão "lembrada" ("Manter conectado") pra ABAS NOVAS
// começarem logadas. Sair/token vencido numa aba só apaga a lembrada se for a mesma desta aba.
function lerTokenSalvo() { try { return sessionStorage.getItem('pm-token') || localStorage.getItem('pm-token'); } catch (e) { return null; } }
function guardarToken(token, lembrar) {
  try {
    sessionStorage.setItem('pm-token', token);
    if (lembrar) localStorage.setItem('pm-token', token); else localStorage.removeItem('pm-token');
  } catch (e) { }
}
// Depois de trocar a senha o servidor devolve um token NOVO: as sessões antigas (de outros aparelhos/abas, ou de quem roubou
// o token) deixam de valer e esta continua com o novo. Mantém a sessão "lembrada" só se esta já era a lembrada.
function adotarTokenNovo(novo) {
  if (!novo) return;
  let lembrada = false;
  try { lembrada = localStorage.getItem('pm-token') === authToken; } catch (e) { }
  authToken = novo;
  guardarToken(novo, lembrada);
}
function esquecerToken(token) {
  try {
    sessionStorage.removeItem('pm-token'); sessionStorage.removeItem('pm-visao');
    if (!token || localStorage.getItem('pm-token') === token) { localStorage.removeItem('pm-token'); localStorage.removeItem('pm-visao'); }
  } catch (e) { }
}
// A "visão" (tela do painel + unidade): por aba; a cópia no localStorage só vale pra aba nova que herdou o MESMO token.
const marcaDoToken = () => String(authToken || '').slice(-16);
function guardarVisao(visao) {
  try {
    sessionStorage.setItem('pm-visao', JSON.stringify(visao));
    if (localStorage.getItem('pm-token') === authToken) localStorage.setItem('pm-visao', JSON.stringify({ ...visao, t: marcaDoToken() }));
  } catch (e) { }
}
function lerVisao() {
  try {
    const propria = sessionStorage.getItem('pm-visao');
    if (propria) return JSON.parse(propria);
    const lembrada = JSON.parse(localStorage.getItem('pm-visao') || 'null');
    return lembrada && lembrada.t === marcaDoToken() ? lembrada : null;
  } catch (e) { return null; }
}
let authToken = lerTokenSalvo();

// A API manda a versão do site em cada resposta (X-App-Versao). Se a aba foi aberta antes de uma atualização, a
// versão dela é outra: avisa e oferece recarregar — senão a tela velha (campos, máscaras, regras) fala com a API nova.
// Aberto direto do arquivo / Live Server (sem a versão no HTML) isso fica desligado.
const VERSAO_DA_PAGINA = document.querySelector('meta[name="app-versao"]')?.content || '';
function verificarVersaoDoSite(versaoServidor) {
  if (!versaoServidor || !VERSAO_DA_PAGINA || VERSAO_DA_PAGINA === '__APP_VERSAO__' || versaoServidor === VERSAO_DA_PAGINA) return;
  if (document.getElementById('aviso-versao')) return;
  const faixa = document.createElement('div');
  faixa.id = 'aviso-versao';
  faixa.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#0E6B4F;color:#fff;padding:10px 16px;text-align:center;font:14px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25)';
  faixa.innerHTML = 'Há uma <b>versão nova</b> do Portal da Maria. <button style="margin-left:10px;padding:5px 14px;border:0;border-radius:8px;background:#fff;color:#0A4E3A;font-weight:600;cursor:pointer" onclick="location.reload()">Atualizar agora</button>';
  document.body.appendChild(faixa);
}

// Indicadores de carregamento. A barra fina no topo aparece em qualquer chamada que passa de ~0,3 s. O cartão com PORCENTAGEM
// é pra carregamentos grandes (entrar, trocar de unidade, enviar planilha): a % = chamadas já concluídas ÷ chamadas esperadas
// (ou, no envio de arquivo, bytes enviados ÷ total), nunca passa de 99% antes de terminar de verdade.
const Carregando = {
  emVoo: 0, timer: null,
  entrou() { this.emVoo++; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; if (this.emVoo > 0) this.barra(true); }, 300); Progresso.noInicio(); },
  saiu() { this.emVoo = Math.max(0, this.emVoo - 1); if (this.emVoo === 0) { clearTimeout(this.timer); this.timer = null; this.barra(false); } Progresso.noFim(); },
  barra(mostrar) { const b = document.getElementById('barra-topo'); if (b) b.style.display = mostrar ? 'block' : 'none'; },
};
const Progresso = {
  ativo: false, esperadas: 0, iniciadas: 0, concluidas: 0, maior: 0, timer: null, visivel: false,
  comecar(titulo, esperadas) {
    this.ativo = true; this.esperadas = esperadas; this.iniciadas = 0; this.concluidas = 0; this.maior = 0;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.visivel = true; this.pintar(titulo, 0, false); }, 250); // carregamento rápido não pisca a tela
    this.titulo = titulo;
  },
  noInicio() { if (this.ativo) this.iniciadas++; },
  noFim() { if (!this.ativo) return; this.concluidas++; const total = Math.max(this.esperadas, this.iniciadas); this.pintar(this.titulo, total ? Math.min(99, Math.round(this.concluidas / total * 100)) : 0, false); },
  definir(titulo, pct, indeterminada) { this.titulo = titulo; this.ativo = false; clearTimeout(this.timer); this.visivel = true; this.pintar(titulo, pct, indeterminada); },
  pintar(titulo, pct, indeterminada) {
    if (!this.visivel) return;
    this.maior = Math.max(this.maior, pct); // só sobe
    const tela = document.getElementById('carregando-tela'); if (!tela) return;
    tela.style.display = 'flex';
    document.getElementById('carregando-titulo').textContent = titulo;
    const barra = document.getElementById('carregando-barra');
    barra.classList.toggle('indeterminada', !!indeterminada);
    barra.style.width = this.maior + '%';
    document.getElementById('carregando-pct').textContent = indeterminada ? 'processando…' : this.maior + '%';
  },
  terminar() {
    this.ativo = false; clearTimeout(this.timer);
    const tela = document.getElementById('carregando-tela');
    if (this.visivel && tela) { this.maior = 100; this.pintar(this.titulo, 100, false); setTimeout(() => { tela.style.display = 'none'; }, 180); }
    this.visivel = false;
  },
};
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('barra-topo')) return;
  const barra = document.createElement('div'); barra.id = 'barra-topo'; document.body.appendChild(barra);
  const tela = document.createElement('div'); tela.id = 'carregando-tela'; tela.setAttribute('role', 'status'); tela.setAttribute('aria-live', 'polite');
  tela.innerHTML = '<div class="carregando-card"><div class="carregando-titulo" id="carregando-titulo">Carregando…</div><div class="carregando-trilho"><div class="carregando-barra" id="carregando-barra"></div></div><div class="carregando-pct" id="carregando-pct">0%</div></div>';
  document.body.appendChild(tela);
});
// Envio de arquivo com porcentagem de verdade (fetch não informa o progresso do envio; XMLHttpRequest informa)
function apiUpload(path, corpo, aoProgresso) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE + path);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (authToken) xhr.setRequestHeader('Authorization', 'Bearer ' + authToken);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) aoProgresso(Math.round((e.loaded / e.total) * 100), false); };
    xhr.upload.onload = () => aoProgresso(100, true); // enviado: agora é o servidor lendo a planilha
    xhr.onload = () => {
      let dados = {}; try { dados = JSON.parse(xhr.responseText); } catch (e) { }
      verificarVersaoDoSite(xhr.getResponseHeader('x-app-versao'));
      if (xhr.status >= 200 && xhr.status < 300) return resolve(dados);
      const erro = new Error(dados.erro || ('Erro ' + xhr.status)); erro.status = xhr.status; erro.codigo = dados.codigo; erro.dados = dados; reject(erro);
    };
    xhr.onerror = () => reject(new Error('Falha de rede ao enviar o arquivo.'));
    xhr.send(JSON.stringify(corpo));
  });
}

async function apiBruta(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  const dados = await res.json().catch(() => ({}));
  verificarVersaoDoSite(res.headers.get('x-app-versao'));
  // 401 de /auth/* é "e-mail/senha incorretos" (ou outro erro de cadastro), não
  // sessão vencida — só vale o tratamento de sessão pra quem estava logado.
  if (res.status === 401 && authToken && !path.startsWith('/auth/')) {
    // Token ausente/expirado/inválido (JWT dura 7 dias) — sem isso, quem já
    // estava logado ficava preso numa tela autenticada vendo "Erro 401" nos
    // toasts de cada ação, sem entender que precisa entrar de novo.
    const estavaLogado = !!authToken;
    const tokenInvalido = authToken;
    authToken = null; usuarioLogado = null;
    esquecerToken(tokenInvalido);
    if (estavaLogado && typeof show === 'function') show('screen-home');
    throw new Error('Sessão expirada — faça login novamente.');
  }
  if (!res.ok) {
    const erro = new Error(dados.erro || ('Erro ' + res.status));
    erro.status = res.status; erro.codigo = dados.codigo; erro.dados = dados; // ex.: codigo CONFLITO_HORARIO / JA_RECUSOU
    throw erro;
  }
  return dados;
}
async function api(path, opts = {}) {
  Carregando.entrou();
  try { return await apiBruta(path, opts); } finally { Carregando.saiu(); }
}
