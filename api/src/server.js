require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const unidadesRoutes = require('./routes/unidades');
const atendimentosRoutes = require('./routes/atendimentos');
const avaliacoesRoutes = require('./routes/avaliacoes');
const subadministradoresRoutes = require('./routes/subadministradores');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/unidades', unidadesRoutes);
app.use('/api/atendimentos', atendimentosRoutes);
app.use('/api/avaliacoes', avaliacoesRoutes);
app.use('/api/sub-administradores', subadministradoresRoutes);

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// Rede de segurança: qualquer erro não tratado nas rotas cai aqui em vez de derrubar o processo
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API do Portal da Maria rodando em http://localhost:${PORT}`));
