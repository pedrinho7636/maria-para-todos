// Cálculos da aba RELATÓRIOS (Agenda, Financeiro e Satisfação). Recebe as linhas do período (já lidas do banco) e
// devolve os números prontos — sem tocar no banco, pra dar pra testar com dados inventados (npm run teste:relatorios).
//
// Regras de contagem (valem pra todos os relatórios):
//   • "atendimento" = tudo que não foi cancelado nem foi falta. Dentro dele, "concluído" é o que já aconteceu e
//     "programado" é o que ainda vai acontecer (pedido, convite, aceito, recusado).
//   • cancelado e falta NÃO contam como atendimento, não geram receita nem repasse (a falta é controle interno da franquia).
//   • o "mês"/período de um relatório é o do SERVIÇO (data do atendimento), não o do pagamento.
//   • custo = valor travado no aceite (valor_prestadora) ou, se ainda não travou, a tarifa atual da prestadora.
//   • só relatórios do administrador usam estes números: eles mostram faltas e metas, que a prestadora nunca vê.
//   • o HISTÓRICO (atendimento_eventos) só existe desde o dia em que passou a ser gravado: o que é mais antigo não tem eventos e
//     fica de fora de tempo de resposta, funil real e motivo/quem cancelou (a tela avisa quantos são).
const { totais, resumir, centavos, reais, soma } = require('./financeiro');

const DIA_MS = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DIAS = 800;
const PRESETS = ['mes', 'mes_anterior', '30d', '90d', 'ano', '12m'];
const NOMES_DIA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']; // isodow 1..7
const OCUPAM = ['proposto', 'aceito', 'concluido']; // status que ocupam o horário de uma prestadora (mesma regra de utils/conflitos.js)
const A_FAZER = ['pedido', 'proposto', 'aceito', 'recusado'];

// ---------- datas (tudo em 'AAAA-MM-DD', sem fuso: são datas locais de Brasília) ----------
const dataValida = (s) => typeof s === 'string' && ISO.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const somaDias = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DIA_MS).toISOString().slice(0, 10);
const diasEntre = (de, ate) => Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / DIA_MS) + 1;
const somaMes = (mes, n) => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
const ultimoDoMes = (mes) => somaDias(somaMes(mes, 1) + '-01', -1);
const isodow = (dia) => ((new Date(dia + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1; // 1 = segunda … 7 = domingo

// Período do relatório. Prioridade: de+ate (personalizado) > mes (AAAA-MM) > preset > mês atual.
// Devolve { de, ate, dias, id, granularidade, anterior: { de, ate } } ou { erro }.
function resolverPeriodo({ de, ate, mes, preset } = {}, hoje) {
  let ini, fim, id;
  if (de || ate) {
    if (!dataValida(de) || !dataValida(ate)) return { erro: 'Período inválido — informe de e ate no formato AAAA-MM-DD' };
    if (de > ate) return { erro: 'A data inicial não pode ser depois da final' };
    ini = de; fim = ate; id = 'custom';
  } else if (mes) {
    if (!MES.test(mes)) return { erro: 'mes inválido — use AAAA-MM' };
    ini = mes + '-01'; fim = ultimoDoMes(mes); id = 'mes';
  } else {
    const p = preset || 'mes', mesHoje = hoje.slice(0, 7);
    if (!PRESETS.includes(p)) return { erro: 'preset inválido' };
    id = p;
    if (p === 'mes') { ini = mesHoje + '-01'; fim = ultimoDoMes(mesHoje); }
    else if (p === 'mes_anterior') { const m = somaMes(mesHoje, -1); ini = m + '-01'; fim = ultimoDoMes(m); }
    else if (p === '30d') { ini = somaDias(hoje, -29); fim = hoje; }
    else if (p === '90d') { ini = somaDias(hoje, -89); fim = hoje; }
    else if (p === 'ano') { ini = hoje.slice(0, 4) + '-01-01'; fim = hoje.slice(0, 4) + '-12-31'; }
    else { ini = somaMes(mesHoje, -11) + '-01'; fim = ultimoDoMes(mesHoje); } // 12m
  }
  const dias = diasEntre(ini, fim);
  if (dias > MAX_DIAS) return { erro: `Período grande demais (no máximo ${MAX_DIAS} dias)` };
  // comparação: um mês cheio é comparado com o mês anterior; qualquer outro período, com o trecho de mesma duração logo antes
  const mesCheio = ini.endsWith('-01') && fim === ultimoDoMes(ini.slice(0, 7));
  const anterior = mesCheio
    ? { de: somaMes(ini.slice(0, 7), -1) + '-01', ate: somaDias(ini, -1) }
    : { de: somaDias(ini, -dias), ate: somaDias(ini, -1) };
  return { de: ini, ate: fim, dias, id, granularidade: dias <= 31 ? 'dia' : dias <= 140 ? 'semana' : 'mes', anterior };
}

// Balde (dia, semana — pela segunda-feira — ou mês) em que uma data cai
function chaveDe(dia, gran) {
  if (gran === 'dia') return dia;
  if (gran === 'mes') return dia.slice(0, 7);
  return somaDias(dia, -(isodow(dia) - 1));
}
function chavesDoPeriodo(de, ate, gran) {
  const chaves = [];
  for (let d = de; d <= ate; d = somaDias(d, 1)) {
    const k = chaveDe(d, gran);
    if (chaves[chaves.length - 1] !== k) chaves.push(k);
  }
  return chaves;
}
// Série com um balde por dia/semana/mês do período (os vazios entram zerados, pra o gráfico não "pular" datas)
function serie(linhas, periodo, inicial, acumular) {
  const chaves = chavesDoPeriodo(periodo.de, periodo.ate, periodo.granularidade);
  const mapa = new Map(chaves.map(k => [k, inicial()]));
  for (const l of linhas) {
    const balde = mapa.get(chaveDe(l.dia, periodo.granularidade));
    if (balde) acumular(balde, l);
  }
  return chaves.map(k => ({ chave: k, ...mapa.get(k) }));
}

// ---------- utilitários ----------
const arred = (n, c = 1) => { const f = 10 ** c; return Math.round(n * f) / f; };
const pct = (a, b, c = 1) => (b > 0 ? arred((a / b) * 100, c) : null);
const media = (lista, c = 1) => (lista.length ? arred(lista.reduce((s, x) => s + x, 0) / lista.length, c) : null);
const duracao = (l) => (l.duracao_horas === null || l.duracao_horas === undefined || l.duracao_horas === '' ? 1 : Number(l.duracao_horas)); // sem duração = 1 h (como a agenda desenha)
const contaAtendimento = (l) => l.status !== 'cancelado' && l.status !== 'falta';

function agrupar(lista, chave) {
  const mapa = new Map();
  for (const x of lista) {
    const k = chave(x);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(x);
  }
  return mapa;
}
// Mantém os `n` primeiros (a lista já vem ordenada) e junta o resto numa linha "Outros", se houver
function comOutros(lista, n, juntar) {
  if (lista.length <= n + 1) return lista;
  return [...lista.slice(0, n), juntar(lista.slice(n))];
}

const mediana = (lista, c = 1) => {
  if (!lista.length) return null;
  const o = [...lista].sort((a, b) => a - b), m = Math.floor(o.length / 2);
  return arred(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2, c);
};

// ---------- HISTÓRICO DE STATUS (tabela atendimento_eventos) ----------
// eventos: [{ id, atendimento_id, status_anterior, status_novo, acao, prestadora_id, ator_perfil, cancelado_por, motivo, quando,
//             inicio_em (começo do atendimento), janela_abre (a partir de quando a prestadora pode aceitar: 2 dias antes) }]
const HORA_MS = 3600000;
const instante = (t) => (t instanceof Date ? t.getTime() : Date.parse(t));
const QUEM_CANCELOU = ['cliente', 'franquia', 'prestadora', 'nao_informado', 'sem_registro'];

// Os eventos de cada atendimento, na ordem em que aconteceram
function cadeias(eventos) {
  const mapa = new Map();
  for (const e of eventos) {
    if (!mapa.has(e.atendimento_id)) mapa.set(e.atendimento_id, []);
    mapa.get(e.atendimento_id).push(e);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => Number(a.id) - Number(b.id));
  return mapa;
}

// Convite = o atendimento ficou "proposto" com uma prestadora ligada (convite novo, troca de prestadora num convite, cadastro já com
// prestadora). A importação da planilha não conta: não se sabe quando o convite foi de fato feito.
const ehConvite = (e) => e.status_novo === 'proposto' && !!e.prestadora_id && ['criado', 'proposto', 'reatribuido'].includes(e.acao);

// Tempo de resposta da prestadora a cada convite dela. Cada convite termina no evento seguinte do atendimento:
//   • ela aceitou / recusou → resposta (conta o tempo);
//   • a unidade deu como combinado, o sistema confirmou ou concluiu (o horário chegou) → "sem resposta" dela;
//   • trocaram a prestadora, cancelaram ou reabriram antes de ela responder → "trocado/cancelado";
//   • nada depois → "em aberto".
// O ACEITE só abre 2 dias antes do atendimento (regra do portal): contar desde o convite faria toda resposta a um convite feito com
// semanas de antecedência parecer lenta, então o aceite conta desde o que vier por último entre o convite e a abertura da janela. A
// recusa pode ser feita a qualquer hora e conta desde o convite.
function respostasAosConvites(eventos, prestadoras = []) {
  const nomes = new Map(prestadoras.map(p => [p.id, p.nome]));
  const porPrestadora = new Map();
  const dados = (id) => {
    if (!porPrestadora.has(id)) porPrestadora.set(id, { prestadora_id: id, nome: nomes.get(id) || '—', convites: 0, aceitos: 0, recusados: 0, sem_resposta: 0, em_aberto: 0, trocados: 0, horas: [] });
    return porPrestadora.get(id);
  };
  for (const cadeia of cadeias(eventos).values()) {
    cadeia.forEach((e, i) => {
      if (!ehConvite(e)) return;
      const d = dados(e.prestadora_id), prox = cadeia[i + 1];
      d.convites++;
      if (!prox) { d.em_aberto++; return; }
      const dela = prox.prestadora_id === e.prestadora_id;
      if (prox.acao === 'aceito' && prox.ator_perfil === 'prestadora' && dela) {
        d.aceitos++;
        const base = Math.max(instante(e.quando), e.janela_abre ? instante(e.janela_abre) : -Infinity);
        d.horas.push(Math.max(0, (instante(prox.quando) - base) / HORA_MS));
      } else if (prox.acao === 'recusado' && dela) {
        d.recusados++;
        d.horas.push(Math.max(0, (instante(prox.quando) - instante(e.quando)) / HORA_MS));
      } else if (['aceito', 'confirmado_auto', 'concluido_auto', 'concluido', 'falta'].includes(prox.acao)) d.sem_resposta++;
      else d.trocados++;
    });
  }
  const estat = (horas) => ({ tempo_medio_h: media(horas, 1), mediana_h: mediana(horas, 1), ate_24h_pct: pct(horas.filter(h => h <= 24).length, horas.length) });
  const todas = [...porPrestadora.values()];
  const horas = todas.flatMap(d => d.horas);
  const soma_ = (campo) => todas.reduce((s, d) => s + d[campo], 0);
  const lista = todas.map(({ horas: hs, ...d }) => ({ ...d, respondidos: d.aceitos + d.recusados, ...estat(hs) }))
    .sort((a, b) => (b.tempo_medio_h ?? -1) - (a.tempo_medio_h ?? -1) || b.convites - a.convites || a.nome.localeCompare(b.nome)); // quem demora mais primeiro
  return {
    convites: soma_('convites'), respondidos: soma_('aceitos') + soma_('recusados'), aceitos: soma_('aceitos'), recusados: soma_('recusados'),
    sem_resposta: soma_('sem_resposta'), em_aberto: soma_('em_aberto'), trocados: soma_('trocados'), ...estat(horas),
    por_prestadora: lista,
  };
}

// Pra cada atendimento que está cancelado: o último evento de cancelamento dele (quando, quem pediu, motivo, antecedência).
// Cancelado de antes do histórico (sem evento) não entra no mapa.
function infoCancelamentos(linhas, eventos) {
  const cancelados = new Set(linhas.filter(l => l.status === 'cancelado').map(l => l.id));
  const info = new Map();
  for (const [id, cadeia] of cadeias(eventos.filter(e => cancelados.has(e.atendimento_id)))) {
    const ultimo = cadeia[cadeia.length - 1];
    if (ultimo.status_novo !== 'cancelado') continue;
    info.set(id, {
      quando: ultimo.quando, quem: ultimo.cancelado_por || null, motivo: ultimo.motivo ? String(ultimo.motivo).trim() : null,
      prestadora_id: ultimo.prestadora_id || null, inicio_em: ultimo.inicio_em || null,
    });
  }
  return info;
}
const quemCancelou = (info) => (info ? info.quem || 'nao_informado' : 'sem_registro');

// Motivos digitados à mão: "Viagem", "viagem." e "VIAGEM " são o mesmo. Mostra a grafia mais usada; os sem motivo vão numa linha
// à parte (motivo = null) no fim. itens: [{ motivo, valor (centavos|null) }]
const chaveMotivo = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.!;,]+$/, '').trim();
function motivosAgrupados(itens, n = 8) {
  const grupos = new Map(), sem = { motivo: null, qtd: 0, receita: 0 };
  for (const it of itens) {
    if (!it.motivo) { sem.qtd++; sem.receita += it.valor ?? 0; continue; }
    const k = chaveMotivo(it.motivo);
    if (!grupos.has(k)) grupos.set(k, { grafias: new Map(), qtd: 0, receita: 0 });
    const g = grupos.get(k);
    g.qtd++; g.receita += it.valor ?? 0; g.grafias.set(it.motivo, (g.grafias.get(it.motivo) || 0) + 1);
  }
  const lista = [...grupos.values()]
    .map(g => ({ motivo: [...g.grafias].sort((a, b) => b[1] - a[1])[0][0], qtd: g.qtd, receita: g.receita }))
    .sort((a, b) => b.qtd - a.qtd || b.receita - a.receita || a.motivo.localeCompare(b.motivo));
  const topo = comOutros(lista, n, resto => ({ motivo: 'Outros motivos', qtd: soma(resto, x => x.qtd), receita: soma(resto, x => x.receita) }));
  return sem.qtd ? [...topo, sem] : topo;
}

// Cancelamentos do período: quem pediu, por quê e com quanta antecedência
function resumoCancelamentos(linhas, info) {
  const cancelados = linhas.filter(l => l.status === 'cancelado');
  const total = cancelados.length;
  const porQuem = QUEM_CANCELOU.map(quem => {
    const qtd = cancelados.filter(l => quemCancelou(info.get(l.id)) === quem).length;
    return { quem, qtd, pct: pct(qtd, total) };
  });
  const motivos = motivosAgrupados(cancelados.map(l => ({ motivo: info.get(l.id)?.motivo || null })), 8).map(({ motivo, qtd }) => ({ motivo, qtd }));
  // antecedência = do cancelamento até o início do atendimento (negativa = cancelado depois de começar)
  const horas = [...info.values()].filter(i => i.inicio_em && i.quando).map(i => (instante(i.inicio_em) - instante(i.quando)) / HORA_MS);
  return {
    total, com_registro: info.size, sem_registro: total - info.size, por_quem: porQuem, motivos,
    antecedencia: {
      avaliados: horas.length, menos_24h: horas.filter(h => h < 24).length, menos_24h_pct: pct(horas.filter(h => h < 24).length, horas.length),
      depois_do_inicio: horas.filter(h => h < 0).length, mediana_h: mediana(horas, 1),
    },
  };
}

// Funil de verdade: por quantas etapas cada atendimento PASSOU (e não só em qual está agora). Cada etapa inclui as seguintes — quem
// chegou a "concluído" também foi convidado e confirmado, mesmo que o sistema tenha confirmado/concluído sozinho. Atendimentos
// importados da planilha entram prontos (sem fluxo) e os anteriores ao histórico não têm eventos: os dois ficam fora da conta.
function funilDoHistorico(linhas, eventos) {
  const ids = new Set(linhas.map(l => l.id));
  const ch = cadeias(eventos.filter(e => ids.has(e.atendimento_id)));
  const ETAPAS = [
    ['pedido', 'Pedido recebido', null],
    ['proposto', 'Convite enviado', ['proposto', 'recusado', 'aceito', 'concluido', 'falta']],
    ['aceito', 'Confirmado', ['aceito', 'concluido', 'falta']],
    ['concluido', 'Concluído', ['concluido', 'falta']],
  ];
  const qtd = { pedido: 0, proposto: 0, aceito: 0, concluido: 0 }, desfechos = { recusados: 0, cancelados: 0, faltas: 0 };
  let importados = 0, aceitosPelaPrestadora = 0;
  for (const cadeia of ch.values()) {
    if (cadeia[0].acao === 'importado') { importados++; continue; }
    qtd.pedido++;
    const vistos = new Set(cadeia.map(e => e.status_novo));
    for (const [etapa, , alcanca] of ETAPAS) if (alcanca && alcanca.some(st => vistos.has(st))) qtd[etapa]++;
    if (vistos.has('recusado')) desfechos.recusados++;
    if (vistos.has('cancelado')) desfechos.cancelados++;
    if (vistos.has('falta')) desfechos.faltas++;
    if (cadeia.some(e => e.acao === 'aceito' && e.ator_perfil === 'prestadora')) aceitosPelaPrestadora++;
  }
  const etapas = ETAPAS.map(([etapa, rotulo], i) => ({
    etapa, rotulo, qtd: qtd[etapa], pct_do_anterior: i === 0 ? null : pct(qtd[etapa], qtd[ETAPAS[i - 1][0]]), pct_do_inicio: pct(qtd[etapa], qtd.pedido),
  }));
  return { base: qtd.pedido, importados, sem_historico: linhas.filter(l => !ch.has(l.id)).length, etapas, desfechos, aceitos_pela_prestadora: aceitosPelaPrestadora };
}

// ---------- AGENDA ----------
function contarAgenda(linhas) {
  const r = { registrados: linhas.length, total: 0, concluidos: 0, programados: 0, cancelados: 0, faltas: 0, horas_total: 0, horas_realizadas: 0, horas_programadas: 0 };
  for (const l of linhas) {
    if (l.status === 'cancelado') { r.cancelados++; continue; }
    if (l.status === 'falta') { r.faltas++; continue; }
    const h = duracao(l);
    r.total++; r.horas_total += h;
    if (l.status === 'concluido') { r.concluidos++; r.horas_realizadas += h; } else { r.programados++; r.horas_programadas += h; }
  }
  r.horas_total = arred(r.horas_total); r.horas_realizadas = arred(r.horas_realizadas); r.horas_programadas = arred(r.horas_programadas);
  r.taxa_cancelamento_pct = pct(r.cancelados, r.registrados);          // cancelados ÷ tudo que foi agendado
  r.taxa_faltas_pct = pct(r.faltas, r.concluidos + r.faltas);          // faltas ÷ atendimentos que deviam ter acontecido (como na Equipe)
  return r;
}

// Atendimentos da mesma prestadora com horários que se sobrepõem (mesma regra de utils/conflitos.js: [início, início+duração),
// sem horário não entra, só proposto/aceito/concluído ocupam o horário)
function choquesDeHorario(linhas) {
  const porPrestadora = agrupar(linhas.filter(l => l.prestadora_id && l.hora && OCUPAM.includes(l.status)), l => l.prestadora_id);
  const atendimentos = new Set(), prestadoras = new Set();
  for (const [prestadoraId, itens] of porPrestadora) {
    const ints = itens.map(l => {
      const [h, m] = l.hora.split(':').map(Number);
      const ini = Date.parse(l.dia + 'T00:00:00Z') / 60000 + h * 60 + m;
      return { id: l.id, ini, fim: ini + duracao(l) * 60 };
    }).sort((a, b) => a.ini - b.ini);
    for (let i = 0; i < ints.length; i++) {
      for (let j = i + 1; j < ints.length && ints[j].ini < ints[i].fim; j++) {
        atendimentos.add(ints[i].id); atendimentos.add(ints[j].id); prestadoras.add(prestadoraId);
      }
    }
  }
  return { atendimentos: atendimentos.size, prestadoras: prestadoras.size };
}

// linhas: [{ id, unidade_id, dia, hora ('HH:MM'|null), status, tipo_servico, area, origem, recorrente, duracao_horas,
//            prestadora_id, prestadora_nome, cliente_id, cliente_nome, profissional_externo }]
// ctx: { periodo, hoje, anteriores (linhas do período anterior), recusas: [{ atendimento_id, prestadora_id }],
//        avisos: [{ criado_em, lido_em }], prestadoras: [{ id, nome, ativa, faltas_aceitavel_pct }],
//        unidades: [{ id, nome }], clientesNovos, eventos (histórico dos atendimentos do período), historicoDesde (quando o histórico começou) }
function relatorioAgenda(linhas, ctx) {
  const { periodo, hoje } = ctx;
  const contam = linhas.filter(contaAtendimento);
  const ids = new Set(linhas.map(l => l.id));
  const recusas = (ctx.recusas || []).filter(r => ids.has(r.atendimento_id));
  const eventos = (ctx.eventos || []).filter(e => ids.has(e.atendimento_id));
  const respostas = respostasAosConvites(eventos, ctx.prestadoras || []);
  const respostaDe = new Map(respostas.por_prestadora.map(r => [r.prestadora_id, r]));
  const infoCanc = infoCancelamentos(linhas, eventos);
  const comEvento = new Set(eventos.map(e => e.atendimento_id));

  const resumo = contarAgenda(linhas);
  const anterior = contarAgenda(ctx.anteriores || []);

  const ordemFunil = ['pedido', 'proposto', 'recusado', 'aceito', 'concluido', 'cancelado', 'falta'];
  const funil = ordemFunil.map(status => ({ status, qtd: linhas.filter(l => l.status === status).length }));

  const sr = serie(linhas, periodo, () => ({ total: 0, concluidos: 0, programados: 0, cancelados: 0, faltas: 0 }), (b, l) => {
    if (l.status === 'cancelado') b.cancelados++;
    else if (l.status === 'falta') b.faltas++;
    else { b.total++; if (l.status === 'concluido') b.concluidos++; else b.programados++; }
  });

  const porDia = NOMES_DIA.map((nome, i) => ({ dow: i + 1, nome, qtd: 0, concluidos: 0 }));
  const calor = new Map();
  let semHorario = 0;
  for (const l of contam) {
    const d = porDia[isodow(l.dia) - 1];
    d.qtd++; if (l.status === 'concluido') d.concluidos++;
    if (!l.hora) { semHorario++; continue; }
    const k = d.dow + ':' + Number(l.hora.slice(0, 2));
    calor.set(k, (calor.get(k) || 0) + 1);
  }
  const celulas = [...calor].map(([k, qtd]) => { const [dow, hora] = k.split(':').map(Number); return { dow, hora, qtd }; }).sort((a, b) => a.dow - b.dow || a.hora - b.hora);

  const servicos = [...agrupar(contam, l => l.tipo_servico)].map(([tipo_servico, it]) => ({
    tipo_servico, qtd: it.length, concluidos: it.filter(l => l.status === 'concluido').length, horas: arred(it.reduce((s, l) => s + duracao(l), 0)),
  })).sort((a, b) => b.qtd - a.qtd || a.tipo_servico.localeCompare(b.tipo_servico));
  const porServico = comOutros(servicos, 12, resto => ({ tipo_servico: 'Outros', qtd: soma(resto, x => x.qtd), concluidos: soma(resto, x => x.concluidos), horas: arred(soma(resto, x => x.horas)) }));

  const porLocal = [...agrupar(contam.filter(l => l.area && l.area.trim()), l => l.area.trim())]
    .map(([area, it]) => ({ area, qtd: it.length })).sort((a, b) => b.qtd - a.qtd || a.area.localeCompare(b.area)).slice(0, 8);

  const porOrigem = [...agrupar(linhas, l => l.origem || 'site')].map(([origem, it]) => ({ origem, qtd: it.length })).sort((a, b) => b.qtd - a.qtd);
  const recorrentes = contam.filter(l => l.recorrente).length;

  // clientes: quem agenda mais, quantos voltaram no período
  const doCliente = agrupar(contam.filter(l => l.cliente_id), l => l.cliente_id);
  const clientes = {
    ativos: doCliente.size,
    voltaram: [...doCliente.values()].filter(it => it.length >= 2).length,   // 2 ou mais atendimentos no período
    novos: ctx.clientesNovos ?? null,                                         // cadastrados no período
    sem_cadastro: contam.filter(l => !l.cliente_id).length,                   // atendimentos sem cliente cadastrado (planilha)
    top: [...doCliente].map(([cliente_id, it]) => ({ cliente_id, cliente: it[0].cliente_nome, qtd: it.length, concluidos: it.filter(l => l.status === 'concluido').length }))
      .sort((a, b) => b.qtd - a.qtd || a.cliente.localeCompare(b.cliente)).slice(0, 10),
  };

  // prestadoras: produtividade, faltas × meta, recusas
  const mapaP = new Map();
  const dadosP = (id, nome, ativa = true, meta = null) => {
    if (!mapaP.has(id)) mapaP.set(id, { prestadora_id: id, nome, ativa, meta_pct: meta, concluidos: 0, programados: 0, cancelados: 0, cancelou_ela: 0, faltas: 0, horas_realizadas: 0, recusas: 0, vinculados: 0 });
    return mapaP.get(id);
  };
  for (const p of ctx.prestadoras || []) dadosP(p.id, p.nome, p.ativa !== false, p.faltas_aceitavel_pct === null || p.faltas_aceitavel_pct === undefined ? null : Number(p.faltas_aceitavel_pct));
  for (const l of linhas) {
    if (!l.prestadora_id) continue;
    const x = dadosP(l.prestadora_id, l.prestadora_nome);
    if (['proposto', 'aceito', 'concluido', 'falta'].includes(l.status)) x.vinculados++; // convites que ela tem em aberto, aceitou ou cumpriu
    if (l.status === 'cancelado') { x.cancelados++; if (infoCanc.get(l.id)?.quem === 'prestadora') x.cancelou_ela++; }
    else if (l.status === 'falta') x.faltas++;
    else if (l.status === 'concluido') { x.concluidos++; x.horas_realizadas += duracao(l); }
    else x.programados++;
  }
  for (const r of recusas) { const x = mapaP.get(r.prestadora_id); if (x) x.recusas++; }
  const todasP = [...mapaP.values()].map(({ vinculados, ...x }) => {
    const devidos = x.concluidos + x.faltas;
    const convites = x.recusas + vinculados; // convites enviados a ela = os que recusou + os que ficaram com ela
    const taxaFaltas = pct(x.faltas, devidos);
    return {
      ...x, horas_realizadas: arred(x.horas_realizadas), devidos, taxa_faltas_pct: taxaFaltas,
      acima_meta: x.meta_pct !== null && taxaFaltas !== null && taxaFaltas > x.meta_pct,
      convites, taxa_recusa_pct: pct(x.recusas, convites),
      resposta_media_h: respostaDe.get(x.prestadora_id)?.tempo_medio_h ?? null, respondidos: respostaDe.get(x.prestadora_id)?.respondidos ?? 0, // do histórico
    };
  });
  const comMovimento = x => x.concluidos + x.programados + x.cancelados + x.faltas + x.recusas > 0;
  const prestadoras = todasP.filter(comMovimento).sort((a, b) => b.concluidos - a.concluidos || b.programados - a.programados || a.nome.localeCompare(b.nome));
  const ociosas = todasP.filter(x => x.ativa && !comMovimento(x)).map(x => ({ prestadora_id: x.prestadora_id, nome: x.nome })).sort((a, b) => a.nome.localeCompare(b.nome));

  const conviteTotal = soma(todasP, x => x.convites);
  const recusasInfo = {
    total: recusas.length,
    atendimentos: new Set(recusas.map(r => r.atendimento_id)).size,
    convites: conviteTotal,
    taxa_pct: pct(recusas.length, conviteTotal),
  };

  const av = ctx.avisos || [];
  const lidos = av.filter(a => a.lido_em);
  const avisos = {
    enviados: av.length, lidos: lidos.length, nao_lidos: av.length - lidos.length,
    horas_ate_ler: media(lidos.map(a => Math.max(0, (new Date(a.lido_em) - new Date(a.criado_em)) / 3600000)), 1),
  };

  const precisam = linhas.filter(l => ['pedido', 'recusado'].includes(l.status));
  const alertas = {
    sem_prestadora_futuros: precisam.filter(l => l.dia >= hoje).length,
    sem_prestadora_passados: precisam.filter(l => l.dia < hoje).length,
    convites_vencidos: linhas.filter(l => l.status === 'proposto' && l.dia < hoje).length,
    sem_vinculo_planilha: contam.filter(l => !l.prestadora_id && l.profissional_externo).length,
    choques: choquesDeHorario(linhas),
  };

  const unidades = ctx.unidades || [];
  const porUnidade = unidades.length > 1
    ? unidades.map(u => ({ unidade_id: u.id, nome: u.nome, ...contarAgenda(linhas.filter(l => l.unidade_id === u.id)) })).sort((a, b) => b.total - a.total)
    : [];

  return {
    resumo, anterior, funil, serie: sr, dia_semana: porDia, calor: { celulas, sem_horario: semHorario },
    por_servico: porServico, por_local: porLocal, por_origem: porOrigem,
    recorrencia: { recorrentes, avulsos: contam.length - recorrentes },
    clientes, prestadoras, ociosas, recusas: recusasInfo, avisos, alertas, por_unidade: porUnidade,
    resposta_convites: respostas, cancelamentos: resumoCancelamentos(linhas, infoCanc), funil_real: funilDoHistorico(linhas, eventos),
    historico: { desde: ctx.historicoDesde ?? null, sem_historico: linhas.filter(l => !comEvento.has(l.id)).length },
  };
}

// ---------- FINANCEIRO ----------
// linhas: as mesmas da agenda, com { valor, custo, repasse_pago_em } (cancelados incluídos: viram "receita perdida").
// ctx: { periodo, hoje, anteriores, evolucao: [{ mes, qtd, receita, custo, receita_completa, custo_completo }], unidades, eventos }
function relatorioFinanceiro(linhas, ctx) {
  const { periodo, hoje } = ctx;
  const semCancelados = linhas.filter(l => l.status !== 'cancelado');
  const base = resumir(semCancelados, hoje);
  const l = linhas.map(x => ({ ...x, valor: centavos(x.valor), custo: centavos(x.custo) }));
  const realizados = l.filter(x => x.status === 'concluido');
  const futuros = l.filter(x => A_FAZER.includes(x.status) && x.dia >= hoje);

  const complemento = (itens) => {
    const comValor = itens.filter(x => x.valor !== null);
    const receita = soma(comValor, x => x.valor), horas = comValor.reduce((s, x) => s + duracao(x), 0);
    return {
      ticket_medio: comValor.length ? reais(Math.round(receita / comValor.length)) : null,
      horas: arred(itens.reduce((s, x) => s + duracao(x), 0)),
      receita_hora: horas > 0 ? reais(Math.round(receita / horas)) : null,
    };
  };

  const perdidos = (status) => {
    const it = l.filter(x => x.status === status);
    return { qtd: it.length, com_valor: it.filter(x => x.valor !== null).length, receita: reais(soma(it, x => x.valor)) };
  };
  const canc = perdidos('cancelado'), fal = perdidos('falta');
  // receita perdida com cancelamentos, por quem pediu e por motivo (do histórico; o que é anterior a ele fica em "sem registro")
  const cancelados = l.filter(x => x.status === 'cancelado');
  const infoCanc = infoCancelamentos(linhas, ctx.eventos || []);
  canc.por_quem = QUEM_CANCELOU.map(quem => {
    const it = cancelados.filter(x => quemCancelou(infoCanc.get(x.id)) === quem);
    return { quem, qtd: it.length, com_valor: it.filter(x => x.valor !== null).length, receita: reais(soma(it, x => x.valor)) };
  }).filter(x => x.qtd > 0);
  canc.por_motivo = motivosAgrupados(cancelados.map(x => ({ motivo: infoCanc.get(x.id)?.motivo || null, valor: x.valor })), 6)
    .map(m => ({ motivo: m.motivo, qtd: m.qtd, receita: reais(m.receita) }));

  const repasseItens = realizados.filter(x => x.custo !== null);
  const repasseTotal = soma(repasseItens, x => x.custo), repassePago = soma(repasseItens.filter(x => x.repasse_pago_em), x => x.custo);

  const sr = serie(l, periodo, () => ({ qtd: 0, receita: 0, custo: 0, margem: 0, prevista: 0 }), (b, x) => {
    if (x.status === 'concluido') {
      b.qtd++; b.receita += x.valor ?? 0; b.custo += x.custo ?? 0;
      if (x.valor !== null && x.custo !== null) b.margem += x.valor - x.custo;
    } else if (A_FAZER.includes(x.status) && x.dia >= hoje) b.prevista += x.valor ?? 0;
  }).map(b => ({ chave: b.chave, qtd: b.qtd, receita: reais(b.receita), custo: reais(b.custo), margem: reais(b.margem), prevista: reais(b.prevista) }));

  const servicos = [...agrupar(realizados, x => x.tipo_servico)].map(([tipo_servico, it]) => ({ tipo_servico, ...totais(it), ...complemento(it) }))
    .sort((a, b) => (b.receita ?? 0) - (a.receita ?? 0) || a.tipo_servico.localeCompare(b.tipo_servico));

  const doCliente = [...agrupar(realizados.filter(x => x.cliente_id), x => x.cliente_id)]
    .map(([cliente_id, it]) => ({ cliente_id, cliente: it[0].cliente_nome, ...totais(it), ...complemento(it) }))
    .sort((a, b) => (b.receita ?? 0) - (a.receita ?? 0) || a.cliente.localeCompare(b.cliente));
  const receitaTotal = soma(realizados, x => x.valor);
  const topCliente = (n) => reais(soma(doCliente.slice(0, n), c => centavos(c.receita)));
  const porCliente = doCliente.slice(0, 10).map(c => ({ ...c, pct_receita: pct(centavos(c.receita), receitaTotal) }));

  const porPrestadora = [...agrupar(realizados.filter(x => x.prestadora_id), x => x.prestadora_id)].map(([prestadora_id, it]) => {
    const comCusto = it.filter(x => x.custo !== null), pagos = comCusto.filter(x => x.repasse_pago_em);
    const total = soma(comCusto, x => x.custo), jaPago = soma(pagos, x => x.custo);
    return {
      prestadora_id, prestadora: it[0].prestadora_nome, ...totais(it), ...complemento(it),
      a_pagar_total: reais(total), pago: reais(jaPago), pendente: reais(total - jaPago), sem_custo_qtd: it.length - comCusto.length,
    };
  }).sort((a, b) => (b.receita ?? 0) - (a.receita ?? 0) || a.prestadora.localeCompare(b.prestadora));

  // evolução: sempre 12 meses (os que não tiveram atendimento entram zerados)
  const mapaEv = new Map((ctx.evolucao || []).map(e => [e.mes, e]));
  const mesFim = periodo.ate.slice(0, 7);
  const evolucao = [];
  for (let i = 11; i >= 0; i--) {
    const mes = somaMes(mesFim, -i), e = mapaEv.get(mes);
    const rc = Number(e?.receita_completa ?? 0), cc = Number(e?.custo_completo ?? 0);
    evolucao.push({ mes, qtd: Number(e?.qtd ?? 0), receita: arred(Number(e?.receita ?? 0), 2), custo: arred(Number(e?.custo ?? 0), 2), margem: arred(rc - cc, 2) });
  }

  const unidades = ctx.unidades || [];
  const porUnidade = unidades.length > 1
    ? unidades.map(u => ({ unidade_id: u.id, nome: u.nome, ...totais(realizados.filter(x => x.unidade_id === u.id)) })).sort((a, b) => (b.receita ?? 0) - (a.receita ?? 0))
    : [];

  const anterior = resumir((ctx.anteriores || []).filter(x => x.status !== 'cancelado'), hoje).realizado;
  const anteriorCompl = complemento((ctx.anteriores || []).map(x => ({ ...x, valor: centavos(x.valor), custo: centavos(x.custo) })).filter(x => x.status === 'concluido'));

  return {
    realizado: { ...base.realizado, ...complemento(realizados) },
    previsto: base.previsto,
    anterior: { ...anterior, ticket_medio: anteriorCompl.ticket_medio },
    perdido: { cancelados: canc, faltas: fal, receita: reais(centavos(canc.receita) + centavos(fal.receita)) },
    repasses: { total: reais(repasseTotal), pago: reais(repassePago), pendente: reais(repasseTotal - repassePago), sem_custo_qtd: realizados.length - repasseItens.length },
    serie: sr, evolucao, por_servico: servicos, por_cliente: porCliente, por_prestadora: porPrestadora,
    concentracao: { top1_pct: pct(centavos(topCliente(1)), receitaTotal), top3_pct: pct(centavos(topCliente(3)), receitaTotal), clientes: doCliente.length },
    alertas: base.alertas, pendencias: base.pendencias, por_unidade: porUnidade,
  };
}

// ---------- SATISFAÇÃO ----------
// avaliacoes: [{ id, nota, status, comentario, dia (data do atendimento), prestadora_id, prestadora_nome, cliente_id, cliente_nome,
//                tipo_servico, horas_ate_avaliar, horas_moderacao }]
// ctx: { periodo, hoje, linhas (agenda do período), anteriores (avaliações do período anterior), recusas, prestadoras, unidades }
function resumoAvaliacoes(av) {
  const aprovadas = av.filter(a => a.status === 'aprovada');
  const moderadas = av.filter(a => a.status !== 'pendente');
  const notas = aprovadas.map(a => a.nota);
  const distribuicao = [5, 4, 3, 2, 1].map(nota => {
    const qtd = aprovadas.filter(a => a.nota === nota).length;
    return { nota, qtd, pct: pct(qtd, aprovadas.length) };
  });
  return {
    total: av.length, aprovadas: aprovadas.length,
    pendentes: av.filter(a => a.status === 'pendente').length, recusadas: av.filter(a => a.status === 'recusada').length,
    nota_media: media(notas, 2),
    satisfeitos_pct: pct(notas.filter(n => n >= 4).length, notas.length),       // notas 4 e 5
    insatisfeitos_pct: pct(notas.filter(n => n <= 2).length, notas.length),     // notas 1 e 2
    distribuicao,
    taxa_aprovacao_pct: pct(aprovadas.length, moderadas.length),
    horas_ate_avaliar: media(av.filter(a => a.horas_ate_avaliar !== null && a.horas_ate_avaliar !== undefined).map(a => Math.max(0, Number(a.horas_ate_avaliar))), 1),
    horas_moderacao: media(moderadas.filter(a => a.horas_moderacao !== null && a.horas_moderacao !== undefined).map(a => Math.max(0, Number(a.horas_moderacao))), 1),
  };
}

function relatorioSatisfacao(avaliacoes, ctx) {
  const { periodo } = ctx;
  const linhas = ctx.linhas || [];
  const resumo = resumoAvaliacoes(avaliacoes);
  const anterior = resumoAvaliacoes(ctx.anteriores || []);
  const aprovadas = avaliacoes.filter(a => a.status === 'aprovada');

  const concluidosComCliente = linhas.filter(x => x.status === 'concluido' && x.cliente_id);
  const clientesAtendidos = new Set(concluidosComCliente.map(x => x.cliente_id));
  const clientesQueAvaliaram = new Set(avaliacoes.map(a => a.cliente_id));
  const cobertura = {
    concluidos: concluidosComCliente.length,
    avaliados: avaliacoes.length,
    taxa_resposta_pct: pct(Math.min(avaliacoes.length, concluidosComCliente.length), concluidosComCliente.length),
    clientes_atendidos: clientesAtendidos.size,
    clientes_que_avaliaram: [...clientesQueAvaliaram].filter(id => clientesAtendidos.has(id)).length,
  };

  const sr = serie(aprovadas, periodo, () => ({ qtd: 0, soma: 0 }), (b, a) => { b.qtd++; b.soma += a.nota; })
    .map(b => ({ chave: b.chave, qtd: b.qtd, nota_media: b.qtd ? arred(b.soma / b.qtd, 2) : null }));

  const operacional = relatorioAgenda(linhas, { periodo, hoje: ctx.hoje, recusas: ctx.recusas, prestadoras: ctx.prestadoras, unidades: [] });
  const opPorId = new Map(operacional.prestadoras.map(p => [p.prestadora_id, p]));
  const notasPorP = agrupar(aprovadas, a => a.prestadora_id);
  const pendentesPorP = agrupar(avaliacoes.filter(a => a.status === 'pendente'), a => a.prestadora_id);
  const ids = new Set([...notasPorP.keys(), ...opPorId.keys()]);
  const nomes = new Map(avaliacoes.map(a => [a.prestadora_id, a.prestadora_nome]));
  const prestadoras = [...ids].map(id => {
    const notas = (notasPorP.get(id) || []).map(a => a.nota), op = opPorId.get(id);
    return {
      prestadora_id: id, nome: op?.nome || nomes.get(id) || '—',
      avaliacoes: notas.length, nota_media: media(notas, 2), satisfeitos_pct: pct(notas.filter(n => n >= 4).length, notas.length),
      pendentes: (pendentesPorP.get(id) || []).length,
      concluidos: op?.concluidos ?? 0, faltas: op?.faltas ?? 0, taxa_faltas_pct: op?.taxa_faltas_pct ?? null, meta_pct: op?.meta_pct ?? null,
      acima_meta: op?.acima_meta ?? false, recusas: op?.recusas ?? 0, cancelados: op?.cancelados ?? 0,
    };
  }).sort((a, b) => (b.nota_media ?? -1) - (a.nota_media ?? -1) || b.avaliacoes - a.avaliacoes || a.nome.localeCompare(b.nome));

  const porServico = [...agrupar(aprovadas, a => a.tipo_servico)].map(([tipo_servico, it]) => ({ tipo_servico, avaliacoes: it.length, nota_media: media(it.map(a => a.nota), 2) }))
    .sort((a, b) => b.avaliacoes - a.avaliacoes || a.tipo_servico.localeCompare(b.tipo_servico)).slice(0, 12);

  const ordemRecente = (a, b) => b.dia.localeCompare(a.dia);
  const item = (a) => ({ id: a.id, nota: a.nota, comentario: a.comentario || null, dia: a.dia, status: a.status, prestadora: a.prestadora_nome, cliente: a.cliente_nome, tipo_servico: a.tipo_servico });
  const atencao = avaliacoes.filter(a => a.nota <= 3).sort(ordemRecente).slice(0, 15).map(item);
  const elogios = aprovadas.filter(a => a.nota === 5 && a.comentario && a.comentario.trim()).sort(ordemRecente).slice(0, 5).map(item);

  const unidades = ctx.unidades || [];
  const porUnidade = unidades.length > 1
    ? unidades.map(u => {
      const notas = aprovadas.filter(a => a.unidade_id === u.id).map(a => a.nota);
      return { unidade_id: u.id, nome: u.nome, avaliacoes: notas.length, nota_media: media(notas, 2), satisfeitos_pct: pct(notas.filter(n => n >= 4).length, notas.length) };
    }).sort((a, b) => (b.nota_media ?? -1) - (a.nota_media ?? -1))
    : [];

  return {
    resumo, anterior, cobertura, serie: sr, por_prestadora: prestadoras, por_servico: porServico, atencao, elogios,
    qualidade: { faltas: operacional.resumo.faltas, taxa_faltas_pct: operacional.resumo.taxa_faltas_pct, cancelados: operacional.resumo.cancelados, recusas: operacional.recusas.total, taxa_recusa_pct: operacional.recusas.taxa_pct },
    por_unidade: porUnidade,
  };
}

module.exports = {
  resolverPeriodo, chaveDe, chavesDoPeriodo, somaDias, somaMes, isodow, PRESETS,
  contarAgenda, choquesDeHorario, relatorioAgenda, relatorioFinanceiro, relatorioSatisfacao, resumoAvaliacoes,
  respostasAosConvites, infoCancelamentos, resumoCancelamentos, motivosAgrupados, funilDoHistorico, QUEM_CANCELOU,
};
