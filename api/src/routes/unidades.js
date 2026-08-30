const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAcessoUnidade } = require('../middleware/auth');
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

// A partir daqui, cada rota exige seu próprio módulo — administrador completo
// sempre passa; sub-administrador só se tiver a permissão daquele módulo.
router.get('/:slug/admin/dashboard', requireAuth, requireAcessoUnidade('dashboard'), asyncHandler(async (req, res) => {
  const { rows: [dados] } = await pool.query(
    'select * from vw_dashboard_unidade where unidade_id = $1',
    [req.unidadeId]
  );
  res.json(dados || {});
}));

router.get('/:slug/admin/equipe', requireAuth, requireAcessoUnidade('equipe'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select * from vw_equipe_unidade where unidade_id = $1 order by nome',
    [req.unidadeId]
  );
  res.json(rows);
}));

router.get('/:slug/admin/clientes', requireAuth, requireAcessoUnidade('clientes'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select * from vw_clientes_unidade where unidade_id = $1 order by nome',
    [req.unidadeId]
  );
  res.json(rows);
}));

module.exports = router;
