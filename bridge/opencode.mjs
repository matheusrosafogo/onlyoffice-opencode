// Cliente HTTP mínimo para o servidor do OpenCode V2.
//
// O bridge sempre fala com o OpenCode por HTTP local. Quando ele mesmo sobe o
// `opencode serve`, usa uma senha aleatória e autenticação Basic (usuário
// `opencode`). Quando recebe `--opencode-url`, pode falar com um servidor já
// existente (útil em testes e em instalações avançadas).

import { setTimeout as delay } from "node:timers/promises";

export class OpenCodeError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = "OpenCodeError";
    this.status = status;
    this.body = body;
  }
}

export class OpenCodeClient {
  constructor({ baseUrl, password = "", timeoutMs = 30000 }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.version = null;
  }

  authHeader() {
    if (!this.password) return null;
    return `Basic ${Buffer.from(`opencode:${this.password}`).toString("base64")}`;
  }

  headers(extra = {}) {
    const headers = { Accept: "application/json", ...extra };
    const auth = this.authHeader();
    if (auth) headers.Authorization = auth;
    return headers;
  }

  async request(
    path,
    { method = "GET", body, timeoutMs = this.timeoutMs, signal } = {},
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    try {
      const init = {
        method,
        headers: this.headers(
          body !== undefined ? { "Content-Type": "application/json" } : {},
        ),
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);

      const res = await fetch(`${this.baseUrl}${path}`, init);
      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) {
        const message =
          (data && typeof data === "object" && (data.message || data.error)) ||
          (typeof data === "string" && data) ||
          `HTTP ${res.status}`;
        throw new OpenCodeError(message, { status: res.status, body: data });
      }

      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new OpenCodeError(`Tempo esgotado ao chamar ${path}`, {
          status: 0,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  async info() {
    const data = await this.request("/api/info");
    if (data && data.version) this.version = data.version;
    return data;
  }

  async waitReady({ timeoutMs = 60000, intervalMs = 300 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        return await this.info();
      } catch (err) {
        lastError = err;
        // 401 significa que a senha está errada; não adianta insistir.
        if (err instanceof OpenCodeError && err.status === 401) throw err;
        await delay(intervalMs);
      }
    }

    throw new OpenCodeError(
      `O OpenCode não respondeu em ${Math.round(timeoutMs / 1000)}s` +
        (lastError ? `: ${lastError.message}` : ""),
      { status: 0 },
    );
  }

  // Consome o SSE de /api/event. Retorna quando o stream termina (o chamador
  // reconecta) e lança em caso de erro de rede/HTTP.
  async events({ signal, onEvent }) {
    const res = await fetch(`${this.baseUrl}/api/event`, {
      headers: this.headers({ Accept: "text/event-stream" }),
      signal,
    });

    if (!res.ok) {
      throw new OpenCodeError(
        `Falha ao assinar eventos do OpenCode (HTTP ${res.status})`,
        {
          status: res.status,
        },
      );
    }
    if (!res.body) {
      throw new OpenCodeError("O OpenCode não retornou um corpo de eventos");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const flushBlock = (block) => {
      const lines = block.replace(/\r\n/g, "\n").split("\n");
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) return;
      const payload = dataLines.join("\n");
      if (!payload) return;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        // Evento não-JSON: ignora em vez de derrubar o stream.
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        flushBlock(block);
      }
    }

    if (buffer.trim()) flushBlock(buffer);
  }
}
