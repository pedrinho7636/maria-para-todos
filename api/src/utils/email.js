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

function smtpConfigurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function resendConfigurado() {
  return !!process.env.RESEND_API_KEY;
}
function configurado() {
  return smtpConfigurado() || resendConfigurado();
}

let transporteSmtp = null;
function transporte() {
  if (!transporteSmtp) {
    const porta = Number(process.env.SMTP_PORT || 587);
    transporteSmtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: porta,
      secure: porta === 465, // 465 = TLS direto; 587 = STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
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
  const from = process.env.SMTP_FROM || `Portal da Maria <${process.env.SMTP_USER}>`;
  await transporte().sendMail({ from, to, subject, html, text: textoSimples(html) });
}

async function enviarPorResend({ to, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || REMETENTE_RESEND_PADRAO, to, subject, html }),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    const erro = new Error(`Resend recusou o envio (${resp.status}): ${corpo}`);
    erro.recusado = true;
    throw erro;
  }
}

async function enviarEmail({ to, subject, html }) {
  const via = smtpConfigurado() ? 'smtp' : resendConfigurado() ? 'resend' : null;
  if (!via) {
    logSimulado(to, subject, html, 'nenhum provedor configurado');
    return { enviado: false, motivo: 'nao-configurado' };
  }

  try {
    if (via === 'smtp') await enviarPorSmtp({ to, subject, html });
    else await enviarPorResend({ to, subject, html });
    return { enviado: true, via };
  } catch (erro) {
    console.error(`[email] falha ao enviar pra ${to} via ${via}:`, erro.message);
    logSimulado(to, subject, html, `falha no envio via ${via}`);
    return { enviado: false, via, motivo: classificarErro(erro) };
  }
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

module.exports = { enviarEmail, classificarErro, configurado, smtpConfigurado, resendConfigurado, htmlCodigo };
