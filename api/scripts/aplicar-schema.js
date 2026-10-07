// Aplica o banco-schema.sql (tabelas + dados de exemplo) no banco configurado
// no .env — local (PGHOST/PGUSER/...) ou hospedado (DATABASE_URL, ex.: Neon).
// Serve pra quem não tem o psql à mão. Só roda em banco VAZIO: o schema cria
// tabelas e insere os dados de exemplo, então rodar de novo duplicaria/falharia.
//
//   npm run banco:schema                       (com os dados de exemplo — bom pra demonstração)
//   npm run banco:schema -- --sem-exemplos     (só as unidades: nenhuma conta nem atendimento de exemplo;
//                                               crie o 1º administrador com `npm run admin:criar`)
//   (ou, sem mexer no .env)  DATABASE_URL="postgresql://..." npm run banco:schema
//
// ATENÇÃO num site público: os dados de exemplo trazem contas com a senha "senha123".
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

(async () => {
  // Transação precisa de UMA conexão só — pool.query pega uma qualquer a cada chamada.
  const cliente = await pool.connect();
  try {
    const { rows } = await cliente.query("select to_regclass('public.unidades') is not null as existe");
    if (rows[0].existe) {
      console.log('O banco já tem as tabelas (unidades existe) — nada a fazer.');
      return;
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'banco-schema.sql'), 'utf8');
    console.log('Aplicando banco-schema.sql…');
    // Tudo numa transação: se algo falhar no meio, o banco volta a ficar vazio
    // em vez de meio-criado.
    await cliente.query('begin');
    await cliente.query(sql);
    if (process.argv.includes('--sem-exemplos')) {
      // Fica só o que o sistema precisa pra funcionar (as unidades, que o cadastro de administrador
      // usa pra casar o CNPJ). Tudo que é conta/atendimento de exemplo sai, na ordem das chaves.
      await cliente.query(`delete from avaliacoes; delete from atendimentos; delete from clientes; delete from prestadoras;
                           delete from sub_administradores; delete from administrador_unidades; delete from administradores;`);
      await cliente.query('commit');
      console.log('Pronto: tabelas criadas SEM dados de exemplo (só as unidades). Crie o 1º administrador: npm run admin:criar -- --help');
    } else {
      await cliente.query('commit');
      console.log('Pronto: tabelas criadas e dados de exemplo inseridos (senhas de exemplo: senha123).');
    }
  } catch (erro) {
    await cliente.query('rollback').catch(() => {});
    console.error('Falha ao aplicar o schema:', erro.message);
    process.exitCode = 1;
  } finally {
    cliente.release();
    await pool.end();
  }
})();
