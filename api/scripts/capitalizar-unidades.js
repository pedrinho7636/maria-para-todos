// Uso: npm run unidades:capitalizar        (mostra o que faria e NÃO grava)
//      npm run unidades:capitalizar -- --aplicar
//
// Corrige nomes de unidade (cidade) que foram cadastrados em minúscula ("carazinho" -> "Carazinho").
// Só o NOME muda: o identificador (slug) e o resto da unidade ficam como estão. Atua no banco que o
// DATABASE_URL aponta (sem ele, no banco local). Pode rodar de novo à vontade.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool, prepararBanco } = require('../src/db');
const { capitalizarNome } = require('../src/utils/normalizacao');

const aplicar = process.argv.includes('--aplicar');

(async () => {
  await prepararBanco();
  const { rows } = await pool.query('select id, nome, slug from unidades order by nome');
  const trocas = rows.map(u => ({ ...u, novo: capitalizarNome(u.nome) })).filter(u => u.novo !== u.nome);
  console.log(`Banco: ${process.env.DATABASE_URL ? 'o do DATABASE_URL' : 'local'} · ${rows.length} unidade(s)`);
  if (trocas.length === 0) console.log('Nenhum nome de unidade precisa de correção.');
  for (const u of trocas) console.log(`  "${u.nome}" -> "${u.novo}"  (${u.slug})`);
  if (trocas.length && aplicar) {
    for (const u of trocas) await pool.query('update unidades set nome = $1 where id = $2', [u.novo, u.id]);
    console.log(`\n${trocas.length} unidade(s) corrigida(s).`);
  } else if (trocas.length) console.log('\nRode de novo com --aplicar para gravar.');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
