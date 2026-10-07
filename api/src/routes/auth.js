const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { normalizarEmail, normalizarTelefone, normalizarCnpj } = require('../utils/normalizacao');
const { senhaValida, emailValido, nomeValido, telefoneValido } = require('../utils/validacao');
const { enviarCodigoConfirmacao, consumirCodigo, MOTIVO_CADASTRO, MOTIVO_RECUPERACAO } = require('../utils/verificacaoEmail');
const { unidadesDoAdmin } = require('../utils/permissoes');

const router = express.Router();
const SALT_ROUNDS = 10;

function assinarToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function erroCredencial(res) {
  return res.status(400).json({ erro: 'E-mail inválido ou senha com menos de 8 caracteres' });
}

// Erro "esperado" lançado de dentro de uma transação (vira resposta 4xx, não 500).
class ErroNegocio extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

// Roda `fn` numa transação: tudo ou nada. É isso que garante que o código de
// verificação só é "gasto" se a conta de fato foi criada — antes, um erro no
// meio (telefone repetido, unidade inexistente) queimava o código e a pessoa
// tinha que pedir outro sem entender o porquê.
async function emTransacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

function responderErroCadastro(res, erro, mensagemDuplicado) {
  if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message });
  if (erro.code === '23505') return res.status(409).json({ erro: mensagemDuplicado });
  console.error(erro);
  return res.status(500).json({ erro: 'Erro ao concluir o cadastro. Tente de novo.' });
}

// Cadastro de administrador (franqueado) — em duas etapas. CNPJ é um dado
// PÚBLICO (nota fiscal, Receita Federal, Google Maps...), então só bater o
// CNPJ nunca pode ser prova suficiente de que quem está se cadastrando é o
// dono da franquia. Por isso este passo só valida os CNPJs e manda um código
// de 6 dígitos pro e-mail informado — a conta só é criada de fato em
// /cadastro/admin/confirmar, depois do código confirmado.
//
// O CNPJ é comparado só pelos dígitos: "12.345.678/0001-90" e "12345678000190"
// são o mesmo CNPJ (antes, digitar sem pontuação dava "nenhuma unidade encontrada").
const SQL_UNIDADES_POR_CNPJ = `select id, slug, nome from unidades where regexp_replace(cnpj, '\\D', '', 'g') = any($1::text[])`;

function cnpjsValidos(cnpjs) {
  return Array.isArray(cnpjs) ? [...new Set(cnpjs.map(normalizarCnpj).filter(c => c.length === 14))] : [];
}

router.post('/cadastro/admin', async (req, res) => {
  const { nome, sobrenome, email, senha, cnpjs } = req.body;
  if (!nome || !sobrenome || !email || !senha || !Array.isArray(cnpjs) || cnpjs.length === 0) {
    return res.status(400).json({ erro: 'nome, sobrenome, email, senha e cnpjs são obrigatórios' });
  }
  if (!nomeValido(nome) || !nomeValido(sobrenome)) return res.status(400).json({ erro: 'Informe nome e sobrenome válidos' });
  if (!emailValido(email) || !senhaValida(senha)) return erroCredencial(res);
  const listaCnpj = cnpjsValidos(cnpjs);
  if (listaCnpj.length === 0) return res.status(400).json({ erro: 'CNPJ inválido (são 14 dígitos)' });

  const emailNormalizado = normalizarEmail(email);
  try {
    const { rows: existentes } = await pool.query('select id from administradores where email = $1', [emailNormalizado]);
    if (existentes.length > 0) return res.status(409).json({ erro: 'E-mail já cadastrado' });

    const { rows: unidades } = await pool.query(SQL_UNIDADES_POR_CNPJ, [listaCnpj]);
    if (unidades.length === 0) {
      return res.status(400).json({ erro: 'Nenhuma unidade encontrada para os CNPJs informados' });
    }

    const envio = await enviarCodigoConfirmacao(emailNormalizado, MOTIVO_CADASTRO);

    res.json({ aguardandoConfirmacao: true, emailEnviado: envio.enviado, motivoEmail: envio.motivo, unidades: unidades.map(u => ({ slug: u.slug, nome: u.nome })) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao iniciar cadastro' });
  }
});

// Confirma o código enviado por e-mail e só então cria a conta + vincula as unidades
router.post('/cadastro/admin/confirmar', async (req, res) => {
  const { nome, sobrenome, email, senha, cnpjs, codigo } = req.body;
  if (!nome || !sobrenome || !email || !senha || !Array.isArray(cnpjs) || cnpjs.length === 0 || !codigo) {
    return res.status(400).json({ erro: 'nome, sobrenome, email, senha, cnpjs e codigo são obrigatórios' });
  }
  if (!nomeValido(nome) || !nomeValido(sobrenome)) return res.status(400).json({ erro: 'Informe nome e sobrenome válidos' });
  if (!emailValido(email) || !senhaValida(senha)) return erroCredencial(res);
  const listaCnpj = cnpjsValidos(cnpjs);
  if (listaCnpj.length === 0) return res.status(400).json({ erro: 'CNPJ inválido (são 14 dígitos)' });
  const emailNormalizado = normalizarEmail(email);

  try {
    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS); // fora da transação: não segura conexão à toa
    const { admin, unidades } = await emTransacao(async (db) => {
      if (!await consumirCodigo(db, emailNormalizado, String(codigo).trim())) throw new ErroNegocio(400, 'Código inválido ou expirado');

      const { rows: unidadesDoAdmin } = await db.query(SQL_UNIDADES_POR_CNPJ, [listaCnpj]);
      if (unidadesDoAdmin.length === 0) throw new ErroNegocio(400, 'Nenhuma unidade encontrada para os CNPJs informados');

      const { rows: [novo] } = await db.query(
        `insert into administradores (nome, sobrenome, email, senha_hash)
         values ($1, $2, $3, $4) returning id, nome, sobrenome, email`,
        [nome.trim(), sobrenome.trim(), emailNormalizado, senhaHash]
      );
      for (const unidade of unidadesDoAdmin) {
        await db.query('insert into administrador_unidades (administrador_id, unidade_id) values ($1, $2)', [novo.id, unidade.id]);
      }
      return { admin: novo, unidades: unidadesDoAdmin };
    });

    const token = assinarToken({ id: admin.id, perfil: 'administrador' });
    res.status(201).json({ token, administrador: admin, unidades });
  } catch (erro) {
    responderErroCadastro(res, erro, 'E-mail já cadastrado');
  }
});

// Cadastro de prestadora — em duas etapas, igual ao de admin. Não existe API
// de WhatsApp pra verificar o telefone de verdade, então a verificação de
// identidade é sempre por e-mail (sem restrição de domínio).
router.post('/cadastro/prestadora', async (req, res) => {
  const { nome, telefone, email, senha, unidade_slug } = req.body;
  if (!nome || !telefone || !email || !senha || !unidade_slug) {
    return res.status(400).json({ erro: 'nome, telefone, email, senha e unidade_slug são obrigatórios' });
  }
  if (!nomeValido(nome)) return res.status(400).json({ erro: 'Informe um nome válido' });
  const telefoneNormalizado = normalizarTelefone(telefone);
  if (!telefoneValido(telefoneNormalizado)) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número' });
  if (!emailValido(email) || !senhaValida(senha)) return erroCredencial(res);

  try {
    const { rows: [unidade] } = await pool.query('select id from unidades where slug = $1', [unidade_slug]);
    if (!unidade) return res.status(400).json({ erro: 'Unidade não encontrada' });

    const { rows: telExistente } = await pool.query('select id from prestadoras where telefone = $1', [telefoneNormalizado]);
    if (telExistente.length > 0) return res.status(409).json({ erro: 'Telefone já cadastrado' });

    const envio = await enviarCodigoConfirmacao(normalizarEmail(email), MOTIVO_CADASTRO);

    res.json({ aguardandoConfirmacao: true, emailEnviado: envio.enviado, motivoEmail: envio.motivo });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao iniciar cadastro' });
  }
});

router.post('/cadastro/prestadora/confirmar', async (req, res) => {
  const { nome, telefone, email, senha, unidade_slug, codigo } = req.body;
  if (!nome || !telefone || !email || !senha || !unidade_slug || !codigo) {
    return res.status(400).json({ erro: 'nome, telefone, email, senha, unidade_slug e codigo são obrigatórios' });
  }
  if (!nomeValido(nome)) return res.status(400).json({ erro: 'Informe um nome válido' });
  const telefoneNormalizado = normalizarTelefone(telefone);
  if (!telefoneValido(telefoneNormalizado)) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número' });
  if (!emailValido(email) || !senhaValida(senha)) return erroCredencial(res);
  const emailNormalizado = normalizarEmail(email);

  try {
    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const prestadora = await emTransacao(async (db) => {
      if (!await consumirCodigo(db, emailNormalizado, String(codigo).trim())) throw new ErroNegocio(400, 'Código inválido ou expirado');

      const { rows: [unidade] } = await db.query('select id from unidades where slug = $1', [unidade_slug]);
      if (!unidade) throw new ErroNegocio(400, 'Unidade não encontrada');

      const { rows: [nova] } = await db.query(
        `insert into prestadoras (nome, telefone, email, senha_hash, unidade_id)
         values ($1, $2, $3, $4, $5) returning id, nome, telefone, email, unidade_id, ativa`,
        [nome.trim(), telefoneNormalizado, emailNormalizado, senhaHash, unidade.id]
      );
      return nova;
    });

    const token = assinarToken({ id: prestadora.id, perfil: 'prestadora', unidade_id: prestadora.unidade_id });
    res.status(201).json({ token, prestadora });
  } catch (erro) {
    responderErroCadastro(res, erro, 'Telefone já cadastrado');
  }
});

// Cadastro de cliente — mesma lógica de duas etapas: sem verificar o e-mail
// antes de criar a conta, um erro de digitação trancaria o próprio login
// (e-mail é o identificador do cliente).
router.post('/cadastro/cliente', async (req, res) => {
  const { nome, telefone, email, senha, unidade_slug } = req.body;
  if (!nome || !senha || !email || !unidade_slug) {
    return res.status(400).json({ erro: 'nome, email, senha e unidade_slug são obrigatórios' });
  }
  if (!nomeValido(nome)) return res.status(400).json({ erro: 'Informe um nome válido' });
  if (!emailValido(email) || !senhaValida(senha)) return erroCredencial(res);
  if (telefone && !telefoneValido(normalizarTelefone(telefone))) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número' });

  try {
    const { rows: [unidade] } = await pool.query('select id from unidades where slug = $1', [unidade_slug]);
    if (!unidade) return res.status(400).json({ erro: 'Unidade não encontrada' });

    const emailNormalizado = normalizarEmail(email);
    const { rows: existentes } = await pool.query('select id from clientes where email = $1', [emailNormalizado]);
    if (existentes.length > 0) return res.status(409).json({ erro: 'E-mail já cadastrado' });

    const envio = await enviarCodigoConfirmacao(emailNormalizado, MOTIVO_CADASTRO);

    res.json({ aguardandoConfirmacao: true, emailEnviado: envio.enviado, motivoEmail: envio.motivo });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao iniciar cadastro' });
  }
});

router.post('/cadastro/cliente/confirmar', async (req, res) => {
  const { nome, telefone, email, senha, unidade_slug, codigo } = req.body;
  if (!nome || !senha || !email || !unidade_slug || !codigo) {
    return res.status(400).json({ erro: 'nome, email, senha, unidade_slug e codigo são obrigatórios' });
  }
  if (!nomeValido(nome)) return res.status(400).json({ erro: 'Informe um nome válido' });
  if (!emailValido(email) || !senhaValida(senha)) return erroCredencial(res);
  if (telefone && !telefoneValido(normalizarTelefone(telefone))) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número' });
  const emailNormalizado = normalizarEmail(email);

  try {
    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const cliente = await emTransacao(async (db) => {
      if (!await consumirCodigo(db, emailNormalizado, String(codigo).trim())) throw new ErroNegocio(400, 'Código inválido ou expirado');

      const { rows: [unidade] } = await db.query('select id from unidades where slug = $1', [unidade_slug]);
      if (!unidade) throw new ErroNegocio(400, 'Unidade não encontrada');

      const { rows: [novo] } = await db.query(
        `insert into clientes (nome, telefone, email, senha_hash, unidade_id)
         values ($1, $2, $3, $4, $5) returning id, nome, telefone, email, unidade_id`,
        [nome.trim(), telefone ? normalizarTelefone(telefone) : null, emailNormalizado, senhaHash, unidade.id]
      );
      return novo;
    });

    const token = assinarToken({ id: cliente.id, perfil: 'cliente', unidade_id: cliente.unidade_id });
    res.status(201).json({ token, cliente });
  } catch (erro) {
    responderErroCadastro(res, erro, 'E-mail já cadastrado');
  }
});

// Confere a senha de uma linha de usuário; devolve a linha (com a cidade) ou null.
async function conferirSenha(usuario, senha) {
  if (!usuario || !usuario.senha_hash) return null;
  if (!await bcrypt.compare(senha, usuario.senha_hash)) return null;
  if (usuario.unidade_id) {
    // O front precisa saber a cidade REAL de quem entrou (prestadora, cliente,
    // funcionário) — quem abre o site por um link cai na cidade padrão da home.
    const { rows: [unidade] } = await pool.query('select slug from unidades where id = $1', [usuario.unidade_id]);
    if (unidade) usuario.unidade_slug = unidade.slug;
  }
  return usuario;
}

// Busca um usuário por tabela/campo e confere a senha; retorna null se não bater.
// Normaliza o identificador do mesmo jeito que foi normalizado no cadastro —
// senão "Nome@Site.com" no cadastro e "nome@site.com" no login não bateriam.
async function buscarEValidar(tabela, campo, identificador, senha) {
  const valor = campo === 'telefone' ? normalizarTelefone(identificador) : normalizarEmail(identificador);
  const { rows } = await pool.query(`select * from ${tabela} where ${campo} = $1`, [valor]);
  // e-mail de prestadora não é único (é só contato): confere a senha em cada linha encontrada
  for (const linha of rows) {
    const ok = await conferirSenha(linha, senha);
    if (ok) return ok;
  }
  return null;
}

// Login unificado — perfil decide em qual tabela procurar e qual campo usar como identificador.
// 'administrador' tenta primeiro administradores (franqueado) e, se não achar, sub_administradores
// (funcionário) — a mesma tela de login serve para os dois, a distinção é resolvida aqui no backend.
// A prestadora entra com telefone OU e-mail (a tela de login diz "E-mail ou telefone").
router.post('/login', async (req, res) => {
  const { perfil, identificador, senha } = req.body;
  if (!perfil || !identificador || !senha) {
    return res.status(400).json({ erro: 'perfil, identificador e senha são obrigatórios' });
  }

  try {
    if (perfil === 'administrador') {
      let usuario = await buscarEValidar('administradores', 'email', identificador, senha);
      let perfilResolvido = 'administrador';
      if (!usuario) {
        usuario = await buscarEValidar('sub_administradores', 'email', identificador, senha);
        perfilResolvido = 'sub_administrador';
      }
      if (!usuario) return res.status(401).json({ erro: 'Credenciais inválidas' });
      if (perfilResolvido === 'sub_administrador' && !usuario.ativo) {
        return res.status(401).json({ erro: 'Seu acesso está desativado. Peça ao administrador para reativá-lo (tela Acessos).' });
      }

      delete usuario.senha_hash;
      // Administrador pode ter 1 ou mais unidades; a tela precisa saber quais (senão
      // um admin só de Panambi tentava abrir Carazinho, a cidade padrão, e tomava 403).
      if (perfilResolvido === 'administrador') usuario.unidades_slugs = await unidadesDoAdmin(usuario.id);
      const payload = perfilResolvido === 'administrador'
        ? { id: usuario.id, perfil: 'administrador' }
        : { id: usuario.id, perfil: 'sub_administrador', unidade_id: usuario.unidade_id };
      const token = assinarToken(payload);
      return res.json({ token, perfil: perfilResolvido, usuario });
    }

    const config = {
      prestadora: { tabela: 'prestadoras', campo: String(identificador).includes('@') ? 'email' : 'telefone' },
      cliente: { tabela: 'clientes', campo: 'email' },
    }[perfil];
    if (!config) return res.status(400).json({ erro: 'Perfil inválido' });

    const usuario = await buscarEValidar(config.tabela, config.campo, identificador, senha);
    if (!usuario) return res.status(401).json({ erro: 'Credenciais inválidas' });

    delete usuario.senha_hash;
    const token = assinarToken({ id: usuario.id, perfil, unidade_id: usuario.unidade_id });
    res.json({ token, perfil, usuario });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
});

// Recuperação de senha — código de 6 dígitos enviado ao e-mail da conta, em duas
// etapas (pedir o código / trocar a senha com ele). A identidade é provada por
// controlar a caixa de e-mail, o mesmo critério do cadastro.
//
// O pedido SEMPRE responde igual, exista a conta ou não: do contrário a rota
// viraria um "descobridor" de quem tem cadastro. O e-mail só sai se a conta existe.
// O código fica guardado sob uma chave própria ("recuperar:perfil:email"), então
// um código de cadastro nunca serve pra redefinir senha.
const MENSAGEM_RECUPERACAO = 'Se existir uma conta com esse dado, enviamos um código de 6 dígitos para o e-mail cadastrado. Ele vale por 15 minutos.';

// Acha a(s) conta(s) do perfil pelo identificador digitado (mesmas regras do login:
// administrador/funcionário e cliente por e-mail, prestadora por telefone OU e-mail).
// Só entram contas que têm senha (login de verdade) e e-mail pra receber o código.
// E-mail de prestadora não é único, então todas as contas ligadas a ele são devolvidas.
async function acharContasParaRecuperar(perfil, identificador) {
  const id = String(identificador ?? '').trim();
  if (!id) return null;
  let candidatas;
  if (perfil === 'administrador') candidatas = [['administradores', 'email'], ['sub_administradores', 'email']];
  else if (perfil === 'prestadora') candidatas = [['prestadoras', id.includes('@') ? 'email' : 'telefone']];
  else if (perfil === 'cliente') candidatas = [['clientes', 'email']];
  else return null;

  for (const [tabela, campo] of candidatas) { // nomes de tabela/coluna são literais acima
    const valor = campo === 'telefone' ? normalizarTelefone(id) : normalizarEmail(id);
    const { rows } = await pool.query(
      `select id, email from ${tabela} where ${campo} = $1 and senha_hash is not null and email is not null`, [valor]
    );
    if (rows.length > 0) {
      const email = normalizarEmail(rows[0].email);
      return { tabela, ids: rows.map(r => r.id), email, chave: `recuperar:${perfil}:${email}` };
    }
  }
  return null;
}

const PERFIS_RECUPERACAO = ['administrador', 'prestadora', 'cliente'];

router.post('/recuperar-senha', async (req, res) => {
  const { perfil, identificador } = req.body;
  if (!PERFIS_RECUPERACAO.includes(perfil)) return res.status(400).json({ erro: 'Perfil inválido' });
  if (!String(identificador ?? '').trim()) return res.status(400).json({ erro: 'Informe seu e-mail (ou telefone, no caso de prestadora)' });

  try {
    const conta = await acharContasParaRecuperar(perfil, identificador);
    if (conta) {
      const envio = await enviarCodigoConfirmacao(conta.chave, { ...MOTIVO_RECUPERACAO, para: conta.email });
      // a resposta não revela nada, mas quem opera a API precisa saber se o e-mail não saiu
      if (!envio.enviado) console.warn(`[recuperar-senha] e-mail não enviado (${envio.motivo}) — o código foi logado acima.`);
    }
    res.json({ ok: true, mensagem: MENSAGEM_RECUPERACAO });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Não foi possível enviar o código agora. Tente de novo.' });
  }
});

router.post('/recuperar-senha/confirmar', async (req, res) => {
  const { perfil, identificador, codigo, senha } = req.body;
  if (!PERFIS_RECUPERACAO.includes(perfil)) return res.status(400).json({ erro: 'Perfil inválido' });
  if (!String(identificador ?? '').trim() || !codigo || !senha) {
    return res.status(400).json({ erro: 'Informe o e-mail/telefone, o código e a nova senha' });
  }
  if (!senhaValida(senha)) return res.status(400).json({ erro: 'A nova senha precisa ter ao menos 8 caracteres' });

  try {
    const conta = await acharContasParaRecuperar(perfil, identificador);
    // conta inexistente responde igual a código errado
    if (!conta) return res.status(400).json({ erro: 'Código inválido ou expirado' });

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    await emTransacao(async (db) => {
      if (!await consumirCodigo(db, conta.chave, String(codigo).trim())) throw new ErroNegocio(400, 'Código inválido ou expirado');
      await db.query(`update ${conta.tabela} set senha_hash = $1 where id = any($2::uuid[])`, [senhaHash, conta.ids]);
    });
    res.json({ ok: true, mensagem: 'Senha redefinida! Entre com a nova senha.' });
  } catch (erro) {
    if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message });
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao redefinir a senha. Tente de novo.' });
  }
});

module.exports = router;
