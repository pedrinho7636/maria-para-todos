// Uso: npm run unidades:conflitos
// Procura, no banco apontado pelo DATABASE_URL (ou no local), CIDADES (nome + UF) que estão em mais de um CNPJ — o que é
// proibido. Só lista; nunca altera nada. Banco criado depois da regra nova não tem esse problema.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../src/db');
const { normalizarTexto } = require('../src/utils/importarPlanilha');

(async () => {
  const { rows } = await pool.query(
    "select slug, nome, uf, coalesce(cnpj, '(sem CNPJ)') as cnpj, upper(regexp_replace(coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')) as d from unidades order by nome");
  const porCidade = new Map();
  for (const u of rows) {
    const chave = normalizarTexto(u.nome) + '/' + String(u.uf).toUpperCase();
    if (!porCidade.has(chave)) porCidade.set(chave, []);
    porCidade.get(chave).push(u);
  }
  let conflitos = 0;
  for (const [chave, lista] of porCidade) {
    if (new Set(lista.map(u => u.d)).size > 1) {
      conflitos++;
      console.log(`\n⚠ ${chave} está em ${lista.length} unidades de CNPJs diferentes:`);
      lista.forEach(u => console.log(`   ${u.slug} · ${u.nome}/${u.uf} · ${u.cnpj}`));
    }
  }
  console.log(conflitos ? `\n${conflitos} cidade(s) em conflito.` : `Nenhum conflito: ${rows.length} unidade(s), cada cidade em um único CNPJ.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
