/* Portal da Maria — Área do cliente
   Atendimentos do cliente, avaliação e pedido de serviço. */

/* cliente avalia (vai para moderação) */
/* Atendimentos do cliente: serviço, data/horário, status e a profissional (nome + foto) quando confirmada.
   "Solicitar cancelamento" só abre o WhatsApp da unidade com a mensagem pronta — NÃO muda nada no atendimento:
   quem cancela é o administrador. */
const STATUS_CLIENTE = {
  pedido: ['aguardando profissional', 'st-wait'], proposto: ['aguardando profissional', 'st-wait'], recusado: ['aguardando profissional', 'st-wait'],
  aceito: ['confirmado', 'st-ok'], concluido: ['concluído', 'st-ok'], cancelado: ['cancelado', 'st-new'], falta: ['não realizado', 'st-new'],
};
const fotoSegura = (foto) => (typeof foto === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(foto) ? foto : null);
function cardAtendimentoCliente(a, hojeISO) {
  const prest = a.prestadora_id ? clienteAtendimentos.prestadoras[a.prestadora_id] : null;
  const foto = prest ? fotoSegura(prest.foto) : null;
  const avatar = foto ? `<div class="cli-foto" style="background-image:url('${foto}')" role="img" aria-label="Foto de ${escapeHtml(prest.nome)}"></div>`
    : `<div class="cli-foto" aria-hidden="true">${prest ? escapeHtml(iniciaisNome(prest.nome)) : '?'}</div>`;
  const [rotulo, cls] = a.em_andamento ? ['em andamento', 'st-route'] : (STATUS_CLIENTE[a.status] || [a.status, 'st-wait']);
  const quando = `${dataBR(a.dia)}${a.hora ? ' · ' + a.hora + (a.hora_fim ? '–' + a.hora_fim : '') : ''}`;
  const quem = prest ? `Profissional: <b>${escapeHtml(prest.nome)}</b>` : (a.status === 'cancelado' ? '' : 'Profissional ainda não confirmada');
  const podePedirCancelamento = ['pedido', 'proposto', 'recusado', 'aceito'].includes(a.status) && a.dia >= hojeISO && !a.em_andamento;
  return `<div class="cli-card${a.status === 'cancelado' ? ' cancelado-c' : ''}">${avatar}
    <div class="cli-corpo" style="flex:1;min-width:0"><strong style="display:block;font-size:14px">${escapeHtml(a.tipo_servico)}</strong>
      <span style="font-size:12.5px;color:var(--muted);display:block">${quando}${a.area ? ' · ' + escapeHtml(a.area) : ''}</span>
      ${quem ? `<span style="font-size:12.5px;display:block">${quem}</span>` : ''}
      ${podePedirCancelamento ? `<a href="#" style="font-size:12px" onclick="event.preventDefault();solicitarCancelamentoWhats('${a.id}')">Solicitar cancelamento</a>` : ''}</div>
    <div class="job-status ${cls}">${rotulo}</div></div>`;
}
function renderClienteAtendimentos() {
  const hoje = hojeISOBrasil();
  const todos = clienteAtendimentos.atendimentos;
  const ativos = ['pedido', 'proposto', 'recusado', 'aceito'];
  const futuros = todos.filter(a => ativos.includes(a.status) && a.dia >= hoje).sort((x, y) => (x.dia + (x.hora || '')).localeCompare(y.dia + (y.hora || '')));
  const proximo = futuros[0];
  document.getElementById('cli-proximo').innerHTML = proximo ? cardAtendimentoCliente(proximo, hoje) : '<div class="empty">Nenhum atendimento marcado. Que tal pedir um novo serviço?</div>';
  // depois do próximo: os que ainda vão acontecer (em ordem de data) e, por fim, os passados/cancelados (mais recentes primeiro)
  const resto = [...futuros.slice(1), ...todos.filter(a => !futuros.includes(a))];
  document.getElementById('cli-historico').innerHTML = resto.length
    ? resto.map(a => cardAtendimentoCliente(a, hoje)).join('') + '<p style="font-size:12px;padding:10px 18px;margin:0">O cancelamento é sempre confirmado pela unidade: "Solicitar cancelamento" só abre uma conversa no WhatsApp.</p>'
    : '<div class="empty">Seus atendimentos vão aparecer aqui.</div>';
}
// Direto do clique (sem await): é o que o navegador exige pra abrir o WhatsApp. Não altera o atendimento.
function solicitarCancelamentoWhats(id) {
  const a = clienteAtendimentos.atendimentos.find(x => x.id === id);
  if (!a) return;
  const slug = usuarioLogado?.dados?.unidade_slug || regiao;
  const tel = (cidades[slug] || {}).tel;
  if (!tel) { toast('Esta unidade ainda não tem WhatsApp cadastrado.'); return; }
  const prest = a.prestadora_id ? clienteAtendimentos.prestadoras[a.prestadora_id] : null;
  const mensagem = `Olá! Gostaria de *solicitar o cancelamento* do atendimento abaixo:\n`
    + `• Serviço: ${a.tipo_servico}\n• Data: ${dataBR(a.dia)}${a.hora ? ' às ' + a.hora : ''}\n`
    + (prest ? `• Profissional: ${prest.nome}\n` : '')
    + `• Referência: ${a.codigo}\n• Cliente: ${usuarioLogado?.dados?.nome || ''}\n\nAguardo a confirmação do cancelamento.`;
  abrirAbaExterna(linkWhatsApp(tel, mensagem));
}

let selRating = {};
function renderClienteAval() {
  const box = document.getElementById('cli-aval');
  box.innerHTML = concluidos.length === 0 ? '<div class="empty">Nenhum atendimento pendente de avaliação. Obrigado! 🙂</div>'
    : concluidos.map(c => `<div class="rate-item"><div class="rate-top"><strong>${escapeHtml(c.servico)}</strong><span>${c.data} · ${escapeHtml(c.prestadora)}</span></div><div class="rate-stars" id="rs-${c.id}">${[1, 2, 3, 4, 5].map(n => '<span class="st" onclick="setStar(\'' + c.id + '\',' + n + ')">★</span>').join('')}</div><textarea id="rc-${c.id}" placeholder="Conte como foi o atendimento (opcional)"></textarea><div><button class="btn-sm" onclick="enviarAvaliacao('${c.id}')">Enviar avaliação</button></div></div>`).join('');
}
function setStar(id, n) { selRating[id] = n; const c = document.getElementById('rs-' + id); if (!c) return;[...c.children].forEach((s, i) => s.classList.toggle('on', i < n)); }
async function enviarAvaliacao(id) {
  const c = concluidos.find(x => x.id === id); if (!c) return;
  const nota = selRating[id] || 0;
  if (!nota) { toast('Escolha de 1 a 5 estrelas antes de enviar.'); return; }
  const com = (document.getElementById('rc-' + id).value || '').trim();
  try {
    await api('/avaliacoes', { method: 'POST', body: JSON.stringify({ atendimento_id: id, nota, comentario: com }) });
    delete selRating[id];
    await carregarDadosCliente();
    renderClienteAval();
    toast('Avaliação enviada — passará pela unidade antes de ir à prestadora.');
  } catch (err) { toast('Erro ao enviar avaliação: ' + err.message); }
}

/* pedido do cliente -> "novo" na unidade */
async function enviarPedido(viaWhats) {
  const nome = document.getElementById('c-nome').value.trim();
  const tel = document.getElementById('c-tel').value.trim();
  const serv = document.getElementById('c-serv').value;
  const msg = (document.getElementById('c-msg').value || '').trim();
  // Pelo WhatsApp o telefone já vai junto na conversa, então só o pedido "normal" exige o número
  // (é por ele que a unidade retorna a ligação).
  if (!nome || (!viaWhats && !tel)) { toast(viaWhats ? 'Preencha seu nome.' : 'Preencha seu nome e telefone para a gente te retornar.'); return; }
  const aba = viaWhats ? abrirAbaEmBranco() : null;
  try {
    await api('/atendimentos', {
      method: 'POST', body: JSON.stringify({
        unidade_slug: regiao, tipo_servico: serv, area: msg || null,
        data_atendimento: hojeISOBrasil(),
        origem: viaWhats ? 'whatsapp' : 'site',
        cliente_nome: nome, cliente_telefone: tel || null // a unidade passa a ver quem pediu (e o telefone)
      })
    });
    document.getElementById('c-nome').value = ''; document.getElementById('c-tel').value = ''; document.getElementById('c-msg').value = '';
    if (viaWhats && aba) {
      const telUnidade = (cidades[regiao] || {}).tel;
      // sem o telefone no texto: a mensagem já sai do WhatsApp da pessoa, o número aparece pra unidade
      const mensagem = `Olá! Meu nome é ${nome} e gostaria de um orçamento de ${serv} com a unidade de ${cidades[regiao].nome}.`
        + (msg ? `\nDetalhe do pedido: ${msg}` : '');
      if (telUnidade) { aba.location.href = linkWhatsApp(telUnidade, mensagem); } else { aba.close(); }
      toast('Pedido enviado! Abrindo o WhatsApp da unidade de ' + cidades[regiao].nome + '.');
    } else {
      toast('Pedido enviado para a unidade de ' + cidades[regiao].nome + '. Em breve entram em contato.');
    }
  } catch (err) {
    if (aba) aba.close();
    toast('Erro ao enviar pedido: ' + err.message);
  }
}
