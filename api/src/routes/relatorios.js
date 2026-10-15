const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole, requireAcessoUnidade } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { concluirAtendimentosRealizados } = require('../utils/conclusao');
const R = require('../utils/relatorios');

const router = express.Router();

// Relatórios (Agenda, Financeiro e Satisfação): SÓ o administrador completo. Eles mostram faltas, metas e margem —
// dados de controle da franquia que nem a prestadora nem o funcionário (sem uma permissão própria) devem ver.
//
// Parâmetros comuns (todos opcionais): de + ate (AAAA-MM-DD) | mes (AAAA-MM) | preset (mes, mes_anterior, 30d, 90d, ano, 12m)
// e escopo=todas (soma todas as unidades do administrador; sem isso vale só a unidade da rota).
// Quase tudo é calculado em utils/relatorios.js (sem banco); aqui só se lê o que ele precisa.

// Linhas do período (todos os status): é a base dos três relatórios. O custo já vem resolvido: valor travado no
// aceite ou, se ainda não travou, a tarifa atual da prestadora.
const SQL_LINHAS = `
  select a.id, a.unidade_id, a.data_atendimento::text as dia, to_char(a.hora_atendimento, 'HH24:MI') as hora,
         a.status::text as status, a.tipo_servico, a.area, a.origem::text as origem, (a.serie_id is not null) as recorrente,
         a.duracao_horas::float8 as duracao_horas, a.valor, coalesce(a.valor_prestadora, p.valor_por_atendimento) as custo,
         a.repasse_pago_em, a.profissional_externo,
         a.prestadora_id, p.nome as prestadora_nome, a.cliente_id, c.nome as cliente_nome
  from atendimentos a
  left join prestadoras p on p.id = a.prestadora_id
  left join clientes c on c.id = a.cliente_id
  where a.unidade_id = any($1::uuid[]) and a.data_atendimento between $2::date and $3::date
  order by a.data_atendimento, a.hora_atendimento`;

// Período + unidades cobertas + "hoje" de Brasília, e deixa os atendimentos já realizados concluídos antes de contar.
const preparar = asyncHandler(async (req, res, next) => {
  const { rows: [h] } = await pool.query(`select (now() at time zone 'America/Sao_Paulo')::date::text as hoje`);
  const q = req.query;
  const periodo = R.resolverPeriodo({ de: q.de, ate: q.ate, mes: q.mes, preset: q.preset }, h.hoje);
  if (periodo.erro) return res.status(400).json({ erro: periodo.erro });

  const todas = q.escopo === 'todas';
  const { rows: unidades } = todas
    ? await pool.query(
      `select u.id, u.nome, u.slug from unidades u join administrador_unidades au on au.unidade_id = u.id
       where au.administrador_id = $1 order by u.nome`, [req.user.id])
    : await pool.query('select id, nome, slug from unidades where id = $1', [req.unidadeId]);
  if (!unidades.length) return res.status(404).json({ erro: 'Unidade não encontrada' });

  await Promise.all(unidades.map(u => concluirAtendimentosRealizados(pool, { unidadeId: u.id }))); // "concluído" sempre em dia
  req.rel = { hoje: h.hoje, periodo, unidades, ids: unidades.map(u => u.id), escopo: todas ? 'todas' : 'unidade' };
  next();
});

const guarda = [requireAuth, requireRole('administrador'), requireAcessoUnidade(), preparar];
const cabecalho = ({ hoje, periodo, unidades, escopo }) => ({ hoje, periodo, escopo, unidades: unidades.map(u => ({ id: u.id, nome: u.nome, slug: u.slug })) });

const linhasDe = async (ids, de, ate) => (await pool.query(SQL_LINHAS, [ids, de, ate])).rows;

const recusasDe = async (ids, de, ate) => (await pool.query(
  `select r.atendimento_id, r.prestadora_id from recusas_atendimento r join atendimentos a on a.id = r.atendimento_id
   where a.unidade_id = any($1::uuid[]) and a.data_atendimento between $2::date and $3::date`, [ids, de, ate])).rows;

const prestadorasDe = async (ids) => (await pool.query(
  `select p.id, p.nome, p.ativa, c.faltas_aceitavel_pct from prestadoras p left join controle_prestadora c on c.prestadora_id = p.id
   where p.unidade_id = any($1::uuid[])`, [ids])).rows;

// ---------- Agenda ----------
router.get('/:slug/agenda', ...guarda, asyncHandler(async (req, res) => {
  const { ids, periodo } = req.rel;
  const [linhas, anteriores, recusas, avisos, prestadoras, novos] = await Promise.all([
    linhasDe(ids, periodo.de, periodo.ate),
    linhasDe(ids, periodo.anterior.de, periodo.anterior.ate),
    recusasDe(ids, periodo.de, periodo.ate),
    pool.query(
      `select av.criado_em, av.lido_em from avisos_prestadora av join prestadoras p on p.id = av.prestadora_id
       where p.unidade_id = any($1::uuid[]) and (av.criado_em at time zone 'America/Sao_Paulo')::date between $2::date and $3::date`,
      [ids, periodo.de, periodo.ate]).then(r => r.rows),
    prestadorasDe(ids),
    pool.query(
      `select count(*)::int as n from clientes where unidade_id = any($1::uuid[])
         and (criado_em at time zone 'America/Sao_Paulo')::date between $2::date and $3::date`,
      [ids, periodo.de, periodo.ate]).then(r => r.rows[0].n),
  ]);
  res.json({
    ...cabecalho(req.rel),
    ...R.relatorioAgenda(linhas, { periodo, hoje: req.rel.hoje, anteriores, recusas, avisos, prestadoras, unidades: req.rel.unidades, clientesNovos: novos }),
  });
}));

// ---------- Financeiro ----------
router.get('/:slug/financeiro', ...guarda, asyncHandler(async (req, res) => {
  const { ids, periodo } = req.rel;
  const mesFim = periodo.ate.slice(0, 7);
  const inicioEvolucao = R.somaMes(mesFim, -11) + '-01', fimEvolucao = R.somaMes(mesFim, 1) + '-01'; // 12 meses, até o fim do mês do período
  const [linhas, anteriores, evolucao] = await Promise.all([
    linhasDe(ids, periodo.de, periodo.ate),
    linhasDe(ids, periodo.anterior.de, periodo.anterior.ate),
    pool.query(
      `select to_char(a.data_atendimento, 'YYYY-MM') as mes,
              count(*)::int as qtd,
              coalesce(sum(a.valor), 0) as receita,
              coalesce(sum(coalesce(a.valor_prestadora, p.valor_por_atendimento)), 0) as custo,
              coalesce(sum(a.valor) filter (where a.valor is not null and coalesce(a.valor_prestadora, p.valor_por_atendimento) is not null), 0) as receita_completa,
              coalesce(sum(coalesce(a.valor_prestadora, p.valor_por_atendimento)) filter (where a.valor is not null and coalesce(a.valor_prestadora, p.valor_por_atendimento) is not null), 0) as custo_completo
       from atendimentos a left join prestadoras p on p.id = a.prestadora_id
       where a.unidade_id = any($1::uuid[]) and a.status = 'concluido' and a.data_atendimento >= $2::date and a.data_atendimento < $3::date
       group by 1 order by 1`, [ids, inicioEvolucao, fimEvolucao]).then(r => r.rows),
  ]);
  res.json({
    ...cabecalho(req.rel),
    ...R.relatorioFinanceiro(linhas, { periodo, hoje: req.rel.hoje, anteriores, evolucao, unidades: req.rel.unidades }),
  });
}));

// ---------- Satisfação ----------
// O período é o do SERVIÇO: entram as avaliações dos atendimentos feitos no período (aprovadas, pendentes e recusadas — a
// moderação é da franquia; só as aprovadas entram nas médias).
const SQL_AVALIACOES = `
  select av.id, av.nota, av.status::text as status, av.comentario, a.data_atendimento::text as dia, a.unidade_id,
         av.prestadora_id, p.nome as prestadora_nome, av.cliente_id, c.nome as cliente_nome, a.tipo_servico,
         extract(epoch from (av.criado_em - ((case when a.hora_atendimento is null then (a.data_atendimento + 1)::timestamp
           else a.data_atendimento + a.hora_atendimento + coalesce(a.duracao_horas, 1)::float8 * interval '1 hour' end) at time zone 'America/Sao_Paulo'))) / 3600 as horas_ate_avaliar,
         extract(epoch from (av.moderado_em - av.criado_em)) / 3600 as horas_moderacao
  from avaliacoes av
  join atendimentos a on a.id = av.atendimento_id
  join prestadoras p on p.id = av.prestadora_id
  join clientes c on c.id = av.cliente_id
  where a.unidade_id = any($1::uuid[]) and a.data_atendimento between $2::date and $3::date`;
const avaliacoesDe = async (ids, de, ate) => (await pool.query(SQL_AVALIACOES, [ids, de, ate])).rows.map(r => ({
  ...r,
  horas_ate_avaliar: r.horas_ate_avaliar === null ? null : Number(r.horas_ate_avaliar),
  horas_moderacao: r.horas_moderacao === null ? null : Number(r.horas_moderacao),
}));

router.get('/:slug/satisfacao', ...guarda, asyncHandler(async (req, res) => {
  const { ids, periodo } = req.rel;
  const [avaliacoes, anteriores, linhas, recusas, prestadoras] = await Promise.all([
    avaliacoesDe(ids, periodo.de, periodo.ate),
    avaliacoesDe(ids, periodo.anterior.de, periodo.anterior.ate),
    linhasDe(ids, periodo.de, periodo.ate),
    recusasDe(ids, periodo.de, periodo.ate),
    prestadorasDe(ids),
  ]);
  res.json({
    ...cabecalho(req.rel),
    ...R.relatorioSatisfacao(avaliacoes, { periodo, hoje: req.rel.hoje, linhas, anteriores, recusas, prestadoras, unidades: req.rel.unidades }),
  });
}));

module.exports = router;
