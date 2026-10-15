const bcrypt = require('bcrypt');
const { normalizarTexto } = require('./importarPlanilha');
const { normalizarTelefone } = require('./normalizacao');
const { telefoneValido } = require('./validacao');

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

// Garante que cada profissional tenha uma prestadora na unidade: reaproveita a que já existe
// (mesmo nome, sem diferenciar acento/maiúscula) e cria as que faltam. `db` pode ser o pool
// ou o client de uma transação (a criação entra na mesma transação da importação).
// Cada item de `entradas` é o nome (texto) ou { nome, telefone } — o telefone vem da planilha ("Nome | Telefone" ou coluna de
// contato) e é APROVEITADO: vai no cadastro da prestadora nova e preenche o telefone de quem já existia sem ele. Telefone
// inválido, ou que já é de OUTRA conta (é único no sistema), é ignorado — nunca tira o número de ninguém.
// Devolve { ids: Map(nomeNormalizado -> id), criadas: [{ id, nome, email, telefone }], telefonesPreenchidos: n }.
async function garantirPrestadoras(db, unidadeId, entradas) {
  const { rows } = await db.query('select id, nome, email, unidade_id, telefone from prestadoras');
  const ids = new Map(), semTelefone = new Set();
  const emailsEmUso = new Set(), telefonesEmUso = new Set();
  for (const r of rows) {
    if (r.email) emailsEmUso.add(r.email.toLowerCase());
    if (r.telefone) telefonesEmUso.add(normalizarTelefone(r.telefone));
    if (r.unidade_id === unidadeId) {
      ids.set(normalizarTexto(r.nome), r.id);
      if (!r.telefone) semTelefone.add(r.id);
    }
  }
  // um telefone utilizável: válido e ainda de ninguém (e marca como usado, pra duas profissionais não dividirem o mesmo)
  const reservarTelefone = (bruto) => {
    const tel = normalizarTelefone(bruto);
    if (!tel || !telefoneValido(tel) || telefonesEmUso.has(tel)) return null;
    telefonesEmUso.add(tel);
    return tel;
  };

  const criadas = [];
  let telefonesPreenchidos = 0;
  let senhaHash = null;
  for (const entrada of entradas) {
    const bruto = typeof entrada === 'string' ? entrada : entrada.nome;
    const telefoneBruto = typeof entrada === 'string' ? null : entrada.telefone;
    const chave = normalizarTexto(bruto);
    if (!chave) continue;

    if (ids.has(chave)) { // já existe: só completa o telefone, se ela não tinha
      const idExistente = ids.get(chave);
      if (telefoneBruto && semTelefone.has(idExistente)) {
        const tel = reservarTelefone(telefoneBruto);
        if (tel) {
          await db.query('update prestadoras set telefone = $1, atualizado_em = now() where id = $2', [tel, idExistente]);
          semTelefone.delete(idExistente);
          telefonesPreenchidos++;
        }
      }
      continue;
    }

    // e-mail repetido (duas "Maria Silva") ganha um número — o login por e-mail precisa ser inequívoco
    const base = emailBase(bruto);
    let email = `${base}@gmail.com`;
    for (let n = 2; emailsEmUso.has(email); n++) email = `${base}${n}@gmail.com`;
    emailsEmUso.add(email);

    senhaHash = senhaHash || await bcrypt.hash(SENHA_PADRAO, SALT_ROUNDS);
    const nome = nomeBonito(bruto);
    const telefone = telefoneBruto ? reservarTelefone(telefoneBruto) : null;
    const { rows: [nova] } = await db.query(
      `insert into prestadoras (nome, telefone, email, senha_hash, unidade_id, primeiro_acesso_pendente)
       values ($1, $2, $3, $4, $5, true) returning id`,
      [nome, telefone, email, senhaHash, unidadeId]
    );
    ids.set(chave, nova.id);
    if (telefone) telefonesPreenchidos++;
    criadas.push({ id: nova.id, nome, email, telefone });
  }
  return { ids, criadas, telefonesPreenchidos };
}

module.exports = { garantirPrestadoras, nomeBonito, emailBase, SENHA_PADRAO };
