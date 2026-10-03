const crypto = require('crypto');
const { pool } = require('../db');
const { enviarEmail, htmlCodigo } = require('./email');

// Código de 6 dígitos de verificação por e-mail — usado no cadastro (admin,
// prestadora, cliente) e na troca de e-mail do perfil. Nunca por WhatsApp (não
// existe API de WhatsApp de verdade). crypto.randomInt, e não Math.random: é
// um segredo de autenticação, não pode ser previsível.
// `destino` é a chave sob a qual o código é guardado/conferido; por padrão é o
// próprio e-mail. `para` separa as duas coisas quando preciso (recuperação de
// senha guarda o código sob uma chave própria, pra um código de cadastro nunca
// servir pra redefinir senha, e vice-versa).
async function enviarCodigoConfirmacao(destino, { assunto, motivo, para }) {
  const codigo = String(crypto.randomInt(100000, 1000000));
  await pool.query(
    `insert into codigos_verificacao (destino, codigo, expira_em) values ($1, $2, now() + interval '15 minutes')`,
    [destino, codigo]
  );
  return enviarEmail({ to: para || destino, subject: assunto, html: htmlCodigo(codigo, motivo) });
}

// Confere o código contra o destino e marca como usado, tudo numa instrução só
// (atômico): dois pedidos simultâneos com o mesmo código não passam os dois.
// `db` pode ser o pool ou o client de uma transação — dentro de uma transação,
// se algo falhar depois, o ROLLBACK devolve o código como não usado.
// Retorna true/false — quem chama decide o que fazer (a rota devolve 400 se false).
async function consumirCodigo(db, destino, codigo) {
  if (!destino || !codigo) return false;
  const { rowCount } = await db.query(
    `update codigos_verificacao set usado = true
     where id = (
       select id from codigos_verificacao
       where destino = $1 and codigo = $2 and usado = false and expira_em > now()
       order by criado_em desc limit 1
       for update skip locked
     )`,
    [destino, codigo]
  );
  return rowCount === 1;
}

const confirmarCodigo = (destino, codigo) => consumirCodigo(pool, destino, codigo);

const MOTIVO_CADASTRO = { assunto: 'Confirme seu cadastro — Portal da Maria', motivo: 'confirmar seu cadastro' };
const MOTIVO_TROCA_EMAIL = { assunto: 'Confirme seu novo e-mail — Portal da Maria', motivo: 'confirmar a troca do seu e-mail' };

const MOTIVO_RECUPERACAO = { assunto: 'Redefinição de senha — Portal da Maria', motivo: 'redefinir a sua senha' };

module.exports = { enviarCodigoConfirmacao, consumirCodigo, confirmarCodigo, MOTIVO_CADASTRO, MOTIVO_TROCA_EMAIL, MOTIVO_RECUPERACAO };
