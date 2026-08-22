const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { unidadeDoAdmin } = require('../utils/permissoes');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Dados institucionais — públicos, alimentam a home (seletor de região)
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select slug, nome, uf, telefone, endereco, endereco_curto from unidades order by nome'
  );
  res.json(rows);
}));

router.get('/:slug', asyncHandler(async (req, res) => {
  const { rows: [unidade] } = await pool.query(
    'select slug, nome, uf, telefone, endereco, endereco_curto from unidades where slug = $1',
    [req.params.slug]
  );
  if (!unidade) return res.status(404).json({ erro: 'Unidade não encontrada' });
  res.json(unidade);
}));

// A partir daqui, tudo exige login de administrador vinculado à unidade
router.use('/:slug/admin', requireAuth, requireRole('administrador'), asyncHandler(async (req, res, next) => {
  const unidadeId = await unidadeDoAdmin(req.user.id, req.params.slug);
  if (!unidadeId) return res.status(403).json({ erro: 'Você não administra esta unidade' });
  req.unidadeId = unidadeId;
  next();
}));

router.get('/:slug/admin/dashboard', asyncHandler(async (req, res) => {
  const { rows: [dados] } = await pool.query(
    'select * from vw_dashboard_unidade where unidade_id = $1',
    [req.unidadeId]
  );
  res.json(dados || {});
}));

router.get('/:slug/admin/equipe', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select * from vw_equipe_unidade where unidade_id = $1 order by nome',
    [req.unidadeId]
  );
  res.json(rows);
}));

router.get('/:slug/admin/clientes', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select * from vw_clientes_unidade where unidade_id = $1 order by nome',
    [req.unidadeId]
  );
  res.json(rows);
}));

module.exports = router;
