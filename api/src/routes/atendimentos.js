const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { unidadeDoAdmin } = require('../utils/permissoes');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Pedido de orçamento pela home — público, entra como 'pedido' na agenda da unidade
router.post('/', asyncHandler(async (req, res) => {
  const { unidade_slug, tipo_servico, area, data_atendimento, hora_atendimento, origem } = req.body;
  if (!unidade_slug || !tipo_servico || !data_atendimento) {
    return res.status(400).json({ erro: 'unidade_slug, tipo_servico e data_atendimento são obrigatórios' });
  }

  const { rows: [unidade] } = await pool.query('select id from unidades where slug = $1', [unidade_slug]);
  if (!unidade) return res.status(400).json({ erro: 'Unidade não encontrada' });

  const { rows: [atendimento] } = await pool.query(
    `insert into atendimentos (unidade_id, tipo_servico, area, data_atendimento, hora_atendimento, origem, status)
     values ($1, $2, $3, $4, $5, $6, 'pedido') returning *`,
    [unidade.id, tipo_servico, area || null, data_atendimento, hora_atendimento || null, origem === 'whatsapp' ? 'whatsapp' : 'site']
  );
  res.status(201).json(atendimento);
}));

// Agenda do dia da unidade — admin
router.get('/admin/:slug/agenda', requireAuth, requireRole('administrador'), asyncHandler(async (req, res) => {
  const unidadeId = await unidadeDoAdmin(req.user.id, req.params.slug);
  if (!unidadeId) return res.status(403).json({ erro: 'Você não administra esta unidade' });

  const { rows } = await pool.query(
    `select a.*, p.nome as prestadora_nome, c.nome as cliente_nome
     from atendimentos a
     left join prestadoras p on p.id = a.prestadora_id
     left join clientes c on c.id = a.cliente_id
     where a.unidade_id = $1 and a.data_atendimento = current_date
     order by a.hora_atendimento nulls last`,
    [unidadeId]
  );
  res.json(rows);
}));

// Admin converte pedido em convite para uma prestadora (pedido -> proposto)
router.post('/admin/:slug/:id/propor', requireAuth, requireRole('administrador'), asyncHandler(async (req, res) => {
  const unidadeId = await unidadeDoAdmin(req.user.id, req.params.slug);
  if (!unidadeId) return res.status(403).json({ erro: 'Você não administra esta unidade' });

  const { prestadora_id } = req.body;
  if (!prestadora_id) return res.status(400).json({ erro: 'prestadora_id é obrigatório' });

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set prestadora_id = $1, status = 'proposto', atualizado_em = now()
     where id = $2 and unidade_id = $3 and status = 'pedido'
     returning *`,
    [prestadora_id, req.params.id, unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou não está em status "pedido"' });
  res.json(atendimento);
}));

// Admin (ou gatilho futuro por data/hora) marca atendimento aceito como concluído
router.post('/admin/:slug/:id/concluir', requireAuth, requireRole('administrador'), asyncHandler(async (req, res) => {
  const unidadeId = await unidadeDoAdmin(req.user.id, req.params.slug);
  if (!unidadeId) return res.status(403).json({ erro: 'Você não administra esta unidade' });

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set status = 'concluido', atualizado_em = now()
     where id = $1 and unidade_id = $2 and status = 'aceito'
     returning *`,
    [req.params.id, unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou não está em status "aceito"' });
  res.json(atendimento);
}));

// Convites pendentes de aceite pela prestadora logada
router.get('/prestadora/me/convites', requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select * from atendimentos where prestadora_id = $1 and status = 'proposto' order by data_atendimento, hora_atendimento`,
    [req.user.id]
  );
  res.json(rows);
}));

// Agenda já aceita pela prestadora logada
router.get('/prestadora/me/agenda', requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select * from atendimentos where prestadora_id = $1 and status = 'aceito' order by data_atendimento, hora_atendimento`,
    [req.user.id]
  );
  res.json(rows);
}));

router.post('/prestadora/me/:id/aceitar', requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set status = 'aceito', atualizado_em = now()
     where id = $1 and prestadora_id = $2 and status = 'proposto'
     returning *`,
    [req.params.id, req.user.id]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Convite não encontrado' });
  res.json(atendimento);
}));

router.post('/prestadora/me/:id/recusar', requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set status = 'recusado', prestadora_id = null, atualizado_em = now()
     where id = $1 and prestadora_id = $2 and status = 'proposto'
     returning *`,
    [req.params.id, req.user.id]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Convite não encontrado' });
  res.json(atendimento);
}));

// Atendimentos concluídos do cliente logado, aguardando avaliação
router.get('/cliente/me/pendentes-avaliacao', requireAuth, requireRole('cliente'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select a.* from atendimentos a
     where a.cliente_id = $1 and a.status = 'concluido'
       and not exists (select 1 from avaliacoes av where av.atendimento_id = a.id)
     order by a.data_atendimento desc`,
    [req.user.id]
  );
  res.json(rows);
}));

module.exports = router;
