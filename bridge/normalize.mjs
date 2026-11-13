// Adaptação entre o schema do OpenCode V2 e o schema simples consumido pelo
// plugin do ONLYOFFICE.

const CONTEXT_START = "<!-- onlyoffice-context ";
const CONTEXT_END = "<!-- /onlyoffice-context -->";

export function formatError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error.message === "string") return error.message;
  if (typeof error.error === "string") return error.error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function stripContext(text) {
  if (typeof text !== "string")
    return { displayText: "", metadata: null, context: "" };

  const start = text.indexOf(CONTEXT_START);
  const end =
    start === -1 ? -1 : text.indexOf(CONTEXT_END, start + CONTEXT_START.length);
  if (start === -1 || end === -1) {
    return { displayText: text.trim(), metadata: null, context: "" };
  }

  const metaStart = start + CONTEXT_START.length;
  const metaEnd = text.indexOf(" -->", metaStart);
  let metadata = null;
  if (metaEnd !== -1) {
    try {
      metadata = JSON.parse(text.slice(metaStart, metaEnd));
    } catch {
      metadata = null;
    }
  }

  const bodyStart = text.indexOf("\n", metaEnd === -1 ? metaStart : metaEnd);
  const context = bodyStart === -1 ? "" : text.slice(bodyStart + 1, end).trim();
  const displayText = text.slice(end + CONTEXT_END.length).trim();

  return { displayText, metadata, context };
}

export function truncateDocument(document, maxChars) {
  const text = typeof document === "string" ? document : "";
  if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false, droppedChars: 0 };
  }

  // Mantém o começo e o fim: contratos e relatórios costumam ter informação
  // importante nas duas pontas (título/resumo e assinaturas/conclusão).
  const keepHead = Math.floor(maxChars * 0.7);
  const keepTail = Math.max(0, maxChars - keepHead);
  const dropped = text.length - maxChars;
  const marker = `\n\n[... ${dropped} caracteres omitidos do documento ...]\n\n`;
  const clipped =
    text.slice(0, keepHead) +
    marker +
    (keepTail > 0 ? text.slice(-keepTail) : "");

  return { text: clipped, truncated: true, droppedChars: dropped };
}

export function buildPrompt({
  displayText,
  document,
  selection,
  editor,
  title,
  metadata = {},
}) {
  const meta = {
    editor: editor || "unknown",
    title: title || "",
    selection: Boolean(selection),
    documentChars: typeof document === "string" ? document.length : 0,
    selectionChars: typeof selection === "string" ? selection.length : 0,
    ...metadata,
  };

  const parts = [
    `${CONTEXT_START}${JSON.stringify(meta)} -->`,
    `Documento: ${title || "(sem título)"}`,
    `Editor: ${editor || "desconhecido"}`,
    "",
    "### Conteúdo do documento",
    "",
    document || "(conteúdo do documento não disponível)",
    "",
  ];

  if (selection) {
    parts.push("### Texto selecionado pelo usuário", "", selection, "");
  }

  parts.push(CONTEXT_END, "", displayText || "");
  return parts.join("\n");
}

export function normalizeMessages(messages) {
  const result = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.type === "user") {
      const { displayText, metadata } = stripContext(message.text);
      result.push({
        id: message.id,
        role: "user",
        text: displayText,
        metadata: metadata || null,
        created: message.time?.created ?? 0,
      });
      continue;
    }

    if (message?.type === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      const text = content
        .filter((part) => part?.type === "text")
        .map((part) => part.text || "")
        .join("");
      const reasoning = content
        .filter((part) => part?.type === "reasoning")
        .map((part) => part.text || "")
        .join("");
      const tools = content
        .filter((part) => part?.type === "tool")
        .map((part) => ({
          id: part.id,
          name: part.name || "tool",
          status: part.state?.status || "unknown",
          input: part.state?.input ?? null,
          content: part.state?.content ?? null,
          error: part.state?.error ? formatError(part.state.error) : null,
        }));

      result.push({
        id: message.id,
        role: "assistant",
        text,
        reasoning,
        tools,
        model: message.model ?? null,
        created: message.time?.created ?? 0,
        error: message.error ? formatError(message.error) : null,
      });
    }
  }
  return result;
}

export function normalizeEvent(event) {
  const type = event?.type;
  const data = event?.data ?? {};
  const sessionID = data.sessionID ?? null;

  switch (type) {
    case "session.text.started":
      return {
        type: "text-start",
        sessionID,
        messageID: data.assistantMessageID ?? null,
      };
    case "session.text.delta":
      return {
        type: "text",
        sessionID,
        messageID: data.assistantMessageID ?? null,
        delta: data.delta ?? "",
      };
    case "session.text.ended":
      return {
        type: "text-end",
        sessionID,
        messageID: data.assistantMessageID ?? null,
      };
    case "session.execution.started":
      return { type: "state", status: "busy", sessionID };
    case "session.execution.succeeded":
      return { type: "state", status: "idle", sessionID, outcome: "succeeded" };
    case "session.execution.interrupted":
      return {
        type: "state",
        status: "idle",
        sessionID,
        outcome: "interrupted",
      };
    case "session.execution.failed":
      return {
        type: "state",
        status: "error",
        sessionID,
        outcome: "failed",
        error: formatError(data.error),
      };
    case "session.idle":
      return {
        type: "state",
        status: "idle",
        sessionID,
        outcome: data.outcome ?? "succeeded",
      };
    case "permission.asked":
      return {
        type: "permission",
        sessionID,
        requestID: data.id,
        action: data.action,
        resources: Array.isArray(data.resources) ? data.resources : [],
        message: data.message ?? "",
        save: Array.isArray(data.save) ? data.save : [],
      };
    case "permission.replied":
      return {
        type: "permission-replied",
        sessionID,
        requestID: data.id,
        reply: data.reply,
      };
    case "session.retry.scheduled":
      return {
        type: "retry",
        sessionID,
        message: data.message ?? "Nova tentativa agendada pelo OpenCode",
      };
    case "session.tool.called":
    case "session.tool.success":
    case "session.tool.failed":
    case "session.tool.progress":
    case "session.step.ended":
    case "session.compaction.ended":
      // O nome/estado da ferramenta é mais fácil de obter recarregando as
      // mensagens. O plugin faz isso com throttle.
      return { type: "refresh", sessionID };
    default:
      return null;
  }
}
