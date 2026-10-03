// Leitura da planilha de atendimentos exportada do sistema da franquia
// (.xlsx com: Orçamento | Número | Data | Horário | Período | Serviço | Tipo |
// Horas | Cliente | Profissionais | Situação | Recorrente). Só lê e valida —
// quem grava no banco é a rota.
const read = require('read-excel-file/node');

const MAX_LINHAS = 5000;

function normalizarTexto(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Cabeçalhos aceitos (já normalizados: sem acento, minúsculo). Achamos a linha de
// cabeçalho procurando, nas primeiras linhas, uma que tenha todas as obrigatórias
// — a planilha real tem uma linha em branco antes do cabeçalho.
const COLUNAS = {
  orcamento: ['orcamento'],
  numero: ['numero', 'codigo'],
  data: ['data'],
  horario: ['horario', 'hora'],
  servico: ['servico'],
  tipo: ['tipo'],
  horas: ['horas', 'duracao'],
  cliente: ['cliente'],
  profissionais: ['profissionais', 'profissional', 'prestadora'],
  situacao: ['situacao', 'status'],
};
const OBRIGATORIAS = ['numero', 'data', 'horario', 'servico'];

function acharCabecalho(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const mapa = {};
    linhas[i].forEach((celula, col) => {
      const nome = normalizarTexto(celula);
      for (const [chave, aceitos] of Object.entries(COLUNAS)) {
        if (aceitos.includes(nome) && !(chave in mapa)) mapa[chave] = col;
      }
    });
    if (OBRIGATORIAS.every(c => c in mapa)) return { indice: i, mapa };
  }
  return null;
}

function dataValida(a, m, d) {
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const dois = n => String(n).padStart(2, '0');

function parseData(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${dois(v.getUTCMonth() + 1)}-${dois(v.getUTCDate())}`;
  }
  if (typeof v === 'number') { // serial do Excel (dias desde 1899-12-30)
    const dt = new Date(Math.round((v - 25569) * 86400000));
    return `${dt.getUTCFullYear()}-${dois(dt.getUTCMonth() + 1)}-${dois(dt.getUTCDate())}`;
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m && dataValida(+m[3], +m[2], +m[1])) return `${m[3]}-${dois(m[2])}-${dois(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m && dataValida(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function parseHora(v) {
  let h, min;
  if (v instanceof Date && !Number.isNaN(v.getTime())) { h = v.getUTCHours(); min = v.getUTCMinutes(); }
  else if (typeof v === 'number') { // fração do dia
    const total = Math.round((v % 1) * 1440);
    h = Math.floor(total / 60); min = total % 60;
  } else {
    const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    h = +m[1]; min = +m[2];
  }
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) return null;
  return `${dois(h)}:${dois(min)}:00`;
}

function parseHoras(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : null;
}

// "Extraplast Indústria e Comércio LTDA | (54) 3330-1788" -> nome + telefone (o telefone pode vir vazio)
function parseCliente(v) {
  const s = String(v ?? '').trim();
  const i = s.lastIndexOf('|');
  const nome = (i >= 0 ? s.slice(0, i) : s).trim().slice(0, 200);
  const telefone = (i >= 0 ? s.slice(i + 1) : '').trim().slice(0, 50);
  return { nome, telefone: telefone || null };
}

// Usa os nomes do catálogo do portal (Limpeza residencial / Limpeza empresarial / ...).
function mapearServico(servico, tipo) {
  const s = normalizarTexto(servico);
  const t = normalizarTexto(tipo);
  if (s === 'limpeza' && t === 'comercial') return 'Limpeza empresarial';
  if (s === 'limpeza' && t === 'residencial') return 'Limpeza residencial';
  return [String(servico ?? '').trim(), String(tipo ?? '').trim().toLowerCase()].filter(Boolean).join(' ');
}

function mapearSituacao(v) {
  const s = normalizarTexto(v);
  if (s.startsWith('conclu')) return 'concluido';
  if (s.startsWith('cancel')) return 'cancelado';
  return 'previsto'; // Previsto/Agendado/vazio: ainda vai acontecer
}

// Retorna { linhas, invalidos, repetidasNoArquivo, totalLidas }. Lança Error com
// mensagem pronta pra mostrar na tela quando o arquivo não é uma planilha válida.
async function lerAtendimentos(buffer) {
  let abas;
  try {
    abas = await read(buffer);
  } catch {
    throw new Error('Não foi possível ler o arquivo. Envie uma planilha .xlsx.');
  }
  const dados = abas?.[0]?.data;
  if (!Array.isArray(dados) || dados.length === 0) throw new Error('A planilha está vazia.');

  const cab = acharCabecalho(dados);
  if (!cab) {
    throw new Error('Não encontrei o cabeçalho esperado (colunas Número, Data, Horário e Serviço).');
  }
  const corpo = dados.slice(cab.indice + 1).filter(l => l.some(c => c !== null && c !== ''));
  if (corpo.length > MAX_LINHAS) throw new Error(`Planilha com mais de ${MAX_LINHAS} linhas — divida em arquivos menores.`);

  const { mapa } = cab;
  const celula = (linha, chave) => (chave in mapa ? linha[mapa[chave]] : null);

  const linhas = [];
  const invalidos = [];
  const vistos = new Set();
  let repetidasNoArquivo = 0;

  corpo.forEach((linha, i) => {
    const numeroLinha = cab.indice + 2 + i; // número da linha como o Excel mostra (1-based)
    const codigo = String(celula(linha, 'numero') ?? '').trim();
    const data = parseData(celula(linha, 'data'));
    const hora = parseHora(celula(linha, 'horario'));
    const servico = mapearServico(celula(linha, 'servico'), celula(linha, 'tipo'));

    const motivos = [];
    if (!codigo) motivos.push('sem Número');
    if (!data) motivos.push('data inválida');
    if (!hora) motivos.push('horário inválido');
    if (!servico) motivos.push('sem Serviço');
    if (motivos.length) { invalidos.push({ linha: numeroLinha, motivo: motivos.join(', ') }); return; }

    if (vistos.has(codigo)) { repetidasNoArquivo++; return; } // mesmo Número duas vezes na planilha: vale a primeira
    vistos.add(codigo);

    const orcamento = String(celula(linha, 'orcamento') ?? '').trim();
    linhas.push({
      linha: numeroLinha,
      codigo,
      orcamento: orcamento || null,
      data,
      hora,
      tipo_servico: servico.slice(0, 200),
      duracao_horas: parseHoras(celula(linha, 'horas')),
      cliente: parseCliente(celula(linha, 'cliente')),
      profissional: String(celula(linha, 'profissionais') ?? '').trim().slice(0, 200),
      situacao: mapearSituacao(celula(linha, 'situacao')),
    });
  });

  return { linhas, invalidos, repetidasNoArquivo, totalLidas: corpo.length };
}

module.exports = { lerAtendimentos, normalizarTexto };
