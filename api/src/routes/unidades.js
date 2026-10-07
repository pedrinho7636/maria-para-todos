const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole, requireAcessoUnidade } = require('../middleware/auth');
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
    `select v.*, p.valor_por_atendimento
     from vw_equipe_unidade v join prestadoras p on p.id = v.prestadora_id
     where v.unidade_id = $1 order by v.nome`,
    [req.unidadeId]
  );
  res.json(rows);
}));

// Quanto a franquia paga a esta prestadora por atendimento. Vazio/null remove a
// tarifa. Só vale pros próximos aceites — o que já foi aceito mantém o valor
// combinado na hora (atendimentos.valor_prestadora). É dinheiro: só administrador
// completo altera (funcionário com módulo "Equipe" enxerga, mas não muda).
router.patch('/:slug/admin/equipe/:prestadoraId', requireAuth, requireRole('administrador'), requireAcessoUnidade('equipe'), asyncHandler(async (req, res) => {
  const bruto = req.body.valor_por_atendimento;
  let valor = null;
  if (bruto !== null && bruto !== undefined && String(bruto).trim() !== '') {
    valor = Number(String(bruto).trim().replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0 || valor >= 100000) {
      return res.status(400).json({ erro: 'Valor inválido — informe um número entre 0 e 99.999,99' });
    }
    valor = Math.round(valor * 100) / 100;
  }

  const { rows: [prestadora] } = await pool.query(
    `update prestadoras set valor_por_atendimento = $1, atualizado_em = now()
     where id = $2 and unidade_id = $3
     returning id, nome, valor_por_atendimento`,
    [valor, req.params.prestadoraId, req.unidadeId]
  );
  if (!prestadora) return res.status(404).json({ erro: 'Prestadora não encontrada nesta unidade' });
  res.json(prestadora);
}));

router.get('/:slug/admin/clientes', requireAuth, requireAcessoUnidade('clientes'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select * from vw_clientes_unidade where unidade_id = $1 order by nome',
    [req.unidadeId]
  );
  res.json(rows);
}));

// Telefone (WhatsApp) da unidade — configuração da franquia, não é um módulo
// delegável: só administrador completo mexe, nunca sub-administrador.
router.patch('/:slug/telefone', requireAuth, requireRole('administrador'), asyncHandler(async (req, res) => {
  const unidadeId = await unidadeDoAdmin(req.user.id, req.params.slug);
  if (!unidadeId) return res.status(403).json({ erro: 'Sem acesso a esta unidade' });

  const telefone = (req.body.telefone || '').trim();
  if (!telefone) return res.status(400).json({ erro: 'telefone é obrigatório' });

  const { rows: [unidade] } = await pool.query(
    'update unidades set telefone = $1 where id = $2 returning slug, nome, uf, telefone, endereco, endereco_curto',
    [telefone, unidadeId]
  );
  res.json(unidade);
}));

// Endereço (local do estabelecimento) da unidade, mostrado no site. Também é só do
// administrador completo. Vazio é permitido e significa "esta unidade não divulga
// endereço": o campo some do site. Sem o resumido, o site usa o completo.
router.patch('/:slug/endereco', requireAuth, requireRole('administrador'), asyncHandler(async (req, res) => {
  const unidadeId = await unidadeDoAdmin(req.user.id, req.params.slug);
  if (!unidadeId) return res.status(403).json({ erro: 'Sem acesso a esta unidade' });

  const endereco = String(req.body.endereco ?? '').trim();
  const curto = String(req.body.endereco_curto ?? '').trim();
  if (endereco.length > 300 || curto.length > 150) {
    return res.status(400).json({ erro: 'Endereço muito longo (máximo 300 caracteres; resumido, 150)' });
  }

  const { rows: [unidade] } = await pool.query(
    `update unidades set endereco = $1, endereco_curto = $2 where id = $3
     returning slug, nome, uf, telefone, endereco, endereco_curto`,
    [endereco || null, endereco ? (curto || null) : null, unidadeId]
  );
  res.json(unidade);
}));

module.exports = router;
