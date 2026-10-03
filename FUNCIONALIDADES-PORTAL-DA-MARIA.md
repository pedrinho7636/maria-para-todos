# Portal da Maria — Descrição Funcional Completa do Sistema

> Material de apoio para redação do corpo do trabalho (TCC). Foco exclusivo no que o sistema **entrega funcionalmente** — o que cada tipo de usuário consegue fazer, em que ordem, sob quais regras e condições — sem entrar em detalhes de implementação, arquitetura de código ou tecnologia. Pode ser colado integralmente para gerar a descrição do sistema, os requisitos funcionais, os casos de uso ou a fundamentação das regras de negócio.

---

## 1. Contexto e propósito

O Portal da Maria é um sistema de gestão para franquias de serviços de limpeza da rede Maria Brasileira. Ele conecta, numa única plataforma, quatro tipos de usuário — administrador (franqueado), sub-administrador (funcionário do franqueado), prestadora de serviço e cliente — em torno do ciclo completo de um atendimento de limpeza: do pedido inicial até a avaliação final do serviço prestado.

O sistema opera hoje sobre duas unidades franqueadas — Carazinho/RS e Panambi/RS —, com todos os dados operacionais (agenda, equipe, clientes, avaliações) tratados de forma independente por unidade, permitindo que um mesmo franqueado administre uma ou mais unidades a partir do mesmo painel.

O propósito central é substituir controle manual/informal (planilhas, WhatsApp avulso, agenda de papel) por um fluxo estruturado que: capta pedidos de orçamento, transforma pedidos em atendimentos atribuídos a uma profissional específica, acompanha a confirmação da profissional, registra a conclusão do serviço e coleta e modera a avaliação do cliente — tudo isso com visibilidade e permissões diferentes para cada papel envolvido.

---

## 2. Perfis de usuário

| Perfil | Quem é | Vínculo |
|---|---|---|
| **Administrador** | O franqueado, dono do negócio | Pode administrar uma ou mais unidades |
| **Sub-administrador** | Funcionário de confiança do franqueado | Vinculado a exatamente uma unidade, com permissões por módulo definidas pelo administrador |
| **Prestadora** | Profissional que executa o serviço de limpeza | Vinculada a uma unidade desde o cadastro |
| **Cliente** | Quem contrata o serviço | Vinculado a uma unidade, pode surgir de um pedido avulso ou de cadastro completo |

A tela de login é unificada: o usuário escolhe apenas o tipo de perfil (administrador, prestadora ou cliente) e informa suas credenciais; o próprio sistema resolve internamente, sem o usuário precisar saber a distinção, se um login de "administrador" corresponde ao franqueado completo ou a um sub-administrador — ambos usam a mesma tela e o mesmo formulário.

---

## 3. Página institucional pública (Home)

Acessível sem necessidade de login, é a porta de entrada do sistema para o público em geral:

- **Seletor de região**: um modal permite ao visitante escolher entre as unidades disponíveis (Carazinho ou Panambi); a escolha atualiza todo o conteúdo dinâmico da página — telefone de contato, endereço, dados institucionais — para refletir a unidade selecionada.
- **Seção institucional (hero)**: apresentação da marca e da unidade selecionada.
- **Seção de funcionalidades**: comunica ao visitante o que o serviço oferece.
- **Seção de serviços**: direciona para páginas oficiais da marca com o detalhamento dos serviços prestados.
- **Formulário de pedido de orçamento**: o visitante informa o tipo de serviço desejado, a área/local do atendimento, e a data (e opcionalmente horário) pretendidos, podendo indicar que prefere ser contatado por WhatsApp. Ao enviar, o pedido entra automaticamente na fila de atendimentos da unidade escolhida, no estágio inicial ("pedido"), ficando disponível para triagem do administrador — **sem que o visitante precise ter conta ou estar logado**.
- **Contato direto por WhatsApp**: um link "clique para conversar" abre o WhatsApp já com o número da unidade e uma mensagem pronta.

---

## 4. Autenticação e cadastro

- **Login unificado**: uma única tela para os três perfis (administrador, prestadora, cliente), com o identificador de acesso variando por perfil — e-mail para administrador e cliente, telefone para prestadora.
- **Cadastro de administrador**: informa nome, sobrenome, e-mail, senha e o(s) CNPJ(s) da(s) unidade(s) que representa; o vínculo com a(s) unidade(s) correspondente(s) é criado automaticamente a partir do CNPJ informado. O fluxo prevê uma etapa de confirmação por código enviado ao e-mail informado antes de liberar o acesso.
- **Cadastro de prestadora**: já nasce vinculado a uma unidade regional específica, escolhida no próprio formulário; o fluxo prevê confirmação por código enviado via WhatsApp ao número informado.
- **Cadastro de cliente**: pode ser feito de forma independente (nome, telefone, e-mail, senha, unidade) ou o registro do cliente pode nascer indiretamente de um pedido de orçamento avulso feito na home, sem conta prévia.
- **Sessão persistente**: uma vez autenticado, o usuário permanece logado por um período de validade (sete dias), sem precisar reinformar credenciais a cada acesso dentro desse prazo.

---

## 5. Painel do administrador (franqueado)

O painel principal do administrador é dividido em módulos de navegação interna, cada um cobrindo uma responsabilidade do dia a dia da franquia.

### 5.1 Visão geral (dashboard)

Tela inicial ao entrar no painel, resume o desempenho da unidade selecionada:
- Quantidade de atendimentos do dia.
- Quantidade de profissionais escaladas para o dia.
- Faturamento acumulado no mês corrente.
- NPS médio (nota média das avaliações já aprovadas pela moderação).
- Resumo/prévia da agenda do dia.

### 5.2 Agenda

O módulo mais operacional do painel, com duas visões complementares:
- **Visão mensal (calendário)**: exibe o mês inteiro com indicação visual de quantos atendimentos existem em cada dia, permitindo navegar entre meses e saltar para qualquer dia específico.
- **Visão do dia (linha do tempo)**: mostra os atendimentos do dia selecionado organizados numa timeline por horário, cada um identificado por tipo de serviço, local e status.

A partir da agenda, o administrador realiza as seguintes ações:
- **Converter pedido em convite**: escolhe uma prestadora disponível da unidade para atender um pedido recém-chegado (seja da home pública, seja criado manualmente), fazendo o atendimento avançar de "pedido" para "proposto" (convite enviado à prestadora).
- **Reatribuir prestadora**: a qualquer momento antes da conclusão ou cancelamento, pode trocar a prestadora designada a um atendimento — inclusive remover a atribuição e deixá-lo novamente sem prestadora definida — sem precisar recriar o atendimento do zero.
- **Marcar como concluído**: registra que o atendimento aceito foi efetivamente realizado, encerrando aquela etapa do ciclo e liberando-o para avaliação do cliente.
- **Atendimento recorrente (padrão semanal)**: em vez de criar atendimentos avulsos um a um, o administrador monta um "padrão" com um ou mais compromissos — cada um definido por dia da semana, horário e tipo de serviço, podendo já indicar a prestadora e/ou o cliente responsáveis — escolhe a data de início e por quantos meses esse padrão deve se repetir, com a opção de repetição semanal contínua ou quinzenal (a cada duas semanas). O sistema gera de uma só vez todas as ocorrências correspondentes àquele período, já como compromissos individuais na agenda, agrupados sob uma mesma "série".
- **Cancelar série recorrente**: cancela de uma só vez todas as ocorrências futuras (ainda não realizadas) de uma série de atendimentos recorrentes, preservando o histórico do que já aconteceu.
- Há um limite de segurança na geração de recorrências (até 200 ocorrências por vez), para impedir que uma configuração equivocada gere uma quantidade descontrolada de compromissos.

### 5.3 Equipe

Lista as prestadoras vinculadas à unidade, mostrando para cada uma:
- Quantidade total de atendimentos já concluídos.
- Nota média recebida nas avaliações aprovadas.
- Situação (ativa ou inativa).

### 5.4 Clientes

Lista os clientes da unidade, mostrando para cada um um histórico resumido: quantidade total de serviços já realizados, e o tipo e a data do último atendimento.

### 5.5 Avaliações (moderação)

Toda avaliação enviada por um cliente passa por um fluxo de aprovação antes de se tornar pública para a prestadora:
- Fila de avaliações **pendentes**, aguardando decisão do administrador (ou de um sub-administrador com permissão para o módulo).
- Ação de **aprovar**: libera a avaliação para a prestadora avaliada visualizar e contar na sua nota média.
- Ação de **recusar**: a avaliação não é publicada nem chega ao conhecimento da prestadora.
- Histórico de avaliações já moderadas (aprovadas e recusadas), para consulta.

### 5.6 Configurações da unidade

- Edição do número de WhatsApp da unidade, usado em todos os links de contato automático gerados pelo sistema para aquela unidade. Esta é uma configuração institucional da franquia, e por isso é uma ação exclusiva do administrador completo — não pode ser delegada a um sub-administrador, mesmo que ele tenha acesso a todos os outros módulos.

### 5.7 Acessos (gestão de sub-administradores)

Módulo dedicado à criação e gestão da equipe interna de acesso ao sistema:
- **Criar sub-administrador**: cadastra um funcionário de confiança com nome, sobrenome, e-mail e senha, vinculado a uma unidade específica.
- **Permissões por módulo**: para cada sub-administrador, o administrador define individualmente quais módulos ele pode acessar — dashboard, agenda, avaliações, equipe e clientes (um módulo financeiro já está previsto na estrutura de permissões, reservado para uma versão futura do sistema).
- **Editar**: nome, sobrenome, senha e o conjunto de permissões podem ser alterados a qualquer momento.
- **Ativar/desativar**: um sub-administrador pode ser temporariamente bloqueado sem precisar excluir seu cadastro ou perder o histórico de suas ações.
- A gestão de sub-administradores em si é sempre uma ação exclusiva do administrador completo — um sub-administrador nunca pode criar, editar ou gerenciar outros sub-administradores, mesmo que tenha acesso a todos os demais módulos.
- Na prática de uso, a interface do sub-administrador se adapta automaticamente às permissões concedidas: os módulos e itens de menu para os quais ele não tem acesso simplesmente não aparecem.

### 5.8 Gestão multiunidade

Um mesmo administrador pode estar vinculado a mais de uma unidade (por exemplo, ser o franqueado responsável tanto por Carazinho quanto por Panambi) e alternar livremente entre elas dentro do painel. Cada unidade mantém seus próprios dados de agenda, equipe, clientes e avaliações, totalmente segmentados entre si.

---

## 6. Painel da prestadora

Voltado para a profissional que executa os serviços, organizado em torno de três blocos:

- **Convites pendentes**: lista os atendimentos que o administrador propôs para aquela prestadora e que ainda aguardam sua resposta (aceitar ou recusar).
  - **Regra de antecedência**: a confirmação de um convite só pode ser feita a partir de dois dias antes da data marcada para o atendimento — convites mais distantes no tempo ficam visíveis na lista, mas ainda não podem ser confirmados, evitando o compromisso de uma agenda muito antecipada que ainda pode mudar.
  - **Recusar**: remove o atendimento da lista de convites da prestadora e devolve o compromisso para o administrador reatribuir a outra profissional.
- **Agenda confirmada**: mostra, em lista e em formato de calendário, apenas os atendimentos já aceitos pela prestadora — os convites ainda pendentes não aparecem aqui, reforçando a separação entre "o que foi oferecido" e "o que está de fato confirmado".
- **Avaliações recebidas**: exibe a nota média geral da prestadora, destaca as três avaliações aprovadas mais recentes, e mantém um histórico das demais avaliações já aprovadas.

---

## 7. Área do cliente

- **Pedido de orçamento**: pode ser feito diretamente pela página pública, sem necessidade de login — é o principal ponto de entrada de novos atendimentos no sistema.
- **Avaliação de atendimentos concluídos**: após login, o cliente visualiza os atendimentos já concluídos que ainda não avaliou, podendo escolher uma nota (de uma a cinco estrelas) e, opcionalmente, escrever um comentário livre sobre a experiência.
- Toda avaliação enviada entra automaticamente na fila de moderação do administrador — o cliente não tem visibilidade sobre se sua avaliação foi aprovada ou recusada dentro do fluxo atual; ela apenas deixa de aparecer como pendente após o envio.

---

## 8. Comunicação automática via WhatsApp ("clique para conversar")

O sistema não envia mensagens de forma automática e silenciosa — ele prepara e abre, no momento certo, um link de conversa do WhatsApp já com o número correto e uma mensagem pronta com os dados relevantes do atendimento ou do pedido, cabendo à pessoa apenas revisar e apertar "enviar". Isso acontece em três situações:

1. **Ao reatribuir uma prestadora** a um atendimento — abre uma conversa com a profissional, informando os dados do compromisso designado a ela.
2. **Ao a prestadora confirmar (aceitar) um atendimento** — abre uma conversa relacionada à confirmação daquele compromisso.
3. **Ao um cliente pedir orçamento pela home marcando preferência de contato "via WhatsApp"** — abre uma conversa com a unidade, já descrevendo o pedido feito.

O número de destino é sempre o cadastrado (da prestadora ou da unidade, conforme o caso), e o número de WhatsApp de cada unidade pode ser atualizado pelo administrador a qualquer momento (ver item 5.6).

---

## 9. Ciclo de vida do atendimento (regra central do sistema)

Todo atendimento — venha de um pedido público, de um cadastro manual do administrador ou de uma recorrência — percorre a mesma progressão de estados, que é o eixo em torno do qual todas as telas e permissões do sistema são organizadas:

**Pedido → Proposto → Aceito → Concluído → Avaliado** (com os desvios possíveis **Recusado** e **Cancelado** a qualquer momento antes da conclusão)

- **Pedido**: o atendimento existe, mas ainda não tem uma prestadora designada. Pode ter chegado pela home pública, por um cadastro manual do administrador, ou como parte de uma série recorrente sem prestadora pré-definida.
- **Proposto**: o administrador escolheu uma prestadora para aquele atendimento; o compromisso aparece como convite pendente para ela.
- **Recusado**: a prestadora recusou o convite; o atendimento volta a precisar de uma nova atribuição pelo administrador.
- **Aceito**: a prestadora confirmou o convite (respeitando a regra dos dois dias de antecedência); o compromisso passa a constar como agenda confirmada, tanto para a prestadora quanto para a unidade.
- **Concluído**: o administrador registra que o serviço foi efetivamente realizado; o atendimento passa a poder ser avaliado pelo cliente.
- **Avaliado**: o cliente enviou sua avaliação (nota + comentário opcional), que entra como pendente até passar pela moderação do administrador — só então, se aprovada, passa a contar visivelmente para a nota da prestadora.
- **Cancelado**: pode ocorrer em qualquer etapa anterior à conclusão, seja individualmente, seja em lote ao se cancelar as ocorrências futuras de uma série recorrente.

---

## 10. Regras de negócio transversais

- **Segmentação por unidade**: praticamente todos os dados operacionais (agenda, equipe, clientes, avaliações) são isolados por unidade regional; um administrador só enxerga e opera sobre as unidades às quais está vinculado.
- **Vínculo administrador↔unidade não depende de um único identificador fixo**: o mesmo franqueado pode estar associado a mais de uma unidade, e o sistema foi desenhado para que essa associação seja explícita e verificável a cada ação, e não assumida.
- **Toda permissão é reconferida no momento da ação**: se um sub-administrador perde uma permissão ou é desativado, isso se reflete imediatamente nas ações que ele consegue realizar — o sistema não se baseia apenas no que foi concedido no momento do login.
- **Moderação como etapa obrigatória**: nenhuma avaliação chega à prestadora sem antes passar pela aprovação (ou recusa) do administrador da unidade.
- **Separação entre "oferecido" e "confirmado"** na visão da prestadora: convites pendentes e agenda confirmada são sempre tratados como listas distintas, nunca misturadas.

---

## 11. Fora do escopo atual (previsto para versões futuras)

- **Integração oficial com a API do WhatsApp Business (Meta Cloud API)**: hoje a comunicação por WhatsApp depende do link manual "clique para conversar"; não há envio automático de mensagens nem leitura de respostas pelo sistema.
- **Duração configurável do atendimento**: atualmente todo atendimento ocupa um bloco fixo de tempo na agenda.
- **Edição de data/horário de um atendimento já criado**: hoje só é possível reatribuir a prestadora responsável; alterar quando o atendimento acontece exige cancelar e recriar o compromisso.
- **Módulo financeiro do sub-administrador**: a permissão já existe na estrutura de acessos, mas a funcionalidade correspondente ainda não foi implementada.
