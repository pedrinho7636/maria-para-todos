// Uso: npm run importadas:vincular        (mostra o que faria e NÃO grava)
//      npm run importadas:vincular -- --aplicar
//
// Atendimentos importados da planilha antes de existir o cadastro automático ficaram só com
// o NOME da profissional (atendimentos.profissional_externo), sem prestadora ligada. Este
// script cria a prestadora de cada nome (e-mail nome@gmail.com, senha padrão senha123),
// liga os atendimentos a ela e limpa o nome provisório. O que estava como "pedido" (previsto
// sem prestadora) passa a "proposto", igual a uma importação nova. Pode rodar de novo à
// vontade: o que já foi ligado não aparece mais.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool, prepararBanco } = require('../src/db');
const { garantirPrestadoras, SENHA_PADRAO } = require('../src/utils/prestadorasImportadas');
const { normalizarTexto } = require('../src/utils/importarPlanilha');

const aplicar = process.argv.includes('--aplicar');

(async () => {
  await prepararBanco(); // garante a migração que torna o telefone opcional
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pares } = await client.query(
      `select a.unidade_id, u.nome as unidade, a.profissional_externo as nome, count(*)::int as atendimentos
       from atendimentos a join unidades u on u.id = a.unidade_id
       where a.profissional_externo is not null
       group by a.unidade_id, u.nome, a.profissional_externo order by u.nome, 4 desc`
    );
    if (pares.length === 0) { console.log('Nada a vincular: nenhum atendimento com profissional sem cadastro.'); await client.query('ROLLBACK'); return; }

    const porUnidade = new Map();
    for (const p of pares) {
      if (!porUnidade.has(p.unidade_id)) porUnidade.set(p.unidade_id, []);
      porUnidade.get(p.unidade_id).push(p);
    }

    let ligados = 0;
    for (const [unidadeId, lista] of porUnidade) {
      const { ids, criadas } = await garantirPrestadoras(client, unidadeId, lista.map(p => p.nome));
      console.log(`\n${lista[0].unidade}: ${lista.length} nome(s), ${criadas.length} prestadora(s) nova(s)`);
      for (const c of criadas) console.log(`  + criada  ${c.nome}  <${c.email}>`);
      for (const p of lista) {
        const id = ids.get(normalizarTexto(p.nome));
        const { rowCount } = await client.query(
          `update atendimentos set prestadora_id = $1, profissional_externo = null,
             status = case when status = 'pedido' then 'proposto' else status end,
             atualizado_em = now()
           where unidade_id = $2 and profissional_externo = $3`,
          [id, unidadeId, p.nome]
        );
        ligados += rowCount;
        console.log(`  ${String(rowCount).padStart(3)} atendimento(s)  ->  ${p.nome}`);
      }
    }

    console.log(`\nTotal: ${ligados} atendimento(s) ligados a prestadoras. Senha padrão das contas novas: ${SENHA_PADRAO}`);
    if (aplicar) { await client.query('COMMIT'); console.log('GRAVADO.'); }
    else { await client.query('ROLLBACK'); console.log('Simulação — nada foi gravado. Rode com --aplicar pra valer.'); }
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro:', erro.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
