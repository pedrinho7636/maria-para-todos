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

// CNPJ de verdade: 14 dígitos, não todos iguais, com os dois dígitos verificadores corretos
// (módulo 11). Só é exigido pra CNPJ NOVO — o que já está cadastrado numa unidade é casado
// como está (os de exemplo do schema não passariam, e não precisam).
function cnpjValido(cnpj) {
  const d = normalizarCnpj(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (base) => {
    let soma = 0, peso = base.length - 7;
    for (const n of base) { soma += Number(n) * peso--; if (peso < 2) peso = 9; }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(d.slice(0, 12)) === Number(d[12]) && digito(d.slice(0, 13)) === Number(d[13]);
}

// "11222333000181" -> "11.222.333/0001-81" (como as unidades guardam o CNPJ)
function formatarCnpj(cnpj) {
  const d = normalizarCnpj(cnpj);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}

// "São José do Ouro" -> "sao-jose-do-ouro" (endereço/identificador curto da unidade)
function slugificar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const ufValida = (uf) => UFS.includes(String(uf ?? '').trim().toUpperCase());

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

// Nome de cidade/unidade: cada palavra começa com maiúscula ("passo fundo" -> "Passo Fundo"); ligações como
// de/da/do/dos/das/e ficam minúsculas no meio ("Santa Maria da Boa Vista"). O resto de cada palavra é mantido como
// foi digitado ("São Paulo", "SC", "D'Oeste" não são estragados).
const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
function capitalizarNome(nome) {
  return String(nome ?? '').trim().replace(/\s+/g, ' ').split(' ').map((p, i) => {
    if (i > 0 && LIGACOES.has(p.toLowerCase())) return p.toLowerCase();
    return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1);
  }).join(' ');
}

module.exports = { capitalizarNome, normalizarEmail, normalizarTelefone, normalizarCnpj, cnpjValido, formatarCnpj, slugificar, ufValida, UFS, emailInstitucionalValido, DOMINIO_INSTITUCIONAL };
