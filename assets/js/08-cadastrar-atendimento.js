/* Portal da Maria — Cadastrar atendimento
   Atendimento único, série semanal e importação de planilha (.xlsx). */

/* Cadastrar atendimento: um só (formulário) ou vários (planilha .xlsx). */
let atdOcupado = false;
let atdArquivoBase64 = null;
const atdVal = id => document.getElementById(id).value;

function abrirModalAtendimento() {
  const clientes = (clientesData[currentUnit] || []).filter(c => c.id);
  document.getElementById('atd-cliente').innerHTML =
    '<option value="">Sem cliente cadastrado (avulso)</option><option value="__novo__">+ Novo cliente…</option>'
    + clientes.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  document.getElementById('atd-prestadora').innerHTML =
    '<option value="">Sem prestadora ainda</option>'
    + (prestadorasAgenda[currentUnit] || []).map(p => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('');
  let dia = diaSelecionadoAgenda || hojeISOBrasil();
  if (new Date(dia + 'T00:00:00').getDay() === 0) dia = '';
  document.getElementById('atd-data').value = dia;
  ['atd-hora', 'atd-servico', 'atd-area', 'atd-valor', 'atd-cliente-nome', 'atd-cliente-tel'].forEach(id => { document.getElementById(id).value = ''; });
  definirHora('atd-hora', '');
  document.getElementById('atd-duracao').value = 4;
  document.getElementById('atd-repete').checked = false;
  document.querySelectorAll('#atd-dias input').forEach(c => { c.checked = false; });
  document.getElementById('atd-meses').value = 3;
  document.getElementById('atd-quinzenal').checked = false;
  atdRepeteMudou();
  document.getElementById('atd-cliente-novo').style.display = 'none';
  document.getElementById('atd-arquivo').value = '';
  document.getElementById('atd-resumo').innerHTML = '';
  document.getElementById('atd-importar').disabled = true;
  document.getElementById('atd-importar').textContent = 'Importar';
  atdArquivoBase64 = null;
  atdAba('unico');
  document.getElementById('modal-atendimento').classList.add('show');
}
function fecharModalAtendimento() { document.getElementById('modal-atendimento').classList.remove('show'); }
// Colunas que o importador lê (as mesmas do modelo .xlsx baixado pela API)
const ATD_COLUNAS_MODELO = [
  ['Orçamento', 'não', 'Agrupa atendimentos do mesmo orçamento'],
  ['Número', 'sim', 'Código único do atendimento — é a chave: reenviar a planilha só traz o que ainda não existe'],
  ['Data', 'sim', 'dd/mm/aaaa'],
  ['Horário', 'sim', 'hh:mm (início, 24 h)'],
  ['Período', 'não lida', 'Manhã/Tarde — o portal usa o Horário'],
  ['Serviço', 'sim', 'Ex.: Limpeza (+ Tipo: Comercial/Residencial)'],
  ['Tipo', 'não', 'Complementa o serviço'],
  ['Horas', 'não', 'Duração; define o horário de término'],
  ['Cliente', 'não', '"Nome | Telefone" — criado se não existir'],
  ['Profissionais', 'não', 'Prestadora ("Nome | Telefone") — cadastrada, já com o telefone, se ainda não existir'],
  ['Repasse (R$)', 'opcional', 'O que a franquia paga à prestadora (custo do Financeiro)'],
  ['Situação', 'não', 'Previsto, Concluído ou Cancelado'],
  ['Recorrente', 'não lida', 'Sim/Não — pra repetir toda semana use o cadastro de atendimento recorrente'],
  ['Local de Atendimento', 'não', 'Endereço do serviço — vira o "Local" do atendimento'],
  ['Valor (R$)', 'opcional', 'O que o cliente paga (alimenta o Financeiro)'],
  ['Margem de Contribuição (R$)', 'não lida', 'Valor − Repasse: o portal calcula sozinho'],
];
function renderColunasModelo() {
  document.getElementById('atd-colunas-modelo').innerHTML = ATD_COLUNAS_MODELO.map(([c, o, u]) =>
    `<tr style="border-top:1px solid var(--line)"><td style="padding:4px 6px 4px 0"><b>${c}</b></td><td style="padding:4px 6px">${o}</td><td style="padding:4px 0 4px 6px">${u}</td></tr>`).join('');
}
async function baixarModeloPlanilha() {
  try {
    const resp = await fetch(API_BASE + `/atendimentos/admin/${currentUnit}/modelo-importacao`, { headers: { Authorization: 'Bearer ' + authToken } });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).erro || 'HTTP ' + resp.status);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resp.blob());
    link.download = 'modelo-importacao-atendimentos.xlsx';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (err) { toast('Não foi possível baixar o modelo: ' + err.message); }
}
function atdAba(qual) {
  if (qual === 'importar') renderColunasModelo();
  document.getElementById('atd-painel-unico').style.display = qual === 'unico' ? 'block' : 'none';
  document.getElementById('atd-painel-importar').style.display = qual === 'importar' ? 'block' : 'none';
  document.getElementById('atd-tab-unico').classList.toggle('active', qual === 'unico');
  document.getElementById('atd-tab-importar').classList.toggle('active', qual === 'importar');
}
// "Repetir toda semana": o mesmo formulário vira um atendimento recorrente (antes eram dois formulários,
// com os mesmos campos repetidos). Ligado, a data vira "a partir de" (o valor continua sendo o de cada atendimento).
function atdRepeteMudou() {
  const repete = document.getElementById('atd-repete').checked;
  document.getElementById('atd-repetir').style.display = repete ? 'block' : 'none';
  document.getElementById('atd-data-rotulo').textContent = repete ? 'A partir de' : 'Data';
  document.getElementById('atd-valor-rotulo').textContent = repete ? 'Valor de cada atendimento (R$)' : 'Valor do atendimento (R$)';
  document.getElementById('atd-salvar').textContent = repete ? 'Gerar atendimentos' : 'Cadastrar';
  if (repete) {
    // sugere o dia da semana da data escolhida (se ainda não marcou nenhum)
    const data = atdVal('atd-data');
    const marcados = document.querySelectorAll('#atd-dias input:checked').length;
    if (data && !marcados) {
      const dia = new Date(data + 'T00:00:00').getDay();
      const caixa = document.querySelector(`#atd-dias input[value="${dia}"]`);
      if (caixa) caixa.checked = true;
    }
  }
}
function atdClienteMudou() {
  document.getElementById('atd-cliente-novo').style.display = atdVal('atd-cliente') === '__novo__' ? 'flex' : 'none';
}
function atdDataMudou(input) {
  if (input.value && new Date(input.value + 'T00:00:00').getDay() === 0) {
    toast('Domingo não está disponível pra agenda.');
    input.value = '';
  }
}

// Série semanal (marcou "Repetir toda semana"): monta um item por dia da semana escolhido, todos
// com o mesmo horário/duração/serviço/cliente/prestadora, e manda o valor de CADA atendimento: todas as
// ocorrências recebem o valor cheio (o total da série é valor × quantidade).
async function salvarSerieAtendimentos() {
  const data = atdVal('atd-data'), hora = lerHora(atdVal('atd-hora')), servico = atdVal('atd-servico').trim();
  if (!data || !hora || !servico) { toast('Preencha "a partir de", horário e serviço.'); return; }
  const dias = [...document.querySelectorAll('#atd-dias input:checked')].map(c => Number(c.value));
  if (dias.length === 0) { toast('Marque ao menos um dia da semana.'); return; }
  const valorCada = lerReais(atdVal('atd-valor'));
  if (Number.isNaN(valorCada)) { toast('Valor inválido — use números, ex.: 150,00.'); return; }

  const comum = { hora_atendimento: hora, tipo_servico: servico, area: atdVal('atd-area').trim() || null, duracao_horas: Number(atdVal('atd-duracao')) || null, prestadora_id: atdVal('atd-prestadora') || null };
  const corpo = {
    data_inicio: data, horizonte_meses: Number(atdVal('atd-meses')) || 3, semanas_alternadas: document.getElementById('atd-quinzenal').checked,
    itens: dias.map(d => ({ ...comum, dia_semana: d })), valor_por_atendimento: valorCada,
  };
  const cliente = atdVal('atd-cliente');
  if (cliente === '__novo__') {
    const nome = atdVal('atd-cliente-nome').trim();
    if (!nome) { toast('Informe o nome do novo cliente.'); return; }
    corpo.cliente_novo = { nome, telefone: atdVal('atd-cliente-tel').trim() };
  } else if (cliente) {
    for (const i of corpo.itens) i.cliente_id = cliente;
  }

  atdOcupado = true;
  try {
    const resp = await apiComConfirmacao(`/atendimentos/admin/${currentUnit}/recorrente`, { method: 'POST', body: JSON.stringify(corpo) });
    fecharModalAtendimento();
    const total = resp.atendimentos.reduce((s, a) => s + (a.valor === null || a.valor === undefined ? 0 : Number(a.valor)), 0);
    toast(resp.quantidade_gerada + ' atendimentos gerados' + (valorCada !== null
      ? ` — ${resp.quantidade_gerada} × ${formatarReais(valorCada)} = ${formatarReais(total)}.` : '.'));
    if (corpo.cliente_novo) await carregarEquipeClientesAvaliacoes(currentUnit);
    const [ano, mes] = data.split('-').map(Number);
    diaSelecionadoAgenda = data;
    mesAtualCalendario = new Date(ano, mes - 1, 1);
    await renderCalendarioMes();
  } catch (err) { toast(err.cancelado ? 'Nada foi criado.' : 'Erro ao criar a repetição: ' + err.message); }
  finally { atdOcupado = false; }
}

async function salvarAtendimentoUnico() {
  if (atdOcupado) return;
  if (document.getElementById('atd-repete').checked) return salvarSerieAtendimentos();
  const data = atdVal('atd-data'), hora = lerHora(atdVal('atd-hora')), servico = atdVal('atd-servico').trim();
  if (!data || !hora || !servico) { toast('Preencha data, horário e serviço.'); return; }

  const corpo = { tipo_servico: servico, data_atendimento: data, hora_atendimento: hora };
  if (atdVal('atd-area').trim()) corpo.area = atdVal('atd-area').trim();
  if (atdVal('atd-duracao')) corpo.duracao_horas = Number(atdVal('atd-duracao'));
  const valorLido = lerReais(atdVal('atd-valor'));
  if (Number.isNaN(valorLido)) { toast('Valor inválido — use números, ex.: 150,00.'); return; }
  if (valorLido !== null) corpo.valor = valorLido;
  if (atdVal('atd-prestadora')) corpo.prestadora_id = atdVal('atd-prestadora');
  const cliente = atdVal('atd-cliente');
  if (cliente === '__novo__') {
    const nome = atdVal('atd-cliente-nome').trim();
    if (!nome) { toast('Informe o nome do novo cliente.'); return; }
    corpo.cliente_novo = { nome, telefone: atdVal('atd-cliente-tel').trim() };
  } else if (cliente) {
    corpo.cliente_id = cliente;
  }

  // Aba do WhatsApp aberta ANTES do await (mesma razão do salvarReatribuicao).
  const aba = corpo.prestadora_id ? abrirAbaEmBranco() : null;
  atdOcupado = true;
  try {
    const atendimento = await apiComConfirmacao(`/atendimentos/admin/${currentUnit}`, { method: 'POST', body: JSON.stringify(corpo) });
    fecharModalAtendimento();
    toast('Atendimento cadastrado.');
    avisarPrestadoraPorWhatsApp(aba, (prestadorasAgenda[currentUnit] || []).find(p => p.id === corpo.prestadora_id), atendimento);
    if (corpo.cliente_novo) await carregarEquipeClientesAvaliacoes(currentUnit); // novo cliente entra nas listas
    const [ano, mes] = data.split('-').map(Number);
    diaSelecionadoAgenda = data;
    mesAtualCalendario = new Date(ano, mes - 1, 1);
    await renderCalendarioMes();
  } catch (err) {
    if (aba) aba.close();
    toast(err.cancelado ? 'Nada foi cadastrado.' : 'Erro ao cadastrar: ' + err.message);
  } finally { atdOcupado = false; }
}

const dataBR = iso => iso.split('-').reverse().join('/');
// Lê o arquivo, manda pra API só pra pré-visualizar (nada é gravado ainda) e
// mostra o que entraria — o botão "Importar N" é que confirma de verdade.
async function atdArquivoEscolhido(input) {
  const arquivo = input.files[0];
  const resumo = document.getElementById('atd-resumo');
  const botao = document.getElementById('atd-importar');
  atdArquivoBase64 = null;
  botao.disabled = true; botao.textContent = 'Importar';
  resumo.innerHTML = '';
  if (!arquivo) return;
  if (!/\.xlsx$/i.test(arquivo.name)) { toast('Escolha um arquivo .xlsx.'); input.value = ''; return; }
  if (arquivo.size > 6 * 1024 * 1024) { toast('Arquivo muito grande (máx. 6MB).'); input.value = ''; return; }

  resumo.innerHTML = '<div class="atd-aviso">Lendo a planilha…</div>';
  try {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    atdArquivoBase64 = btoa(bin);
    const r = (await apiUpload(`/atendimentos/admin/${currentUnit}/importar`, { arquivo_base64: atdArquivoBase64 }, (pct, processando) => Progresso.definir(processando ? 'Lendo a planilha…' : 'Enviando a planilha…', pct, processando))).resumo;
    Progresso.terminar();

    const semCadastro = r.profissionais_sem_cadastro;
    resumo.innerHTML =
      `<div class="atd-stats">
         <div class="atd-stat"><b>${r.novas}</b><span>novos</span></div>
         <div class="atd-stat"><b>${r.ja_existentes}</b><span>já importados</span></div>
         <div class="atd-stat"><b>${r.clientes_novos}</b><span>clientes novos</span></div>
       </div>`
      + (r.com_valor || r.com_custo ? `<div class="atd-aviso">A planilha traz <b>Valor</b> em ${r.com_valor} linha(s) e <b>Repasse</b> em ${r.com_custo}: eles entram no Financeiro.</div>` : '')
      + (r.periodo ? `<div class="atd-aviso">Período dos novos: ${dataBR(r.periodo.de)} a ${dataBR(r.periodo.ate)}.</div>` : '')
      + (r.novas === 0 ? '<div class="atd-aviso">Nada de novo neste arquivo — tudo nele já está no sistema.</div>' : '')
      + (semCadastro.length ? `<div class="atd-aviso"><b>${semCadastro.length}</b> profissional(is) da planilha ainda não são prestadoras. Ao importar, o sistema cadastra
           cada uma (e-mail <i>nome@gmail.com</i>, sem espaços; senha padrão <b>${escapeHtml(r.senha_padrao)}</b>)${semCadastro.some(p => p.telefone) ? ' <b>já com o telefone que a planilha traz</b> (' + semCadastro.filter(p => p.telefone).length + ' de ' + semCadastro.length + ' com contato)' : ''} e já liga os atendimentos a ela: ${semCadastro.slice(0, 5).map(p => escapeHtml(p.nome) + (p.telefone ? ' · ' + escapeHtml(formatarTelefone(p.telefone)) : '') + ' (' + p.qtd + ')').join(', ')}${semCadastro.length > 5 ? ' e mais ' + (semCadastro.length - 5) + '…' : ''}.</div>` : '')
      + (r.invalidas ? `<div class="atd-aviso"><b>${r.invalidas}</b> linha(s) ignorada(s): ${r.invalidas_detalhe.slice(0, 5).map(i => 'linha ' + i.linha + ' (' + escapeHtml(i.motivo) + ')').join('; ')}${r.invalidas > 5 ? '…' : ''}.</div>` : '')
      + (r.repetidas_no_arquivo ? `<div class="atd-aviso">${r.repetidas_no_arquivo} linha(s) repetida(s) no próprio arquivo (mesmo Número) — vale a primeira.</div>` : '');
    if (r.novas > 0) { botao.disabled = false; botao.textContent = `Importar ${r.novas} novo${r.novas === 1 ? '' : 's'}`; }
  } catch (err) {
    atdArquivoBase64 = null;
    Progresso.terminar();
    resumo.innerHTML = `<div class="atd-aviso">${escapeHtml(err.message)}</div>`;
  }
}

async function confirmarImportacao() {
  if (atdOcupado || !atdArquivoBase64) return;
  atdOcupado = true;
  const botao = document.getElementById('atd-importar');
  botao.disabled = true; botao.textContent = 'Importando…';
  try {
    const r = await apiUpload(`/atendimentos/admin/${currentUnit}/importar`, { arquivo_base64: atdArquivoBase64, confirmar: true }, (pct, processando) => Progresso.definir(processando ? 'Importando os atendimentos…' : 'Enviando a planilha…', pct, processando));
    Progresso.terminar();
    fecharModalAtendimento();
    toast(`${r.importados} atendimento(s) importado(s)` + (r.ja_existentes ? ` · ${r.ja_existentes} já existiam` : '')
      + (r.prestadoras_criadas?.length ? ` · ${r.prestadoras_criadas.length} prestadora(s) cadastrada(s)` : '') + '.');
    await carregarEquipeClientesAvaliacoes(currentUnit); // clientes novos entram nas listas
    await carregarPrestadorasAgenda(currentUnit); // e as prestadoras novas, nas listas de atribuição
    await renderCalendarioMes();
  } catch (err) {
    Progresso.terminar();
    toast('Erro ao importar: ' + err.message);
    botao.disabled = false; botao.textContent = 'Tentar de novo';
  } finally { atdOcupado = false; }
}
