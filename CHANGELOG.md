# Changelog

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
