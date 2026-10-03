const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { unidadesDoAdmin } = require('../utils/permissoes');
const { normalizarEmail, normalizarTelefone, emailInstitucionalValido, DOMINIO_INSTITUCIONAL } = require('../utils/normalizacao');
const { senhaValida, emailValido, telefoneValido } = require('../utils/validacao');
const { enviarCodigoConfirmacao, confirmarCodigo, MOTIVO_TROCA_EMAIL } = require('../utils/verificacaoEmail');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const SALT_ROUNDS = 10;

// Cada perfil vive numa tabela diferente, com campos ligeiramente diferentes
// (administrador/sub-admin têm sobrenome; prestadora usa telefone como login
// e e-mail é só contato opcional, sem dono único; cliente usa e-mail como
// login). Esse mapa deixa as rotas abaixo genéricas em vez de repetir a mesma
// lógica 4 vezes. `exigeDominio` (restrição @mariabrasileira.com.br + nome da
// unidade) existe mas fica desligada pra todo mundo por pedido do usuário —
// verificar o domínio na Resend/DNS não valia a complicação por enquanto;
// basta virar `true` num perfil se essa exigência voltar a fazer sentido.
const CONFIG = {
  administrador: { tabela: 'administradores', temSobrenome: true, temTelefone: true, telefoneObrigatorio: false, temEmail: true, emailUnico: true, exigeDominio: false },
  sub_administrador: { tabela: 'sub_administradores', temSobrenome: true, temTelefone: true, telefoneObrigatorio: false, temEmail: true, emailUnico: true, exigeDominio: false },
  // telefone é o login da prestadora (coluna not null unique) — nunca pode ficar em branco, diferente dos outros 3.
  prestadora: { tabela: 'prestadoras', temSobrenome: false, temTelefone: true, telefoneObrigatorio: true, temEmail: true, emailUnico: false, exigeDominio: false },
  cliente: { tabela: 'clientes', temSobrenome: false, temTelefone: true, telefoneObrigatorio: false, temEmail: true, emailUnico: true, exigeDominio: false },
};

async function unidadeSlugDoUsuario(tabela, id) {
  const { rows: [row] } = await pool.query(
    `select u.slug from unidades u join ${tabela} t on t.unidade_id = u.id where t.id = $1`,
    [id]
  );
  return row ? row.slug : null;
}

async function slugsPermitidosPara(perfil, tabela, id) {
  if (perfil === 'administrador') return unidadesDoAdmin(id);
  const slug = await unidadeSlugDoUsuario(tabela, id);
  return slug ? [slug] : [];
}

// Dados do próprio perfil logado — funciona pros 4 tipos de usuário.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const cfg = CONFIG[req.user.perfil];
  if (!cfg) return res.status(400).json({ erro: 'Perfil sem tela de configurações' });

  const { rows: [dados] } = await pool.query(`select * from ${cfg.tabela} where id = $1`, [req.user.id]);
  if (!dados) return res.status(404).json({ erro: 'Perfil não encontrado' });
  delete dados.senha_hash;

  const unidadesSlugs = await slugsPermitidosPara(req.user.perfil, cfg.tabela, req.user.id);

  res.json({
    ...dados,
    perfil: req.user.perfil,
    temSobrenome: cfg.temSobrenome,
    temTelefone: cfg.temTelefone,
    temEmail: cfg.temEmail,
    exigeDominioInstitucional: !!cfg.exigeDominio,
    dominioInstitucional: DOMINIO_INSTITUCIONAL,
    unidadesSlugs,
  });
}));

// Nome/sobrenome/telefone/foto — não precisam de verificação, ao contrário do e-mail.
router.patch('/', requireAuth, asyncHandler(async (req, res) => {
  const cfg = CONFIG[req.user.perfil];
  if (!cfg) return res.status(400).json({ erro: 'Perfil sem tela de configurações' });

  const { nome, sobrenome, telefone, foto } = req.body;
  const sets = [];
  const vals = [];
  let i = 1;

  if (nome !== undefined) {
    if (!nome || !nome.trim()) return res.status(400).json({ erro: 'nome não pode ficar vazio' });
    sets.push(`nome = $${i++}`); vals.push(nome.trim());
  }
  if (cfg.temSobrenome && sobrenome !== undefined) {
    if (!sobrenome || !sobrenome.trim()) return res.status(400).json({ erro: 'sobrenome não pode ficar vazio' });
    sets.push(`sobrenome = $${i++}`); vals.push(sobrenome.trim());
  }
  if (cfg.temTelefone && telefone !== undefined) {
    const tel = normalizarTelefone(telefone);
    if (cfg.telefoneObrigatorio && !tel) return res.status(400).json({ erro: 'telefone é obrigatório para este perfil' });
    if (tel && !telefoneValido(tel)) return res.status(400).json({ erro: 'Telefone inválido — informe DDD + número' });
    sets.push(`telefone = $${i++}`); vals.push(tel || null);
  }
  if (foto !== undefined) {
    if (foto) {
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(foto)) {
        return res.status(400).json({ erro: 'Formato de imagem inválido' });
      }
      if (foto.length > 1_800_000) { // ~1.3MB de imagem decodificada
        return res.status(400).json({ erro: 'Imagem muito grande (máximo ~1,3MB)' });
      }
    }
    sets.push(`foto = $${i++}`); vals.push(foto || null);
  }
  if (sets.length === 0) return res.status(400).json({ erro: 'Nada para atualizar' });

  vals.push(req.user.id);
  try {
    const { rows: [dados] } = await pool.query(
      `update ${cfg.tabela} set ${sets.join(', ')} where id = $${i} returning *`,
      vals
    );
    if (!dados) return res.status(404).json({ erro: 'Perfil não encontrado' });
    delete dados.senha_hash;
    res.json(dados);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Telefone já cadastrado por outra conta' });
    throw erro;
  }
}));

// Esta rota dispara e-mail de verdade (custa cota do provedor) e o código tem
// só 6 dígitos — sem limite de tentativas dava pra usá-la pra spam e pra
// adivinhar o código por força bruta.
const limiteEmail = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// Passo 1: valida o e-mail (institucional, se o perfil exigir) e manda um
// código de 6 dígitos pra ele — a troca só acontece de fato em /email/confirmar.
// Mesma regra do cadastro: e-mail nunca é trocado sem confirmar que quem está
// mudando tem acesso a essa caixa de entrada.
router.post('/email/solicitar', limiteEmail, requireAuth, asyncHandler(async (req, res) => {
  const cfg = CONFIG[req.user.perfil];
  if (!cfg || !cfg.temEmail) return res.status(400).json({ erro: 'Este perfil não tem e-mail' });

  const { email } = req.body;
  if (!emailValido(email)) return res.status(400).json({ erro: 'E-mail inválido' });

  if (cfg.exigeDominio) {
    const slugs = await slugsPermitidosPara(req.user.perfil, cfg.tabela, req.user.id);
    if (!emailInstitucionalValido(email, slugs)) {
      return res.status(400).json({
        erro: `E-mail precisa terminar em @${DOMINIO_INSTITUCIONAL} e começar com o nome da sua unidade` +
          (slugs.length ? ` (${slugs.join(' ou ')})` : ''),
      });
    }
  }

  const emailNormalizado = normalizarEmail(email);
  if (cfg.emailUnico) {
    const { rows: existentes } = await pool.query(
      `select id from ${cfg.tabela} where email = $1 and id <> $2`,
      [emailNormalizado, req.user.id]
    );
    if (existentes.length > 0) return res.status(409).json({ erro: 'E-mail já usado por outra conta' });
  }

  const envio = await enviarCodigoConfirmacao(emailNormalizado, MOTIVO_TROCA_EMAIL);
  res.json({ aguardandoConfirmacao: true, emailEnviado: envio.enviado, motivoEmail: envio.motivo });
}));

// Passo 2: confirma o código e só então grava o e-mail novo.
router.post('/email/confirmar', limiteEmail, requireAuth, asyncHandler(async (req, res) => {
  const cfg = CONFIG[req.user.perfil];
  if (!cfg || !cfg.temEmail) return res.status(400).json({ erro: 'Este perfil não tem e-mail' });

  const { email, codigo } = req.body;
  if (!email || !codigo) return res.status(400).json({ erro: 'email e codigo são obrigatórios' });
  const emailNormalizado = normalizarEmail(email);

  const ok = await confirmarCodigo(emailNormalizado, String(codigo).trim());
  if (!ok) return res.status(400).json({ erro: 'Código inválido ou expirado' });

  try {
    const { rows: [dados] } = await pool.query(
      `update ${cfg.tabela} set email = $1 where id = $2 returning *`,
      [emailNormalizado, req.user.id]
    );
    if (!dados) return res.status(404).json({ erro: 'Perfil não encontrado' });
    delete dados.senha_hash;
    res.json(dados);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'E-mail já usado por outra conta' });
    throw erro;
  }
}));

// Troca de senha — exige a senha atual (nunca só a nova), pra ninguém com uma
// sessão aberta numa máquina compartilhada trocar a senha de outra pessoa.
router.patch('/senha', requireAuth, asyncHandler(async (req, res) => {
  const cfg = CONFIG[req.user.perfil];
  if (!cfg) return res.status(400).json({ erro: 'Perfil sem tela de configurações' });

  const { senha_atual, senha_nova } = req.body;
  if (!senha_atual || !senha_nova) return res.status(400).json({ erro: 'senha_atual e senha_nova são obrigatórios' });
  if (!senhaValida(senha_nova)) return res.status(400).json({ erro: 'Nova senha deve ter ao menos 8 caracteres' });

  const { rows: [usuario] } = await pool.query(`select senha_hash from ${cfg.tabela} where id = $1`, [req.user.id]);
  if (!usuario) return res.status(404).json({ erro: 'Perfil não encontrado' });

  const ok = await bcrypt.compare(senha_atual, usuario.senha_hash);
  if (!ok) return res.status(401).json({ erro: 'Senha atual incorreta' });

  const novoHash = await bcrypt.hash(senha_nova, SALT_ROUNDS);
  await pool.query(`update ${cfg.tabela} set senha_hash = $1 where id = $2`, [novoHash, req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
