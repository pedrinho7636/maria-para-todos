// Envio de e-mail. Ordem de preferência:
//   1. SMTP (SMTP_HOST/SMTP_USER/SMTP_PASS) — ex.: Gmail com "senha de app".
//      Entrega pra QUALQUER destinatário, sem verificar domínio.
//   2. Resend (RESEND_API_KEY) — a conta de teste só entrega pro e-mail dono da
//      conta; pra qualquer outro é preciso verificar um domínio na Resend.
//   3. Modo simulado: imprime o conteúdo (inclusive o código) no console da API.
// Nunca trava cadastro/perfil por falha de e-mail — o código já foi gravado no
// banco antes daqui. O retorno diz se o e-mail saiu de verdade, pra tela poder
// avisar com precisão em vez de prometer um envio que não aconteceu.
const nodemailer = require('nodemailer');

const REMETENTE_RESEND_PADRAO = 'Portal da Maria <onboarding@resend.dev>';

// Valores colados num painel (Render, .env) chegam com sujeira que o Gmail recusa como "senha
// errada": aspas em volta, espaço ou quebra de linha no fim, e a senha de app do Gmail aparece na
// tela em 4 blocos separados por espaço ("abcd efgh ijkl mnop") — a senha de verdade tem 16 letras
// seguidas. Limpa tudo isso aqui, em um lugar só.
const semAspas = (v) => String(v ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
const smtpHost = () => semAspas(process.env.SMTP_HOST);
const smtpUser = () => semAspas(process.env.SMTP_USER);
const smtpPass = () => semAspas(process.env.SMTP_PASS).replace(/\s+/g, '');
const resendKey = () => semAspas(process.env.RESEND_API_KEY);

function smtpConfigurado() {
  return !!(smtpHost() && smtpUser() && smtpPass());
}
function resendConfigurado() {
  return !!resendKey();
}
function configurado() {
  return smtpConfigurado() || resendConfigurado();
}

// "rotherpedro00@gmail.com" -> "ro***@gmail.com" (pro log dizer QUAL conta sem expô-la inteira)
function mascarar(email) {
  const [local, dominio] = String(email).split('@');
  return dominio ? `${local.slice(0, 2)}***@${dominio}` : '***';
}

// Resumo (sem segredos) do que está configurado — vai pro log ao subir a API, pra quem opera o
// site conferir se o Render recebeu o que se esperava: qual provedor vale, qual conta envia e
// quantos caracteres tem a senha (a senha de app do Gmail tem exatamente 16).
function descreverConfiguracao() {
  const linhas = [];
  if (smtpConfigurado()) {
    const tamanho = smtpPass().length;
    linhas.push(`SMTP ${smtpHost()}:${process.env.SMTP_PORT || 587} · conta ${mascarar(smtpUser())} · senha com ${tamanho} caracteres`);
    if (/gmail/i.test(smtpHost()) && tamanho !== 16) linhas.push(`  ⚠ a senha de app do Gmail tem 16 caracteres; esta tem ${tamanho} — provavelmente NÃO é a senha de app (gere outra em myaccount.google.com/apppasswords).`);
    if (String(process.env.SMTP_PASS ?? '') !== smtpPass()) linhas.push('  (a senha chegou com espaços/aspas e foi limpa automaticamente)');
  } else {
    linhas.push('SMTP não configurado');
  }
  linhas.push(resendConfigurado() ? 'Resend configurado' + (smtpConfigurado() ? ' (usado se o SMTP falhar)' : '') : 'Resend não configurado');
  if (!configurado()) linhas.push('  ⚠ nenhum provedor de e-mail: os códigos só aparecem aqui no log.');
  return linhas;
}

let transporteSmtp = null;
function transporte() {
  if (!transporteSmtp) {
    const porta = Number(process.env.SMTP_PORT || 587);
    transporteSmtp = nodemailer.createTransport({
      host: smtpHost(),
      port: porta,
      secure: porta === 465, // 465 = TLS direto; 587 = STARTTLS
      auth: { user: smtpUser(), pass: smtpPass() },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporteSmtp;
}

function textoSimples(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Fallback de desenvolvimento: imprime o conteúdo no console da API pra quem
// estiver rodando o servidor conseguir seguir o fluxo.
function logSimulado(to, subject, html, motivo) {
  console.log(`[email:simulado — ${motivo}] para ${to} — assunto "${subject}"\n${textoSimples(html)}`);
}

async function enviarPorSmtp({ to, subject, html }) {
  // O Gmail só aceita remetente igual à conta autenticada (ou alias dela) —
  // por isso o EMAIL_FROM da Resend não vale aqui.
  const from = semAspas(process.env.SMTP_FROM) || `Portal da Maria <${smtpUser()}>`;
  await transporte().sendMail({ from, to, subject, html, text: textoSimples(html) });
}

async function enviarPorResend({ to, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: semAspas(process.env.EMAIL_FROM) || REMETENTE_RESEND_PADRAO, to, subject, html }),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    const erro = new Error(`Resend recusou o envio (${resp.status}): ${corpo}`);
    erro.recusado = true;
    throw erro;
  }
}

// Tenta os provedores configurados em ordem (SMTP, depois Resend): se o SMTP falhar mas a Resend
// estiver configurada, ela ainda tenta — o e-mail só é dado como "não saiu" quando TODOS falham, e
// aí o motivo devolvido é o do primeiro (o principal), que é o que a pessoa precisa consertar.
async function enviarEmail({ to, subject, html }) {
  const provedores = [];
  if (smtpConfigurado()) provedores.push(['smtp', enviarPorSmtp]);
  if (resendConfigurado()) provedores.push(['resend', enviarPorResend]);
  if (provedores.length === 0) {
    logSimulado(to, subject, html, 'nenhum provedor configurado');
    return { enviado: false, motivo: 'nao-configurado' };
  }

  let primeiroErro = null, primeiraVia = null;
  for (const [via, enviar] of provedores) {
    try {
      await enviar({ to, subject, html });
      if (primeiroErro) console.log(`[email] ${primeiraVia} falhou, mas o envio por ${via} funcionou.`);
      return { enviado: true, via };
    } catch (erro) {
      console.error(`[email] falha ao enviar pra ${to} via ${via}:`, erro.message);
      if (!primeiroErro) { primeiroErro = erro; primeiraVia = via; }
    }
  }
  logSimulado(to, subject, html, `falha no envio via ${primeiraVia}`);
  return { enviado: false, via: primeiraVia, motivo: classificarErro(primeiroErro) };
}
// Diz à tela (sem vazar nenhum segredo) QUAL foi o tipo de falha, pra quem opera o site
// saber o que consertar sem precisar abrir os logs: senha recusada é um problema, porta
// bloqueada ou servidor inalcançável é outro, bem diferente.
function classificarErro(erro) {
  if (erro.recusado) return 'recusado-pelo-provedor';
  if (erro.code === 'EAUTH' || [534, 535].includes(erro.responseCode)) return 'smtp-autenticacao';
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EDNS'].includes(erro.code)) return 'smtp-conexao';
  return 'erro-de-envio';
}

function htmlCodigo(codigo, motivo) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="color:#1f6f4a;margin:0 0 12px">Portal da Maria</h2>
    <p style="color:#333">Use o código abaixo para ${motivo}:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f0f5f2;padding:18px;text-align:center;border-radius:8px;color:#1f6f4a">${codigo}</p>
    <p style="color:#888;font-size:13px">Expira em 15 minutos. Se não foi você quem pediu, ignore este e-mail.</p>
  </div>`;
}

module.exports = { enviarEmail, classificarErro, descreverConfiguracao, configurado, smtpConfigurado, resendConfigurado, htmlCodigo };
