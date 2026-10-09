// Cria (ou redefine a senha de) um administrador direto no banco — o jeito de ter o 1º acesso
// num banco novo sem depender de e-mail. Roda no seu computador, contra o banco do .env ou da
// DATABASE_URL (Neon).
//
//   npm run admin:criar -- --email voce@exemplo.com --nome Maria --sobrenome Silva \
//        --cnpj 00.000.000/0001-00 --unidades "Carazinho/RS,Panambi/RS" --telefone "(54) 9 9999-9999"
//
// --unidades: lista de "Cidade/UF" (UF opcional; padrão RS). Cada uma é CRIADA se ainda não existir
//   (e então o --cnpj é obrigatório) ou, se já existir, apenas vinculada ao administrador. Todas as
//   unidades de um administrador pertencem à mesma empresa (mesmo CNPJ): é isso que deixa ele alternar
//   entre elas no painel.
// --telefone: WhatsApp das unidades criadas agora (opcional).
//
// A senha NÃO vai na linha de comando (ficaria no histórico do terminal): o script pergunta
// (a digitação fica oculta) ou lê a variável ADMIN_SENHA. Mínimo 8 caracteres.
// Se o e-mail já for de um administrador, o script recusa; com --redefinir, troca só a senha.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../src/db');
const { cnpjValido, normalizarCnpj, slugificar, ufValida, formatarCnpj } = require('../src/utils/normalizacao');
const { criarUnidade, vincularAdmin } = require('../src/utils/unidades');

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
    console.log('Uso: npm run admin:criar -- --email x@y.com --nome Maria --sobrenome Silva --cnpj 00.000.000/0001-00 --unidades "Carazinho/RS,Panambi/RS" [--telefone "(54) 9 9999-9999"] [--redefinir]');
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

    const cnpj = normalizarCnpj(argumento('cnpj'));
    if (argumento('cnpj') && !cnpjValido(cnpj)) throw new Error('CNPJ inválido — confira os 14 dígitos.');
    const telefone = argumento('telefone');
    const pedidas = argumento('unidades').split(',').map(s => s.trim()).filter(Boolean).map((s) => {
      const [nome, uf] = s.split('/').map(p => p.trim());
      return { nome, uf: (uf || 'RS').toUpperCase() };
    });
    for (const p of pedidas) if (!p.nome || !ufValida(p.uf)) throw new Error(`Unidade inválida: "${p.nome}/${p.uf}". Use "Cidade/UF", ex.: Carazinho/RS.`);

    const cliente = await pool.connect();
    const resumo = [];
    try {
      await cliente.query('begin');
      const { rows: [novo] } = await cliente.query(
        'insert into administradores (nome, sobrenome, email, senha_hash) values ($1, $2, $3, $4) returning id',
        [argumento('nome').trim(), argumento('sobrenome').trim(), email, hash]
      );
      for (const p of pedidas) {
        const { rows: [ja] } = await cliente.query('select id, slug, cnpj from unidades where slug = $1', [slugificar(p.nome)]);
        if (ja) {
          // unidade que já existe: só vincula (e completa CNPJ/telefone se ela ainda não tinha)
          if (cnpj && ja.cnpj && normalizarCnpj(ja.cnpj) !== cnpj) throw new Error(`A unidade ${ja.slug} já tem outro CNPJ (${ja.cnpj}).`);
          if (cnpj) await cliente.query('update unidades set cnpj = coalesce(cnpj, $1) where id = $2', [formatarCnpj(cnpj), ja.id]);
          if (telefone) await cliente.query('update unidades set telefone = coalesce(telefone, $1) where id = $2', [telefone, ja.id]);
          await vincularAdmin(cliente, novo.id, ja.id);
          resumo.push(`${ja.slug} (já existia)`);
        } else {
          if (!cnpj) throw new Error(`Pra CRIAR a unidade "${p.nome}" informe o --cnpj da empresa.`);
          const criada = await criarUnidade(cliente, { nome: p.nome, uf: p.uf, telefone: telefone || null, endereco: null, endereco_curto: null }, cnpj);
          await vincularAdmin(cliente, novo.id, criada.id);
          resumo.push(`${criada.slug} (criada)`);
        }
      }
      await cliente.query('commit');
    } catch (erro) { await cliente.query('rollback').catch(() => {}); throw erro; } finally { cliente.release(); }
    console.log(`Administrador criado: ${email} (unidades: ${resumo.join(', ')}). Já dá pra entrar no portal.`);
  } catch (erro) {
    console.error('Erro:', erro.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
