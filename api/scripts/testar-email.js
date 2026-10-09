// Uso: npm run email:teste -- destino@exemplo.com
// Manda um e-mail de teste pelo provedor configurado no .env (ou nas variáveis de ambiente do Render —
// dá pra rodar no "Shell" do serviço) e mostra o resultado, pra validar usuário/senha do SMTP (ou a
// chave da Resend) sem passar pela tela. Mostra também o que a API enxergou da configuração (sem segredos).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { enviarEmail, htmlCodigo, descreverConfiguracao } = require('../src/utils/email');

const destino = process.argv[2];
if (!destino) {
  console.error('Informe o destinatário: npm run email:teste -- voce@exemplo.com');
  process.exit(1);
}

console.log('Configuração de e-mail vista pela API:');
descreverConfiguracao().forEach(l => console.log('  ' + l));
console.log('');

const DICAS = {
  'smtp-autenticacao': 'O servidor de e-mail RECUSOU o usuário/senha. No Gmail: SMTP_USER = a conta que gerou a senha de app, SMTP_PASS = a senha de app de 16 letras (não a senha normal), em https://myaccount.google.com/apppasswords (precisa da verificação em duas etapas ligada).',
  'smtp-conexao': 'Não houve conexão com o servidor de e-mail: a porta pode estar bloqueada pela hospedagem (o Render grátis bloqueia SMTP) ou o SMTP_HOST/SMTP_PORT está errado.',
  'recusado-pelo-provedor': 'O provedor recusou: na Resend sem domínio verificado só vale o e-mail dono da conta.',
};

enviarEmail({ to: destino, subject: 'Teste de e-mail — Portal da Maria', html: htmlCodigo('123456', 'testar o envio de e-mail') })
  .then(r => {
    if (r.enviado) console.log(`OK: e-mail enviado pra ${destino} (via ${r.via}).`);
    else console.log(`NÃO enviado (${r.motivo}). Veja a mensagem de erro acima.${DICAS[r.motivo] ? '\n' + DICAS[r.motivo] : ''}`);
    process.exit(r.enviado ? 0 : 2);
  });
