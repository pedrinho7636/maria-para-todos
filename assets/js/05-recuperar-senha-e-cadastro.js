/* Portal da Maria — Recuperar senha e cadastro
   Recuperação de senha por código e criação de conta (administrador, prestadora e cliente) com confirmação de e-mail. */

/* Recuperar senha: pede um código de 6 dígitos (enviado ao e-mail da conta) e
   troca a senha com ele. A tela nunca diz se a conta existe — a API responde
   igual nos dois casos — e depois de trocar já entra com a senha nova. */
let recPerfil = null, recIdentificador = '', recOcupado = false;
function abrirRecuperar(ev) {
  if (ev) ev.preventDefault();
  const ehPrestadora = perfil === 'prestadora';
  recPerfil = { franqueado: 'administrador', prestadora: 'prestadora', cliente: 'cliente' }[perfil];
  document.getElementById('rec-texto1').textContent = ehPrestadora
    ? 'Informe o telefone (ou o e-mail) da sua conta. Enviamos um código de 6 dígitos para o e-mail cadastrado.'
    : 'Informe o e-mail da sua conta. Enviamos um código de 6 dígitos para ele.';
  document.getElementById('rec-label').textContent = ehPrestadora ? 'Telefone ou e-mail' : 'E-mail';
  document.getElementById('rec-ident').value = document.getElementById('login-user').value.trim();
  ['rec-codigo', 'rec-senha', 'rec-senha2'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('rec-passo1').style.display = 'block';
  document.getElementById('rec-passo2').style.display = 'none';
  document.getElementById('modal-recuperar').classList.add('show');
  document.getElementById('rec-ident').focus();
}
function fecharRecuperar() { document.getElementById('modal-recuperar').classList.remove('show'); }
function recuperarVoltar() {
  document.getElementById('rec-passo1').style.display = 'block';
  document.getElementById('rec-passo2').style.display = 'none';
}
async function recuperarPedirCodigo() {
  const identificador = document.getElementById('rec-ident').value.trim();
  if (!identificador) { toast('Informe seu ' + (recPerfil === 'prestadora' ? 'telefone ou e-mail.' : 'e-mail.')); return false; }
  try {
    await api('/auth/recuperar-senha', { method: 'POST', body: JSON.stringify({ perfil: recPerfil, identificador }) });
  } catch (err) { toast('Não foi possível enviar o código: ' + err.message); return false; }
  recIdentificador = identificador;
  return true;
}
async function recuperarEnviarCodigo() {
  if (recOcupado) return;
  recOcupado = true;
  const botao = document.getElementById('rec-enviar'); botao.disabled = true;
  try {
    if (!await recuperarPedirCodigo()) return;
    document.getElementById('rec-texto2').textContent =
      'Se existir uma conta com esse dado, enviamos um código para o e-mail cadastrado (vale por 15 minutos). Digite-o abaixo e escolha a nova senha.';
    document.getElementById('rec-passo1').style.display = 'none';
    document.getElementById('rec-passo2').style.display = 'block';
    document.getElementById('rec-codigo').focus();
  } finally { recOcupado = false; botao.disabled = false; }
}
async function recuperarReenviar(ev) {
  if (ev) ev.preventDefault();
  if (recOcupado) return;
  recOcupado = true;
  try {
    document.getElementById('rec-ident').value = recIdentificador;
    if (await recuperarPedirCodigo()) toast('Código reenviado. Se existir uma conta, ele chega em instantes.');
  } finally { recOcupado = false; }
}
async function recuperarConfirmar() {
  if (recOcupado) return;
  const codigo = document.getElementById('rec-codigo').value.trim();
  const senha = document.getElementById('rec-senha').value;
  if (!/^\d{6}$/.test(codigo)) { toast('Digite o código de 6 dígitos.'); return; }
  if (senha.length < 8) { toast('A nova senha precisa ter ao menos 8 caracteres.'); return; }
  if (senha !== document.getElementById('rec-senha2').value) { toast('As duas senhas não são iguais.'); return; }
  recOcupado = true;
  const botao = document.getElementById('rec-confirmar'); botao.disabled = true;
  try {
    await api('/auth/recuperar-senha/confirmar', { method: 'POST', body: JSON.stringify({ perfil: recPerfil, identificador: recIdentificador, codigo, senha }) });
  } catch (err) { toast(err.message); return; }
  finally { recOcupado = false; botao.disabled = false; }
  fecharRecuperar();
  document.getElementById('login-user').value = recIdentificador;
  document.getElementById('login-pass').value = '';
  toast('Senha redefinida! Entrando…');
  doLogin(recIdentificador, senha);
}

/* cadastro */
let cadPerfil = 'administrador';
function setCadProfile(p) {
  cadPerfil = p;
  ['administrador', 'prestadora', 'cliente'].forEach(x => {
    document.getElementById('cad-pf-' + x).classList.toggle('active', x === p);
    document.getElementById('cad-fields-' + x).style.display = (x === p ? 'block' : 'none');
  });
}
// Cadastro de admin, prestadora e cliente segue o mesmo padrão de duas
// etapas: nada é criado até o código do e-mail ser confirmado. Não existe
// API de WhatsApp de verdade, então toda verificação de identidade — pros
// 4 tipos de usuário — é sempre por e-mail (nunca por telefone/WhatsApp).
// Cada ctx guarda os dados preenchidos enquanto aguarda a confirmação.
let dadosCadastroPendente = {};
async function enviarCodigo(ctx) {
  let dados, rota;
  if (ctx === 'admin-email') {
    const nome = document.getElementById('cad-admin-nome').value.trim();
    const sobrenome = document.getElementById('cad-admin-sobrenome').value.trim();
    const email = document.getElementById('admin-email').value.trim();
    const cnpjRaw = document.getElementById('cad-admin-cnpj').value.trim();
    const senha = document.getElementById('cad-administrador-senha')?.value || '';
    if (!nome || !sobrenome) { toast('Preencha nome e sobrenome antes de verificar o e-mail.'); return; }
    if (!email) { toast('Preencha o e-mail.'); return; }
    if (!cnpjRaw) { toast('Informe o CNPJ da empresa.'); return; }
    if (!senha) { toast('Defina sua senha (abaixo) antes de verificar o e-mail.'); return; }
    const unNome = document.getElementById('cad-admin-un-nome').value.trim();
    const unUf = document.getElementById('cad-admin-un-uf').value.trim().toUpperCase();
    if (!unNome) { toast('Informe a cidade/nome da unidade que você está cadastrando.'); return; }
    if (unUf.length !== 2) { toast('Informe a UF da unidade (ex.: RS).'); return; }
    dados = {
      nome, sobrenome, email, senha, cnpj: cnpjRaw,
      unidade: {
        nome: unNome, uf: unUf,
        telefone: document.getElementById('cad-admin-tel').value.trim() || undefined,
        endereco: document.getElementById('cad-admin-un-end').value.trim() || undefined,
      },
    };
    rota = '/auth/cadastro/admin';
  } else if (ctx === 'prestadora-email') {
    const nome = document.getElementById('cad-prestadora-nome').value.trim();
    const telefone = document.getElementById('prest-phone').value.trim();
    const email = document.getElementById('prestadora-email').value.trim();
    const slug = document.getElementById('cad-prest-regiao').value;
    const senha = document.getElementById('cad-prestadora-senha')?.value || '';
    if (!nome) { toast('Preencha seu nome.'); return; }
    if (!slug) { toast('Selecione a sua região.'); return; }
    if (!telefone) { toast('Preencha seu telefone.'); return; }
    if (!email) { toast('Preencha o e-mail.'); return; }
    if (!senha) { toast('Defina sua senha (abaixo) antes de verificar o e-mail.'); return; }
    dados = { nome, telefone, email, senha, unidade_slug: slug };
    rota = '/auth/cadastro/prestadora';
  } else if (ctx === 'cliente-email') {
    const nome = document.getElementById('cad-cliente-nome').value.trim();
    const email = document.getElementById('cliente-email').value.trim();
    const telefone = document.getElementById('cad-cliente-telefone').value.trim();
    const slug = document.getElementById('cad-cliente-regiao').value;
    const senha = document.getElementById('cad-cliente-senha')?.value || '';
    if (!nome) { toast('Preencha seu nome.'); return; }
    if (!email) { toast('Preencha o e-mail.'); return; }
    if (!slug) { toast('Selecione sua cidade.'); return; }
    if (!senha) { toast('Defina sua senha (abaixo) antes de verificar o e-mail.'); return; }
    dados = { nome, email, telefone, unidade_slug: slug, senha };
    rota = '/auth/cadastro/cliente';
  } else {
    return;
  }
  try {
    const resp = await api(rota, { method: 'POST', body: JSON.stringify(dados) });
    // CNPJ que já tinha conta + nome/e-mail/senha do dono: a unidade nova já foi acrescentada à
    // empresa e a resposta traz o login — não há código a confirmar.
    if (resp.token && ctx === 'admin-email') { await concluirCadastroAdmin(ctx, dados, resp); return; }
    dadosCadastroPendente[ctx] = dados;
    document.getElementById(ctx + '-codebox').style.display = 'block';
    document.getElementById(ctx + '-verifybtn').textContent = 'Reenviar';
    toast(mensagemEnvioEmail(resp.emailEnviado, dados.email, resp.motivoEmail));
  } catch (err) { toast('Erro ao verificar e-mail: ' + err.message); }
}
// Fecha um cadastro de administrador: limpa o formulário, atualiza as unidades conhecidas (a nova
// já aparece no seletor) e entra na conta. Serve pro caminho com código e pro "empresa existente".
async function concluirCadastroAdmin(ctx, dados, resp) {
  document.querySelectorAll('#cad-fields-administrador input, #cad-fields-administrador select').forEach(el => { el.value = ''; });
  document.getElementById(ctx + '-codebox').style.display = 'none';
  document.getElementById(ctx + '-ok').style.display = 'none';
  document.getElementById(ctx + '-verifybtn').textContent = 'Verificar';
  delete dadosCadastroPendente[ctx];
  toast(resp.empresaExistente ? `Unidade ${resp.unidadeCriada?.nome || ''} acrescentada à sua empresa! Entrando…` : 'Conta e unidade criadas! Entrando…');
  await carregarDadosPublicos(); // a unidade nova passa a existir no seletor/listas
  setProfile('franqueado');
  document.getElementById('login-user').value = dados.email;
  document.getElementById('login-pass').value = '';
  show('screen-login');
  await doLogin(dados.email, dados.senha);
}
async function confirmarCodigo(ctx) {
  const rotas = {
    'admin-email': '/auth/cadastro/admin/confirmar',
    'prestadora-email': '/auth/cadastro/prestadora/confirmar',
    'cliente-email': '/auth/cadastro/cliente/confirmar',
  };
  const rota = rotas[ctx];
  if (!rota) return;
  const codigo = (document.getElementById(ctx + '-codeinput').value || '').trim();
  const dados = dadosCadastroPendente[ctx];
  if (!codigo || !dados) { toast('Peça um código (botão "Verificar") antes de confirmar.'); return; }
  let respConfirmar;
  try {
    respConfirmar = await api(rota, { method: 'POST', body: JSON.stringify({ ...dados, codigo }) });
  } catch (err) { toast('Erro ao confirmar código: ' + err.message); return; }
  if (ctx === 'admin-email') { await concluirCadastroAdmin(ctx, dados, respConfirmar); return; }

  // Conta criada: limpa o formulário (a senha não fica na tela) e já ENTRA nela —
  // sem mandar a pessoa digitar login e senha de novo.
  const entrada = { 'admin-email': ['franqueado', dados.email], 'prestadora-email': ['prestadora', dados.telefone], 'cliente-email': ['cliente', dados.email] }[ctx];
  document.querySelectorAll('#cad-fields-' + cadPerfil + ' input, #cad-fields-' + cadPerfil + ' select').forEach(el => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
  document.getElementById(ctx + '-codebox').style.display = 'none';
  document.getElementById(ctx + '-ok').style.display = 'none';
  document.getElementById(ctx + '-verifybtn').textContent = 'Verificar';
  delete dadosCadastroPendente[ctx];

  toast('Conta criada! Entrando…');
  setProfile(entrada[0]);
  document.getElementById('login-user').value = entrada[1]; // se a entrada automática falhar, o login já vem preenchido
  document.getElementById('login-pass').value = '';
  show('screen-login');
  await doLogin(entrada[1], dados.senha);
}
async function doCadastro() {
  // A conta só é criada de fato no fluxo de verificação de e-mail acima
  // (botões "Verificar"/"Confirmar") — sem API de WhatsApp de verdade,
  // e-mail é o único jeito de confirmar que a pessoa é dona daquele
  // contato antes de existir conta, pros 4 tipos de usuário.
  const ctx = { administrador: 'admin-email', prestadora: 'prestadora-email', cliente: 'cliente-email' }[cadPerfil];
  const jaVerificado = document.getElementById(ctx + '-ok').style.display === 'flex';
  if (jaVerificado) { show('screen-login'); toast('Conta já criada — faça login para continuar.'); return; }
  toast('Confirme seu e-mail (botão "Verificar" acima) antes de criar a conta.');
}
