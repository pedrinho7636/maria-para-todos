// Normaliza e-mail/telefone antes de gravar ou comparar contra o banco — sem
// isso, "Nome@Site.com" e "nome@site.com" (ou duas formatações do mesmo
// telefone, ex. "(54) 9 9000-0001" vs "54990000001") viram registros
// "diferentes" para a constraint `unique`, e o login por telefone falha se a
// pessoa digitar de um jeito ligeiramente diferente do cadastro.
function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Só dígitos, sem o código do país: "+55 54 99640-6725", "5554996406725" e
// "(54) 9 9640-6725" viram todos "54996406725". Sem isso, quem se cadastrou
// digitando o +55 não conseguia entrar depois digitando sem (e vice-versa).
// Só tira o "55" quando sobra um número brasileiro completo (12–13 dígitos), pra
// não confundir com o DDD 55 de Panambi ("55 9680-6226" tem 10 dígitos e fica).
function normalizarTelefone(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  return (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55') ? digitos.slice(2) : digitos;
}

// CNPJ só pelos dígitos ("12.345.678/0001-90" e "12345678000190" são o mesmo).
function normalizarCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

// E-mail institucional exigido de administrador/sub-administrador: domínio
// fixo da franquia + prefixo com o nome (slug) da unidade que a pessoa
// administra — evita que qualquer e-mail pessoal seja usado pra uma conta
// que representa oficialmente uma unidade da rede.
const DOMINIO_INSTITUCIONAL = 'mariabrasileira.com.br';

function emailInstitucionalValido(email, slugsPermitidos) {
  const e = normalizarEmail(email);
  if (!e.endsWith('@' + DOMINIO_INSTITUCIONAL)) return false;
  const local = e.split('@')[0];
  return (slugsPermitidos || []).some(slug => local.startsWith(String(slug).toLowerCase()));
}

module.exports = { normalizarEmail, normalizarTelefone, normalizarCnpj, emailInstitucionalValido, DOMINIO_INSTITUCIONAL };
