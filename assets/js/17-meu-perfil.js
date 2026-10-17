/* Portal da Maria — Meu perfil
   Configurações de conta (nome, foto, telefone, e-mail, senha e dados da unidade) para os quatro tipos de usuário. */

/* ===== Meu perfil — configurações de conta, mesma tela pros 4 tipos de
   usuário (administrador/sub-administrador/prestadora/cliente); o back-end
   decide o que cada um pode editar via GET /perfil. */
let perfilAtual = null;
let perfilEmailPendente = null;

function iniciaisNome(nome) {
  return (nome || '').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
}
function aplicarFotoNoCirculo(el, foto, nome) {
  if (!el) return;
  foto = fotoSegura(foto); // só imagem em base64 de verdade: qualquer outra coisa nunca entra no CSS (url(...))
  if (foto) {
    // size/position inline porque os avatares do topo têm `background:` em
    // shorthand inline (cor de fundo), que zera o background-size da classe —
    // sem isso a foto aparecia ampliada, só um pedaço do canto.
    el.style.backgroundImage = `url(${foto})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.textContent = iniciaisNome(nome);
  }
}
function avatarTopoAtual() {
  const id = { administrador: 'topbar-avatar-admin', sub_administrador: 'topbar-avatar-admin', prestadora: 'topbar-avatar-prestadora', cliente: 'topbar-avatar-cliente' }[usuarioLogado?.tipo];
  return id ? document.getElementById(id) : null;
}

async function abrirPerfil() {
  if (!usuarioLogado) return;
  try {
    perfilAtual = await api('/perfil');
  } catch (err) { toast('Erro ao carregar perfil: ' + err.message); return; }
  perfilEmailPendente = null;

  document.getElementById('perfil-nome').value = perfilAtual.nome || '';
  document.getElementById('perfil-sobrenome-wrap').style.display = perfilAtual.temSobrenome ? 'block' : 'none';
  document.getElementById('perfil-sobrenome').value = perfilAtual.sobrenome || '';
  document.getElementById('perfil-telefone').value = formatarTelefone(perfilAtual.telefone);
  // administrador: o telefone que importa é o da UNIDADE (abaixo, em "Dados da unidade"); o pessoal não é usado em lugar nenhum
  const ehAdmin = perfilAtual.perfil === 'administrador';
  document.getElementById('perfil-telefone-wrap').style.display = ehAdmin ? 'none' : '';
  document.getElementById('perfil-basico-botao').textContent = ehAdmin ? 'Salvar nome' : 'Salvar nome e telefone';
  document.getElementById('perfil-email').value = perfilAtual.email || '';
  document.getElementById('perfil-email-codigo').value = '';
  document.getElementById('perfil-email-senha').value = '';
  document.getElementById('perfil-email-codebox').style.display = 'none';
  aplicarFotoNoCirculo(document.getElementById('perfil-foto-preview'), perfilAtual.foto, perfilAtual.nome);

  const hint = document.getElementById('perfil-email-hint');
  if (perfilAtual.exigeDominioInstitucional) {
    hint.style.display = 'block';
    hint.textContent = `Precisa terminar em @${perfilAtual.dominioInstitucional} e começar com o nome da sua unidade` +
      (perfilAtual.unidadesSlugs?.length ? ` (${perfilAtual.unidadesSlugs.join(' ou ')}).` : '.');
  } else {
    hint.style.display = 'none';
  }

  document.getElementById('perfil-senha-atual').value = '';
  document.getElementById('perfil-senha-nova').value = '';
  document.getElementById('perfil-senha-nova2').value = '';

  // administrador: mostra a empresa (CNPJ + unidades) e o formulário de nova unidade
  const caixaEmpresa = document.getElementById('perfil-empresa');
  caixaEmpresa.style.display = perfilAtual.empresa ? 'block' : 'none';
  if (perfilAtual.empresa) {
    const e = perfilAtual.empresa;
    document.getElementById('perfil-empresa-resumo').innerHTML =
      (e.cnpj ? `CNPJ <b>${escapeHtml(e.cnpj)}</b> · ` : 'Sem CNPJ definido · ') + plural(e.unidades.length, 'unidade', 'unidades');
    // seletor das unidades da empresa (abre na que está aberta no painel)
    const sel = document.getElementById('perfil-un-sel');
    sel.innerHTML = e.unidades.map(u => `<option value="${escapeHtml(u.slug)}">${escapeHtml(u.nome)}/${escapeHtml(u.uf)}</option>`).join('');
    if (e.unidades.some(u => u.slug === currentUnit)) sel.value = currentUnit;
    perfilCarregarUnidade();
    ['perfil-un-nome', 'perfil-un-uf', 'perfil-un-tel', 'perfil-un-end', 'perfil-un-cnpj'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('perfil-un-cnpj-wrap').style.display = e.cnpj ? 'none' : 'block'; // conta criada por script pode não ter CNPJ
  }

  document.getElementById('modal-perfil').classList.add('show');
}
function fecharPerfil() { document.getElementById('modal-perfil').classList.remove('show'); }

// Dados da unidade (telefone de WhatsApp e endereço mostrado no site), editáveis pelo administrador no Meu perfil.
function perfilCarregarUnidade() {
  const c = cidades[document.getElementById('perfil-un-sel').value] || {};
  document.getElementById('perfil-un-edit-tel').value = formatarTelefone(c.tel);
  document.getElementById('perfil-un-edit-end').value = c.end || '';
  document.getElementById('perfil-un-edit-curto').value = c.endCurto || '';
}
let salvandoUnidadePerfil = false;
async function salvarDadosUnidadePerfil() {
  if (salvandoUnidadePerfil) return;
  const slug = document.getElementById('perfil-un-sel').value;
  const c = cidades[slug];
  if (!c) { toast('Escolha a unidade.'); return; }
  const telefone = document.getElementById('perfil-un-edit-tel').value.trim();
  const endereco = document.getElementById('perfil-un-edit-end').value.trim();
  const endereco_curto = document.getElementById('perfil-un-edit-curto').value.trim();
  const mudouTel = telefone.replace(/\D/g, '') !== (c.tel || '').replace(/\D/g, ''), mudouEnd = endereco !== (c.end || '') || endereco_curto !== (c.endCurto || '');
  if (!mudouTel && !mudouEnd) { toast('Nada mudou.'); return; }
  if (mudouTel && !telefone) { toast('Informe o telefone da unidade (o WhatsApp do site usa esse número).'); return; }
  salvandoUnidadePerfil = true;
  const botao = document.getElementById('perfil-un-salvar'); botao.disabled = true;
  try {
    if (mudouTel) { const u = await api(`/unidades/${slug}/telefone`, { method: 'PATCH', body: JSON.stringify({ telefone }) }); c.tel = u.telefone; }
    if (mudouEnd) { const u = await api(`/unidades/${slug}/endereco`, { method: 'PATCH', body: JSON.stringify({ endereco, endereco_curto }) }); c.end = u.endereco; c.endCurto = u.endereco_curto; }
    if (slug === regiao) setRegiao(slug); // o site da cidade aberta na home já mostra o dado novo
    perfilCarregarUnidade();
    toast(`Dados da unidade ${c.nome} atualizados.`);
  } catch (err) { toast('Erro ao salvar os dados da unidade: ' + err.message); }
  finally { salvandoUnidadePerfil = false; botao.disabled = false; }
}

// "Adicionar unidade" dentro do perfil: acrescenta uma franquia à empresa (mesmo CNPJ) da conta logada.
let adicionandoUnidade = false;
async function adicionarUnidadePerfil() {
  if (adicionandoUnidade) return;
  const nome = document.getElementById('perfil-un-nome').value.trim();
  const uf = document.getElementById('perfil-un-uf').value.trim().toUpperCase();
  if (!nome) { toast('Informe a cidade/nome da unidade.'); return; }
  if (uf.length !== 2) { toast('Informe a UF da unidade (ex.: RS).'); return; }
  adicionandoUnidade = true;
  const botao = document.getElementById('perfil-un-botao'); botao.disabled = true;
  try {
    const r = await api('/unidades', { method: 'POST', body: JSON.stringify({
      nome, uf,
      telefone: document.getElementById('perfil-un-tel').value.trim() || undefined,
      endereco: document.getElementById('perfil-un-end').value.trim() || undefined,
      cnpj: document.getElementById('perfil-un-cnpj').value.trim() || undefined,
    }) });
    usuarioLogado.dados = { ...usuarioLogado.dados, unidades_slugs: r.unidades_slugs };
    await carregarDadosPublicos();         // a unidade nova passa a existir nas listas públicas
    await setUnit(r.unidade.slug);         // e já abre ela no painel (o seletor ganha o novo botão)
    fecharPerfil();
    toast(`Unidade ${r.unidade.nome} adicionada à sua empresa — alterne entre as unidades pelo seletor no topo do painel.`);
  } catch (err) { toast('Erro ao adicionar unidade: ' + err.message); }
  finally { adicionandoUnidade = false; botao.disabled = false; }
}

// Corta no centro (quadrado) e reduz pra 256×256 JPEG antes de enviar: a
// foto aparece num círculo de poucas dezenas de pixels, então mandar o
// arquivo original do celular (vários MB) só estourava o limite do servidor.
function reduzirFoto(file, lado = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const menor = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = lado;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // PNG com transparência viraria preto em JPEG
      ctx.fillRect(0, 0, lado, lado);
      ctx.drawImage(img, (img.width - menor) / 2, (img.height - menor) / 2, menor, menor, 0, 0, lado, lado);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler essa imagem.')); };
    img.src = url;
  });
}
async function perfilFotoSelecionada(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Escolha um arquivo de imagem.'); input.value = ''; return; }
  if (file.size > 15 * 1024 * 1024) { toast('Imagem muito grande (máx. 15MB).'); input.value = ''; return; }
  try {
    await salvarFotoPerfil(await reduzirFoto(file));
  } catch (err) { toast(err.message); }
  input.value = ''; // permite escolher o mesmo arquivo de novo depois
}
function removerFotoPerfil() { salvarFotoPerfil(''); }

// A foto é salva na hora (ao escolher/remover), sem depender de um segundo
// clique em "Salvar" — esse passo escondido fazia parecer que a troca "não pegou".
async function salvarFotoPerfil(foto) {
  try {
    perfilAtual = await api('/perfil', { method: 'PATCH', body: JSON.stringify({ foto: foto || null }) });
    sincronizarPerfilNaTela();
    toast(foto ? 'Foto atualizada.' : 'Foto removida.');
  } catch (err) {
    aplicarFotoNoCirculo(document.getElementById('perfil-foto-preview'), perfilAtual.foto, perfilAtual.nome);
    toast('Erro ao salvar a foto: ' + err.message);
  }
}
// Reflete o perfil recém-salvo no modal e no avatar do topo.
function sincronizarPerfilNaTela() {
  if (usuarioLogado) usuarioLogado.dados = { ...usuarioLogado.dados, ...perfilAtual };
  if (usuarioLogado?.tipo === 'prestadora') {
    prestadora.nome = perfilAtual.nome;
    document.getElementById('ps-saudacao').textContent = 'Olá, ' + primeiroNome(perfilAtual.nome) + '.';
  }
  if (usuarioLogado?.tipo === 'cliente') document.getElementById('cli-saudacao').textContent = 'Olá, ' + primeiroNome(perfilAtual.nome) + '.';
  aplicarFotoNoCirculo(document.getElementById('perfil-foto-preview'), perfilAtual.foto, perfilAtual.nome);
  aplicarFotoNoCirculo(avatarTopoAtual(), perfilAtual.foto, perfilAtual.nome);
}

async function salvarPerfilBasico() {
  const nome = document.getElementById('perfil-nome').value.trim();
  if (!nome) { toast('Informe seu nome.'); return; }
  const body = { nome };
  if (perfilAtual.perfil !== 'administrador') body.telefone = document.getElementById('perfil-telefone').value.trim(); // administrador: sem telefone pessoal
  if (perfilAtual.temSobrenome) {
    const sobrenome = document.getElementById('perfil-sobrenome').value.trim();
    if (!sobrenome) { toast('Informe seu sobrenome.'); return; }
    body.sobrenome = sobrenome;
  }
  try {
    perfilAtual = await api('/perfil', { method: 'PATCH', body: JSON.stringify(body) });
    sincronizarPerfilNaTela();
    toast('Perfil atualizado.');
  } catch (err) { toast('Erro ao salvar perfil: ' + err.message); }
}

async function solicitarVerificacaoEmail() {
  const email = document.getElementById('perfil-email').value.trim();
  const senhaAtual = document.getElementById('perfil-email-senha').value;
  if (!email) { toast('Informe um e-mail.'); return; }
  if (!senhaAtual) { toast('Digite a sua senha atual para trocar o e-mail (é a garantia de que é você mesmo).'); return; }
  try {
    const resp = await api('/perfil/email/solicitar', { method: 'POST', body: JSON.stringify({ email, senha_atual: senhaAtual }) });
    perfilEmailPendente = email;
    document.getElementById('perfil-email-codebox').style.display = 'block';
    toast(mensagemEnvioEmail(resp.emailEnviado, email, resp.motivoEmail));
  } catch (err) { toast('Erro: ' + err.message); }
}
async function confirmarEmailPerfil() {
  const codigo = document.getElementById('perfil-email-codigo').value.trim();
  if (!codigo || !perfilEmailPendente) { toast('Peça a verificação (botão "Verificar e salvar") antes de confirmar.'); return; }
  try {
    perfilAtual = await api('/perfil/email/confirmar', { method: 'POST', body: JSON.stringify({ email: perfilEmailPendente, codigo, senha_atual: document.getElementById('perfil-email-senha').value }) });
    document.getElementById('perfil-email-codebox').style.display = 'none';
    document.getElementById('perfil-email-senha').value = '';
    perfilEmailPendente = null;
    if (usuarioLogado) usuarioLogado.dados = { ...usuarioLogado.dados, ...perfilAtual };
    toast('E-mail confirmado e atualizado!');
  } catch (err) { toast('Erro ao confirmar: ' + err.message); }
}

async function alterarSenhaPerfil() {
  const atual = document.getElementById('perfil-senha-atual').value;
  const nova = document.getElementById('perfil-senha-nova').value;
  const nova2 = document.getElementById('perfil-senha-nova2').value;
  if (!atual || !nova) { toast('Preencha a senha atual e a nova senha.'); return; }
  if (nova !== nova2) { toast('As senhas novas não coincidem.'); return; }
  try {
    const resp = await api('/perfil/senha', { method: 'PATCH', body: JSON.stringify({ senha_atual: atual, senha_nova: nova }) });
    adotarTokenNovo(resp.token); // as outras sessões (e quem tivesse roubado a antiga) caem; esta continua
    document.getElementById('perfil-senha-atual').value = '';
    document.getElementById('perfil-senha-nova').value = '';
    document.getElementById('perfil-senha-nova2').value = '';
    toast('Senha alterada.');
  } catch (err) { toast('Erro ao alterar senha: ' + err.message); }
}
