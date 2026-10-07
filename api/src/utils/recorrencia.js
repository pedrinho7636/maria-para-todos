// Geração das ocorrências de um atendimento recorrente (semana-modelo repetida semana a
// semana, ou semana sim/não) e a divisão do valor MENSAL de cada item entre as ocorrências.
//
// Valor do mês: quem cadastra informa o valor do MÊS INTEIRO daquele dia/horário (ex.: a
// faxina de toda terça de um cliente custa R$ 1.200 por mês). Cada ocorrência recebe a parte
// dela: valor_mensal ÷ (quantas vezes o padrão ocorre naquele mês). Mês de 4 terças = R$ 300
// cada; mês de 5 terças = R$ 240 cada — em qualquer caso a soma do mês fecha no valor
// informado, centavo a centavo. Mês só parcialmente coberto (começa no meio do mês, ou o
// período termina no meio dele) recebe a parte proporcional às ocorrências que de fato entram.
// O divisor é sempre o mês cheio do padrão, ignorando onde a série começa/termina.
const DIA_MS = 86400000;

const iso = (d) => d.toISOString().slice(0, 10);

function lerData(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || iso(d) !== s ? null : d;
}

// itens: [{ dia_semana (0=domingo..6), valor_mensal? }]. Devolve, em ordem de data,
// [{ data: 'YYYY-MM-DD', item: índice em itens, valor: number|null, valor_mensal: number|null }].
function gerarOcorrencias({ dataInicio, horizonteMeses, alternadas, itens, limite = 200 }) {
  const inicio = lerData(dataInicio);
  if (!inicio) throw new Error('data_inicio inválida');
  const meses = Math.min(Math.max(parseInt(horizonteMeses, 10) || 3, 1), 24);
  const fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + meses);

  // domingo da semana que contém data_inicio = semana 0 do padrão
  const domingo0 = new Date(inicio.getTime() - inicio.getUTCDay() * DIA_MS);
  const ocorre = (item, d) => {
    if (d.getUTCDay() !== Number(item.dia_semana)) return false;
    if (!alternadas) return true;
    const semana = Math.floor((d.getTime() - domingo0.getTime()) / (7 * DIA_MS));
    return ((semana % 2) + 2) % 2 === 0; // semana "sim/não": a semana inteira entra ou sai
  };

  const linhas = [];
  for (let d = new Date(inicio); d <= fim && linhas.length < limite; d = new Date(d.getTime() + DIA_MS)) {
    for (let i = 0; i < itens.length && linhas.length < limite; i++) {
      if (ocorre(itens[i], d)) linhas.push({ data: iso(d), item: i, valor: null, valor_mensal: null });
    }
  }

  // quantas vezes o padrão do item ocorre no mês CHEIO (divisor do valor mensal)
  const totalNoMes = (i, mes) => {
    const [ano, m] = mes.split('-').map(Number);
    let n = 0;
    for (let d = new Date(Date.UTC(ano, m - 1, 1)); d.getUTCMonth() === m - 1; d = new Date(d.getTime() + DIA_MS)) {
      if (ocorre(itens[i], d)) n++;
    }
    return n;
  };

  const grupos = new Map(); // "item|mês" -> linhas
  for (const l of linhas) {
    const chave = `${l.item}|${l.data.slice(0, 7)}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(l);
  }
  for (const [chave, doGrupo] of grupos) {
    const [i, mes] = [Number(chave.split('|')[0]), chave.split('|')[1]];
    const mensal = itens[i].valor_mensal;
    if (mensal === null || mensal === undefined) continue;
    const centavos = Math.round(mensal * 100);
    const total = totalNoMes(i, mes);
    if (doGrupo.length === total) {
      // mês inteiro: reparte os centavos que sobram, uma a uma, nas primeiras ocorrências
      const base = Math.floor(centavos / total), resto = centavos - base * total;
      doGrupo.forEach((l, k) => { l.valor = (base + (k < resto ? 1 : 0)) / 100; });
    } else {
      doGrupo.forEach((l) => { l.valor = Math.round(centavos / total) / 100; });
    }
    doGrupo.forEach((l) => { l.valor_mensal = centavos / 100; });
  }
  return linhas;
}

module.exports = { gerarOcorrencias };
