const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { normalizarEmail, normalizarTelefone } = require('../utils/normalizacao');
const { senhaValida, emailValido, telefoneValido } = require('../utils/validacao');
const { enviarCodigoConfirmacao, consumirCodigo } = require('../utils/verificacaoEmail');
const { SENHA_PADRAO } = require('../utils/prestadorasImportadas');
const { ErroNegocio, emTransacao } = require('../utils/unidades');

const router = express.Router();

// Primeiro acesso da prestadora cuja conta nasceu na importação da planilha (e-mail presumido + senha padrão).
// Antes de usar o portal ela é obrigada a: informar o e-mail DELA, provar que tem acesso a ele (código de 6
// dígitos) e trocar a senha padrão. Só então `primeiro_acesso_pendente` vira false e o resto da API abre.
// (O que ela pode fazer enquanto está pendente é só isto: ver requirePrimeiroAcessoConcluido.)
const MOTIVO_PRIMEIRO_ACESSO = { assunto: 'Confirme seu e-mail — Portal da Maria', motivo: 'confirmar o seu e-mail e concluir o primeiro acesso' };

// manda e-mail de verdade e o código tem só 6 dígitos: sem limite, dava pra gerar spam e adivinhar o código
const limite = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// a chave do código inclui a conta: um código pedido por uma prestadora nunca vale pra outra
const chaveDoCodigo = (id, email) => `primeiro-acesso:${id}:${email}`;

async function contaPendente(id) {
  const { rows: [p] } = await pool.query('select id, nome, telefone, email, primeiro_acesso_pendente from prestadoras where id = $1', [id]);
  return p?.primeiro_acesso_pendente ? p : null;
}

// Passo 1: valida o e-mail e manda o código
router.post('/solicitar', limite, requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const conta = await contaPendente(req.user.id);
  if (!conta) return res.status(400).json({ erro: 'O primeiro acesso desta conta já foi concluído.' });

  const email = normalizarEmail(req.body.email);
  if (!emailValido(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  const { rows: emUso } = await pool.query('select 1 from prestadoras where email = $1 and id <> $2', [email, conta.id]);
  if (emUso.length) return res.status(409).json({ erro: 'Esse e-mail já é de outra prestadora. Use o seu e-mail pessoal.' });

  const envio = await enviarCodigoConfirmacao(chaveDoCodigo(conta.id, email), { ...MOTIVO_PRIMEIRO_ACESSO, para: email });
  res.json({ aguardandoConfirmacao: true, emailEnviado: envio.enviado, motivoEmail: envio.motivo });
}));

// Passo 2: confere o código e, numa transação só, grava e-mail + senha nova (+ telefone, se ela informou)
router.post('/concluir', limite, requireAuth, requireRole('prestadora'), asyncHandler(async (req, res) => {
  const conta = await contaPendente(req.user.id);
  if (!conta) return res.status(400).json({ erro: 'O primeiro acesso desta conta já foi concluído.' });

  const email = normalizarEmail(req.body.email);
  const codigo = String(req.body.codigo ?? '').trim();
  const senhaNova = String(req.body.senha_nova ?? '');
  if (!emailValido(email) || !codigo) return res.status(400).json({ erro: 'Informe o e-mail e o código recebido.' });
  if (!senhaValida(senhaNova)) return res.status(400).json({ erro: 'A senha nova precisa ter ao menos 8 caracteres.' });
  if (senhaNova === SENHA_PADRAO) return res.status(400).json({ erro: 'Escolha uma senha diferente da senha padrão.' });

  let telefone = conta.telefone; // sem telefone informado, mantém o que o administrador cadastrou
  if (req.body.telefone !== undefined && String(req.body.telefone).trim() !== '') {
    telefone = normalizarTelefone(req.body.telefone);
    if (!telefoneValido(telefone)) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número.' });
  }

  const senhaHash = await bcrypt.hash(senhaNova, 10);
  try {
    const usuario = await emTransacao(async (db) => {
      if (!await consumirCodigo(db, chaveDoCodigo(conta.id, email), codigo)) throw new ErroNegocio(400, 'Código inválido ou expirado');
      const { rows: [p] } = await db.query(
        `update prestadoras set email = $1, senha_hash = $2, telefone = $3, primeiro_acesso_pendente = false, atualizado_em = now()
         where id = $4 returning *`,
        [email, senhaHash, telefone, conta.id]
      );
      return p;
    });
    delete usuario.senha_hash;
    res.json({ ok: true, usuario });
  } catch (erro) {
    if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message });
    if (erro.code === '23505') return res.status(409).json({ erro: 'Esse telefone já está cadastrado em outra conta.' });
    throw erro;
  }
}));

module.exports = router;
