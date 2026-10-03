const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole, requireAcessoUnidade } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Cliente envia avaliação de um atendimento concluído — entra como 'pendente' para moderação
router.post('/', requireAuth, requireRole('cliente'), asyncHandler(async (req, res) => {
  const { atendimento_id, nota, comentario } = req.body;
  if (!atendimento_id || !nota) return res.status(400).json({ erro: 'atendimento_id e nota são obrigatórios' });
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    return res.status(400).json({ erro: 'nota deve ser um número inteiro entre 1 e 5' });
  }
  if (comentario && comentario.length > 1000) {
    return res.status(400).json({ erro: 'comentario excede o tamanho máximo permitido' });
  }

  const { rows: [atendimento] } = await pool.query(
    `select * from atendimentos where id = $1 and cliente_id = $2 and status = 'concluido'`,
    [atendimento_id, req.user.id]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou não pertence a você' });

  const { rows: [avaliacao] } = await pool.query(
    `insert into avaliacoes (atendimento_id, cliente_id, prestadora_id, nota, comentario, status)
     values ($1, $2, $3, $4, $5, 'pendente') returning *`,
    [atendimento_id, req.user.id, atendimento.prestadora_id, nota, comentario || null]
  );
  res.status(201).json(avaliacao);
}));

// Avaliações aprovadas da prestadora logada (nota média + histórico)
router.get('/prestadora/me', requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select av.*, at.tipo_servico as servico, c.nome as cliente_nome
     from avaliacoes av
     join atendimentos at on at.id = av.atendimento_id
     join clientes c on c.id = av.cliente_id
     where av.prestadora_id = $1 and av.status = 'aprovada'
     order by av.criado_em desc`,
    [req.user.id]
  );
  res.json(rows);
}));

// Todas as avaliações das prestadoras da unidade (pendentes + já moderadas) — admin/sub-admin com permissão
router.get('/admin/:slug', requireAuth, requireAcessoUnidade('avaliacoes'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select av.*, at.tipo_servico as servico, c.nome as cliente_nome, p.nome as prestadora_nome
     from avaliacoes av
     join atendimentos at on at.id = av.atendimento_id
     join prestadoras p on p.id = av.prestadora_id
     join clientes c on c.id = av.cliente_id
     where p.unidade_id = $1
     order by av.criado_em desc`,
    [req.unidadeId]
  );
  res.json(rows);
}));

router.post('/admin/:slug/:id/aprovar', requireAuth, requireAcessoUnidade('avaliacoes'), asyncHandler(async (req, res) => {
  const { rows: [avaliacao] } = await pool.query(
    `update avaliacoes set status = 'aprovada', moderado_por = $1, moderado_em = now()
     where id = $2 and prestadora_id in (select id from prestadoras where unidade_id = $3) and status = 'pendente'
     returning *`,
    [req.user.id, req.params.id, req.unidadeId]
  );
  if (!avaliacao) return res.status(404).json({ erro: 'Avaliação não encontrada' });
  res.json(avaliacao);
}));

router.post('/admin/:slug/:id/recusar', requireAuth, requireAcessoUnidade('avaliacoes'), asyncHandler(async (req, res) => {
  const { rows: [avaliacao] } = await pool.query(
    `update avaliacoes set status = 'recusada', moderado_por = $1, moderado_em = now()
     where id = $2 and prestadora_id in (select id from prestadoras where unidade_id = $3) and status = 'pendente'
     returning *`,
    [req.user.id, req.params.id, req.unidadeId]
  );
  if (!avaliacao) return res.status(404).json({ erro: 'Avaliação não encontrada' });
  res.json(avaliacao);
}));

module.exports = router;
