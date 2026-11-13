#!/usr/bin/env node
// Servidor MCP mínimo (stdio) que expõe as ferramentas do ONLYOFFICE ao
// OpenCode. Sem dependências externas: fala JSON-RPC por linhas no stdin/stdout
// e encaminha as chamadas para o bridge via HTTP.

import fs from "node:fs";
import process from "node:process";

const VERSION = "0.4.0";
const DEBUG_LOG = process.env.OPENCODE_ONLYOFFICE_MCP_LOG || "";

function debug(...args) {
  if (!DEBUG_LOG) return;
  try {
    fs.appendFileSync(
      DEBUG_LOG,
      `${new Date().toISOString()} ${args
        .map((value) =>
          typeof value === "string" ? value : JSON.stringify(value),
        )
        .join(" ")}\n`,
    );
  } catch {
    // diagnóstico nunca deve derrubar o servidor
  }
}
const BRIDGE = (
  process.env.OPENCODE_ONLYOFFICE_BRIDGE || "http://127.0.0.1:18765"
).replace(/\/+$/, "");
const TOKEN =
  process.env.OPENCODE_ONLYOFFICE_TOKEN || "onlyoffice-opencode-local";
const CALL_TIMEOUT_MS = 65_000;

const TOOLS = [
  {
    name: "get_document",
    description:
      "Returns the current Writer document as Markdown (default) or plain text, including title, page count and element count. Use only when the chat context is insufficient.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["markdown", "text"] },
        maxChars: { type: "integer", minimum: 1000, maximum: 200000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_selection",
    description:
      "Returns the text and selection type currently selected in the Writer document.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "insert_text",
    description:
      "Inserts text at the cursor in the current Writer document. Formatted Markdown/office-doc is applied by default. Track Changes is always enabled.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        formatted: { type: "boolean", default: true },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "replace_selection",
    description:
      "Replaces the active selection in the Writer document. Requires an active selection. Formatted Markdown/office-doc is applied by default. Track Changes is always enabled.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        formatted: { type: "boolean", default: true },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_office_doc",
    description:
      "Applies a structured office-doc JSON spec (fonts, sizes, colors, spacing, alignment, margins, page breaks, native tables and text boxes). Track Changes is always enabled. The schema is documented in AGENTS.md.",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "object" },
      },
      required: ["spec"],
      additionalProperties: false,
    },
  },
  {
    name: "accept_all_revisions",
    description:
      "Accepts every tracked change in the current Writer document. Destructive: use only when the user explicitly asks.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "reject_all_revisions",
    description:
      "Rejects every tracked change in the current Writer document. Destructive: use only when the user explicitly asks.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

let buffer = "";

function send(message) {
  debug("send", message);
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, message, code = -32603) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function callBridge(name, args, sessionID) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${BRIDGE}/api/tools/call?token=${encodeURIComponent(TOKEN)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          arguments: args || {},
          sessionID: sessionID || null,
        }),
        signal: controller.signal,
      },
    );

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }

    if (!response.ok || (data && data.error)) {
      throw new Error((data && data.error) || `Bridge HTTP ${response.status}`);
    }

    return data && data.result !== undefined ? data.result : data;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatch(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "onlyoffice", version: VERSION },
    };
  }

  if (method === "ping") return {};

  if (method === "tools/list") {
    return { tools: TOOLS };
  }

  if (method === "tools/call") {
    const name = params?.name;
    if (!TOOLS.some((tool) => tool.name === name)) {
      throw new Error(`Ferramenta desconhecida: ${name}`);
    }

    const args = params?.arguments || {};
    const sessionID = params?._meta?.["ai.opencode/sessionID"] || null;

    try {
      const result = await callBridge(name, args, sessionID);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: error.message }),
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Método MCP não suportado: ${method}`);
}

async function handleLine(line) {
  if (!line.trim()) return;
  debug("recv", line);
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    debug("recv-invalid-json", line);
    return;
  }

  if (message.id === undefined || message.id === null) {
    // notifications/initialized e afins não têm resposta.
    debug("notification", message.method);
    return;
  }

  try {
    const result = await dispatch(message.method, message.params || {});
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    debug("error", message.method, error.message || String(error));
    sendError(message.id, error.message || String(error));
  }
}

debug("start", {
  bridge: BRIDGE,
  version: VERSION,
  pid: process.pid,
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    handleLine(line);
  }
});

process.stdin.on("end", () => {
  if (buffer.trim()) handleLine(buffer);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
