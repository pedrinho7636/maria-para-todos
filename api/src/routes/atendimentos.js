const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole, requireAcessoUnidade } = require('../middleware/auth');
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

// Agenda de um dia da unidade — admin (?data=YYYY-MM-DD, default hoje)
router.get('/admin/:slug/agenda', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { data } = req.query;
  const { rows } = await pool.query(
    `select a.*, p.nome as prestadora_nome, c.nome as cliente_nome
     from atendimentos a
     left join prestadoras p on p.id = a.prestadora_id
     left join clientes c on c.id = a.cliente_id
     where a.unidade_id = $1 and a.data_atendimento = coalesce($2::date, current_date)
       and a.status <> 'cancelado'
     order by a.hora_atendimento nulls last`,
    [req.unidadeId, data || null]
  );
  res.json(rows);
}));

// Lista enxuta de prestadoras ativas da unidade — liberada por 'agenda' (não por
// 'equipe'), já que atribuir/reatribuir prestadora é uma operação de agenda.
router.get('/admin/:slug/prestadoras', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select id, nome from prestadoras where unidade_id = $1 and ativa = true order by nome',
    [req.unidadeId]
  );
  res.json(rows);
}));

// Contagem de atendimentos por dia num mês — alimenta os pontinhos do calendário
router.get('/admin/:slug/agenda/resumo-mensal', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { mes } = req.query; // 'YYYY-MM'
  if (!mes) return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });

  const { rows } = await pool.query(
    `select data_atendimento::text as data, count(*)::int as total
     from atendimentos
     where unidade_id = $1
       and date_trunc('month', data_atendimento) = date_trunc('month', ($2 || '-01')::date)
       and status <> 'cancelado'
     group by data_atendimento
     order by data_atendimento`,
    [req.unidadeId, mes]
  );
  res.json(rows);
}));

// Admin converte pedido em convite para uma prestadora (pedido -> proposto)
router.post('/admin/:slug/:id/propor', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { prestadora_id } = req.body;
  if (!prestadora_id) return res.status(400).json({ erro: 'prestadora_id é obrigatório' });

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set prestadora_id = $1, status = 'proposto', atualizado_em = now()
     where id = $2 and unidade_id = $3 and status = 'pedido'
     returning *`,
    [prestadora_id, req.params.id, req.unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou não está em status "pedido"' });
  res.json(atendimento);
}));

// Reatribui (ou remove) a prestadora de um atendimento em qualquer status não-terminal.
// Generaliza /propor, que só funcionava a partir de 'pedido'.
router.post('/admin/:slug/:id/reatribuir', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const prestadoraId = req.body.prestadora_id || null;

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set
       prestadora_id = $1::uuid,
       status = case when status in ('pedido', 'recusado') and $1::uuid is not null then 'proposto' else status end,
       atualizado_em = now()
     where id = $2 and unidade_id = $3 and status not in ('concluido', 'cancelado')
     returning *`,
    [prestadoraId, req.params.id, req.unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou já concluído/cancelado' });
  res.json(atendimento);
}));

// Admin (ou gatilho futuro por data/hora) marca atendimento aceito como concluído
router.post('/admin/:slug/:id/concluir', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set status = 'concluido', atualizado_em = now()
     where id = $1 and unidade_id = $2 and status = 'aceito'
     returning *`,
    [req.params.id, req.unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou não está em status "aceito"' });
  res.json(atendimento);
}));

// Cria uma recorrência por "semana-modelo": o admin monta uma ou mais entradas
// (dia da semana + horário + serviço, cada uma com prestadora/cliente opcionais)
// e o sistema repete esse padrão semana a semana (ou intercalado, semana sim/
// semana não) até o horizonte, gerando todas as linhas concretas de uma vez —
// sem tabela de regra, mesmo princípio de antes, só que agora com várias
// entradas por semana em vez de uma só.
router.post('/admin/:slug/recorrente', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { data_inicio, horizonte_meses, semanas_alternadas, itens } = req.body;

  if (!data_inicio || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'data_inicio e itens (ao menos um) são obrigatórios' });
  }
  for (const item of itens) {
    const dia = Number(item.dia_semana);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6 || !item.hora_atendimento || !item.tipo_servico) {
      return res.status(400).json({ erro: 'cada item precisa de dia_semana (0-6), hora_atendimento e tipo_servico' });
    }
  }

  const inicio = new Date(data_inicio + 'T00:00:00');
  if (Number.isNaN(inicio.getTime())) return res.status(400).json({ erro: 'data_inicio inválida' });
  const horizonte = parseInt(horizonte_meses, 10) || 3;
  const fim = new Date(inicio);
  fim.setMonth(fim.getMonth() + horizonte);

  // domingo da semana que contém data_inicio = semana 0 do padrão
  const domingoSemana0 = new Date(inicio);
  domingoSemana0.setDate(domingoSemana0.getDate() - domingoSemana0.getDay());

  const linhas = [];
  for (let semana = new Date(domingoSemana0), indiceSemana = 0; semana <= fim; semana.setDate(semana.getDate() + 7), indiceSemana++) {
    if (semanas_alternadas && indiceSemana % 2 !== 0) continue; // semana "sim/não": pula a semana inteira, sem exceção
    for (const item of itens) {
      const data = new Date(semana);
      data.setDate(data.getDate() + Number(item.dia_semana));
      if (data < inicio || data > fim) continue;
      linhas.push({ data: data.toISOString().slice(0, 10), item });
      if (linhas.length >= 200) break; // trava de segurança contra input absurdo
    }
    if (linhas.length >= 200) break;
  }
  if (linhas.length === 0) return res.status(400).json({ erro: 'Nenhuma ocorrência gerada nesse período' });

  const serieId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inseridos = [];
    for (const { data, item } of linhas) {
      const status = item.prestadora_id ? 'proposto' : 'pedido';
      const { rows: [linha] } = await client.query(
        `insert into atendimentos
           (unidade_id, cliente_id, prestadora_id, tipo_servico, area, data_atendimento,
            hora_atendimento, valor, status, origem, serie_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10)
         returning *`,
        [req.unidadeId, item.cliente_id || null, item.prestadora_id || null, item.tipo_servico, item.area || null,
         data, item.hora_atendimento, item.valor || null, status, serieId]
      );
      inseridos.push(linha);
    }
    await client.query('COMMIT');
    res.status(201).json({ serie_id: serieId, quantidade_gerada: inseridos.length, atendimentos: inseridos });
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}));

// Cancela as ocorrências futuras (ainda não concluídas/canceladas) de uma série
router.post('/admin/:slug/serie/:serieId/cancelar', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `update atendimentos set status = 'cancelado', atualizado_em = now()
     where serie_id = $1 and unidade_id = $2 and data_atendimento >= current_date
       and status not in ('concluido', 'cancelado')
     returning id`,
    [req.params.serieId, req.unidadeId]
  );
  res.json({ cancelados: rows.length });
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

// Prestadora só pode confirmar (aceitar) um convite a partir de 2 dias antes
// do atendimento — reserva de agenda muito antecipada fica só "aguardando".
router.post('/prestadora/me/:id/aceitar', requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const { rows: [atual] } = await pool.query(
    `select * from atendimentos where id = $1 and prestadora_id = $2 and status = 'proposto'`,
    [req.params.id, req.user.id]
  );
  if (!atual) return res.status(404).json({ erro: 'Convite não encontrado' });

  const hojeISO = new Date().toISOString().slice(0, 10);
  const dataISO = atual.data_atendimento.toISOString().slice(0, 10);
  const diasRestantes = Math.round((new Date(dataISO) - new Date(hojeISO)) / 86400000);
  if (diasRestantes > 2) {
    return res.status(400).json({ erro: `Só é possível confirmar a partir de 2 dias antes do atendimento (faltam ${diasRestantes} dias)` });
  }

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set status = 'aceito', atualizado_em = now() where id = $1 returning *`,
    [req.params.id]
  );
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
