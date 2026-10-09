// Gera o modelo (.xlsx) da planilha de importação de atendimentos: uma aba "Atendimentos" já no formato
// que o importador lê (com linhas de exemplo) e uma aba "Como preencher" explicando cada coluna.
// Os nomes das colunas vêm de importarPlanilha.js — se o importador mudar, o modelo acompanha.
const writeExcelFile = require('write-excel-file/node').default;

const COLUNAS = [
  // [título, largura, obrigatória?, o que colocar, exemplo]
  ['Orçamento', 12, 'não', 'Código do orçamento/contrato. Serve só pra agrupar atendimentos do mesmo orçamento.', '500'],
  ['Número', 10, 'SIM', 'Código ÚNICO do atendimento (texto ou número; não use nada começando com EXEMPLO). É a chave: reenviar a mesma planilha (ou uma mais nova) só traz o que ainda não existe — o que já foi importado é ignorado.', '1001'],
  ['Data', 12, 'SIM', 'Dia do atendimento, no formato dd/mm/aaaa (ou data do Excel).', '15/10/2026'],
  ['Horário', 10, 'SIM', 'Horário de início, hh:mm.', '08:00'],
  ['Serviço', 14, 'SIM', 'O serviço. "Limpeza" + Tipo "Comercial" vira "Limpeza empresarial"; "Limpeza" + "Residencial" vira "Limpeza residencial"; outros nomes entram como estão.', 'Limpeza'],
  ['Tipo', 14, 'não', 'Complementa o Serviço (Comercial / Residencial / pós-obra...).', 'Comercial'],
  ['Horas', 8, 'não', 'Duração em horas (aceita decimais: 2,5). Define a altura do bloco na agenda; sem ela, 1 hora.', '4'],
  ['Cliente', 34, 'não', 'Nome do cliente; se quiser o telefone, escreva "Nome | Telefone". O cliente é criado (sem login) se ainda não existir.', 'Empresa Exemplo LTDA | (54) 3333-4444'],
  ['Profissionais', 26, 'não', 'Nome da prestadora. Se ela ainda não existir no portal, é cadastrada na hora (e-mail nome@gmail.com, senha padrão) e os atendimentos ficam ligados a ela.', 'Maria da Silva'],
  ['Situação', 12, 'não', 'Previsto (ainda vai acontecer — vira convite pra prestadora), Concluído ou Cancelado. Vazio = Previsto.', 'Previsto'],
  ['Valor', 12, 'não', 'OPCIONAL. Quanto o CLIENTE paga por este atendimento (alimenta o Financeiro). Ex.: 600,00.', '600,00'],
  ['Custo', 12, 'não', 'OPCIONAL. Quanto a FRANQUIA paga à prestadora por este atendimento (repasse). Sem ele, vale o valor por atendimento definido na tela Equipe.', '150,00'],
];

const EXEMPLOS = [
  ['500', 'EXEMPLO-1', new Date(Date.UTC(2026, 9, 15)), '08:00', 'Limpeza', 'Comercial', 4, 'Empresa Exemplo LTDA | (54) 3333-4444', 'Maria da Silva', 'Previsto', '600,00', '150,00'],
  ['501', 'EXEMPLO-2', new Date(Date.UTC(2026, 9, 16)), '13:30', 'Limpeza', 'Residencial', 3, 'Cláudia Souza', 'Maria da Silva', 'Previsto', '240,00', ''],
  ['502', 'EXEMPLO-3', new Date(Date.UTC(2026, 9, 1)), '09:00', 'Passadoria', '', 2.5, 'Pedro Alves | (54) 99999-0000', 'Joana Prestes', 'Concluído', '', ''],
];

async function gerarModeloImportacao() {
  const cab = COLUNAS.map(([titulo, , obrig]) => ({ value: titulo, fontWeight: 'bold', backgroundColor: obrig === 'SIM' ? '#CFE8DA' : '#EEF2EF' }));
  const linhasExemplo = EXEMPLOS.map(l => l.map((valor, i) => (valor instanceof Date ? { value: valor, type: Date, format: 'dd/mm/yyyy' } : (valor === '' ? null : valor))));

  const instrucoes = [
    [{ value: 'Coluna', fontWeight: 'bold' }, { value: 'Obrigatória?', fontWeight: 'bold' }, { value: 'O que colocar', fontWeight: 'bold' }, { value: 'Exemplo', fontWeight: 'bold' }],
    ...COLUNAS.map(([titulo, , obrig, texto, exemplo]) => [{ value: titulo, fontWeight: 'bold' }, obrig, texto, exemplo]),
    [null, null, null, null],
    [{ value: 'Regras gerais', fontWeight: 'bold' }, null, null, null],
    [null, null, 'A primeira aba é a que é lida. O cabeçalho pode ter linhas em branco antes dele; a ordem das colunas não importa, só os nomes.', null],
    [null, null, 'As 3 linhas de exemplo da aba "Atendimentos" têm Número começando com EXEMPLO: o portal as IGNORA, então não faz mal esquecê-las. Apague-as ou substitua pelos seus dados.', null],
    [null, null, 'O portal mostra uma pré-visualização (quantos são novos, quantos já existem, quais prestadoras serão cadastradas) e só grava quando você confirma.', null],
    [null, null, 'Domingos não têm agenda no portal: atendimentos nesse dia entram, mas não aparecem no calendário.', null],
  ];

  return writeExcelFile([
    { data: [cab, ...linhasExemplo], sheet: 'Atendimentos', columns: COLUNAS.map(([, largura]) => ({ width: largura })), stickyRowsCount: 1 },
    { data: instrucoes, sheet: 'Como preencher', columns: [{ width: 16 }, { width: 14 }, { width: 110 }, { width: 38 }] },
  ]).toBuffer();
}

module.exports = { gerarModeloImportacao, COLUNAS_DO_MODELO: COLUNAS.map(c => c[0]) };
