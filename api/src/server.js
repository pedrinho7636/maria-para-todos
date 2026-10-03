require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { pool, prepararBanco } = require('./db');

const syncRoutes = require('./routes/sync');
const authRoutes = require('./routes/auth');
const unidadesRoutes = require('./routes/unidades');
const atendimentosRoutes = require('./routes/atendimentos');
const avaliacoesRoutes = require('./routes/avaliacoes');
const subadministradoresRoutes = require('./routes/subadministradores');
const perfilRoutes = require('./routes/perfil');

// Fail-fast: subir com o segredo de exemplo (ou um segredo curto) deixaria
// qualquer token assinável por quem lesse este repositório — o valor do
// .env.example é literalmente público.
const segredo = process.env.JWT_SECRET;
if (!segredo || segredo === 'troque-este-segredo' || segredo.length < 32) {
  console.error('JWT_SECRET ausente ou fraco — defina uma string aleatória longa (32+ caracteres) em api/.env');
  process.exit(1);
}

const app = express();
// Allowlist explícita em vez de cors() aberto pra qualquer origem — mantém o
// Live Server/`npx serve` local funcionando e já fica pronto pra um domínio
// de produção via variável de ambiente.
const origensPermitidas = (process.env.CORS_ORIGINS || 'http://localhost:5000').split(',').map(o => o.trim());
app.use(cors({ origin: origensPermitidas }));
// A foto de perfil viaja como data URL no corpo do JSON, então só essa rota
// aceita corpo maior; o limite padrão (100kb) segue valendo pro resto da API.
// Precisa vir ANTES do express.json() global (o primeiro parser a rodar vence).
app.use('/api/perfil', express.json({ limit: '2mb' }));
// A planilha de atendimentos viaja em base64 no JSON (até 6MB de arquivo ≈ 8MB).
app.use('/api/atendimentos/admin/:slug/importar', express.json({ limit: '9mb' }));
app.use(express.json());

// Dado de API nunca deve vir de cache do navegador: uma resposta velha em cache
// é exatamente o "mudei e não apareceu" que ninguém consegue explicar.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Limite de tentativas em rotas sensíveis a força bruta / spam. No login só as
// tentativas ERRADAS contam (skipSuccessfulRequests): contar também as certas
// bloqueava quem apenas alternava entre contas várias vezes (ex.: testando
// admin/prestadora/cliente) depois de 10 logins em 15 minutos.
const aviso429 = { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };
const base = { windowMs: 15 * 60 * 1000, standardHeaders: true, legacyHeaders: false, message: aviso429 };
// por conta (IP + identificador): barra força bruta numa conta sem travar as outras
const limiteLoginConta = rateLimit({
  ...base, max: 10, skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.identificador ?? '').trim().toLowerCase()}`,
});
// por IP: barra quem tenta muitas contas diferentes
const limiteLoginIp = rateLimit({ ...base, max: 60, skipSuccessfulRequests: true });
// cada pedido de cadastro dispara e-mail de verdade, então tem teto — mas folgado
// o bastante pra um cadastro (pedir código, reenviar, confirmar) sem travar
const limiteCadastro = rateLimit({ ...base, max: 30 });
// Recuperação de senha. A chave é só o identificador (sem o IP): quem quer lotar a
// caixa de e-mail de alguém, ou chutar o código de 6 dígitos, troca de IP à vontade —
// o limite tem que ser por conta. Chutes: 8 erros / 15 min contra 1 milhão de códigos
// que expiram em 15 min = chance desprezível. Os acertos não contam.
const chaveConta = (req) => `${String(req.body?.perfil ?? '')}|${String(req.body?.identificador ?? '').trim().toLowerCase()}`;
const limiteRecuperarPedido = rateLimit({ ...base, max: 5, keyGenerator: chaveConta });
const limiteRecuperarConfirmar = rateLimit({ ...base, max: 8, skipSuccessfulRequests: true, keyGenerator: chaveConta });
const limiteRecuperarIp = rateLimit({ ...base, max: 40 });
app.post('/api/auth/recuperar-senha', limiteRecuperarIp, limiteRecuperarPedido);
app.post('/api/auth/recuperar-senha/confirmar', limiteRecuperarIp, limiteRecuperarConfirmar);
app.use('/api/auth/login', limiteLoginIp, limiteLoginConta);
app.use('/api/auth/cadastro', limiteCadastro);

// Health de verdade: toca o banco. Antes respondia {ok:true} mesmo com o Postgres fora do ar.
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true, banco: 'ok' });
  } catch (erro) {
    res.status(503).json({ ok: false, banco: 'fora do ar' });
  }
});

app.use('/api/sync', syncRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/unidades', unidadesRoutes);
app.use('/api/atendimentos', atendimentosRoutes);
app.use('/api/avaliacoes', avaliacoesRoutes);
app.use('/api/sub-administradores', subadministradoresRoutes);
app.use('/api/perfil', perfilRoutes);

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// Rede de segurança: qualquer erro não tratado nas rotas cai aqui em vez de derrubar o processo
app.use((err, req, res, next) => {
  // Erros do parser de corpo são do cliente (413/400), não "erro interno" — antes
  // uma foto grande virava um 500 genérico e ninguém entendia por que não salvava.
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo muito grande' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Corpo da requisição inválido' });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// Só abre a porta depois de confirmar o banco e aplicar as migrações — assim "API
// rodando" significa que ela de fato consegue atender, e qualquer problema de
// banco aparece aqui, claro, em vez de virar erro 500 solto na tela de alguém.
const PORT = process.env.PORT || 3001;
prepararBanco()
  .then(() => new Promise((resolve, reject) => {
    const servidor = app.listen(PORT, () => {
      console.log(`API do Portal da Maria rodando em http://localhost:${PORT}`);
      resolve(servidor);
    });
    servidor.on('error', (erro) => {
      if (erro.code === 'EADDRINUSE') {
        reject(new Error(
          `A porta ${PORT} já está em uso — provavelmente a API já está rodando em outro terminal.\n` +
          '  Feche o outro terminal (Ctrl+C) e rode de novo. Pra achar quem usa a porta:\n' +
          `    Get-NetTCPConnection -LocalPort ${PORT} -State Listen`
        ));
      } else {
        reject(erro);
      }
    });
  }))
  .catch((erro) => {
    console.error(`\nNão foi possível iniciar a API:\n  ${erro.message}\n`);
    process.exit(1);
  });
