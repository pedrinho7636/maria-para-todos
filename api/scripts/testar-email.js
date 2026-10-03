// Uso: npm run email:teste -- destino@exemplo.com
// Manda um e-mail de teste pelo provedor configurado no .env e mostra o resultado,
// pra validar usuário/senha do SMTP (ou a chave da Resend) sem passar pela tela.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { enviarEmail, htmlCodigo, smtpConfigurado, resendConfigurado } = require('../src/utils/email');

const destino = process.argv[2];
if (!destino) {
  console.error('Informe o destinatário: npm run email:teste -- voce@exemplo.com');
  process.exit(1);
}

const provedor = smtpConfigurado() ? 'SMTP' : resendConfigurado() ? 'Resend' : 'nenhum (modo simulado)';
console.log(`Provedor em uso: ${provedor}`);

enviarEmail({ to: destino, subject: 'Teste de e-mail — Portal da Maria', html: htmlCodigo('123456', 'testar o envio de e-mail') })
  .then(r => {
    console.log(r.enviado ? `OK: e-mail enviado pra ${destino} (via ${r.via}).` : `NÃO enviado (${r.motivo}). Veja a mensagem de erro acima.`);
    process.exit(r.enviado ? 0 : 2);
  });
