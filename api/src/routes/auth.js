const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();
const SALT_ROUNDS = 10;

function assinarToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Cadastro de administrador (franqueado) — vincula às unidades pelos CNPJs informados
router.post('/cadastro/admin', async (req, res) => {
  const { nome, sobrenome, email, senha, cnpjs } = req.body;
  if (!nome || !sobrenome || !email || !senha || !Array.isArray(cnpjs) || cnpjs.length === 0) {
    return res.status(400).json({ erro: 'nome, sobrenome, email, senha e cnpjs são obrigatórios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const { rows: [admin] } = await client.query(
      `insert into administradores (nome, sobrenome, email, senha_hash)
       values ($1, $2, $3, $4) returning id, nome, sobrenome, email`,
      [nome, sobrenome, email, senhaHash]
    );

    const { rows: unidades } = await client.query(
      `select id, slug, nome from unidades where cnpj = any($1::text[])`,
      [cnpjs]
    );
    if (unidades.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Nenhuma unidade encontrada para os CNPJs informados' });
    }

    for (const unidade of unidades) {
      await client.query(
        `insert into administrador_unidades (administrador_id, unidade_id) values ($1, $2)`,
        [admin.id, unidade.id]
      );
    }

    await client.query('COMMIT');
    const token = assinarToken({ id: admin.id, perfil: 'administrador' });
    res.status(201).json({ token, administrador: admin, unidades });
  } catch (erro) {
    await client.query('ROLLBACK');
    if (erro.code === '23505') return res.status(409).json({ erro: 'E-mail já cadastrado' });
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar administrador' });
  } finally {
    client.release();
  }
});

// Cadastro de prestadora — vinculada a uma unidade desde o cadastro
router.post('/cadastro/prestadora', async (req, res) => {
  const { nome, telefone, senha, unidade_slug } = req.body;
  if (!nome || !telefone || !senha || !unidade_slug) {
    return res.status(400).json({ erro: 'nome, telefone, senha e unidade_slug são obrigatórios' });
  }

  try {
    const { rows: [unidade] } = await pool.query('select id from unidades where slug = $1', [unidade_slug]);
    if (!unidade) return res.status(400).json({ erro: 'Unidade não encontrada' });

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const { rows: [prestadora] } = await pool.query(
      `insert into prestadoras (nome, telefone, senha_hash, unidade_id)
       values ($1, $2, $3, $4) returning id, nome, telefone, unidade_id, ativa`,
      [nome, telefone, senhaHash, unidade.id]
    );

    const token = assinarToken({ id: prestadora.id, perfil: 'prestadora', unidade_id: prestadora.unidade_id });
    res.status(201).json({ token, prestadora });
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Telefone já cadastrado' });
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar prestadora' });
  }
});

// Cadastro de cliente
router.post('/cadastro/cliente', async (req, res) => {
  const { nome, telefone, email, senha, unidade_slug } = req.body;
  if (!nome || !senha || !email || !unidade_slug) {
    return res.status(400).json({ erro: 'nome, email, senha e unidade_slug são obrigatórios' });
  }

  try {
    const { rows: [unidade] } = await pool.query('select id from unidades where slug = $1', [unidade_slug]);
    if (!unidade) return res.status(400).json({ erro: 'Unidade não encontrada' });

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const { rows: [cliente] } = await pool.query(
      `insert into clientes (nome, telefone, email, senha_hash, unidade_id)
       values ($1, $2, $3, $4, $5) returning id, nome, telefone, email, unidade_id`,
      [nome, telefone || null, email, senhaHash, unidade.id]
    );

    const token = assinarToken({ id: cliente.id, perfil: 'cliente', unidade_id: cliente.unidade_id });
    res.status(201).json({ token, cliente });
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'E-mail já cadastrado' });
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
  }
});

// Login unificado — perfil decide em qual tabela procurar e qual campo usar como identificador
router.post('/login', async (req, res) => {
  const { perfil, identificador, senha } = req.body;
  if (!perfil || !identificador || !senha) {
    return res.status(400).json({ erro: 'perfil, identificador e senha são obrigatórios' });
  }

  const config = {
    administrador: { tabela: 'administradores', campo: 'email' },
    prestadora: { tabela: 'prestadoras', campo: 'telefone' },
    cliente: { tabela: 'clientes', campo: 'email' },
  }[perfil];

  if (!config) return res.status(400).json({ erro: 'Perfil inválido' });

  try {
    const { rows: [usuario] } = await pool.query(
      `select * from ${config.tabela} where ${config.campo} = $1`,
      [identificador]
    );
    if (!usuario || !usuario.senha_hash) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaOk) return res.status(401).json({ erro: 'Credenciais inválidas' });

    delete usuario.senha_hash;
    const token = assinarToken({ id: usuario.id, perfil, unidade_id: usuario.unidade_id });
    res.json({ token, perfil, usuario });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
});

module.exports = router;
