require('dotenv').config();
const path = require('path');
const fs = require('fs');
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
const primeiroAcessoRoutes = require('./routes/primeiroAcesso');
const financeiroRoutes = require('./routes/financeiro');
const relatoriosRoutes = require('./routes/relatorios');
const { iniciarConclusaoAutomatica } = require('./utils/conclusao');
const { descreverConfiguracao } = require('./utils/email');
const { requireAuth } = require('./middleware/auth');

// Uma promessa rejeitada sem tratamento (um erro que escapou de alguma rota) derrubaria o processo inteiro por causa de UMA
// requisição ruim — todo mundo logado perderia a conexão. Registra e segue.
process.on('unhandledRejection', (motivo) => console.error('[unhandledRejection]', motivo));

// Fail-fast: subir com o segredo de exemplo (ou um segredo curto) deixaria
// qualquer token assinável por quem lesse este repositório — o valor do
// .env.example é literalmente público.
const segredo = process.env.JWT_SECRET;
if (!segredo || segredo === 'troque-este-segredo' || segredo.length < 32) {
  console.error('JWT_SECRET ausente ou fraco — defina uma string aleatória longa (32+ caracteres) em api/.env');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by'); // não anuncia "Express" pra quem olha os cabeçalhos
// Cabeçalhos de segurança pro site público: o navegador não "adivinha" tipo de arquivo, o site não abre dentro de
// iframe de outro endereço (clickjacking), links de saída não vazam o endereço completo e recursos sensíveis do aparelho
// (câmera, microfone, localização...) ficam desligados. HSTS só em produção (HTTPS garantido pela hospedagem).
//
// CSP (Content-Security-Policy): a página só carrega script/estilo/imagem/fonte dela mesma (e as fontes do Google), só fala
// com a própria API (connect-src 'self': um código injetado não consegue mandar dado pra fora), não aceita <object>/<base> de
// outro lugar e não deixa outro site pôr a página num iframe. 'unsafe-inline' em script e estilo continua necessário porque o
// HTML usa onclick="..." e style="..." por todo lado — tirar isso exigiria trocar todos por addEventListener/classes.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': CSP, 'X-Permitted-Cross-Domain-Policies': 'none',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
// Atrás do proxy da hospedagem (Render), o IP do visitante chega no
// X-Forwarded-For; sem isso req.ip seria sempre o do proxy e os limites de
// login/cadastro abaixo valeriam pra TODOS os usuários juntos.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
// Allowlist explícita em vez de cors() aberto pra qualquer origem — mantém o
// Live Server/`npx serve` local funcionando e já fica pronto pra um domínio
// de produção via variável de ambiente.
const origensPermitidas = (process.env.CORS_ORIGINS || 'http://localhost:5000').split(',').map(o => o.trim());
app.use(cors({ origin: origensPermitidas }));
// A foto de perfil viaja como data URL no corpo do JSON, então só essa rota
// aceita corpo maior; o limite padrão (100kb) segue valendo pro resto da API.
// Precisa vir ANTES do express.json() global (o primeiro parser a rodar vence).
// requireAuth ANTES do parser grande: quem não está logado leva 401 sem a API ler 2/9 MB de corpo (senão qualquer um, sem conta,
// forçava o servidor a receber e interpretar vários MB por requisição).
app.use('/api/perfil', requireAuth, express.json({ limit: '2mb' }));
// A planilha de atendimentos viaja em base64 no JSON (até 6MB de arquivo ≈ 8MB).
app.use('/api/atendimentos/admin/:slug/importar', requireAuth, express.json({ limit: '9mb' }));
app.use(express.json());

// Dado de API nunca deve vir de cache do navegador: uma resposta velha em cache
// é exatamente o "mudei e não apareceu" que ninguém consegue explicar.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Versão do site = carimbo de modificação mais recente entre o HTML e os arquivos de assets/ (CSS e JS); muda a cada
// deploy. Toda resposta da API leva essa versão no cabeçalho X-App-Versao e o HTML guarda a que foi entregue a ele:
// quem deixou a aba aberta durante uma atualização vê o aviso "versão nova — atualizar" em vez de ficar com a tela
// velha conversando com a API nova (campos/máscaras antigos, mensagens que não batem...).
// O resultado fica 2 s em memória pra não varrer a pasta a cada chamada da API.
const PASTA_ASSETS = path.join(__dirname, '..', '..', 'assets');
function maiorCarimbo(pasta) {
  let maior = 0;
  try {
    for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
      const caminho = path.join(pasta, item.name);
      maior = Math.max(maior, item.isDirectory() ? maiorCarimbo(caminho) : fs.statSync(caminho).mtimeMs);
    }
  } catch { /* pasta ausente: só vale o HTML */ }
  return maior;
}
let versaoEmCache = { em: 0, valor: '0' };
const versaoDoSite = () => {
  if (Date.now() - versaoEmCache.em < 2000) return versaoEmCache.valor;
  let html = 0;
  try { html = fs.statSync(ARQUIVO_SITE).mtimeMs; } catch { /* sem HTML */ }
  versaoEmCache = { em: Date.now(), valor: String(Math.round(Math.max(html, maiorCarimbo(PASTA_ASSETS)))) };
  return versaoEmCache.valor;
};
app.use('/api', (req, res, next) => { res.set('X-App-Versao', versaoDoSite()); next(); });

// Limite de tentativas em rotas sensíveis a força bruta / spam. No login só as
// tentativas ERRADAS contam (skipSuccessfulRequests): contar também as certas
// bloqueava quem apenas alternava entre contas várias vezes (ex.: testando
// admin/prestadora/cliente) depois de 10 logins em 15 minutos.
const aviso429 = { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };
const base = { windowMs: 15 * 60 * 1000, standardHeaders: true, legacyHeaders: false, message: aviso429 };
// Teto geral da API por IP (1.500 por minuto — o uso normal é uma fração disso: a tela consulta a cada 4 s): barra quem
// dispara requisições em laço pra sobrecarregar o servidor ou o banco, sem atrapalhar um escritório inteiro atrás do mesmo IP.
// (LIMITE_API existe só pra suíte de testes, que dispara milhares de chamadas em segundos do mesmo IP.)
app.use('/api', rateLimit({
  windowMs: 60 * 1000, max: Number(process.env.LIMITE_API) || 1500, standardHeaders: true, legacyHeaders: false, message: aviso429,
  skip: (req) => req.path === '/ping' || req.path === '/health',
}));
// por conta (IP + identificador): barra força bruta numa conta sem travar as outras
const limiteLoginConta = rateLimit({
  ...base, max: 10, skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.identificador ?? '').trim().toLowerCase()}`,
});
// por IP: barra quem tenta muitas contas diferentes
const limiteLoginIp = rateLimit({ ...base, max: 60, skipSuccessfulRequests: true });
// cada pedido de cadastro dispara e-mail de verdade, então tem teto — mas folgado
// o bastante pra um cadastro (pedir código, reenviar, confirmar) sem travar
// (LIMITE_CADASTRO existe só pra suíte de testes, que faz dezenas de cadastros do mesmo IP)
const limiteCadastro = rateLimit({ ...base, max: Number(process.env.LIMITE_CADASTRO) || 30 });
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
// Cadastro de administrador com um CNPJ que JÁ existe confere nome + e-mail + SENHA do dono da empresa:
// é um jeito de chutar senha, então vale a mesma regra do login — só as tentativas ERRADAS contam,
// por e-mail + IP (um cadastro que dá certo, ou que só manda o código, não gasta o limite).
const limiteCadastroAdminConta = rateLimit({
  ...base, max: 10, skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
});
app.post('/api/auth/cadastro/admin', limiteCadastroAdminConta);
// Por DESTINATÁRIO do e-mail (qualquer IP): cada pedido de cadastro manda um código pra um endereço qualquer, então sem isso
// dava pra usar o site pra lotar a caixa de alguém (trocando de IP) e, no outro lado, pra chutar o código de 6 dígitos de um
// cadastro em andamento. Pedidos: 6 por 15 min por e-mail; conferências erradas: 10 por 15 min por e-mail (as certas não contam).
const emailDoPedido = (req) => String(req.body?.email ?? '').trim().toLowerCase() || 'ip:' + ipKeyGenerator(req.ip);
const limiteEnvioPorEmail = rateLimit({ ...base, max: Number(process.env.LIMITE_CADASTRO) || 6, keyGenerator: emailDoPedido });
const limiteConfirmaPorEmail = rateLimit({ ...base, max: Number(process.env.LIMITE_CADASTRO) || 10, skipSuccessfulRequests: true, keyGenerator: emailDoPedido });
app.post(['/api/auth/cadastro/admin', '/api/auth/cadastro/prestadora', '/api/auth/cadastro/cliente'], limiteEnvioPorEmail);
app.post(['/api/auth/cadastro/admin/confirmar', '/api/auth/cadastro/prestadora/confirmar', '/api/auth/cadastro/cliente/confirmar'], limiteConfirmaPorEmail);
app.use('/api/auth/login', limiteLoginIp, limiteLoginConta);
app.use('/api/auth/cadastro', limiteCadastro);

// Resposta leve, sem banco: é o que o health check da hospedagem chama (com frequência —
// consultar o Postgres a cada chamada o manteria acordado e gastaria a cota do plano grátis).
app.get('/api/ping', (req, res) => res.json({ ok: true }));

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
app.use('/api/primeiro-acesso', primeiroAcessoRoutes);
app.use('/api/financeiro', financeiroRoutes);
app.use('/api/relatorios', relatoriosRoutes);

// O próprio servidor entrega o frontend (mesma origem da API = sem CORS no site
// publicado): o HTML em "/" e, em "/assets", os CSS e JS dele. Só isso — nunca a pasta inteira do
// projeto, que tem .env, .sql etc.
const ARQUIVO_SITE = path.join(__dirname, '..', '..', 'Portal Da Maria.html');
// O HTML nunca fica em cache (no-store): abrir/recarregar a página sempre traz a versão do último deploy. A versão
// entregue vai dentro do HTML (no lugar de __APP_VERSAO__) pra a página comparar com a da API.
let htmlEmCache = { versao: null, texto: '' };
app.get('/', (req, res) => {
  const versao = versaoDoSite();
  if (htmlEmCache.versao !== versao) htmlEmCache = { versao, texto: fs.readFileSync(ARQUIVO_SITE, 'utf8').replace('__APP_VERSAO__', versao) };
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, must-revalidate' }).send(htmlEmCache.texto);
});
// CSS e JS do site: o navegador guarda, mas confere a cada abertura (ETag) se mudou — assim, depois de um deploy, o HTML novo
// nunca fica com arquivo velho. Sem listar a pasta, sem arquivos ocultos.
app.use('/assets', express.static(PASTA_ASSETS, { index: false, dotfiles: 'ignore', setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// Rede de segurança: qualquer erro não tratado nas rotas cai aqui em vez de derrubar o processo
app.use((err, req, res, next) => {
  // Erros do parser de corpo são do cliente (413/400), não "erro interno" — antes
  // uma foto grande virava um 500 genérico e ninguém entendia por que não salvava.
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo muito grande' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Corpo da requisição inválido' });
  // O banco recusou um VALOR que veio do cliente (id que não é UUID, data que não existe, texto grande demais, número fora da
  // faixa, caractere nulo...): é erro de quem chamou, não do servidor — 400 em vez de um 500 que parece falha nossa.
  if (['22P02', '22007', '22008', '22003', '22001', '22021'].includes(err.code)) return res.status(400).json({ erro: 'Algum dado enviado é inválido.' });
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
      descreverConfiguracao().forEach(l => console.log('[email] ' + l)); // qual provedor/conta vale (sem segredos)
      iniciarConclusaoAutomatica();
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
