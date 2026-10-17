// Sessão (JWT) — assinatura, verificação e REVOGAÇÃO quando a senha muda.
//
// O token vale 7 dias e, sozinho, não dá pra "desligar": quem roubou um token (computador compartilhado, celular perdido)
// continuaria dentro mesmo depois de a dona trocar a senha. Por isso cada conta guarda `senha_alterada_em` (hora de Node,
// a MESMA fonte da marca de emissão do token — nunca o relógio do banco, pra um atraso entre os dois não invalidar token novo)
// e um token emitido ANTES dessa hora deixa de valer. Token de conta apagada também deixa de valer.
// A hora de emissão vai no token em milissegundos (`ia`; o `iat` padrão do JWT só tem segundos e deixaria passar um token
// emitido no mesmo segundo da troca). Token antigo, sem `ia`, é comparado pelo `iat`.
// A consulta é guardada 10 s em memória (o /sync bate de poucos em poucos segundos); quem troca a senha aqui dentro
// limpa a entrada na hora (esquecerSessao), então para a API que fez a troca o efeito é imediato.
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const TABELA_DO_PERFIL = { administrador: 'administradores', sub_administrador: 'sub_administradores', prestadora: 'prestadoras', cliente: 'clientes' };
const PERFIL_DA_TABELA = Object.fromEntries(Object.entries(TABELA_DO_PERFIL).map(([perfil, tabela]) => [tabela, perfil]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDADE_DO_CACHE_MS = 10_000;

// Algoritmo fixo nos dois lados: a verificação nunca aceita o que o próprio token "pede" (alg: none etc.).
const assinarToken = (payload) => jwt.sign({ ...payload, ia: Date.now() }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
const verificarToken = (token) => jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

// Token novo para a mesma pessoa (usado depois de trocar a senha: a sessão ATUAL continua, as antigas caem)
const tokenDe = (user) => assinarToken({ id: user.id, perfil: user.perfil, ...(user.unidade_id ? { unidade_id: user.unidade_id } : {}) });

const cache = new Map(); // "perfil:id" -> { existe, desde (ms), ate (ms) }

async function carimbo(perfil, id) {
  const chave = perfil + ':' + id, agora = Date.now();
  const guardado = cache.get(chave);
  if (guardado && guardado.ate > agora) return guardado;
  // o nome da tabela vem do mapa acima (literal), nunca de entrada do usuário
  const { rows: [linha] } = await pool.query(`select senha_alterada_em from ${TABELA_DO_PERFIL[perfil]} where id = $1`, [id]);
  const valor = { existe: !!linha, desde: linha?.senha_alterada_em ? new Date(linha.senha_alterada_em).getTime() : 0, ate: agora + VALIDADE_DO_CACHE_MS };
  if (cache.size > 5000) cache.clear();
  cache.set(chave, valor);
  return valor;
}

// O token (já com a assinatura conferida) ainda vale? Conta existe e a senha não mudou depois de ele ser emitido.
async function sessaoValida(user) {
  if (!user || !TABELA_DO_PERFIL[user.perfil] || !UUID.test(String(user.id))) return false;
  const { existe, desde } = await carimbo(user.perfil, user.id);
  if (!existe) return false;
  if (!desde) return true; // senha nunca trocada
  if (typeof user.ia === 'number') return user.ia >= desde;
  return typeof user.iat === 'number' && user.iat >= Math.floor(desde / 1000); // token de antes desta versão (só tem segundos)
}

// Chamar logo DEPOIS de gravar uma senha nova (ids = um ou vários).
function esquecerSessao(perfil, ids) {
  for (const id of [].concat(ids)) cache.delete(perfil + ':' + id);
}

module.exports = { TABELA_DO_PERFIL, PERFIL_DA_TABELA, assinarToken, verificarToken, tokenDe, sessaoValida, esquecerSessao };
