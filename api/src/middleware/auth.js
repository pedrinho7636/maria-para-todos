const asyncHandler = require('../utils/asyncHandler');
const { acessoAdminUnidade } = require('../utils/permissoes');
const { verificarToken, sessaoValida } = require('../utils/sessao');
const { pool } = require('../db');

// Confere a assinatura do token E se a sessão ainda vale (conta existe e a senha não foi trocada depois de o token ser
// emitido — ver utils/sessao.js). Token inválido/vencido/revogado = 401.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Token ausente' });

  let user;
  try {
    user = verificarToken(token);
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
  try {
    if (!(await sessaoValida(user))) return res.status(401).json({ erro: 'Sessão encerrada. Entre novamente.' });
  } catch (erro) {
    return next(erro);
  }
  req.user = user;
  next();
}

function requireRole(...perfis) {
  return (req, res, next) => {
    if (!perfis.includes(req.user.perfil)) {
      return res.status(403).json({ erro: 'Sem permissão para este recurso' });
    }
    next();
  };
}

// Autoriza administrador completo OU sub-administrador com permissão no
// módulo indicado, para a unidade do :slug da rota. Seta req.unidadeId.
function requireAcessoUnidade(modulo) {
  return asyncHandler(async (req, res, next) => {
    const acesso = await acessoAdminUnidade(req.user, req.params.slug, modulo);
    if (!acesso) return res.status(403).json({ erro: 'Sem permissão para este recurso' });
    req.unidadeId = acesso.unidadeId;
    next();
  });
}

// Prestadora com conta criada pela planilha (senha padrão) só pode usar a etapa de "primeiro acesso"
// (confirmar o e-mail e trocar a senha) até concluí-la; o resto da área dela responde 403 com
// codigo PRIMEIRO_ACESSO. Perfis que não são prestadora passam direto.
const requirePrimeiroAcessoConcluido = asyncHandler(async (req, res, next) => {
  if (req.user.perfil !== 'prestadora') return next();
  const { rows: [p] } = await pool.query('select primeiro_acesso_pendente, ativa from prestadoras where id = $1', [req.user.id]);
  // prestadora INATIVA (desativada pelo administrador na Equipe) não usa mais o portal
  if (p && p.ativa === false) return res.status(403).json({ erro: 'Seu acesso está desativado. Fale com a sua unidade.', codigo: 'DESATIVADA' });
  if (p?.primeiro_acesso_pendente) {
    return res.status(403).json({ erro: 'Conclua o seu primeiro acesso (confirmar o e-mail e criar uma senha) para usar o portal.', codigo: 'PRIMEIRO_ACESSO' });
  }
  next();
});

module.exports = { requireAuth, requireRole, requireAcessoUnidade, requirePrimeiroAcessoConcluido };
