// Cria (ou redefine a senha de) um administrador direto no banco — o jeito de ter o 1º acesso
// num banco novo sem depender de e-mail. Roda no seu computador, contra o banco do .env ou da
// DATABASE_URL (Neon).
//
//   npm run admin:criar -- --email voce@exemplo.com --nome Maria --sobrenome Silva --unidades carazinho,panambi
//
// A senha NÃO vai na linha de comando (ficaria no histórico do terminal): o script pergunta
// (a digitação fica oculta) ou lê a variável ADMIN_SENHA. Mínimo 8 caracteres.
// Se o e-mail já for de um administrador, o script recusa; com --redefinir, troca só a senha.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../src/db');

function argumento(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}

// lê uma linha do terminal sem mostrar o que se digita
function perguntarSenha(texto) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { // sem terminal interativo (pipe/CI): lê a linha inteira normalmente
      let dado = '';
      stdin.on('data', (c) => { dado += c; });
      stdin.on('end', () => resolve(dado.split(/\r?\n/)[0]));
      return;
    }
    process.stdout.write(texto);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let senha = '';
    const aoDigitar = (c) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', aoDigitar); process.stdout.write('\n'); return resolve(senha); }
        if (ch === '\u0003') { process.exit(130); } // Ctrl+C
        if (ch === '\u007f' || ch === '\b') senha = senha.slice(0, -1); // Backspace
        else senha += ch;
      }
    };
    stdin.on('data', aoDigitar);
  });
}

(async () => {
  if (process.argv.includes('--help') || !argumento('email')) {
    console.log('Uso: npm run admin:criar -- --email x@y.com --nome Maria --sobrenome Silva --unidades carazinho,panambi [--redefinir]');
    return process.exit(argumento('email') ? 0 : 1);
  }
  const email = argumento('email').trim().toLowerCase();
  const redefinir = process.argv.includes('--redefinir');
  try {
    const { rows: [existente] } = await pool.query('select id from administradores where email = $1', [email]);
    if (existente && !redefinir) throw new Error(`Já existe um administrador com ${email}. Use --redefinir pra trocar só a senha.`);
    if (!existente) {
      if (!argumento('nome') || !argumento('sobrenome') || !argumento('unidades')) throw new Error('Faltou --nome, --sobrenome ou --unidades.');
    }

    const senha = process.env.ADMIN_SENHA || await perguntarSenha('Senha (mínimo 8 caracteres): ');
    if (!senha || senha.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres.');
    const hash = await bcrypt.hash(senha, 10);

    if (existente) {
      await pool.query('update administradores set senha_hash = $1 where id = $2', [hash, existente.id]);
      console.log(`Senha de ${email} redefinida.`);
      return;
    }

    const slugs = argumento('unidades').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const { rows: unidades } = await pool.query('select id, slug from unidades where slug = any($1::text[])', [slugs]);
    const faltando = slugs.filter(s => !unidades.some(u => u.slug === s));
    if (faltando.length) throw new Error(`Unidade(s) inexistente(s): ${faltando.join(', ')}. As cadastradas são: carazinho, panambi.`);

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const { rows: [novo] } = await cliente.query(
        'insert into administradores (nome, sobrenome, email, senha_hash) values ($1, $2, $3, $4) returning id',
        [argumento('nome').trim(), argumento('sobrenome').trim(), email, hash]
      );
      for (const u of unidades) await cliente.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1, $2)', [novo.id, u.id]);
      await cliente.query('commit');
    } catch (erro) { await cliente.query('rollback').catch(() => {}); throw erro; } finally { cliente.release(); }
    console.log(`Administrador criado: ${email} (unidades: ${unidades.map(u => u.slug).join(', ')}). Já dá pra entrar no portal.`);
  } catch (erro) {
    console.error('Erro:', erro.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
