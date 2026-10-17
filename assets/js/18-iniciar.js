/* Portal da Maria — Início do app
   Aviso (toast), tema claro/escuro, atalhos de teclado e a partida: carrega as unidades e reabre a sessão guardada. Precisa ser o ÚLTIMO script. */

let toastTimer;
function toast(msg) { const t = document.getElementById('toast'); document.getElementById('toast-msg').textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600); }

/* modo escuro */
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('pm-theme', t); } catch (e) { } }
function toggleTheme() { const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; applyTheme(cur); }
(function () { let t = 'light'; try { t = localStorage.getItem('pm-theme') || 'light'; } catch (e) { } applyTheme(t); })();
document.getElementById('region-modal').addEventListener('click', e => { if (e.target.id === 'region-modal') e.currentTarget.classList.remove('show'); });
// Perfil, atendimento recorrente e o balão de reatribuir da agenda NÃO fecham
// mais ao clicar fora (perdia o que estava preenchido): fecham pelo botão
// (× / Fechar / Cancelar) ou pelo ESC. O seletor de cidade, que é só uma
// escolha rápida, continua fechando ao clicar fora.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // fecha um de cada vez, o que estiver "por cima" primeiro
  if (document.getElementById('modal-painel').classList.contains('show')) fecharPersonalizarPainel();
  else if (document.getElementById('modal-nova-prestadora').classList.contains('show')) fecharNovaPrestadora();
  else if (document.getElementById('modal-recuperar').classList.contains('show')) fecharRecuperar();
  else if (document.getElementById('modal-tarifa').classList.contains('show')) fecharTarifa();
  else if (document.getElementById('modal-meta-faltas').classList.contains('show')) fecharMetaFaltas();
  else if (document.getElementById('modal-substituir').classList.contains('show')) fecharSubstituir();
  else if (document.getElementById('modal-contato').classList.contains('show')) fecharContatoPrestadora();
  else if (document.getElementById('modal-primeiro-acesso').classList.contains('show')) return; // não dá pra pular o primeiro acesso
  else if (document.getElementById('modal-perfil').classList.contains('show')) fecharPerfil();
  else if (document.getElementById('modal-atendimento').classList.contains('show')) fecharModalAtendimento();
  else if (document.getElementById('reatribuir-pop')) fecharReatribuirPop();
  else document.getElementById('region-modal').classList.remove('show');
});

// Enter no login entra, igual a clicar em "Entrar".
['login-user', 'login-pass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
  });
});

// Enter nos modais de recuperar senha e de valor por atendimento também confirma.
[['rec-ident', recuperarEnviarCodigo], ['rec-codigo', recuperarConfirmar], ['rec-senha', recuperarConfirmar], ['rec-senha2', recuperarConfirmar], ['tarifa-valor', salvarTarifa], ['meta-valor', salvarMetaFaltas], ['contato-tel', salvarContatoPrestadora], ['pa-codigo', primeiroAcessoConcluir], ['pa-senha2', primeiroAcessoEnviarCodigo]].forEach(([id, acao]) => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); acao(); }
  });
});

// Link de convite enviado ao cliente (WhatsApp): ?cadastro=cliente&unidade=... abre direto o cadastro de cliente.
{
  const p = new URLSearchParams(location.search);
  if (p.get('cadastro') === 'cliente') { cadastroUnidadeConvite = p.get('unidade') || ''; setCadProfile('cliente'); show('screen-cadastro'); }
}
// Link enviado à prestadora (WhatsApp): ?perfil=prestadora abre direto o login dela.
if (new URLSearchParams(location.search).get('perfil') === 'prestadora') {
  setProfile('prestadora');
  show('screen-login');
}

montarSeletoresHora();
ligarFormatacaoDeCampos();
// carrega unidades (dado público) já na home e, se havia sessão guardada, reabre ela (as unidades precisam estar carregadas)
carregarDadosPublicos().then(restaurarSessao);
