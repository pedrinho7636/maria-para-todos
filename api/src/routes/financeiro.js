const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAcessoUnidade } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { resumir } = require('../utils/financeiro');
const { concluirAtendimentosRealizados } = require('../utils/conclusao');

const router = express.Router();

// Módulo "financeiro": administrador completo ou funcionário com essa permissão.
// (Quanto cada prestadora recebe POR atendimento continua sendo definido só pelo
// administrador completo, na tela Equipe — aqui se vê e se fecha o que já aconteceu.)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

async function hojeEMes() {
  const { rows: [r] } = await pool.query(
    `select (now() at time zone 'America/Sao_Paulo')::date::text as hoje,
            to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes`
  );
  return r;
}

function mesAnterior(mes) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

// Linhas do mês (sem cancelados) com o custo já resolvido: valor travado no aceite ou, se
// ainda não travou, a tarifa atual da prestadora.
const SQL_LINHAS = `
  select a.id, a.data_atendimento::text as dia, to_char(a.hora_atendimento, 'HH24:MI') as hora, a.status, a.tipo_servico,
         a.valor, coalesce(a.valor_prestadora, p.valor_por_atendimento) as custo,
         a.prestadora_id, p.nome as prestadora_nome, a.cliente_id, c.nome as cliente_nome, a.repasse_pago_em
  from atendimentos a
  left join prestadoras p on p.id = a.prestadora_id
  left join clientes c on c.id = a.cliente_id
  where a.unidade_id = $1 and a.status <> 'cancelado'
    and a.data_atendimento >= ($2 || '-01')::date
    and a.data_atendimento < (($2 || '-01')::date + interval '1 month')
  order by a.data_atendimento, a.hora_atendimento`;

// Resumo financeiro do mês (?mes=YYYY-MM, padrão: o mês atual de Brasília)
router.get('/:slug/resumo', requireAuth, requireAcessoUnidade('financeiro'), asyncHandler(async (req, res) => {
  const agora = await hojeEMes();
  const mes = req.query.mes ? String(req.query.mes) : agora.mes;
  if (!MES.test(mes)) return res.status(400).json({ erro: 'mes inválido — use AAAA-MM' });

  await concluirAtendimentosRealizados(); // "realizado" sempre em dia, sem esperar o ciclo automático
  const anterior = mesAnterior(mes);
  const [{ rows }, { rows: rowsAnt }] = await Promise.all([
    pool.query(SQL_LINHAS, [req.unidadeId, mes]),
    pool.query(SQL_LINHAS, [req.unidadeId, anterior]),
  ]);
  const { realizado: antes } = resumir(rowsAnt, agora.hoje);

  res.json({
    mes, hoje: agora.hoje, mes_atual: agora.mes,
    ...resumir(rows, agora.hoje),
    anterior: { mes: anterior, receita: antes.receita, custo: antes.custo, margem: antes.margem },
  });
}));

// Atendimentos concluídos de uma prestadora no mês — a "folha" do repasse dela
router.get('/:slug/repasses/:prestadoraId', requireAuth, requireAcessoUnidade('financeiro'), asyncHandler(async (req, res) => {
  const { prestadoraId } = req.params;
  const mes = String(req.query.mes || '');
  if (!UUID.test(prestadoraId)) return res.status(400).json({ erro: 'prestadora inválida' });
  if (!MES.test(mes)) return res.status(400).json({ erro: 'mes inválido — use AAAA-MM' });

  const { rows: [prestadora] } = await pool.query(
    'select id, nome, valor_por_atendimento from prestadoras where id = $1 and unidade_id = $2', [prestadoraId, req.unidadeId]);
  if (!prestadora) return res.status(404).json({ erro: 'Prestadora não encontrada nesta unidade' });

  const { rows } = await pool.query(
    `select a.id, a.data_atendimento::text as dia, to_char(a.hora_atendimento, 'HH24:MI') as hora, a.tipo_servico,
            c.nome as cliente, coalesce(a.valor_prestadora, p.valor_por_atendimento) as custo, a.repasse_pago_em
     from atendimentos a
     join prestadoras p on p.id = a.prestadora_id
     left join clientes c on c.id = a.cliente_id
     where a.prestadora_id = $1 and a.unidade_id = $2 and a.status = 'concluido'
       and a.data_atendimento >= ($3 || '-01')::date and a.data_atendimento < (($3 || '-01')::date + interval '1 month')
     order by a.data_atendimento, a.hora_atendimento`,
    [prestadoraId, req.unidadeId, mes]
  );
  res.json({
    prestadora: { id: prestadora.id, nome: prestadora.nome },
    mes,
    atendimentos: rows.map(r => ({ ...r, custo: r.custo === null ? null : Number(r.custo) })),
  });
}));

// Marca como pago (ou desfaz) o repasse de TODOS os atendimentos concluídos da prestadora
// naquele mês. Só entram os que têm custo (sem tarifa não há o que pagar). Ao pagar, o valor
// fica travado no atendimento: mudar a tarifa depois não altera o que já foi pago.
router.post('/:slug/repasses/:prestadoraId/pagar', requireAuth, requireAcessoUnidade('financeiro'), asyncHandler(async (req, res) => {
  const { prestadoraId } = req.params;
  const mes = String(req.body.mes || '');
  const desfazer = req.body.desfazer === true;
  if (!UUID.test(prestadoraId)) return res.status(400).json({ erro: 'prestadora inválida' });
  if (!MES.test(mes)) return res.status(400).json({ erro: 'mes inválido — use AAAA-MM' });

  const { rows } = await pool.query(
    `update atendimentos a set
       repasse_pago_em = case when $4::boolean then null else now() end,
       valor_prestadora = coalesce(a.valor_prestadora, p.valor_por_atendimento),
       atualizado_em = now()
     from prestadoras p
     where p.id = a.prestadora_id and a.prestadora_id = $1 and a.unidade_id = $2 and a.status = 'concluido'
       and a.data_atendimento >= ($3 || '-01')::date and a.data_atendimento < (($3 || '-01')::date + interval '1 month')
       and coalesce(a.valor_prestadora, p.valor_por_atendimento) is not null
       and (a.repasse_pago_em is not null) = $4::boolean
     returning a.id`,
    [prestadoraId, req.unidadeId, mes, desfazer]
  );
  res.json({ atualizados: rows.length, desfeito: desfazer });
}));

module.exports = router;
