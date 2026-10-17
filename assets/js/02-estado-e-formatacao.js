/* Portal da Maria — Estado global e campos
   Dados em memória, horário em 24 h, máscaras de telefone/dinheiro/CNPJ, nomes com inicial maiúscula e escapeHtml. */

/* ================================================================
   PORTAL DA MARIA — VERSÃO "LOCAL"
   Os dados abaixo vêm da API Node/Express (pasta api/), que fala
   com um PostgreSQL local usando o schema de banco-schema-local.sql.
   ================================================================ */
let cidades = {};
let unidades = {};
let prestadora = { nome: "", unidade: "", id: null };
let usuarioLogado = null;   // { id, tipo: 'administrador'|'prestadora'|'cliente' }
let convites = [];
let agendaPrestadora = [];
let resumoPrestadora = null; // tarifa e totais calculados pela API (semana/mês)
// linha de detalhe de um atendimento da prestadora: local e valor só entram se existirem
function detalheJob(a) {
  const partes = [a.area ? escapeHtml(a.area) : '', a.valor || ''].filter(Boolean);
  return partes.length ? `<span>${partes.join(' · ')}</span>` : '';
}
let equipeData = {};     // slug da unidade -> equipe (as unidades vêm da API, não são fixas)
let clientesData = {};
let avaliacoes = [];
let concluidos = [];
let bancoCarregado = false;

// A API diz se o e-mail saiu de verdade (emailEnviado). Quando não saiu
// (servidor de e-mail sem chave configurada ou recusando o destinatário), o
// código fica só no console da API — isso é cenário de desenvolvimento, e a
// mensagem precisa dizer a verdade em vez de prometer um e-mail que não existe.
function mensagemEnvioEmail(enviado, email, motivo) {
  if (enviado) return 'Enviamos um código de 6 dígitos para ' + email + '. Confira a caixa de entrada (e o spam).';
  const detalhe = {
    'nao-configurado': 'O servidor de e-mail da API não está configurado.',
    'recusado-pelo-provedor': 'O provedor de e-mail recusou esse destinatário (conta de teste da Resend só entrega pro e-mail dono da conta).',
    'smtp-autenticacao': 'O servidor de e-mail recusou o usuário/senha (confira SMTP_USER e se SMTP_PASS é a senha de app do Gmail, 16 letras, sem espaços).',
    'smtp-conexao': 'O servidor não conseguiu se conectar ao servidor de e-mail (porta bloqueada pela hospedagem ou falha de rede).',
    'erro-de-envio': 'O envio falhou (veja o motivo nos logs da API).',
  }[motivo] || 'O envio falhou.';
  return 'Não foi possível enviar o e-mail. ' + detalhe + ' Em desenvolvimento o código aparece no console da API.';
}

// "Hoje" no fuso do Brasil, não em UTC — new Date().toISOString() adianta o
// dia entre ~21h e 23h59 no horário de Brasília (UTC-3), o que descasava a
// regra "confirma a partir de 2 dias antes" (e o destaque de "hoje" no
// calendário) dependendo da hora exata em que a página era usada.
function hojeISOBrasil() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
// "quinta-feira, 2 de outubro" — as telas mostravam um texto fixo do protótipo ("22 de junho").
function dataPorExtensoHoje() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
}
function primeiroNome(nome) { return (nome || '').trim().split(/\s+/)[0] || ''; }

/* Horários SEMPRE em 24 h (08:00, 13:30, 22:00 — nunca AM/PM). O <input type="time"> mostra AM/PM conforme o
   idioma do navegador e não dá pra impedir, então o horário é escolhido em dois seletores (hora 00–23 e minuto de 5 em 5). */
// "9", "930", "9:30", "0930", "13:30" -> "HH:MM"; inválido ("25:00", "12:75") -> null
function lerHora(texto) {
  const t = String(texto ?? '').trim();
  let h, m;
  if (/^\d{1,2}:\d{2}$/.test(t)) [h, m] = t.split(':').map(Number);
  else if (/^\d{1,2}$/.test(t)) { h = Number(t); m = 0; }
  else if (/^\d{3,4}$/.test(t)) { h = Number(t.slice(0, -2)); m = Number(t.slice(-2)); }
  else return null;
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') : null;
}
// Seletores de horário: <div class="hora-sel" data-alvo="ID"> vira  [hora] : [minuto]  e grava "HH:MM" no input escondido ID
function montarSeletoresHora() {
  document.querySelectorAll('.hora-sel').forEach(caixa => {
    const alvo = caixa.dataset.alvo;
    const horas = ['<option value="">--</option>'], minutos = ['<option value="">--</option>'];
    for (let h = 0; h < 24; h++) horas.push('<option value="' + String(h).padStart(2, '0') + '">' + String(h).padStart(2, '0') + '</option>');
    for (let m = 0; m < 60; m += 5) minutos.push('<option value="' + String(m).padStart(2, '0') + '">' + String(m).padStart(2, '0') + '</option>');
    caixa.innerHTML = '<select id="' + alvo + '-h" aria-label="Hora" onchange="horaSelecionada(\'' + alvo + '\')">' + horas.join('') + '</select><span>:</span>'
      + '<select id="' + alvo + '-m" aria-label="Minuto" onchange="horaSelecionada(\'' + alvo + '\')">' + minutos.join('') + '</select>';
  });
}
function horaSelecionada(alvo) {
  const h = document.getElementById(alvo + '-h'), m = document.getElementById(alvo + '-m');
  if (h.value && !m.value) m.value = '00'; // escolheu a hora: já vale hora cheia
  document.getElementById(alvo).value = h.value ? h.value + ':' + (m.value || '00') : '';
}
function definirHora(alvo, valor) {
  const [h, m] = (valor || '').split(':');
  const sh = document.getElementById(alvo + '-h'), sm = document.getElementById(alvo + '-m');
  if (sh) sh.value = h || '';
  if (sm) {
    if (m && ![...sm.options].some(o => o.value === m)) sm.add(new Option(m, m)); // minuto fora do passo de 5 (ex.: vindo de fora)
    sm.value = m || '';
  }
  document.getElementById(alvo).value = valor || '';
}
// data de um instante (timestamp do banco) no fuso de Brasília — o corte em UTC mostrava o dia seguinte à noite
const dataHoraBR = (instante) => new Date(instante).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
/* Telefone: formato certo enquanto digita — (54) 3333-4444 ou (54) 9 9999-0000. Aceita +55 colado; o servidor guarda só
   os dígitos de qualquer jeito. */
function formatarTelefone(valor) {
  let d = String(valor == null ? '' : valor).replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2); // +55 digitado/colado
  d = d.slice(0, 11);
  if (!d) return '';
  const ddd = d.slice(0, 2), r = d.slice(2);
  if (d.length <= 2) return '(' + d;
  if (r.length <= 4) return '(' + ddd + ') ' + r;
  if (d.length <= 10) return '(' + ddd + ') ' + r.slice(0, 4) + '-' + r.slice(4);
  return '(' + ddd + ') ' + r[0] + ' ' + r.slice(1, 5) + '-' + r.slice(5);
}
// pra EXIBIR um telefone vindo do banco (pode ser só dígitos): formata se parece telefone, senão mostra como veio
const exibirTelefone = (v) => (String(v == null ? '' : v).replace(/\D/g, '').length >= 10 ? formatarTelefone(v) : (v || ''));
function mascararTelefone(input) { input.value = formatarTelefone(input.value); }

/* Dinheiro como no app do banco: só dígitos, sempre duas casas, e cada dígito novo entra pela direita
   (1 → 0,01 · 15 → 0,15 · 1500 → 15,00 · 150000 → 1.500,00). Apagar tudo deixa o campo vazio ("sem valor").
   Vale pra todo <input data-moeda> — inclusive os criados depois (detalhe do atendimento na agenda). */
function formatarMoedaCampo(valor) {
  const d = String(valor == null ? '' : valor).replace(/\D/g, '').replace(/^0+/, '').slice(0, 10); // até 99.999.999,99
  if (!d) return '';
  const c = d.padStart(3, '0');
  return c.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + c.slice(-2);
}
// valor numérico vindo do banco (150 / "150.5") → "150,50", pronto pra máscara
const moedaParaCampo = (v) => (v === null || v === undefined || v === '' ? '' : formatarMoedaCampo(Math.round(Number(v) * 100)));
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('input[data-moeda]')) return;
  el.value = formatarMoedaCampo(el.value);
  el.setSelectionRange(el.value.length, el.value.length); // o cursor fica sempre no fim, como no banco
});

/* Nomes: primeira letra de cada palavra em maiúscula ("ana carolina" → "Ana Carolina"; de/da/do/dos/das/e ficam
   minúsculos no meio). Nome de PESSOA digitado todo em maiúsculas também vira "Ana Carolina". Ao sair do campo; o
   servidor faz a mesma coisa ao gravar. */
function capitalizarNomeFront(texto, pessoa) {
  let t = String(texto == null ? '' : texto).trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (pessoa && !/[a-zà-ÿ]/.test(t)) t = t.toLowerCase();
  const ligacoes = ['de', 'da', 'do', 'das', 'dos', 'e'];
  t = t.split(' ').map((p, i) => (i > 0 && ligacoes.indexOf(p.toLowerCase()) >= 0 ? p.toLowerCase() : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1))).join(' ');
  return pessoa ? t.replace(/-([a-zà-ÿ])/g, (m, c) => '-' + c.toLocaleUpperCase('pt-BR')) : t;
}
function ligarFormatacaoDeCampos() {
  ['c-tel', 'cad-admin-tel', 'prest-phone', 'cad-cliente-telefone', 'atd-cliente-tel', 'np-tel', 'contato-tel', 'pa-tel', 'perfil-telefone', 'perfil-un-edit-tel', 'perfil-un-tel'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('maxlength', '16'); el.setAttribute('inputmode', 'tel'); el.setAttribute('autocomplete', 'off');
    el.addEventListener('input', () => mascararTelefone(el));
  });
  // pessoas: maiúsculas viram "Nome Próprio"; clientes/unidades (podem ser nome fantasia/sigla) só ganham a inicial maiúscula
  const grupos = [[true, ['cad-admin-nome', 'cad-admin-sobrenome', 'cad-prestadora-nome', 'sa-nome', 'sa-sobrenome', 'np-nome', 'perfil-nome', 'perfil-sobrenome']],
    [false, ['cad-cliente-nome', 'atd-cliente-nome', 'c-nome', 'cad-admin-un-nome', 'perfil-un-nome']]];
  for (const [pessoa, ids] of grupos) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('blur', () => { el.value = capitalizarNomeFront(el.value, pessoa); });
    });
  }
}
const horarioFaixa = (a) => (a.hora || '--:--') + (a.fim ? '–' + a.fim : ''); // "09:00–13:00"

/* CNPJ: máscara enquanto digita (com ou sem pontuação, e aceita o CNPJ alfanumérico da Receita) e aviso se os
   dígitos verificadores não conferem. O servidor é quem decide; aqui é só ajuda — um CNPJ que já tem conta pode ser
   antigo/de teste e entra mesmo assim com os dados da empresa. */
function cnpjValidoFront(texto) {
  const d = String(texto || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(d) || /^(.)\1{13}$/.test(d)) return false;
  const dv = (base) => { let soma = 0, peso = base.length - 7; for (const c of base) { soma += (c.charCodeAt(0) - 48) * peso--; if (peso < 2) peso = 9; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}
function mascararCnpj(input) {
  const v = input.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
  const p = [v.slice(0, 2), v.slice(2, 5), v.slice(5, 8), v.slice(8, 12), v.slice(12, 14)];
  input.value = p[0] + (p[1] ? '.' + p[1] : '') + (p[2] ? '.' + p[2] : '') + (p[3] ? '/' + p[3] : '') + (p[4] ? '-' + p[4] : '');
  const dica = document.getElementById(input.id + '-dica');
  if (!dica) return;
  if (v.length < 14) { dica.textContent = ''; return; }
  const ok = cnpjValidoFront(v);
  dica.style.color = ok ? 'var(--green-strong)' : 'var(--red)';
  dica.textContent = ok ? '✓ CNPJ válido.' : '⚠ Os dígitos verificadores não conferem — confira o número. (Vale pra empresa nova; CNPJ que já tem conta entra com os dados dela.)';
}

// Chama a API e, se ela avisar de CONFLITO DE HORÁRIO da prestadora ou de que ela JÁ RECUSOU o atendimento,
// pergunta ao administrador e, se ele confirmar, repete a chamada com o "mesmo assim" (forcar_conflito / forcar_recusa).
// Cancelando, lança um erro com .cancelado = true (quem chama não mostra mensagem de erro).
async function apiComConfirmacao(path, opts = {}) {
  const corpo = opts.body ? JSON.parse(opts.body) : {};
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try { return await api(path, { ...opts, body: JSON.stringify(corpo) }); }
    catch (err) {
      const flag = { CONFLITO_HORARIO: 'forcar_conflito', JA_RECUSOU: 'forcar_recusa' }[err.codigo];
      if (!flag || err.status !== 409) throw err;
      if (!window.confirm(err.message)) { const cancelado = new Error('Operação cancelada.'); cancelado.cancelado = true; throw cancelado; }
      corpo[flag] = true;
    }
  }
  throw new Error('Não foi possível concluir (conflito persistente).');
}
let cadastroUnidadeConvite = ''; // unidade vinda do link de convite (?cadastro=cliente&unidade=...)

// Qualquer texto que venha do banco e tenha se originado de um campo livre
// digitado por cliente/prestadora (nome, tipo_servico, area, comentário...)
// passa por aqui antes de entrar num innerHTML — sem isso, um pedido público
// ou uma avaliação com <script>/<img onerror=...> executa no navegador de
// quem visualizar a lista (ex.: o admin), podendo roubar o token da sessão.
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
