// Aplica o banco-schema.sql (tabelas + dados de exemplo) no banco configurado
// no .env — local (PGHOST/PGUSER/...) ou hospedado (DATABASE_URL, ex.: Neon).
// Serve pra quem não tem o psql à mão. Só roda em banco VAZIO: o schema cria
// tabelas e insere os dados de exemplo, então rodar de novo duplicaria/falharia.
//
//   npm run banco:schema                          (com os dados de exemplo — bom pra demonstração)
//   npm run banco:schema -- --sem-exemplos        (começa LIMPO: as unidades Carazinho e Panambi existem
//                                                  vazias — sem CNPJ, telefone, endereço, contas ou atendimentos.
//                                                  O 1º administrador a se cadastrar define o CNPJ de cada uma.)
//   npm run banco:schema -- --sem-exemplos --recriar
//                                                 (APAGA TUDO do banco apontado e recria do zero. Mostra qual
//                                                  banco é e exige digitar APAGAR TUDO pra confirmar.)
//   (ou, sem mexer no .env)  DATABASE_URL="postgresql://..." npm run banco:schema
//
// ATENÇÃO num site público: os dados de exemplo trazem contas com a senha "senha123".
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { pool } = require('../src/db');

const semExemplos = process.argv.includes('--sem-exemplos');
const recriar = process.argv.includes('--recriar');

// Qual banco o comando vai atingir — sem a senha — pra quem confirma ver ONDE está apagando.
function destino() {
  if (process.env.DATABASE_URL) {
    try { const u = new URL(process.env.DATABASE_URL); return `${u.hostname}${u.pathname} (DATABASE_URL — banco hospedado)`; }
    catch { return 'DATABASE_URL (endereço ilegível)'; }
  }
  return `${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE} (banco LOCAL)`;
}

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(texto, (r) => { rl.close(); resolve(r.trim()); }));
}

(async () => {
  // Transação precisa de UMA conexão só — pool.query pega uma qualquer a cada chamada.
  const cliente = await pool.connect();
  try {
    if (recriar) {
      console.log(`\n⚠  ISTO APAGA TODOS OS DADOS do banco:\n     ${destino()}\n`);
      // --sim-apagar-tudo pula a pergunta (pra automação/testes). Sem ela, só roda num terminal
      // interativo e exige digitar a frase: um comando colado por engano não apaga nada.
      if (!process.argv.includes('--sim-apagar-tudo')) {
        if (!process.stdin.isTTY) throw new Error('--recriar só roda num terminal interativo (precisa da sua confirmação).');
        if (await perguntar('Pra confirmar, digite exatamente  APAGAR TUDO  : ') !== 'APAGAR TUDO') {
          console.log('Cancelado — nada foi apagado.');
          return;
        }
      }
      await cliente.query('drop schema public cascade; create schema public;');
      console.log('Banco apagado. Recriando…');
    }

    const { rows } = await cliente.query("select to_regclass('public.unidades') is not null as existe");
    if (rows[0].existe) {
      console.log('O banco já tem as tabelas (unidades existe) — nada a fazer. (Pra apagar e recriar: --recriar)');
      return;
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'banco-schema.sql'), 'utf8');
    console.log('Aplicando banco-schema.sql…');
    // Tudo numa transação: se algo falhar no meio, o banco volta a ficar vazio
    // em vez de meio-criado.
    await cliente.query('begin');
    await cliente.query(sql);
    if (semExemplos) {
      // Sai tudo que é conta/atendimento de exemplo (na ordem das chaves) e as unidades ficam
      // "vazias": sem o CNPJ/telefone/endereço fictícios. Sem CNPJ cadastrado, ninguém "casa" uma
      // unidade digitando um número público — quem assume é o 1º administrador a se cadastrar nela.
      await cliente.query(`delete from avaliacoes; delete from atendimentos; delete from clientes; delete from prestadoras;
                           delete from sub_administradores; delete from administrador_unidades; delete from administradores;
                           delete from codigos_verificacao;
                           update unidades set cnpj = null, telefone = null, endereco = null, endereco_curto = null;`);
      await cliente.query('commit');
      console.log('Pronto: banco LIMPO. Carazinho e Panambi existem vazias. Cadastre o administrador pelo site (marcando a unidade) ou com: npm run admin:criar -- --help');
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
