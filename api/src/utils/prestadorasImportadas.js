const bcrypt = require('bcrypt');
const { normalizarTexto } = require('./importarPlanilha');

// A planilha de atendimentos traz só o NOME da profissional (sem e-mail, sem telefone).
// Pra elas já entrarem no sistema — com atendimentos ligados e acesso ao portal — a conta
// é criada automaticamente: e-mail = nome sem espaços/acentos @gmail.com e senha padrão.
// É uma credencial provisória de propósito: a prestadora (ou o admin) troca no "Meu perfil".
const SENHA_PADRAO = 'senha123';
const SALT_ROUNDS = 10;

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

// "ELISIANE DE FATIMA DE SOUZA" -> "Elisiane de Fatima de Souza". Nome que já vem com
// minúsculas ("Jaqueline Inajara Shultz") é mantido como está; siglas com ponto ("A.M.") também.
function nomeBonito(nome) {
  const limpo = String(nome ?? '').trim().replace(/\s+/g, ' ');
  if (/[a-zà-ÿ]/.test(limpo)) return limpo;
  return limpo.toLowerCase().split(' ').map((p, i) => {
    if (p.includes('.')) return p.toUpperCase();
    if (i > 0 && PARTICULAS.has(p)) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

// "Elisiane de Fátima de Souza" -> "elisianedefatimadesouza@gmail.com"
function emailBase(nome) {
  const local = normalizarTexto(nome).replace(/[^a-z0-9]/g, '').slice(0, 60);
  return local || 'prestadora';
}

// Garante que cada nome tenha uma prestadora na unidade: reaproveita a que já existe
// (mesmo nome, sem diferenciar acento/maiúscula) e cria as que faltam. `db` pode ser o pool
// ou o client de uma transação (a criação entra na mesma transação da importação).
// Devolve { ids: Map(nomeNormalizado -> id), criadas: [{ id, nome, email }] }.
async function garantirPrestadoras(db, unidadeId, nomes) {
  const { rows } = await db.query('select id, nome, email, unidade_id from prestadoras');
  const ids = new Map();
  const emailsEmUso = new Set();
  for (const r of rows) {
    if (r.email) emailsEmUso.add(r.email.toLowerCase());
    if (r.unidade_id === unidadeId) ids.set(normalizarTexto(r.nome), r.id);
  }

  const criadas = [];
  let senhaHash = null;
  for (const bruto of nomes) {
    const chave = normalizarTexto(bruto);
    if (!chave || ids.has(chave)) continue;

    // e-mail repetido (duas "Maria Silva") ganha um número — o login por e-mail precisa ser inequívoco
    const base = emailBase(bruto);
    let email = `${base}@gmail.com`;
    for (let n = 2; emailsEmUso.has(email); n++) email = `${base}${n}@gmail.com`;
    emailsEmUso.add(email);

    senhaHash = senhaHash || await bcrypt.hash(SENHA_PADRAO, SALT_ROUNDS);
    const nome = nomeBonito(bruto);
    const { rows: [nova] } = await db.query(
      `insert into prestadoras (nome, telefone, email, senha_hash, unidade_id)
       values ($1, null, $2, $3, $4) returning id`,
      [nome, email, senhaHash, unidadeId]
    );
    ids.set(chave, nova.id);
    criadas.push({ id: nova.id, nome, email });
  }
  return { ids, criadas };
}

module.exports = { garantirPrestadoras, nomeBonito, emailBase, SENHA_PADRAO };
