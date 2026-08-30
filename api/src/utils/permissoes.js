const { pool } = require('../db');

// Retorna o id da unidade se o administrador tiver acesso a ela (por slug), senão null
async function unidadeDoAdmin(adminId, slug) {
  const { rows: [unidade] } = await pool.query(
    `select u.id from unidades u
     join administrador_unidades au on au.unidade_id = u.id
     where u.slug = $1 and au.administrador_id = $2`,
    [slug, adminId]
  );
  return unidade ? unidade.id : null;
}

// Autoriza acesso administrativo (franqueado OU sub-administrador) a uma
// unidade, opcionalmente exigindo permissão de um módulo específico.
// Sempre reconsulta o banco — nunca confia em claims do JWT para permissão,
// mesmo princípio já usado por unidadeDoAdmin para o vínculo admin<->unidade.
// Retorna { unidadeId, total } (total=true para administrador completo) ou null.
async function acessoAdminUnidade(user, slug, modulo) {
  if (user.perfil === 'administrador') {
    const unidadeId = await unidadeDoAdmin(user.id, slug);
    return unidadeId ? { unidadeId, total: true } : null;
  }

  if (user.perfil === 'sub_administrador') {
    const { rows: [row] } = await pool.query(
      `select sa.unidade_id, sa.ativo, sa.pode_dashboard, sa.pode_agenda,
              sa.pode_avaliacoes, sa.pode_equipe, sa.pode_clientes, sa.pode_financeiro
       from sub_administradores sa
       join unidades u on u.id = sa.unidade_id
       where sa.id = $1 and u.slug = $2`,
      [user.id, slug]
    );
    if (!row || !row.ativo) return null;
    if (modulo && !row['pode_' + modulo]) return null;
    return { unidadeId: row.unidade_id, total: false };
  }

  return null;
}

module.exports = { unidadeDoAdmin, acessoAdminUnidade };
