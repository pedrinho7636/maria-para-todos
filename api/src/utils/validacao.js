// Validação mínima de cadastro/edição — sem isso, qualquer string (inclusive
// senha de 1 caractere, nome em branco ou "email" sem @) era aceita e virava
// registro normalmente.
function senhaValida(s) {
  return typeof s === 'string' && s.length >= 8;
}

function emailValido(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function nomeValido(n) {
  return typeof n === 'string' && n.trim().length >= 2 && n.trim().length <= 120;
}

// Recebe o telefone JÁ normalizado (só dígitos): DDD + número, 10 ou 11 dígitos.
function telefoneValido(digitos) {
  return /^\d{10,11}$/.test(digitos);
}

module.exports = { senhaValida, emailValido, nomeValido, telefoneValido };
