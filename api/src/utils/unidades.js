// Cadastro de unidades (franquias) e a regra de "empresa": todas as unidades de uma mesma conta de
// administrador têm o MESMO CNPJ — é isso que permite alternar entre elas no painel. Outro CNPJ,
// outra empresa: conta nova.
const { normalizarTelefone, formatarCnpj, slugificar, ufValida, capitalizarNome } = require('./normalizacao');
const { telefoneValido } = require('./validacao');
const { normalizarTexto } = require('./importarPlanilha');

const { pool } = require('../db');

// Roda `fn` numa transação (tudo ou nada) com uma conexão só.
async function emTransacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

// Erro "esperado" de regra de negócio (vira resposta 4xx, não 500).
class ErroNegocio extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

// Lê e valida os dados de uma unidade vindos de um formulário.
// Devolve { dados } ou { erro }.
function lerDadosUnidade(corpo) {
  const nome = capitalizarNome(corpo?.nome); // "passo fundo" vira "Passo Fundo"
  const uf =String(corpo?.uf ?? '').trim().toUpperCase();
  const telefone = String(corpo?.telefone ?? '').trim();
  const endereco = String(corpo?.endereco ?? '').trim();
  const enderecoCurto = String(corpo?.endereco_curto ?? '').trim();
  if (nome.length < 2 || nome.length > 80) return { erro: 'Informe o nome (cidade) da unidade.' };
  if (!ufValida(uf)) return { erro: 'Informe a UF da unidade (ex.: RS).' };
  if (telefone && !telefoneValido(normalizarTelefone(telefone))) return { erro: 'Telefone da unidade inválido — informe DDD + número.' };
  if (endereco.length > 300 || enderecoCurto.length > 150) return { erro: 'Endereço muito longo (máximo 300 caracteres; resumido, 150).' };
  return { dados: { nome, uf, telefone: telefone || null, endereco: endereco || null, endereco_curto: endereco ? (enderecoCurto || null) : null } };
}

// Identificador curto e único da unidade: "Passo Fundo" -> "passo-fundo" (e "passo-fundo-2" se já existir).
async function slugLivre(db, nome) {
  const base = slugificar(nome) || 'unidade';
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    const { rows } = await db.query('select 1 from unidades where slug = $1', [slug]);
    if (rows.length === 0) return slug;
  }
  throw new ErroNegocio(409, 'Não foi possível gerar um identificador para a unidade. Tente outro nome.');
}

// Cria a unidade com o CNPJ (só dígitos) da empresa, recusando nome repetido DENTRO da mesma empresa.
async function criarUnidade(db, dadosBrutos, cnpjDigitos) {
  const dados = { ...dadosBrutos, nome: capitalizarNome(dadosBrutos.nome) }; // vale também pra quem chega por script (admin:criar)
  // Trava por empresa até o fim da transação: dois pedidos simultâneos (duplo clique, duas abas) não
  // passam os dois pela checagem de nome repetido e criam a mesma unidade duas vezes.
  await db.query('select pg_advisory_xact_lock(hashtext($1))', ['empresa:' + cnpjDigitos]);
  const { rows: mesmaEmpresa } = await db.query(
    `select nome from unidades where regexp_replace(cnpj, '\\D', '', 'g') = $1`, [cnpjDigitos]);
  if (mesmaEmpresa.some(u => normalizarTexto(u.nome) === normalizarTexto(dados.nome))) {
    throw new ErroNegocio(409, `Esta empresa já tem uma unidade chamada ${dados.nome}.`);
  }
  const slug = await slugLivre(db, dados.nome);
  const { rows: [unidade] } = await db.query(
    `insert into unidades (slug, nome, uf, cnpj, telefone, endereco, endereco_curto)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, slug, nome, uf`,
    [slug, dados.nome, dados.uf, formatarCnpj(cnpjDigitos), dados.telefone, dados.endereco, dados.endereco_curto]
  );
  return unidade;
}

async function vincularAdmin(db, adminId, unidadeId) {
  await db.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1, $2) on conflict do nothing', [adminId, unidadeId]);
}

// CNPJs (só dígitos) das unidades de um administrador — a "empresa" dele.
async function cnpjsDoAdmin(db, adminId) {
  const { rows } = await db.query(
    `select distinct regexp_replace(u.cnpj, '\\D', '', 'g') as d
     from unidades u join administrador_unidades au on au.unidade_id = u.id
     where au.administrador_id = $1 and u.cnpj is not null`, [adminId]);
  return rows.map(r => r.d).filter(Boolean);
}

module.exports = { ErroNegocio, emTransacao, lerDadosUnidade, criarUnidade, vincularAdmin, cnpjsDoAdmin };
