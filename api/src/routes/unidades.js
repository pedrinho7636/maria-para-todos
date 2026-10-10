const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth, requireRole, requireAcessoUnidade } = require('../middleware/auth');
const { unidadeDoAdmin, unidadesDoAdmin } = require('../utils/permissoes');
const { normalizarCnpj, cnpjValido, formatarCnpj, normalizarEmail, normalizarTelefone } = require('../utils/normalizacao');
const { nomeValido, emailValido, telefoneValido, senhaValida } = require('../utils/validacao');
const { normalizarTexto } = require('../utils/importarPlanilha');
const { ErroNegocio, emTransacao, lerDadosUnidade, criarUnidade, vincularAdmin, cnpjsDoAdmin } = require('../utils/unidades');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Acrescenta uma unidade à EMPRESA do administrador logado (mesmo CNPJ das que ele já tem, por isso o
// mesmo login alterna entre elas). Mesma ação do cadastro de CNPJ já existente, mas estando logado não
// precisa redigitar nome/e-mail/senha. Conta sem CNPJ definido (criada por script) informa o CNPJ aqui.
router.post('/', requireAuth, requireRole('administrador'), asyncHandler(async (req, res) => {
  const lida = lerDadosUnidade(req.body);
  if (lida.erro) return res.status(400).json({ erro: lida.erro });

  try {
    const meus = await cnpjsDoAdmin(pool, req.user.id);
    let cnpj;
    if (meus.length === 0) {
      cnpj = normalizarCnpj(req.body.cnpj);
      if (!cnpjValido(cnpj)) return res.status(400).json({ erro: 'CNPJ inválido — os dígitos verificadores não conferem. Confira o número digitado.' });
      const { rows: donos } = await pool.query(
        `select 1 from unidades u join administrador_unidades au on au.unidade_id = u.id
         where upper(regexp_replace(u.cnpj, '[^0-9A-Za-z]', '', 'g')) = $1 and au.administrador_id <> $2`, [cnpj, req.user.id]);
      if (donos.length > 0) return res.status(409).json({ erro: 'Este CNPJ já pertence a outra conta.' });
    } else {
      const pedido = normalizarCnpj(req.body.cnpj);
      cnpj = pedido && meus.includes(pedido) ? pedido : meus[0]; // se a conta tem CNPJs diferentes (legado), vale o escolhido
    }

    const unidade = await emTransacao(async (db) => {
      const criada = await criarUnidade(db, lida.dados, cnpj);
      await vincularAdmin(db, req.user.id, criada.id);
      return criada;
    });
    res.status(201).json({ unidade, cnpj: formatarCnpj(cnpj), unidades_slugs: await unidadesDoAdmin(req.user.id) });
  } catch (erro) {
    if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message });
    throw erro;
  }
}));

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
    `select v.*, p.valor_por_atendimento, p.telefone, p.email, p.primeiro_acesso_pendente
     from vw_equipe_unidade v join prestadoras p on p.id = v.prestadora_id
     where v.unidade_id = $1 order by v.nome`,
    [req.unidadeId]
  );
  res.json(rows);
}));

// O administrador cadastra uma prestadora direto na aba Equipe (sem ela precisar se cadastrar sozinha
// nem confirmar e-mail: quem vai usar a conta recebe o acesso do administrador). Se não vier senha, o
// sistema gera uma provisória e a devolve UMA vez — a prestadora troca no "Meu perfil". Se a agenda já
// tinha atendimentos com o nome dela (vindos da planilha, "prestadora sem cadastro"), eles são ligados
// à conta nova automaticamente. É criação de login, então só administrador completo.
router.post('/:slug/admin/equipe', requireAuth, requireRole('administrador'), requireAcessoUnidade('equipe'), asyncHandler(async (req, res) => {
  const nome = String(req.body.nome ?? '').trim().replace(/\s+/g, ' ');
  const email = normalizarEmail(req.body.email);
  const telefone = normalizarTelefone(req.body.telefone);
  if (!nomeValido(nome)) return res.status(400).json({ erro: 'Informe o nome da prestadora.' });
  if (!email && !telefone) return res.status(400).json({ erro: 'Informe o e-mail e/ou o telefone: é com um deles que ela entra no portal.' });
  if (email && !emailValido(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  if (telefone && !telefoneValido(telefone)) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número.' });

  const informada = String(req.body.senha ?? '');
  if (informada && !senhaValida(informada)) return res.status(400).json({ erro: 'A senha precisa ter ao menos 8 caracteres (ou deixe em branco pra gerar uma).' });
  const senha = informada || crypto.randomBytes(6).toString('base64url'); // 8 caracteres, aleatória
  const senhaHash = await bcrypt.hash(senha, 10);

  try {
    const resultado = await emTransacao(async (db) => {
      // e-mail repetido deixaria o login "por e-mail" ambíguo (várias contas com a mesma senha possível)
      if (email) {
        const { rows } = await db.query('select 1 from prestadoras where email = $1', [email]);
        if (rows.length) throw new ErroNegocio(409, 'Já existe uma prestadora com esse e-mail.');
      }
      const { rows: [nova] } = await db.query(
        `insert into prestadoras (nome, telefone, email, senha_hash, unidade_id)
         values ($1, $2, $3, $4, $5) returning id, nome, telefone, email`,
        [nome, telefone || null, email || null, senhaHash, req.unidadeId]
      );

      // atendimentos que a planilha deixou só com o NOME dela passam a apontar pra conta nova
      const { rows: externos } = await db.query(
        `select distinct profissional_externo as nome from atendimentos
         where unidade_id = $1 and prestadora_id is null and profissional_externo is not null`, [req.unidadeId]);
      let ligados = 0;
      for (const e of externos.filter(x => normalizarTexto(x.nome) === normalizarTexto(nome))) {
        const { rowCount } = await db.query(
          `update atendimentos set prestadora_id = $1, profissional_externo = null,
             status = case when status = 'pedido' then 'proposto' else status end, atualizado_em = now()
           where unidade_id = $2 and prestadora_id is null and profissional_externo = $3`,
          [nova.id, req.unidadeId, e.nome]);
        ligados += rowCount;
      }
      return { nova, ligados };
    });
    res.status(201).json({ prestadora: resultado.nova, atendimentos_ligados: resultado.ligados, senha_provisoria: informada ? null : senha });
  } catch (erro) {
    if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message });
    if (erro.code === '23505') return res.status(409).json({ erro: 'Já existe uma prestadora com esse telefone.' });
    throw erro;
  }
}));

// Quanto a franquia paga a esta prestadora por atendimento. Vazio/null remove a
// tarifa. Só vale pros próximos aceites — o que já foi aceito mantém o valor
// combinado na hora (atendimentos.valor_prestadora). É dinheiro: só administrador
// completo altera (funcionário com módulo "Equipe" enxerga, mas não muda).
//
// O mesmo PATCH corrige o TELEFONE de contato dela (a conta criada pela planilha nasce sem telefone). Cada
// campo só muda se vier no corpo: mandar só o telefone não apaga a tarifa, e vice-versa.
router.patch('/:slug/admin/equipe/:prestadoraId', requireAuth, requireRole('administrador'), requireAcessoUnidade('equipe'), asyncHandler(async (req, res) => {
  const sets = [];
  const vals = [];

  if ('valor_por_atendimento' in req.body) {
    const bruto = req.body.valor_por_atendimento;
    let valor = null;
    if (bruto !== null && bruto !== undefined && String(bruto).trim() !== '') {
      valor = Number(String(bruto).trim().replace(',', '.'));
      if (!Number.isFinite(valor) || valor < 0 || valor >= 100000) {
        return res.status(400).json({ erro: 'Valor inválido — informe um número entre 0 e 99.999,99' });
      }
      valor = Math.round(valor * 100) / 100;
    }
    vals.push(valor); sets.push(`valor_por_atendimento = $${vals.length}`);
  }

  if ('telefone' in req.body) {
    const telefone = normalizarTelefone(req.body.telefone);
    if (telefone && !telefoneValido(telefone)) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número.' });
    vals.push(telefone || null); sets.push(`telefone = $${vals.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ erro: 'Nada para atualizar — informe valor_por_atendimento e/ou telefone.' });

  const { rows: [atual] } = await pool.query('select email from prestadoras where id = $1 and unidade_id = $2', [req.params.prestadoraId, req.unidadeId]);
  if (!atual) return res.status(404).json({ erro: 'Prestadora não encontrada nesta unidade' });
  // sem telefone e sem e-mail ela não teria como entrar
  if ('telefone' in req.body && !normalizarTelefone(req.body.telefone) && !atual.email) {
    return res.status(400).json({ erro: 'Esta conta não tem e-mail; sem telefone ela não teria como entrar.' });
  }

  vals.push(req.params.prestadoraId, req.unidadeId);
  try {
    const { rows: [prestadora] } = await pool.query(
      `update prestadoras set ${sets.join(', ')}, atualizado_em = now()
       where id = $${vals.length - 1} and unidade_id = $${vals.length}
       returning id, nome, telefone, email, valor_por_atendimento, primeiro_acesso_pendente`,
      vals
    );
    res.json(prestadora);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Esse telefone já está cadastrado em outra conta.' });
    throw erro;
  }
}));

router.get('/:slug/admin/clientes', requireAuth, requireAcessoUnidade('clientes'), asyncHandler(async (req, res) => {
  // além do resumo da view: telefone, se já tem conta (login) e quando o convite pra criar perfil foi enviado.
  // total_registrados conta TODOS os atendimentos do cliente (a view só conta os concluídos): é o que decide
  // se um perfil novo pode receber a substituição de um provisório.
  const { rows } = await pool.query(
    `select v.*, c.telefone, c.email, (c.senha_hash is not null) as tem_conta, c.convite_enviado_em,
            (select count(*)::int from atendimentos a where a.cliente_id = c.id) as total_registrados
     from vw_clientes_unidade v join clientes c on c.id = v.cliente_id
     where v.unidade_id = $1 order by v.nome`,
    [req.unidadeId]
  );
  res.json(rows);
}));

// Marca que o convite (WhatsApp) pra criar o perfil foi enviado a um cliente que ainda não tem conta. É o que libera
// "Substituir perfil" depois. Só vale pra cliente sem login desta unidade.
router.post('/:slug/admin/clientes/:clienteId/convite', requireAuth, requireAcessoUnidade('clientes'), asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.clienteId)) return res.status(400).json({ erro: 'cliente inválido' });
  const { rows: [c] } = await pool.query(
    `update clientes set convite_enviado_em = now()
     where id = $1 and unidade_id = $2 and senha_hash is null
     returning id, convite_enviado_em`,
    [req.params.clienteId, req.unidadeId]
  );
  if (!c) return res.status(404).json({ erro: 'Cliente sem cadastro não encontrado nesta unidade (quem já tem conta não precisa de convite).' });
  res.json(c);
}));

// "Substituir perfil": passa tudo que está ligado a um cliente PROVISÓRIO (sem conta, já convidado) para o perfil que o
// próprio cliente criou, e remove o provisório — consolidação de cadastro, não um cliente novo desconectado.
// Regras (todas conferidas aqui, dentro de UMA transação, com as duas linhas travadas):
//   • o provisório não tem login e já recebeu o convite;
//   • o destino tem login, é da mesma unidade, é outra pessoa e NÃO tem nenhum atendimento registrado;
//   • todas as referências ao provisório (atendimentos, avaliações e qualquer outra tabela que aponte pra clientes)
//     passam pro destino; nada é excluído além do próprio registro provisório.
// É uma operação que apaga um cadastro, então só o administrador completo faz.
router.post('/:slug/admin/clientes/:clienteId/substituir', requireAuth, requireRole('administrador'), requireAcessoUnidade('clientes'), asyncHandler(async (req, res) => {
  const origemId = req.params.clienteId, destinoId = String(req.body.destino_id ?? '');
  if (!UUID.test(origemId) || !UUID.test(destinoId)) return res.status(400).json({ erro: 'Informe o perfil de destino.' });
  if (origemId === destinoId) return res.status(400).json({ erro: 'O perfil de destino precisa ser diferente do provisório.' });

  try {
    const resultado = await emTransacao(async (db) => {
      // trava as duas linhas, sempre na mesma ordem (evita travar uma na outra se duas substituições rodarem juntas)
      const { rows } = await db.query(
        'select id, nome, telefone, senha_hash, unidade_id, convite_enviado_em from clientes where id = any($1::uuid[]) order by id for update', [[origemId, destinoId]]);
      const origem = rows.find(r => r.id === origemId), destino = rows.find(r => r.id === destinoId);
      if (!origem || origem.unidade_id !== req.unidadeId) throw new ErroNegocio(404, 'Cliente provisório não encontrado nesta unidade.');
      if (origem.senha_hash) throw new ErroNegocio(400, 'Este cliente já tem conta própria: só um cadastro provisório (sem login) pode ser substituído.');
      if (!origem.convite_enviado_em) throw new ErroNegocio(400, 'Envie primeiro o convite de cadastro por WhatsApp a este cliente: a substituição só vale pra quem já foi convidado.');
      if (!destino || destino.unidade_id !== req.unidadeId) throw new ErroNegocio(404, 'Perfil de destino não encontrado nesta unidade.');
      if (!destino.senha_hash) throw new ErroNegocio(400, 'O perfil de destino precisa ser um cadastro completo (com login), criado pelo próprio cliente.');
      const { rows: [{ n: jaTem }] } = await db.query('select count(*)::int as n from atendimentos where cliente_id = $1', [destinoId]);
      if (jaTem > 0) throw new ErroNegocio(409, `O perfil de destino já tem ${jaTem === 1 ? '1 atendimento registrado' : jaTem + ' atendimentos registrados'}: só um perfil sem nenhum atendimento pode receber a substituição.`);

      // todas as tabelas com chave estrangeira pra clientes (hoje: atendimentos e avaliações; novas entram sozinhas)
      const { rows: refs } = await db.query(
        `select c.conrelid::regclass::text as tabela, quote_ident(a.attname) as coluna
         from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confrelid = 'clientes'::regclass and array_length(c.conkey, 1) = 1`);
      const movidos = {};
      for (const { tabela, coluna } of refs) { // nomes vêm do catálogo do Postgres, não de entrada do usuário
        const { rowCount } = await db.query(`update ${tabela} set ${coluna} = $1 where ${coluna} = $2`, [destinoId, origemId]);
        movidos[tabela] = rowCount;
      }
      // o telefone que o administrador tinha do provisório passa pro perfil novo se ele não informou um
      if (origem.telefone) await db.query('update clientes set telefone = $1 where id = $2 and (telefone is null or telefone = \'\')', [origem.telefone, destinoId]);
      await db.query('delete from clientes where id = $1', [origemId]);
      return { provisorio: origem.nome, destino: destino.nome, movidos };
    });
    res.json(resultado);
  } catch (erro) {
    if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message });
    throw erro;
  }
}));

// Layout do painel inicial (Visão geral) DESTA unidade: quais atalhos aparecem e em que ordem, e quais
// cartões de resumo ficam visíveis. Vale pra todo mundo que abre o painel da unidade; só o administrador
// completo altera. Sem nada salvo, vale o padrão (tudo visível, na ordem de sempre).
const MODULOS_PAINEL = ['agenda', 'equipe', 'clientes', 'avaliacoes', 'financeiro', 'relatorios'];
const BLOCOS_PAINEL = ['atend', 'prof', 'fat', 'nps', 'agenda-hoje'];

router.get('/:slug/admin/painel', requireAuth, requireAcessoUnidade('dashboard'), asyncHandler(async (req, res) => {
  const { rows: [u] } = await pool.query('select painel_config from unidades where id = $1', [req.unidadeId]);
  const c = u?.painel_config || {};
  // atalhos novos (que não existiam quando a configuração foi salva) entram no fim, em vez de sumirem
  const ordem = [...(c.ordem || []).filter(m => MODULOS_PAINEL.includes(m)), ...MODULOS_PAINEL.filter(m => !(c.ordem || []).includes(m))];
  res.json({ ordem, ocultos: (c.ocultos || []).filter(o => MODULOS_PAINEL.includes(o) || BLOCOS_PAINEL.includes(o)), modulos: MODULOS_PAINEL, blocos: BLOCOS_PAINEL });
}));

router.put('/:slug/admin/painel', requireAuth, requireRole('administrador'), requireAcessoUnidade('dashboard'), asyncHandler(async (req, res) => {
  const { ordem, ocultos } = req.body;
  if (!Array.isArray(ordem) || !Array.isArray(ocultos)) return res.status(400).json({ erro: 'ordem e ocultos são listas' });
  if (ordem.some(m => !MODULOS_PAINEL.includes(m)) || new Set(ordem).size !== ordem.length) {
    return res.status(400).json({ erro: 'ordem com atalho inválido ou repetido' });
  }
  if (ocultos.some(o => !MODULOS_PAINEL.includes(o) && !BLOCOS_PAINEL.includes(o))) return res.status(400).json({ erro: 'item oculto inválido' });
  const config = { ordem, ocultos: [...new Set(ocultos)] };
  await pool.query('update unidades set painel_config = $1 where id = $2', [config, req.unidadeId]);
  res.json({ ...config, modulos: MODULOS_PAINEL, blocos: BLOCOS_PAINEL });
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
