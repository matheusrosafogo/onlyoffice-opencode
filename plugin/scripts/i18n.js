(function (root) {
  "use strict";

  const strings = {
    "pt-BR": {
      appName: "OpenCode",
      newChat: "Nova conversa",
      settings: "Configurações",
      save: "Salvar",
      close: "Fechar",
      cancel: "Cancelar",
      document: "Documento",
      refresh: "Atualizar",
      messagePlaceholder: "Pergunte sobre o documento…",
      send: "Enviar",
      stop: "Parar",
      connection: "Conexão",
      bridgeUrl: "URL do bridge",
      bridgeToken: "Token do bridge",
      testConnection: "Testar conexão",
      testing: "Testando…",
      connectionOk: "Conexão OK",
      connectionFailed: "Falha na conexão",
      modelAndAgent: "Modelo e agente",
      model: "Modelo",
      agent: "Agente",
      agentHint:
        "O agente e as permissões vêm da configuração global do OpenCode.",
      defaultModel: "Padrão do OpenCode",
      defaultAgent: "Padrão do OpenCode",
      noModels: "Nenhum modelo disponível",
      noAgents: "Nenhum agente disponível",
      context: "Contexto",
      includeDocument: "Enviar o documento inteiro nas mensagens",
      contextHint:
        "O conteúdo do documento é enviado ao provedor do modelo escolhido. Se o documento for muito grande, ele será truncado.",
      language: "Idioma da interface",
      diagnostics: "Diagnóstico",
      copyDiagnostics: "Copiar diagnóstico",
      diagnosticsCopied: "Diagnóstico copiado",
      copyFailed: "Não foi possível copiar",
      emptyTitle: "Converse com o seu documento",
      emptyText:
        "Pergunte, resuma, revise, traduza ou peça uma reescrita. O contexto do documento é enviado junto com a sua mensagem.",
      quickSummarize: "Resumir",
      quickReview: "Revisar",
      quickImprove: "Melhorar escrita",
      quickTranslate: "Traduzir para inglês",
      quickExplain: "Explicar",
      quickTranslatePt: "Traduzir para português",
      promptSummarize: "Resuma o documento em tópicos claros e objetivos.",
      promptReview:
        "Revise o texto selecionado (ou o documento inteiro, se não houver seleção) e aponte problemas de clareza, gramática, consistência e tom.",
      promptImprove:
        "Reescreva o texto selecionado (ou o documento inteiro, se não houver seleção) de forma mais clara e profissional, mantendo o significado.",
      promptTranslate:
        "Traduza o texto selecionado (ou o documento inteiro, se não houver seleção) para inglês, mantendo o tom e a terminologia do documento.",
      promptTranslatePt:
        "Traduza o texto selecionado (ou o documento inteiro, se não houver seleção) para português, mantendo o tom e a terminologia do documento.",
      promptExplain: "Explique o conteúdo do documento em linguagem simples.",
      you: "Você",
      assistant: "OpenCode",
      thinking: "Pensando…",
      copy: "Copiar",
      copied: "Copiado",
      insert: "Inserir no cursor",
      inserted: "Texto inserido",
      replace: "Substituir seleção",
      replaced: "Seleção substituída",
      insertError: "Não foi possível inserir o texto",
      replaceError: "Não foi possível substituir a seleção",
      bridgeOffline:
        "O bridge do OpenCode não está acessível. Verifique o serviço e clique em tentar novamente.",
      bridgeHint:
        "Instalação manual: systemctl --user status opencode-onlyoffice. Módulo NixOS: systemctl status opencode-onlyoffice.",
      connected: "Conectado",
      disconnected: "Desconectado",
      retry: "Tentar novamente",
      loading: "Carregando…",
      error: "Erro",
      contextFull: "Documento inteiro",
      contextSelection: "Seleção",
      noSelection: "sem seleção",
      chars: "{n} caracteres",
      contextTruncated:
        "O documento foi truncado para caber no contexto do modelo.",
      contextSent: "Contexto enviado",
      newChatConfirm: "Começar uma nova conversa sobre este documento?",
      settingsSaved: "Configurações salvas",
      permissionTitle: "O OpenCode precisa de permissão",
      permissionText: "Ação: {action}",
      allowOnce: "Permitir uma vez",
      allowAlways: "Permitir sempre",
      deny: "Negar",
      permissionReplied: "Permissão respondida",
      permissionError: "Não foi possível responder à permissão",
      upstreamLost: "Conexão com o OpenCode perdida. Tentando reconectar…",
      upstreamOk: "Conexão com o OpenCode restabelecida.",
      retryScheduled: "O OpenCode vai tentar novamente…",
      emptyDocTitle: "Documento sem título",
      editorWord: "Texto",
      editorCell: "Planilha",
      editorSlide: "Apresentação",
      editorPdf: "PDF",
      selectionChip: "com seleção",
      documentChip: "documento inteiro",
      truncatedChip: "contexto truncado",
      opencodeVersion: "OpenCode",
      workspace: "Workspace",
      notAvailable: "indisponível",
      sendHint: "Ctrl+Enter para enviar",
      stopHint: "Interrompe a resposta atual",
      apply: "Aplicar",
      reasoning: "Raciocínio",
      tool: "Ferramenta",
      showMore: "Mostrar detalhes",
      showLess: "Ocultar detalhes",
      sessionError: "Erro na sessão",
      bridgeStarting: "Conectando ao OpenCode…",
      noDocumentContext:
        "O conteúdo completo não está disponível para este editor.",
    },
    en: {
      appName: "OpenCode",
      newChat: "New chat",
      settings: "Settings",
      save: "Save",
      close: "Close",
      cancel: "Cancel",
      document: "Document",
      refresh: "Refresh",
      messagePlaceholder: "Ask about the document…",
      send: "Send",
      stop: "Stop",
      connection: "Connection",
      bridgeUrl: "Bridge URL",
      bridgeToken: "Bridge token",
      testConnection: "Test connection",
      testing: "Testing…",
      connectionOk: "Connection OK",
      connectionFailed: "Connection failed",
      modelAndAgent: "Model and agent",
      model: "Model",
      agent: "Agent",
      agentHint:
        "The agent and permissions come from your global OpenCode configuration.",
      defaultModel: "OpenCode default",
      defaultAgent: "OpenCode default",
      noModels: "No models available",
      noAgents: "No agents available",
      context: "Context",
      includeDocument: "Send the whole document with each message",
      contextHint:
        "The document content is sent to the provider of the selected model. Very large documents are truncated.",
      language: "Interface language",
      diagnostics: "Diagnostics",
      copyDiagnostics: "Copy diagnostics",
      diagnosticsCopied: "Diagnostics copied",
      copyFailed: "Could not copy",
      emptyTitle: "Chat with your document",
      emptyText:
        "Ask, summarize, review, translate or request a rewrite. The document context is sent with your message.",
      quickSummarize: "Summarize",
      quickReview: "Review",
      quickImprove: "Improve writing",
      quickTranslate: "Translate to English",
      quickExplain: "Explain",
      quickTranslatePt: "Translate to Portuguese",
      promptSummarize:
        "Summarize the document in clear, objective bullet points.",
      promptReview:
        "Review the selected text (or the whole document if there is no selection) and point out clarity, grammar, consistency and tone issues.",
      promptImprove:
        "Rewrite the selected text (or the whole document if there is no selection) in a clearer, more professional way while keeping the meaning.",
      promptTranslate:
        "Translate the selected text (or the whole document if there is no selection) to English, keeping the document's tone and terminology.",
      promptTranslatePt:
        "Translate the selected text (or the whole document if there is no selection) to Portuguese, keeping the document's tone and terminology.",
      promptExplain: "Explain the document content in simple terms.",
      you: "You",
      assistant: "OpenCode",
      thinking: "Thinking…",
      copy: "Copy",
      copied: "Copied",
      insert: "Insert at cursor",
      inserted: "Text inserted",
      replace: "Replace selection",
      replaced: "Selection replaced",
      insertError: "Could not insert the text",
      replaceError: "Could not replace the selection",
      bridgeOffline:
        "The OpenCode bridge is not reachable. Check the service and try again.",
      bridgeHint:
        "Manual install: systemctl --user status opencode-onlyoffice. NixOS module: systemctl status opencode-onlyoffice.",
      connected: "Connected",
      disconnected: "Disconnected",
      retry: "Try again",
      loading: "Loading…",
      error: "Error",
      contextFull: "Whole document",
      contextSelection: "Selection",
      noSelection: "no selection",
      chars: "{n} characters",
      contextTruncated: "The document was truncated to fit the model context.",
      contextSent: "Context sent",
      newChatConfirm: "Start a new conversation about this document?",
      settingsSaved: "Settings saved",
      permissionTitle: "OpenCode needs permission",
      permissionText: "Action: {action}",
      allowOnce: "Allow once",
      allowAlways: "Allow always",
      deny: "Deny",
      permissionReplied: "Permission answered",
      permissionError: "Could not answer the permission request",
      upstreamLost: "Lost connection to OpenCode. Reconnecting…",
      upstreamOk: "Connection to OpenCode restored.",
      retryScheduled: "OpenCode will retry…",
      emptyDocTitle: "Untitled document",
      editorWord: "Document",
      editorCell: "Spreadsheet",
      editorSlide: "Presentation",
      editorPdf: "PDF",
      selectionChip: "with selection",
      documentChip: "whole document",
      truncatedChip: "context truncated",
      opencodeVersion: "OpenCode",
      workspace: "Workspace",
      notAvailable: "unavailable",
      sendHint: "Ctrl+Enter to send",
      stopHint: "Stops the current response",
      apply: "Apply",
      reasoning: "Reasoning",
      tool: "Tool",
      showMore: "Show details",
      showLess: "Hide details",
      sessionError: "Session error",
      bridgeStarting: "Connecting to OpenCode…",
      noDocumentContext: "Full content is not available for this editor.",
    },
  };

  let current = "pt-BR";

  function detect() {
    let lang = "";
    try {
      lang = new URLSearchParams(root.location.search).get("lang") || "";
    } catch {
      lang = "";
    }
    if (!lang) lang = navigator.language || "pt-BR";
    return lang.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
  }

  function setLang(lang) {
    current = strings[lang] ? lang : "pt-BR";
    if (root.document) root.document.documentElement.lang = current;
    return current;
  }

  function getLang() {
    return current;
  }

  function t(key, vars) {
    const table = strings[current] || strings["pt-BR"];
    let value = table[key];
    if (value === undefined) value = strings["pt-BR"][key];
    if (value === undefined) return key;
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return value;
  }

  root.OO_I18N = { strings, detect, setLang, getLang, t };
})(window);
