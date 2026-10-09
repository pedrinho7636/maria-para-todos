// Uso: npm run importadas:primeiro-acesso        (mostra o que faria e NÃO grava)
//      npm run importadas:primeiro-acesso -- --aplicar
//
// As prestadoras criadas pela importação ANTES de existir o "primeiro acesso obrigatório" continuam com a senha
// padrão (senha123) e ainda não confirmaram o e-mail. Este script acha as contas cuja senha ainda é a padrão e as
// marca como "primeiro acesso pendente": no próximo login elas confirmam o e-mail e trocam a senha. Quem já trocou
// a senha não é tocada; contas sem e-mail (exemplos do banco de demonstração) também ficam de fora. Confira a lista antes de
// usar --aplicar: uma conta de teste sua que ainda use senha123 também entra. Pode rodar de novo à vontade.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { pool, prepararBanco } = require('../src/db');
const { SENHA_PADRAO } = require('../src/utils/prestadorasImportadas');

const aplicar = process.argv.includes('--aplicar');

(async () => {
  await prepararBanco(); // garante a coluna primeiro_acesso_pendente
  const { rows } = await pool.query(
    `select p.id, p.nome, p.email, p.senha_hash, u.nome as unidade
     from prestadoras p join unidades u on u.id = p.unidade_id
     where not p.primeiro_acesso_pendente and p.email is not null order by u.nome, p.nome`);
  const ids = [];
  for (const p of rows) {
    if (await bcrypt.compare(SENHA_PADRAO, p.senha_hash)) {
      ids.push(p.id);
      console.log(`  ${p.unidade} · ${p.nome} (${p.email || 'sem e-mail'})`);
    }
  }
  if (ids.length === 0) console.log('Nenhuma conta com a senha padrão fora do primeiro acesso.');
  else if (aplicar) {
    await pool.query('update prestadoras set primeiro_acesso_pendente = true, atualizado_em = now() where id = any($1::uuid[])', [ids]);
    console.log(`\n${ids.length} conta(s) marcada(s): no próximo login elas confirmam o e-mail e trocam a senha.`);
  } else console.log(`\n${ids.length} conta(s) seriam marcadas. Rode de novo com --aplicar para gravar.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
