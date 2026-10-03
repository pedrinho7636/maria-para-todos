const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { acessoAdminUnidade } = require('../utils/permissoes');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Sincronização entre usuários. O front consulta esta rota a cada poucos
// segundos; ela devolve uma "impressão digital" do que AQUELE usuário enxerga
// (quantidade de linhas + carimbo da última alteração de cada tabela relevante).
// Quando a impressão muda, o front recarrega os dados — assim o que alguém faz
// (convite, aceite, avaliação, atendimento novo, importação...) aparece pra
// quem está com a tela aberta em segundos, sem precisar relogar. Custa uma
// consulta leve por chamada (índices em unidade_id/atualizado_em).
//
// Os argumentos de marca() são literais deste arquivo, nunca entrada do usuário.
const marca = (tabela, campoTempo, onde) =>
  `(select count(*) || ':' || coalesce(extract(epoch from max(${campoTempo}))::text, '0') from ${tabela} where ${onde})`;

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { perfil, id } = req.user;
  let partes = [];

  if (perfil === 'administrador' || perfil === 'sub_administrador') {
    const slug = String(req.query.unidade || '');
    let permissoes = '';

    if (perfil === 'sub_administrador') {
      // Conta desativada (ou permissão trocada) pelo admin tem que refletir na
      // hora na tela dele: desativada = 403, permissão nova entra na impressão.
      const { rows: [sub] } = await pool.query(
        `select ativo, pode_dashboard, pode_agenda, pode_avaliacoes, pode_equipe, pode_clientes
         from sub_administradores where id = $1`, [id]);
      if (!sub || !sub.ativo) return res.status(403).json({ erro: 'Seu acesso foi desativado pelo administrador.' });
      permissoes = [sub.pode_dashboard, sub.pode_agenda, sub.pode_avaliacoes, sub.pode_equipe, sub.pode_clientes].map(b => (b ? 1 : 0)).join('');
    }

    const acesso = await acessoAdminUnidade(req.user, slug, null);
    if (!acesso) return res.status(403).json({ erro: 'Sem acesso a esta unidade' });

    const { rows: [r] } = await pool.query(
      `select
         ${marca('atendimentos', 'atualizado_em', 'unidade_id = $1')} as atendimentos,
         ${marca('prestadoras', 'atualizado_em', 'unidade_id = $1')} as prestadoras,
         ${marca('clientes', 'criado_em', 'unidade_id = $1')} as clientes,
         (select count(*) || ':' || coalesce(extract(epoch from max(coalesce(av.moderado_em, av.criado_em)))::text, '0')
            from avaliacoes av join prestadoras p on p.id = av.prestadora_id where p.unidade_id = $1) as avaliacoes`,
      [acesso.unidadeId]
    );
    partes = [r.atendimentos, r.prestadoras, r.clientes, r.avaliacoes, permissoes];
  } else if (perfil === 'prestadora') {
    const { rows: [r] } = await pool.query(
      `select
         ${marca('atendimentos', 'atualizado_em', 'prestadora_id = $1')} as atendimentos,
         ${marca('prestadoras', 'atualizado_em', 'id = $1')} as tarifa,
         (select count(*) || ':' || coalesce(extract(epoch from max(coalesce(moderado_em, criado_em)))::text, '0')
            from avaliacoes where prestadora_id = $1 and status = 'aprovada') as avaliacoes`,
      [id]
    );
    partes = [r.atendimentos, r.tarifa, r.avaliacoes];
  } else if (perfil === 'cliente') {
    const { rows: [r] } = await pool.query(
      `select
         ${marca('atendimentos', 'atualizado_em', 'cliente_id = $1')} as atendimentos,
         ${marca('avaliacoes', 'criado_em', 'cliente_id = $1')} as avaliacoes`,
      [id]
    );
    partes = [r.atendimentos, r.avaliacoes];
  } else {
    return res.status(400).json({ erro: 'Perfil desconhecido' });
  }

  res.json({ versao: partes.join('|') });
}));

module.exports = router;
