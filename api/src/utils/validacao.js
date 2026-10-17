// Validação mínima de cadastro/edição — sem isso, qualquer string (inclusive
// senha de 1 caractere, nome em branco ou "email" sem @) era aceita e virava
// registro normalmente.
function senhaValida(s) {
  return typeof s === 'string' && s.length >= 8;
}

// Um e-mail só. Sem espaço e sem , ; < > ( ) [ ] " \ — vírgula e ponto e vírgula fariam o provedor de e-mail tratar o texto
// como VÁRIOS destinatários ("eu@x.com,vitima@y.com" mandaria o código pros dois: dava pra usar o cadastro pra mandar
// e-mail a qualquer pessoa), e os demais são caracteres de HTML/cabeçalho que nunca fazem parte de um endereço real.
// 254 é o tamanho máximo de um endereço.
const EMAIL = /^[^\s@,;<>()[\]"\\]+@[^\s@,;<>()[\]"\\]+\.[^\s@,;<>()[\]"\\]+$/;
function emailValido(e) {
  return typeof e === 'string' && e.length <= 254 && EMAIL.test(e);
}

function nomeValido(n) {
  return typeof n === 'string' && n.trim().length >= 2 && n.trim().length <= 120;
}

// Recebe o telefone JÁ normalizado (só dígitos): DDD + número, 10 ou 11 dígitos.
function telefoneValido(digitos) {
  return /^\d{10,11}$/.test(digitos);
}

module.exports = { senhaValida, emailValido, nomeValido, telefoneValido };
