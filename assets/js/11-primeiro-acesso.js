/* Portal da Maria — Primeiro acesso da prestadora
   Conta criada pela planilha: confirmar o e-mail e trocar a senha padrão antes de usar o portal. */

/* Primeiro acesso da prestadora (conta criada pela planilha): entra com o nome + senha padrão e, antes de
   qualquer coisa, informa o e-mail DELA, confirma o código recebido e troca a senha. O servidor também barra
   o resto da área dela enquanto isso não termina (403 PRIMEIRO_ACESSO). */
let paOcupado = false, paEmail = '', paContinuar = null;
function abrirPrimeiroAcesso(usuario, continuar) {
  paContinuar = continuar;
  document.getElementById('pa-nome').textContent = usuario.nome;
  document.getElementById('pa-email').value = '';
  document.getElementById('pa-tel').value = formatarTelefone(usuario.telefone);
  ['pa-senha', 'pa-senha2', 'pa-codigo'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pa-passo1').style.display = 'block';
  document.getElementById('pa-passo2').style.display = 'none';
  document.getElementById('modal-primeiro-acesso').classList.add('show');
  document.getElementById('pa-email').focus();
}
function sairPrimeiroAcesso() { document.getElementById('modal-primeiro-acesso').classList.remove('show'); logout(); }
function primeiroAcessoVoltar() {
  document.getElementById('pa-passo1').style.display = 'block';
  document.getElementById('pa-passo2').style.display = 'none';
}
async function primeiroAcessoPedirCodigo() {
  const email = document.getElementById('pa-email').value.trim();
  const senha = document.getElementById('pa-senha').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Informe o seu e-mail.'); return false; }
  if (senha.length < 8) { toast('A nova senha precisa ter ao menos 8 caracteres.'); return false; }
  if (senha === SENHA_PADRAO_IMPORTADAS) { toast('Escolha uma senha diferente da senha padrão.'); return false; }
  if (senha !== document.getElementById('pa-senha2').value) { toast('As duas senhas não são iguais.'); return false; }
  try {
    const resp = await api('/primeiro-acesso/solicitar', { method: 'POST', body: JSON.stringify({ email }) });
    paEmail = email;
    toast(mensagemEnvioEmail(resp.emailEnviado, email, resp.motivoEmail));
    return true;
  } catch (err) { toast(err.message); return false; }
}
async function primeiroAcessoEnviarCodigo() {
  if (paOcupado) return;
  paOcupado = true;
  const botao = document.getElementById('pa-enviar'); botao.disabled = true;
  try {
    if (!await primeiroAcessoPedirCodigo()) return;
    document.getElementById('pa-texto2').innerHTML = `Digite o código de 6 dígitos que enviamos para <b>${escapeHtml(paEmail)}</b> (vale por 15 minutos).`;
    document.getElementById('pa-passo1').style.display = 'none';
    document.getElementById('pa-passo2').style.display = 'block';
    document.getElementById('pa-codigo').focus();
  } finally { paOcupado = false; botao.disabled = false; }
}
async function primeiroAcessoReenviar(ev) {
  if (ev) ev.preventDefault();
  if (paOcupado) return;
  paOcupado = true;
  try { await primeiroAcessoPedirCodigo(); } finally { paOcupado = false; }
}
async function primeiroAcessoConcluir() {
  if (paOcupado) return;
  const codigo = document.getElementById('pa-codigo').value.trim();
  if (!/^\d{6}$/.test(codigo)) { toast('Digite o código de 6 dígitos.'); return; }
  paOcupado = true;
  const botao = document.getElementById('pa-concluir'); botao.disabled = true;
  try {
    const r = await api('/primeiro-acesso/concluir', { method: 'POST', body: JSON.stringify({
      email: paEmail, codigo, senha_nova: document.getElementById('pa-senha').value, telefone: document.getElementById('pa-tel').value.trim(),
    }) });
    document.getElementById('modal-primeiro-acesso').classList.remove('show');
    adotarTokenNovo(r.token); // a senha padrão deixou de valer, e com ela as sessões feitas com ela
    usuarioLogado.dados = { ...usuarioLogado.dados, ...r.usuario };
    toast('Tudo certo! Seu e-mail foi confirmado e sua senha foi trocada.');
    const continuar = paContinuar; paContinuar = null;
    if (continuar) await continuar();
  } catch (err) { toast(err.message); }
  finally { paOcupado = false; botao.disabled = false; }
}

function renderClientes() {
  const arr = clientesData[currentUnit] || [];
  document.getElementById('clv-unit').textContent = unidades[currentUnit].nome;
  const adminCompleto = usuarioLogado?.tipo === 'administrador'; // substituir perfil apaga um cadastro: só administrador completo
  document.getElementById('clv-list').innerHTML = arr.map(c => {
    const conta = c.temConta ? '<span class="chip chip-on">com conta</span>' : '<span class="chip chip-off">sem cadastro</span>';
    let acoes = '';
    if (!c.temConta) {
      acoes += c.telefone
        ? `<button class="btn-sm ghost" onclick="convidarClienteWhats('${c.id}')">${c.convite ? 'Reenviar convite' : 'Convidar por WhatsApp'}</button>`
        : '<span class="tr-meta">sem telefone p/ convidar</span>';
      if (c.convite && adminCompleto) acoes += `<button class="btn-sm ghost" onclick="abrirSubstituir('${c.id}')">Substituir perfil</button>`;
    }
    const detalhe = [c.telefone ? escapeHtml(exibirTelefone(c.telefone)) : '', !c.temConta && c.convite ? 'convite enviado em ' + dataHoraBR(c.convite) : ''].filter(Boolean).join(' · ');
    return `<div class="tablerow"><div class="tr-av">${escapeHtml(c.ini)}</div><div class="tr-body"><strong>${escapeHtml(c.nome)}</strong><span>${escapeHtml(c.ultimo)}</span>${detalhe ? `<span>${detalhe}</span>` : ''}</div>${conta}<span class="tr-meta">${c.total} serviços</span>${acoes}</div>`;
  }).join('') || '<div class="empty">Nenhum cliente ainda.</div>';
}
