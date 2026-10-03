const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { unidadeDoAdmin } = require('../utils/permissoes');
const { normalizarEmail } = require('../utils/normalizacao');
const { senhaValida, emailValido, nomeValido } = require('../utils/validacao');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const SALT_ROUNDS = 10;
const MODULOS = ['dashboard', 'agenda', 'avaliacoes', 'equipe', 'clientes', 'financeiro'];

// Gerir sub-administradores é sempre admin-completo — nunca delegável via
// requireAcessoUnidade, mesmo que o sub-admin tenha todos os outros módulos.
router.use(requireAuth, requireRole('administrador'));

async function exigirUnidade(req, res) {
  const unidadeId = await unidadeDoAdmin(req.user.id, req.params.slug);
  if (!unidadeId) res.status(403).json({ erro: 'Você não administra esta unidade' });
  return unidadeId;
}

// Cria um sub-administrador vinculado à unidade
router.post('/:slug', asyncHandler(async (req, res) => {
  const unidadeId = await exigirUnidade(req, res);
  if (!unidadeId) return;

  const { nome, sobrenome, email, senha, permissoes = {} } = req.body;
  if (!nome || !sobrenome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, sobrenome, email e senha são obrigatórios' });
  }
  // Mesmas regras do cadastro das outras contas (antes aceitava senha de 1 caractere).
  if (!nomeValido(nome) || !nomeValido(sobrenome)) return res.status(400).json({ erro: 'Informe nome e sobrenome válidos' });
  if (!emailValido(email) || !senhaValida(senha)) {
    return res.status(400).json({ erro: 'E-mail inválido ou senha com menos de 8 caracteres' });
  }
  // O login do painel procura primeiro em administradores: se o e-mail do
  // funcionário já fosse de um administrador, os dois se confundiriam na entrada.
  const { rows: jaEhAdmin } = await pool.query('select 1 from administradores where email = $1', [normalizarEmail(email)]);
  if (jaEhAdmin.length) return res.status(409).json({ erro: 'E-mail já cadastrado' });

  const colunas = MODULOS.map(m => `pode_${m}`);
  const valores = MODULOS.map(m => !!permissoes[m]);
  const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
  const placeholdersValores = valores.map((_, i) => `$${7 + i}`).join(', ');

  try {
    const { rows: [sub] } = await pool.query(
      `insert into sub_administradores (nome, sobrenome, email, senha_hash, unidade_id, criado_por, ${colunas.join(', ')})
       values ($1, $2, $3, $4, $5, $6, ${placeholdersValores})
       returning id, nome, sobrenome, email, unidade_id, ativo, ${colunas.join(', ')}`,
      [nome, sobrenome, normalizarEmail(email), senhaHash, unidadeId, req.user.id, ...valores]
    );
    res.status(201).json(sub);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'E-mail já cadastrado' });
    throw erro;
  }
}));

// Lista os sub-administradores da unidade
router.get('/:slug', asyncHandler(async (req, res) => {
  const unidadeId = await exigirUnidade(req, res);
  if (!unidadeId) return;

  const colunas = MODULOS.map(m => `pode_${m}`).join(', ');
  const { rows } = await pool.query(
    `select id, nome, sobrenome, email, ativo, ${colunas}
     from sub_administradores where unidade_id = $1 order by nome`,
    [unidadeId]
  );
  res.json(rows);
}));

// Edita nome/sobrenome/senha/permissões (todos os campos são opcionais)
router.patch('/:slug/:id', asyncHandler(async (req, res) => {
  const unidadeId = await exigirUnidade(req, res);
  if (!unidadeId) return;

  const { nome, sobrenome, senha, permissoes } = req.body;
  const sets = [];
  const vals = [];
  let i = 1;

  if (nome) {
    if (!nomeValido(nome)) return res.status(400).json({ erro: 'Nome inválido' });
    sets.push(`nome = $${i++}`); vals.push(nome.trim());
  }
  if (sobrenome) {
    if (!nomeValido(sobrenome)) return res.status(400).json({ erro: 'Sobrenome inválido' });
    sets.push(`sobrenome = $${i++}`); vals.push(sobrenome.trim());
  }
  if (senha) {
    if (!senhaValida(senha)) return res.status(400).json({ erro: 'A senha precisa ter ao menos 8 caracteres' });
    sets.push(`senha_hash = $${i++}`); vals.push(await bcrypt.hash(senha, SALT_ROUNDS));
  }
  if (permissoes) {
    for (const modulo of MODULOS) {
      if (modulo in permissoes) { sets.push(`pode_${modulo} = $${i++}`); vals.push(!!permissoes[modulo]); }
    }
  }
  if (sets.length === 0) return res.status(400).json({ erro: 'Nada para atualizar' });

  vals.push(req.params.id, unidadeId);
  const colunas = MODULOS.map(m => `pode_${m}`).join(', ');
  const { rows: [sub] } = await pool.query(
    `update sub_administradores set ${sets.join(', ')}
     where id = $${i++} and unidade_id = $${i}
     returning id, nome, sobrenome, email, ativo, ${colunas}`,
    vals
  );
  if (!sub) return res.status(404).json({ erro: 'Sub-administrador não encontrado' });
  res.json(sub);
}));

// Ativa/desativa (mesmo padrão de soft-disable de prestadoras.ativa)
router.post('/:slug/:id/:acao(ativar|desativar)', asyncHandler(async (req, res) => {
  const unidadeId = await exigirUnidade(req, res);
  if (!unidadeId) return;

  const ativo = req.params.acao === 'ativar';
  const { rows: [sub] } = await pool.query(
    `update sub_administradores set ativo = $1 where id = $2 and unidade_id = $3 returning id, ativo`,
    [ativo, req.params.id, unidadeId]
  );
  if (!sub) return res.status(404).json({ erro: 'Sub-administrador não encontrado' });
  res.json(sub);
}));

module.exports = router;
