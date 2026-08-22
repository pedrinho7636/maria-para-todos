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

module.exports = { unidadeDoAdmin };
