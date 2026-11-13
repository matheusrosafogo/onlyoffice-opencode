# Changelog

## 0.4.0

- Modo agêntico com servidor MCP local (stdio): o OpenCode lê e edita o
  documento diretamente.
- Ferramentas: `get_document`, `get_selection`, `insert_text`,
  `replace_selection`, `apply_office_doc`, `accept_all_revisions` e
  `reject_all_revisions`.
- Roteamento por `sessionID` do OpenCode para o painel do documento correto,
  inclusive com várias janelas abertas.
- Track Changes obrigatório em toda escrita, com autor `OpenCode`; a ferramenta
  falha se o modo de revisão não puder ser ativado.
- Permissões: leituras são `allow`; escritas são `ask`. O botão "Permitir
  sempre" não aparece para escritas `onlyoffice_*`.
- Ferramentas Writer-only; planilhas, apresentações e PDFs retornam erro claro.
- O bridge gera/atualiza o `opencode.json` do workspace e o `AGENTS.md` com as
  instruções das ferramentas.
- Testes do protocolo MCP, do roteamento bridge/SSE e do gerador de configuração.

## 0.3.1

- Track Changes no Writer: inserir e substituir conteúdo como revisão
  atribuída ao autor `OpenCode`.
- Toggle "Revisões" no rodapé do painel e opção correspondente nas
  configurações.
- Suporte a `"trackChanges": true|false` no bloco `office-doc`.
- O estado anterior do Track Changes é restaurado após a inserção.
- Foco em documentos (Writer); planilhas e apresentações continuam com texto
  simples e PDFs não são modificados.

## 0.3.0

- Formatação avançada no Writer via bloco `office-doc`: fontes, tamanhos,
  cores, espaçamento, alinhamento, margens, quebras de página, tabelas nativas
  e caixas de texto/quadros.
- Card no chat para documentos estruturados, com resumo e especificação JSON.
- Ação rápida "Layout avançado".
- `AGENTS.md` com o schema `office-doc` e instruções de uso.
- Bridge garante que o `AGENTS.md` do workspace seja editável.

## 0.2.0

- Inserção formatada no Writer: Markdown convertido para HTML e aplicado com
  `PasteHtml` (títulos, negrito, itálico, listas, tabelas, citações e código).
- Substituição de seleção com formatação no Writer.
- Opção "Aplicar formatação ao inserir no Writer (Markdown)" nas configurações.
- Tabelas Markdown renderizadas no chat.
- Tema do painel aplicado a partir do `theme-type` da URL do plugin.
- Idioma do painel detectado a partir do `lang` do ONLYOFFICE.
- Workspace `AGENTS.md` deixa de ser somente leitura e orienta o modelo a usar
  Markdown estruturado.
- Instalador reinicia o serviço ao atualizar.

## 0.1.0

- Primeira versão: painel de chat, contexto do documento, streaming, copiar,
  inserir e substituir seleção.
- Bridge local com banco isolado do OpenCode e cópia de credenciais.
- Módulo NixOS e artefato `.plugin` para instalação manual.
