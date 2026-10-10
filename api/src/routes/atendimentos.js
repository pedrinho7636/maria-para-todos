const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth, requireRole, requireAcessoUnidade, requirePrimeiroAcessoConcluido } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { lerAtendimentos, normalizarTexto } = require('../utils/importarPlanilha');
const { garantirPrestadoras, SENHA_PADRAO } = require('../utils/prestadorasImportadas');
const { gerarOcorrencias } = require('../utils/recorrencia');
const { gerarModeloImportacao } = require('../utils/modeloPlanilha');
const { STATUS_QUE_OCUPAM, STATUS_CONFIRMADOS, SQL_CONFLITOS_JSON, conflitosDoHorario, conflitosDosAtendimentos, descreverConflito } = require('../utils/conflitos');
const { avisarCancelamento } = require('../utils/avisos');

const router = express.Router();

const dataBR = (d) => String(d).slice(0, 10).split('-').reverse().join('/');

// Antes de ATRIBUIR um atendimento a uma prestadora (convite novo, troca de prestadora, "programado" manual):
//  • ela já RECUSOU esse atendimento antes? (o registro fica ligado ao atendimento; o administrador é avisado pra não
//    mandar o mesmo convite de novo pra quem já disse não)
//  • ela já tem outro atendimento que se sobrepõe a esse horário?
// Nos dois casos o administrador pode seguir mesmo assim: a tela pergunta e reenvia com forcar_recusa / forcar_conflito.
// Devolve null (pode seguir) ou { status, json } pronto pra responder.
async function checarAtribuicao(db, { prestadoraId, atendimento, body = {} }) {
  if (!prestadoraId) return null;
  const { rows: [p] } = await db.query('select nome from prestadoras where id = $1', [prestadoraId]);
  const nome = p?.nome || 'A prestadora';
  if (!body.forcar_recusa && atendimento.id) {
    const { rows: [r] } = await db.query(
      'select recusado_em from recusas_atendimento where atendimento_id = $1 and prestadora_id = $2 order by recusado_em desc limit 1',
      [atendimento.id, prestadoraId]);
    if (r) {
      return { status: 409, json: {
        codigo: 'JA_RECUSOU', recusado_em: r.recusado_em,
        erro: `${nome} já recusou este atendimento em ${r.recusado_em.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Enviar de novo mesmo assim?`,
      } };
    }
  }
  if (!body.forcar_conflito) {
    const conflitos = await conflitosDoHorario(db, {
      prestadoraId, data: atendimento.data, hora: atendimento.hora, duracao: atendimento.duracao_horas ?? null,
      excluirId: atendimento.id || null, statuses: STATUS_QUE_OCUPAM,
    });
    if (conflitos.length) {
      return { status: 409, json: {
        codigo: 'CONFLITO_HORARIO', conflitos,
        erro: `${nome} já tem atendimento nesse horário: ${conflitos.slice(0, 3).map(descreverConflito).join('; ')}${conflitos.length > 3 ? '…' : ''}. Atribuir mesmo assim?`,
      } };
    }
  }
  return null;
}

// Dados do atendimento no formato que checarAtribuicao espera (data como texto, hora HH:MM)
async function lerParaChecar(db, id, unidadeId) {
  const { rows: [a] } = await db.query(
    `select id, status, prestadora_id, data_atendimento::text as data, to_char(hora_atendimento, 'HH24:MI') as hora, duracao_horas::float8 as duracao_horas
     from atendimentos where id = $1 and unidade_id = $2`, [id, unidadeId]);
  return a || null;
}

// Acha um cliente da unidade pelo nome (sem diferenciar acento/maiúscula) ou cria
// um novo, sem login — mesmo tipo de cadastro avulso que o pedido público gera.
async function acharOuCriarCliente(db, unidadeId, nome, telefone) {
  const alvo = normalizarTexto(nome);
  const { rows } = await db.query('select id, nome from clientes where unidade_id = $1', [unidadeId]);
  const achado = rows.find(c => normalizarTexto(c.nome) === alvo);
  if (achado) return achado.id;
  const { rows: [novo] } = await db.query(
    'insert into clientes (nome, telefone, unidade_id) values ($1, $2, $3) returning id',
    [nome, telefone || null, unidadeId]
  );
  return novo.id;
}

// Rota pública, sem autenticação — sem limite, qualquer IP podia inundar a
// agenda de uma unidade com "pedidos" (e é também o vetor do XSS de 1.2).
const limitePedidoPublico = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// Confere que um id de prestadora/cliente pertence de fato à unidade que o
// admin está operando — sem isso, um admin (ou sub-admin) que soubesse/
// adivinhasse o UUID de uma prestadora de OUTRA unidade conseguiria atribuí-la
// a um atendimento que não é dela, quebrando silenciosamente as views por unidade.
async function pertenceAUnidade(tabela, id, unidadeId) {
  const { rows: [row] } = await pool.query(
    `select id from ${tabela} where id = $1 and unidade_id = $2`,
    [id, unidadeId]
  );
  return !!row;
}

// Anexa ao atendimento o quanto a prestadora recebe por ele (valor_pago): o valor
// travado no aceite ou, antes disso, a tarifa atual dela. O aviso de WhatsApp pra
// prestadora usa isso — ela nunca vê o preço cobrado do cliente (atendimentos.valor).
async function comValorPago(atendimento) {
  if (!atendimento || !atendimento.prestadora_id) return atendimento;
  const { rows: [p] } = await pool.query('select valor_por_atendimento from prestadoras where id = $1', [atendimento.prestadora_id]);
  const valor = atendimento.valor_prestadora ?? p?.valor_por_atendimento ?? null;
  return { ...atendimento, valor_pago: valor === null ? null : Number(valor) };
}

// Pedido de orçamento pela home — público, entra como 'pedido' na agenda da unidade
router.post('/', limitePedidoPublico, asyncHandler(async (req, res) => {
  const { unidade_slug, tipo_servico, area, data_atendimento, hora_atendimento, origem, cliente_nome, cliente_telefone } = req.body;
  if (!unidade_slug || !tipo_servico || !data_atendimento) {
    return res.status(400).json({ erro: 'unidade_slug, tipo_servico e data_atendimento são obrigatórios' });
  }
  const nomePedido = String(cliente_nome ?? '').trim().slice(0, 120);
  const telefonePedido = String(cliente_telefone ?? '').trim().slice(0, 30);
  // Rota pública, sem autenticação — limite de tamanho reduz a superfície de
  // abuso em campos de texto livre (também escapados no frontend antes de exibir).
  if (tipo_servico.length > 200 || (area && area.length > 500)) {
    return res.status(400).json({ erro: 'tipo_servico ou area excede o tamanho máximo permitido' });
  }

  const { rows: [unidade] } = await pool.query('select id from unidades where slug = $1', [unidade_slug]);
  if (!unidade) return res.status(400).json({ erro: 'Unidade não encontrada' });

  // Quem pediu entra como cliente avulso (sem login) da unidade — antes o nome e o telefone digitados no
  // site se perdiam e a unidade não tinha como retornar. Reaproveita o cliente de mesmo nome.
  const clienteId = nomePedido ? await acharOuCriarCliente(pool, unidade.id, nomePedido, telefonePedido) : null;
  const { rows: [atendimento] } = await pool.query(
    `insert into atendimentos (unidade_id, cliente_id, tipo_servico, area, data_atendimento, hora_atendimento, origem, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'pedido') returning *`,
    [unidade.id, clienteId, tipo_servico, area || null, data_atendimento, hora_atendimento || null, origem === 'whatsapp' ? 'whatsapp' : 'site']
  );
  res.status(201).json(atendimento);
}));

// Agenda de um dia da unidade — admin (?data=YYYY-MM-DD, default hoje).
// Cancelados NÃO entram nas contagens (só programado e concluído contam): por padrão ficam de fora;
// a tela da agenda pede ?incluir_cancelados=1 pra mostrá-los (riscados) e poder reativá-los.
router.get('/admin/:slug/agenda', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { data } = req.query;
  const comCancelados = req.query.incluir_cancelados === '1';
  const { rows } = await pool.query(
    `select a.*, p.nome as prestadora_nome, c.nome as cliente_nome,
            -- quem já recusou este atendimento (continua valendo mesmo depois de passar pra outra prestadora)
            (select coalesce(json_agg(json_build_object('prestadora_id', r.prestadora_id, 'nome', pr.nome, 'em', r.recusado_em) order by r.recusado_em), '[]'::json)
               from recusas_atendimento r join prestadoras pr on pr.id = r.prestadora_id where r.atendimento_id = a.id) as recusas
     from atendimentos a
     left join prestadoras p on p.id = a.prestadora_id
     left join clientes c on c.id = a.cliente_id
     where a.unidade_id = $1 and a.data_atendimento = coalesce($2::date, (now() at time zone 'America/Sao_Paulo')::date)
       and ($3::boolean or a.status <> 'cancelado')
     order by a.hora_atendimento nulls last`,
    [req.unidadeId, data || null, comCancelados]
  );
  res.json(rows);
}));

// Situação do atendimento na agenda: PROGRAMADO, CONCLUÍDO ou CANCELADO. Só os programados e os
// concluídos entram nas contagens (dashboard, calendário, equipe, financeiro); o cancelado fica
// registrado, mas fora de tudo — e dá pra voltar atrás.
//  • concluido: vira concluído (e trava a tarifa da prestadora, se houver, como no aceite)
//  • cancelado: vira cancelado (mantém prestadora e valores, só sai das contas)
//  • programado: volta a ser um atendimento por acontecer — "aceito" se já tem prestadora (é o
//    administrador afirmando que está combinado), senão "pedido". Marca situacao_manual: se a data
//    já passou, a conclusão automática NÃO o conclui de novo.
router.post('/admin/:slug/:id/situacao', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { situacao } = req.body;
  if (!['programado', 'concluido', 'cancelado'].includes(situacao)) {
    return res.status(400).json({ erro: 'situacao deve ser programado, concluido ou cancelado' });
  }
  const atual = await lerParaChecar(pool, req.params.id, req.unidadeId);
  if (!atual) return res.status(404).json({ erro: 'Atendimento não encontrado' });

  // voltar a "programado" com prestadora vira "aceito": ela passa a ter esse horário ocupado — avisa se conflita
  if (situacao === 'programado' && atual.prestadora_id && atual.status !== 'aceito') {
    const bloqueio = await checarAtribuicao(pool, { prestadoraId: atual.prestadora_id, atendimento: atual, body: { ...req.body, forcar_recusa: true } });
    if (bloqueio) return res.status(bloqueio.status).json(bloqueio.json);
  }

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos a set
       status = case $1::text when 'concluido' then 'concluido'::status_atendimento
                              when 'cancelado' then 'cancelado'::status_atendimento
                              else case when a.prestadora_id is not null then 'aceito'::status_atendimento else 'pedido'::status_atendimento end end,
       valor_prestadora = case when $1::text in ('concluido', 'programado') and a.prestadora_id is not null
                               then coalesce(a.valor_prestadora, (select p.valor_por_atendimento from prestadoras p where p.id = a.prestadora_id))
                               else a.valor_prestadora end,
       situacao_manual = ($1::text = 'programado'),
       atualizado_em = now()
     where a.id = $2 and a.unidade_id = $3
     returning *`,
    [situacao, req.params.id, req.unidadeId]
  );
  // cancelado pelo administrador: a prestadora responsável recebe um aviso no portal (e some da agenda dela)
  let avisada = false;
  if (situacao === 'cancelado' && atual.status !== 'cancelado' && atual.prestadora_id) {
    avisada = (await avisarCancelamento(pool, [atendimento.id])) > 0;
  }
  res.json({ ...atendimento, prestadora_avisada: avisada });
}));

// Lista enxuta de prestadoras ativas da unidade — liberada por 'agenda' (não por
// 'equipe'), já que atribuir/reatribuir prestadora é uma operação de agenda.
router.get('/admin/:slug/prestadoras', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'select id, nome, telefone from prestadoras where unidade_id = $1 and ativa = true order by nome',
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
  if (!await pertenceAUnidade('prestadoras', prestadora_id, req.unidadeId)) {
    return res.status(400).json({ erro: 'prestadora_id não pertence a esta unidade' });
  }
  const paraChecar = await lerParaChecar(pool, req.params.id, req.unidadeId);
  const bloqueio = paraChecar && await checarAtribuicao(pool, { prestadoraId: prestadora_id, atendimento: paraChecar, body: req.body });
  if (bloqueio) return res.status(bloqueio.status).json(bloqueio.json);

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set prestadora_id = $1, status = 'proposto', profissional_externo = null, valor_prestadora = null, atualizado_em = now()
     where id = $2 and unidade_id = $3 and status = 'pedido'
     returning *`,
    [prestadora_id, req.params.id, req.unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou não está em status "pedido"' });
  res.json(await comValorPago(atendimento));
}));

// Reatribui (ou remove) a prestadora de um atendimento em qualquer status não-terminal.
// Generaliza /propor, que só funcionava a partir de 'pedido'.
router.post('/admin/:slug/:id/reatribuir', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const prestadoraId = req.body.prestadora_id || null;
  if (prestadoraId && !await pertenceAUnidade('prestadoras', prestadoraId, req.unidadeId)) {
    return res.status(400).json({ erro: 'prestadora_id não pertence a esta unidade' });
  }
  // trocar pra OUTRA prestadora (ou convidar uma nova): avisa se ela já recusou este atendimento ou se tem horário em conflito
  if (prestadoraId) {
    const paraChecar = await lerParaChecar(pool, req.params.id, req.unidadeId);
    if (paraChecar && !['concluido', 'cancelado'].includes(paraChecar.status) && paraChecar.prestadora_id !== prestadoraId) {
      const bloqueio = await checarAtribuicao(pool, { prestadoraId, atendimento: paraChecar, body: req.body });
      if (bloqueio) return res.status(bloqueio.status).json(bloqueio.json);
    }
  }

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set
       prestadora_id = $1::uuid,
       status = case when status in ('pedido', 'recusado') and $1::uuid is not null then 'proposto' else status end,
       profissional_externo = case when $1::uuid is not null then null else profissional_externo end,
       -- quem já estava aceito continua aceito com a nova prestadora: trava a tarifa dela
       valor_prestadora = case when status = 'aceito' then (select valor_por_atendimento from prestadoras where id = $1::uuid) else null end,
       atualizado_em = now()
     where id = $2 and unidade_id = $3 and status not in ('concluido', 'cancelado')
     returning *`,
    [prestadoraId, req.params.id, req.unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou já concluído/cancelado' });
  res.json(await comValorPago(atendimento));
}));

// Local do atendimento (bairro/endereço) — o admin corrige ou preenche; vazio
// apaga o campo (nas telas, atendimento sem local simplesmente não mostra a linha).
router.patch('/admin/:slug/:id/local', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const local = String(req.body.area ?? '').trim();
  if (local.length > 500) return res.status(400).json({ erro: 'O local excede 500 caracteres' });

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set area = $1, atualizado_em = now()
     where id = $2 and unidade_id = $3 and status <> 'cancelado'
     returning *`,
    [local || null, req.params.id, req.unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou cancelado' });
  res.json(atendimento);
}));

// Valor cobrado do cliente por este atendimento. Vazio remove. (Atendimento de uma série
// recorrente ganha o valor dividido na criação; aqui dá pra ajustar um deles à mão.)
router.patch('/admin/:slug/:id/valor', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const bruto = req.body.valor;
  let valor = null;
  if (bruto !== null && bruto !== undefined && String(bruto).trim() !== '') {
    valor = Number(String(bruto).trim().replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0 || valor >= 1e8) return res.status(400).json({ erro: 'Valor inválido' });
    valor = Math.round(valor * 100) / 100;
  }

  const { rows: [atendimento] } = await pool.query(
    `update atendimentos set valor = $1, atualizado_em = now()
     where id = $2 and unidade_id = $3 and status <> 'cancelado'
     returning *`,
    [valor, req.params.id, req.unidadeId]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Atendimento não encontrado ou cancelado' });
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

// Cadastro de UM atendimento pelo painel (avulso). Com prestadora já nasce como
// 'proposto' (convite); sem ela, 'pedido'. O cliente pode ser um já cadastrado
// (cliente_id) ou um novo, informado só pelo nome/telefone (cliente_novo).
router.post('/admin/:slug', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { tipo_servico, area, data_atendimento, hora_atendimento, duracao_horas, valor, cliente_id, cliente_novo, prestadora_id } = req.body;

  const servico = String(tipo_servico ?? '').trim();
  if (!servico) return res.status(400).json({ erro: 'Informe o serviço' });
  if (servico.length > 200 || (area && String(area).length > 500)) {
    return res.status(400).json({ erro: 'Serviço ou local excede o tamanho máximo permitido' });
  }

  const dataStr = String(data_atendimento ?? '');
  const dt = new Date(dataStr + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr) || Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== dataStr) {
    return res.status(400).json({ erro: 'Data inválida' });
  }
  if (dt.getUTCDay() === 0) return res.status(400).json({ erro: 'Domingo não está disponível pra agenda' });

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora_atendimento ?? ''))) {
    return res.status(400).json({ erro: 'Informe o horário (HH:MM)' });
  }

  let duracao = null;
  if (duracao_horas !== undefined && duracao_horas !== null && duracao_horas !== '') {
    duracao = Number(duracao_horas);
    if (!Number.isFinite(duracao) || duracao < 0.5 || duracao > 24) {
      return res.status(400).json({ erro: 'Duração deve estar entre 0,5 e 24 horas' });
    }
  }
  let valorNum = null;
  if (valor !== undefined && valor !== null && valor !== '') {
    valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum < 0 || valorNum >= 1e8) return res.status(400).json({ erro: 'Valor inválido' });
  }

  if (prestadora_id && !await pertenceAUnidade('prestadoras', prestadora_id, req.unidadeId)) {
    return res.status(400).json({ erro: 'prestadora_id não pertence a esta unidade' });
  }
  if (cliente_id && !await pertenceAUnidade('clientes', cliente_id, req.unidadeId)) {
    return res.status(400).json({ erro: 'cliente_id não pertence a esta unidade' });
  }
  const nomeNovo = String(cliente_novo?.nome ?? '').trim().slice(0, 200);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let clienteId = cliente_id || null;
    if (!clienteId && nomeNovo) {
      clienteId = await acharOuCriarCliente(client, req.unidadeId, nomeNovo, String(cliente_novo?.telefone ?? '').trim().slice(0, 50));
    }
    const { rows: [atendimento] } = await client.query(
      `insert into atendimentos
         (unidade_id, cliente_id, prestadora_id, tipo_servico, area, data_atendimento, hora_atendimento,
          duracao_horas, valor, status, origem)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
       returning *`,
      [req.unidadeId, clienteId, prestadora_id || null, servico, area ? String(area).trim() : null, dataStr,
       hora_atendimento, duracao, valorNum, prestadora_id ? 'proposto' : 'pedido']
    );
    // convite pra uma prestadora que já tem outro atendimento nesse horário: avisa (o administrador pode confirmar mesmo assim)
    if (prestadora_id && !req.body.forcar_conflito) {
      const conflitos = await conflitosDosAtendimentos(client, [atendimento.id]);
      if (conflitos.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          codigo: 'CONFLITO_HORARIO', conflitos,
          erro: `Essa prestadora já tem atendimento nesse horário: ${conflitos.slice(0, 3).map(descreverConflito).join('; ')}${conflitos.length > 3 ? '…' : ''}. Atribuir mesmo assim?`,
        });
      }
    }
    await client.query('COMMIT');
    res.status(201).json(await comValorPago(atendimento));
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}));

// Modelo (.xlsx) da planilha de importação: colunas, linhas de exemplo e uma aba explicando cada campo.
router.get('/admin/:slug/modelo-importacao', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const buffer = await gerarModeloImportacao();
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="modelo-importacao-atendimentos.xlsx"',
  });
  res.send(Buffer.from(buffer));
}));

// Importa a planilha de atendimentos (.xlsx do sistema da franquia, enviada em
// base64). A coluna "Número" é a chave: o que já foi importado antes é ignorado,
// então dá pra importar o mesmo arquivo (ou um export mais novo) quantas vezes
// quiser e só entra o que for novo. Sem `confirmar: true` NADA é gravado — só
// devolve o resumo do que entraria (pré-visualização).
router.post('/admin/:slug/importar', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { arquivo_base64: base64, confirmar } = req.body;
  if (typeof base64 !== 'string' || !base64) return res.status(400).json({ erro: 'Envie o arquivo da planilha' });

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 6 * 1024 * 1024) return res.status(400).json({ erro: 'Arquivo muito grande (máximo 6MB)' });
  if (buffer.subarray(0, 2).toString('latin1') !== 'PK') { // .xlsx é um zip
    return res.status(400).json({ erro: 'Esse arquivo não parece ser uma planilha .xlsx' });
  }

  let lido;
  try {
    lido = await lerAtendimentos(buffer);
  } catch (erro) {
    return res.status(400).json({ erro: erro.message });
  }

  const { rows: jaImportados } = await pool.query(
    'select codigo_externo from atendimentos where unidade_id = $1 and codigo_externo = any($2::text[])',
    [req.unidadeId, lido.linhas.map(l => l.codigo)]
  );
  const jaTem = new Set(jaImportados.map(r => r.codigo_externo));
  const novas = lido.linhas.filter(l => !jaTem.has(l.codigo));

  const { rows: prestadoras } = await pool.query('select id, nome, valor_por_atendimento from prestadoras where unidade_id = $1', [req.unidadeId]);
  const idPrestadora = new Map(prestadoras.map(p => [normalizarTexto(p.nome), p.id]));
  const tarifaPrestadora = new Map(prestadoras.map(p => [p.id, p.valor_por_atendimento]));
  const { rows: clientes } = await pool.query('select id, nome from clientes where unidade_id = $1', [req.unidadeId]);
  const idCliente = new Map(clientes.map(c => [normalizarTexto(c.nome), c.id]));

  const semCadastro = new Map();
  const clientesNovos = new Set();
  for (const l of novas) {
    if (l.profissional && !idPrestadora.has(normalizarTexto(l.profissional))) {
      semCadastro.set(l.profissional, (semCadastro.get(l.profissional) || 0) + 1);
    }
    const chave = normalizarTexto(l.cliente.nome);
    if (chave && !idCliente.has(chave)) clientesNovos.add(chave);
  }
  const datas = novas.map(l => l.data).sort();
  const resumo = {
    linhas_lidas: lido.totalLidas,
    novas: novas.length,
    ja_existentes: lido.linhas.length - novas.length,
    repetidas_no_arquivo: lido.repetidasNoArquivo,
    invalidas: lido.invalidos.length,
    invalidas_detalhe: lido.invalidos.slice(0, 20),
    clientes_novos: clientesNovos.size,
    // profissionais que ainda não são prestadoras: a confirmação cria a conta de cada uma
    // (e-mail nome@gmail.com, senha padrão) e já liga os atendimentos a ela
    profissionais_sem_cadastro: [...semCadastro].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd),
    senha_padrao: SENHA_PADRAO,
    com_valor: novas.filter(l => l.valor !== null).length,   // linhas novas que trouxeram Valor / Custo
    com_custo: novas.filter(l => l.custo !== null).length,
    periodo: datas.length ? { de: datas[0], ate: datas[datas.length - 1] } : null,
  };

  if (confirmar !== true) return res.json({ confirmado: false, resumo });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // cria (na mesma transação) as prestadoras que a planilha cita e ainda não existem
    const { ids: idsPrestadoras, criadas } = await garantirPrestadoras(
      client, req.unidadeId, [...new Set(novas.map(l => l.profissional).filter(Boolean))]
    );
    for (const [chave, id] of idsPrestadoras) idPrestadora.set(chave, id);
    let importados = 0;
    for (const l of novas) {
      let clienteId = null;
      const chaveCliente = normalizarTexto(l.cliente.nome);
      if (chaveCliente) {
        clienteId = idCliente.get(chaveCliente);
        if (!clienteId) {
          const { rows: [novo] } = await client.query(
            'insert into clientes (nome, telefone, unidade_id) values ($1, $2, $3) returning id',
            [l.cliente.nome, l.cliente.telefone, req.unidadeId]
          );
          clienteId = novo.id;
          idCliente.set(chaveCliente, clienteId);
        }
      }
      const prestadoraId = l.profissional ? idPrestadora.get(normalizarTexto(l.profissional)) || null : null;
      // "Previsto" ainda vai acontecer: com prestadora conhecida vira convite (ela
      // confirma pelo portal, na janela de 2 dias); sem, fica aguardando atribuição.
      const status = l.situacao === 'previsto' ? (prestadoraId ? 'proposto' : 'pedido') : l.situacao;
      // ON CONFLICT cobre duas importações simultâneas do mesmo arquivo: a segunda não duplica.
      const r = await client.query(
        `insert into atendimentos
           (unidade_id, cliente_id, prestadora_id, tipo_servico, data_atendimento, hora_atendimento, duracao_horas,
            status, origem, codigo_externo, orcamento_externo, profissional_externo, valor_prestadora, valor)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'importacao', $9, $10, $11, $12, $13)
         on conflict (unidade_id, codigo_externo) where codigo_externo is not null do nothing`,
        [req.unidadeId, clienteId, prestadoraId, l.tipo_servico, l.data, l.hora, l.duracao_horas, status,
         l.codigo, l.orcamento, l.profissional && !prestadoraId ? l.profissional : null,
         // custo vindo na planilha vale como o repasse combinado; sem ele, já realizado/aceito trava a
         // tarifa de hoje e ainda não aceito fica nulo até o aceite
         prestadoraId && l.custo !== null ? l.custo
           : prestadoraId && (status === 'concluido' || status === 'aceito') ? tarifaPrestadora.get(prestadoraId) ?? null : null,
         l.valor]
      );
      importados += r.rowCount;
    }
    await client.query('COMMIT');
    res.json({
      confirmado: true, importados, ja_existentes: lido.linhas.length - importados, resumo,
      prestadoras_criadas: criadas.map(({ nome, email }) => ({ nome, email })),
    });
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}));

// Cria uma recorrência por "semana-modelo": o admin monta uma ou mais entradas
// (dia da semana + horário + serviço, cada uma com prestadora/cliente opcionais)
// e o sistema repete esse padrão semana a semana (ou intercalado, semana sim/
// semana não) até o horizonte, gerando todas as linhas concretas de uma vez —
// sem tabela de regra, mesmo princípio de antes, só que agora com várias
// entradas por semana em vez de uma só.
router.post('/admin/:slug/recorrente', requireAuth, requireAcessoUnidade('agenda'), asyncHandler(async (req, res) => {
  const { data_inicio, horizonte_meses, semanas_alternadas, itens, valor_mensal_total, cliente_novo } = req.body;

  if (!data_inicio || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'data_inicio e itens (ao menos um) são obrigatórios' });
  }
  // valor do MÊS da série inteira (todos os dias da semana juntos): dividido entre todas as ocorrências do mês
  let valorMensalTotal = null;
  if (valor_mensal_total !== undefined && valor_mensal_total !== null && String(valor_mensal_total).trim() !== '') {
    valorMensalTotal = Number(String(valor_mensal_total).replace(',', '.'));
    if (!Number.isFinite(valorMensalTotal) || valorMensalTotal < 0 || valorMensalTotal >= 1e8) return res.status(400).json({ erro: 'Valor do mês inválido' });
    valorMensalTotal = Math.round(valorMensalTotal * 100) / 100;
  }
  const nomeNovo = String(cliente_novo?.nome ?? '').trim().slice(0, 200);
  for (const item of itens) {
    // duração do atendimento (opcional); sem ela a agenda mostra um bloco de 1 hora
    if (item.duracao_horas === undefined || item.duracao_horas === null || item.duracao_horas === '') item.duracao_horas = null;
    else {
      item.duracao_horas = Number(item.duracao_horas);
      if (!Number.isFinite(item.duracao_horas) || item.duracao_horas < 0.5 || item.duracao_horas > 24) {
        return res.status(400).json({ erro: 'Duração deve estar entre 0,5 e 24 horas' });
      }
    }
    const dia = Number(item.dia_semana);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6 || !item.hora_atendimento || !item.tipo_servico) {
      return res.status(400).json({ erro: 'cada item precisa de dia_semana (0-6), hora_atendimento e tipo_servico' });
    }
    if (item.prestadora_id && !await pertenceAUnidade('prestadoras', item.prestadora_id, req.unidadeId)) {
      return res.status(400).json({ erro: 'prestadora_id de um dos itens não pertence a esta unidade' });
    }
    if (item.cliente_id && !await pertenceAUnidade('clientes', item.cliente_id, req.unidadeId)) {
      return res.status(400).json({ erro: 'cliente_id de um dos itens não pertence a esta unidade' });
    }
    // valor do MÊS inteiro desse item (opcional); cada ocorrência recebe a parte dela
    if (item.valor_mensal === undefined || item.valor_mensal === null || String(item.valor_mensal).trim() === '') {
      item.valor_mensal = null;
    } else {
      const v = Number(String(item.valor_mensal).replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || v >= 1e8) return res.status(400).json({ erro: 'Valor do mês inválido em um dos itens' });
      item.valor_mensal = Math.round(v * 100) / 100;
    }
  }

  // trava de segurança contra input absurdo: até 200 ocorrências por série
  let linhas;
  try {
    linhas = gerarOcorrencias({
      dataInicio: data_inicio, horizonteMeses: horizonte_meses, alternadas: !!semanas_alternadas,
      itens: itens.map(i => ({ dia_semana: Number(i.dia_semana), valor_mensal: i.valor_mensal })),
      valorMensalTotal,
    });
  } catch (erro) {
    return res.status(400).json({ erro: erro.message });
  }
  if (linhas.length === 0) return res.status(400).json({ erro: 'Nenhuma ocorrência gerada nesse período' });

  const serieId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // cliente novo da série (sem cadastro ainda): criado/achado UMA vez e usado nos itens sem cliente próprio
    const clienteNovoId = nomeNovo ? await acharOuCriarCliente(client, req.unidadeId, nomeNovo, String(cliente_novo?.telefone ?? '').trim().slice(0, 50)) : null;
    const inseridos = [];
    for (const { data, item: indice, valor, valor_mensal: valorMensal } of linhas) {
      const item = itens[indice];
      const status = item.prestadora_id ? 'proposto' : 'pedido';
      const { rows: [linha] } = await client.query(
        `insert into atendimentos
           (unidade_id, cliente_id, prestadora_id, tipo_servico, area, data_atendimento,
            hora_atendimento, duracao_horas, valor, valor_mensal, status, origem, serie_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12)
         returning *`,
        [req.unidadeId, item.cliente_id || clienteNovoId || null, item.prestadora_id || null, item.tipo_servico, item.area || null,
         data, item.hora_atendimento, item.duracao_horas, valor, valorMensal, status, serieId]
      );
      inseridos.push(linha);
    }
    // série com prestadora: confere se alguma ocorrência cai num horário em que ela já tem outro atendimento
    // (inclusive entre as da própria série); o administrador pode confirmar mesmo assim (forcar_conflito)
    if (!req.body.forcar_conflito) {
      const conflitos = await conflitosDosAtendimentos(client, inseridos.filter(i => i.prestadora_id).map(i => i.id));
      if (conflitos.length) {
        await client.query('ROLLBACK');
        const afetados = new Set(conflitos.map(c => c.atendimento_id)).size;
        return res.status(409).json({
          codigo: 'CONFLITO_HORARIO', conflitos: conflitos.slice(0, 10), atendimentos_em_conflito: afetados,
          erro: `${afetados === 1 ? '1 atendimento da série cai' : afetados + ' atendimentos da série caem'} num horário em que a prestadora já tem outro serviço (ex.: ${descreverConflito(conflitos[0])}). Criar mesmo assim?`,
        });
      }
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
     where serie_id = $1 and unidade_id = $2 and data_atendimento >= (now() at time zone 'America/Sao_Paulo')::date
       and status not in ('concluido', 'cancelado')
     returning id`,
    [req.params.serieId, req.unidadeId]
  );
  // cada prestadora que tinha ocorrências da série é avisada de cada cancelamento
  const avisadas = await avisarCancelamento(pool, rows.map(r => r.id));
  res.json({ cancelados: rows.length, avisos_enviados: avisadas });
}));

// A prestadora enxerga só o que a FRANQUIA paga a ela por atendimento (valor_pago),
// nunca o preço cobrado do cliente. Já aceito: o valor travado no aceite; ainda
// convite (ou aceito antes da tarifa existir): a tarifa atual dela.
// Além disso cada linha traz o cliente, o horário de término e os `conflitos`: outros atendimentos DELA que se
// sobrepõem a este (a tela marca em vermelho — e o aceite é barrado quando o conflito é com um já confirmado).
const COLUNAS_PRESTADORA = `a.id, a.tipo_servico, a.area, a.data_atendimento, a.hora_atendimento, a.duracao_horas, a.status,
  to_char(a.hora_atendimento + (coalesce(a.duracao_horas, 1)::float8 * interval '1 hour'), 'HH24:MI') as hora_fim,
  a.data_atendimento::text as dia, cl.nome as cliente_nome,
  coalesce(a.valor_prestadora, p.valor_por_atendimento) as valor_pago,
  ${SQL_CONFLITOS_JSON('a')} as conflitos`;
const DE_PRESTADORA = `from atendimentos a join prestadoras p on p.id = a.prestadora_id left join clientes cl on cl.id = a.cliente_id`;

// Convites pendentes de aceite pela prestadora logada
router.get('/prestadora/me/convites', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select ${COLUNAS_PRESTADORA} ${DE_PRESTADORA}
     where a.prestadora_id = $1 and a.status = 'proposto' order by a.data_atendimento, a.hora_atendimento`,
    [req.user.id]
  );
  res.json(rows);
}));

// Agenda já aceita pela prestadora logada
router.get('/prestadora/me/agenda', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select ${COLUNAS_PRESTADORA} ${DE_PRESTADORA}
     where a.prestadora_id = $1 and a.status = 'aceito' order by a.data_atendimento, a.hora_atendimento`,
    [req.user.id]
  );
  res.json(rows);
}));

// Calendário da prestadora: TUDO que é dela no mês (convites, confirmados, concluídos e cancelados), com cliente,
// início/término, serviço, status e conflitos. Só enxerga os atendimentos ligados a ela (prestadora_id = quem está logada).
router.get('/prestadora/me/calendario', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  const mes = String(req.query.mes ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ erro: 'mes inválido — use AAAA-MM' });
  const { rows } = await pool.query(
    `select ${COLUNAS_PRESTADORA} ${DE_PRESTADORA}
     where a.prestadora_id = $1 and a.status in ('proposto', 'aceito', 'concluido', 'cancelado')
       and a.data_atendimento >= ($2 || '-01')::date and a.data_atendimento < (($2 || '-01')::date + interval '1 month')
     order by a.data_atendimento, a.hora_atendimento`,
    [req.user.id, mes]
  );
  res.json(rows);
}));

// Avisos não lidos da prestadora (hoje: cancelamentos feitos pelo administrador)
router.get('/prestadora/me/avisos', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select id, tipo, dados, criado_em from avisos_prestadora where prestadora_id = $1 and lido_em is null order by criado_em desc limit 50`,
    [req.user.id]
  );
  res.json(rows);
}));
router.post('/prestadora/me/avisos/lidas', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query('update avisos_prestadora set lido_em = now() where prestadora_id = $1 and lido_em is null', [req.user.id]);
  res.json({ lidos: rowCount });
}));
router.post('/prestadora/me/avisos/:id/lida', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ erro: 'aviso inválido' });
  const { rowCount } = await pool.query('update avisos_prestadora set lido_em = now() where id = $1 and prestadora_id = $2 and lido_em is null', [req.params.id, req.user.id]);
  res.json({ lidos: rowCount });
}));

// Quanto ela tem a receber: tarifa por atendimento × atendimentos aceitos/concluídos.
// Calculado aqui (e não no navegador) pra semana/mês seguirem o fuso de Brasília
// e a conta ser uma só. "Realizado" = aceito/concluído em data que já passou (ou
// concluído); "previsto" = aceito de hoje em diante. Semana começa no domingo,
// igual ao painel dela.
router.get('/prestadora/me/resumo', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  const { rows: [r] } = await pool.query(
    `with datas as (
       select (now() at time zone 'America/Sao_Paulo')::date as hoje
     ), dados as (
       select a.data_atendimento as dia, a.status, a.repasse_pago_em,
              coalesce(a.valor_prestadora, p.valor_por_atendimento) as valor
       from atendimentos a join prestadoras p on p.id = a.prestadora_id
       where a.prestadora_id = $1 and a.status in ('aceito', 'concluido')
     )
     select
       (select valor_por_atendimento from prestadoras where id = $1) as valor_por_atendimento,
       count(*) filter (where dia >= hoje - extract(dow from hoje)::int and dia < hoje - extract(dow from hoje)::int + 7)::int as semana_qtd,
       coalesce(sum(valor) filter (where dia >= hoje - extract(dow from hoje)::int and dia < hoje - extract(dow from hoje)::int + 7), 0) as semana_total,
       count(*) filter (where date_trunc('month', dia) = date_trunc('month', hoje) and (status = 'concluido' or dia < hoje))::int as mes_realizados_qtd,
       coalesce(sum(valor) filter (where date_trunc('month', dia) = date_trunc('month', hoje) and (status = 'concluido' or dia < hoje)), 0) as mes_realizados_total,
       coalesce(sum(valor) filter (where date_trunc('month', dia) = date_trunc('month', hoje) and repasse_pago_em is not null), 0) as mes_pago_total,
       count(*) filter (where date_trunc('month', dia) = date_trunc('month', hoje) and status = 'aceito' and dia >= hoje)::int as mes_previstos_qtd,
       coalesce(sum(valor) filter (where date_trunc('month', dia) = date_trunc('month', hoje) and status = 'aceito' and dia >= hoje), 0) as mes_previstos_total
     from dados, datas`,
    [req.user.id]
  );
  const n = v => (v === null || v === undefined ? null : Number(v));
  res.json({
    valor_por_atendimento: n(r.valor_por_atendimento),
    semana: { qtd: r.semana_qtd, total: n(r.semana_total) },
    mes: {
      realizados_qtd: r.mes_realizados_qtd, realizados_total: n(r.mes_realizados_total), pago_total: n(r.mes_pago_total),
      previstos_qtd: r.mes_previstos_qtd, previstos_total: n(r.mes_previstos_total),
    },
  });
}));

// Prestadora só pode confirmar (aceitar) um convite a partir de 2 dias antes
// do atendimento — reserva de agenda muito antecipada fica só "aguardando".
router.post('/prestadora/me/:id/aceitar', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  const { rows: [atual] } = await pool.query(
    `select * from atendimentos where id = $1 and prestadora_id = $2 and status = 'proposto'`,
    [req.params.id, req.user.id]
  );
  if (!atual) return res.status(404).json({ erro: 'Convite não encontrado' });

  // toISOString() converte pra UTC — entre ~21h e 23h59 no horário de Brasília
  // (UTC-3) o UTC já virou o dia seguinte, adiantando "hoje" incorretamente.
  // toLocaleDateString com o fuso explícito evita esse bug de virada de dia.
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const dataISO = atual.data_atendimento.toISOString().slice(0, 10);
  const diasRestantes = Math.round((new Date(dataISO) - new Date(hojeISO)) / 86400000);
  if (diasRestantes > 2) {
    return res.status(400).json({ erro: `Só é possível confirmar a partir de 2 dias antes do atendimento (faltam ${diasRestantes} dias)` });
  }

  // uma prestadora não faz dois serviços ao mesmo tempo: não confirma se já tem outro (confirmado ou concluído) sobreposto
  const emConflito = await conflitosDoHorario(pool, {
    prestadoraId: req.user.id, data: dataISO, hora: atual.hora_atendimento ? String(atual.hora_atendimento).slice(0, 5) : null,
    duracao: atual.duracao_horas === null ? null : Number(atual.duracao_horas), excluirId: atual.id, statuses: STATUS_CONFIRMADOS,
  });
  if (emConflito.length) {
    return res.status(409).json({
      codigo: 'CONFLITO_HORARIO', conflitos: emConflito,
      erro: `Você já tem um atendimento confirmado nesse horário (${emConflito.slice(0, 2).map(descreverConflito).join('; ')}). Fale com a unidade para resolver antes de aceitar.`,
    });
  }

  const { rows: [atendimento] } = await pool.query(
    // ao aceitar, trava a tarifa vigente: o que ela viu no convite é o que vale
    `update atendimentos set status = 'aceito', atualizado_em = now(),
       valor_prestadora = (select valor_por_atendimento from prestadoras where id = $2)
     where id = $1 returning id, tipo_servico, area, data_atendimento, hora_atendimento, status, valor_prestadora as valor_pago`,
    [req.params.id, req.user.id]
  );
  res.json(atendimento);
}));

router.post('/prestadora/me/:id/recusar', requireAuth, requireRole('prestadora'), requirePrimeiroAcessoConcluido, asyncHandler(async (req, res) => {
  // a recusa é gravada junto (mesma instrução = tudo ou nada) e fica ligada ao atendimento pra sempre:
  // o administrador vê quem já recusou, mesmo depois de o atendimento passar pra outra prestadora
  const { rows: [atendimento] } = await pool.query(
    `with recusado as (
       update atendimentos set status = 'recusado', prestadora_id = null, valor_prestadora = null, atualizado_em = now()
       where id = $1 and prestadora_id = $2 and status = 'proposto'
       returning id, tipo_servico, area, data_atendimento, hora_atendimento, status
     ), registro as (
       insert into recusas_atendimento (atendimento_id, prestadora_id) select id, $2 from recusado
     )
     select * from recusado`,
    [req.params.id, req.user.id]
  );
  if (!atendimento) return res.status(404).json({ erro: 'Convite não encontrado' });
  res.json(atendimento);
}));

// Os atendimentos do cliente logado, pra ele acompanhar: serviço, data/horário, status e QUEM é a prestadora
// (nome + foto, pra reconhecer a profissional). A prestadora só aparece depois de CONFIRMAR (aceito/concluído):
// enquanto é só um convite ela pode recusar, e o cliente não deve ser levado a contar com ela. A foto vem uma vez por
// prestadora (em `prestadoras`), não repetida em cada atendimento. Cancelamento é pedido pelo WhatsApp e decidido pela
// unidade — nada aqui altera o atendimento.
router.get('/cliente/me/atendimentos', requireAuth, requireRole('cliente'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `select a.id, a.tipo_servico, a.area, a.data_atendimento::text as dia, to_char(a.hora_atendimento, 'HH24:MI') as hora,
            to_char(a.hora_atendimento + (coalesce(a.duracao_horas, 1)::float8 * interval '1 hour'), 'HH24:MI') as hora_fim,
            a.status, upper(left(a.id::text, 8)) as codigo,
            case when a.status in ('aceito', 'concluido') then a.prestadora_id end as prestadora_id
     from atendimentos a
     where a.cliente_id = $1
     order by a.data_atendimento desc, a.hora_atendimento desc nulls last
     limit 300`,
    [req.user.id]
  );
  const ids = [...new Set(rows.map(r => r.prestadora_id).filter(Boolean))];
  const { rows: profissionais } = ids.length
    ? await pool.query('select id, nome, foto from prestadoras where id = any($1::uuid[])', [ids])
    : { rows: [] };
  res.json({
    atendimentos: rows,
    prestadoras: Object.fromEntries(profissionais.map(p => [p.id, { nome: p.nome, foto: p.foto }])),
  });
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
