// Cálculos do módulo Financeiro. Recebe as linhas do mês (já lidas do banco) e devolve
// os totais — sem tocar no banco, pra dar pra testar com dados inventados.
//
// Vocabulário:
//   valor  = o que o CLIENTE paga pelo atendimento (receita)
//   custo  = o que a FRANQUIA paga à prestadora (repasse): o valor travado no aceite
//            (atendimentos.valor_prestadora) ou, se ainda não travou, a tarifa atual dela
//   realizado = atendimento concluído (a API conclui sozinha o aceito cuja hora passou)
//   previsto  = ainda por acontecer (pedido, convite ou aceito de hoje em diante)
//
// Tudo é somado em CENTAVOS (inteiros) e só no fim volta pra reais, pra a soma de muitos
// valores com centavos não acumular erro de ponto flutuante.
const centavos = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100));
const reais = (c) => (c === null ? null : c / 100);
const soma = (lista, f) => lista.reduce((s, x) => s + (f(x) ?? 0), 0);

// Margem só faz sentido nos atendimentos em que se sabe o valor E o custo; os demais
// distorceriam a conta (receita sem custo parece lucro puro). `completos` conta quantos entraram.
function totais(linhas) {
  const completos = linhas.filter(l => l.valor !== null && l.custo !== null);
  const receitaCompleta = soma(completos, l => l.valor);
  const custoCompleto = soma(completos, l => l.custo);
  const margem = receitaCompleta - custoCompleto;
  return {
    qtd: linhas.length,
    receita: reais(soma(linhas, l => l.valor)),
    custo: reais(soma(linhas, l => l.custo)),
    margem: reais(margem),
    margem_pct: receitaCompleta > 0 ? Math.round((margem / receitaCompleta) * 1000) / 10 : null,
    completos: completos.length,
  };
}

// linhas: [{ id, dia:'YYYY-MM-DD', hora, status, tipo_servico, valor, custo (reais|null),
//            prestadora_id, prestadora_nome, cliente_id, cliente_nome, repasse_pago_em }]
function resumir(linhas, hoje) {
  const l = linhas.map(x => ({ ...x, valor: centavos(x.valor), custo: centavos(x.custo) }));
  const realizados = l.filter(x => x.status === 'concluido');
  const futuros = l.filter(x => x.status !== 'concluido' && x.dia >= hoje && ['pedido', 'proposto', 'aceito', 'recusado'].includes(x.status));

  const agrupar = (lista, chave, extra = () => ({})) => {
    const mapa = new Map();
    for (const x of lista) {
      const k = chave(x);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(x);
    }
    return [...mapa].map(([k, itens]) => ({ chave: k, ...totais(itens), ...extra(itens) }));
  };

  const porServico = agrupar(realizados, x => x.tipo_servico)
    .map(({ chave, ...r }) => ({ tipo_servico: chave, ...r }))
    .sort((a, b) => (b.receita ?? 0) - (a.receita ?? 0));

  const porCliente = agrupar(realizados.filter(x => x.cliente_id), x => x.cliente_id, it => ({ cliente: it[0].cliente_nome }))
    .map(({ chave, ...r }) => ({ cliente_id: chave, ...r }))
    .sort((a, b) => (b.receita ?? 0) - (a.receita ?? 0)).slice(0, 10);

  // repasses: o que cada prestadora tem a receber pelos atendimentos realizados no mês
  const porPrestadora = agrupar(realizados.filter(x => x.prestadora_id), x => x.prestadora_id, (it) => {
    const comCusto = it.filter(x => x.custo !== null);
    const pagos = comCusto.filter(x => x.repasse_pago_em);
    const total = soma(comCusto, x => x.custo), jaPago = soma(pagos, x => x.custo);
    return {
      prestadora: it[0].prestadora_nome,
      a_pagar_total: reais(total), pago: reais(jaPago), pendente: reais(total - jaPago),
      pagos_qtd: pagos.length, pendentes_qtd: comCusto.length - pagos.length, sem_custo_qtd: it.length - comCusto.length,
    };
  }).map(({ chave, ...r }) => ({ prestadora_id: chave, ...r }))
    .sort((a, b) => b.pendente - a.pendente || a.prestadora.localeCompare(b.prestadora));

  // pendências que deixam os números incompletos — cada uma aponta o atendimento pra corrigir
  const pendencias = [];
  for (const x of realizados) {
    const faltas = [];
    if (x.valor === null) faltas.push('valor');
    if (x.custo === null) faltas.push(x.prestadora_id ? 'custo' : 'prestadora'); // sem prestadora não há de quem tirar o custo
    if (faltas.length) pendencias.push({ id: x.id, dia: x.dia, hora: x.hora, tipo_servico: x.tipo_servico, cliente: x.cliente_nome, falta: faltas });
  }
  const convitesVencidos = l.filter(x => x.status === 'proposto' && x.dia < hoje).length;

  return {
    realizado: totais(realizados),
    previsto: {
      ...totais(futuros),
      sem_prestadora_qtd: futuros.filter(x => !x.prestadora_id).length,
      sem_valor_qtd: futuros.filter(x => x.valor === null).length,
    },
    por_servico: porServico,
    por_cliente: porCliente,
    por_prestadora: porPrestadora,
    alertas: {
      realizados_sem_valor: realizados.filter(x => x.valor === null).length,
      realizados_sem_custo: realizados.filter(x => x.custo === null).length,
      convites_vencidos: convitesVencidos,
      repasses_pendentes: reais(soma(porPrestadora, p => centavos(p.pendente))),
    },
    pendencias: pendencias.sort((a, b) => a.dia.localeCompare(b.dia)).slice(0, 30),
  };
}

module.exports = { resumir, totais };
