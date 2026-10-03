# Portal da Maria — v1.1.0

Sistema de gestão para franquias de serviços de limpeza (TCC): administrador, sub-administradores com permissão
por módulo, prestadoras e clientes, com agenda em calendário, atendimento recorrente por padrão semanal,
avisos automáticos por WhatsApp (link "clique pra conversar") e moderação de avaliações. Roda 100% local —
frontend em `Portal Da Maria - V1.1.0.html`, backend em `api/` (Node/Express), banco PostgreSQL.

## Para rodar o projeto

Veja o passo a passo completo em [LEIA-ME.md](LEIA-ME.md).

## Documentação

- [LEIA-ME.md](LEIA-ME.md) — instalação, configuração e como testar o fluxo.
- [DOCUMENTACAO-PORTAL-DA-MARIA.md](DOCUMENTACAO-PORTAL-DA-MARIA.md) — mapeamento de telas, regras de negócio e
  rastreabilidade tela → tabela do banco.

## Estrutura

```
Portal Da Maria - V1.1.0.html   — frontend (SPA de arquivo único)
banco-schema.sql                — schema PostgreSQL (tabelas, enums, views, dados de exemplo)
api/                             — backend Node/Express
```
