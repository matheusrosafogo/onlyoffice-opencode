#!/usr/bin/env node
// Bridge local entre o plugin do ONLYOFFICE e o OpenCode V2.
//
// Responsabilidades:
//   - subir (ou reutilizar) um `opencode serve` local;
//   - esconder a senha do OpenCode do plugin;
//   - mapear um documento do ONLYOFFICE para uma sessão persistente;
//   - montar o prompt com o contexto do documento;
//   - repassar o streaming via SSE em um formato estável.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { OpenCodeClient, OpenCodeError } from "./opencode.mjs";
import { credentialsNeedSync, seedCredentials } from "./credentials.mjs";
import { SessionStore, isValidDocKey } from "./sessions.mjs";
import {
  buildPrompt,
  formatError,
  normalizeEvent,
  normalizeMessages,
  truncateDocument,
} from "./normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "0.3.1";
const DEFAULT_TOKEN = "onlyoffice-opencode-local";
const MAX_BODY_BYTES = 25 * 1024 * 1024;

function usage() {
  return `onlyoffice-opencode-bridge ${VERSION}

Uso:
  onlyoffice-opencode-bridge [opções]

Opções:
  --port <porta>              Porta HTTP do bridge (padrão: 18765)
  --host <endereço>           Endereço de escuta (padrão: 127.0.0.1)
  --token <token>             Token exigido pelo plugin (padrão: ${DEFAULT_TOKEN})
  --opencode <caminho>        Binário do OpenCode (padrão: ~/.opencode/bin/opencode)
  --opencode-url <url>        Usa um servidor OpenCode já existente em vez de subir um
  --opencode-password <senha> Senha do servidor existente (opcional)
  --state-dir <diretório>     Estado do bridge (padrão: ~/.local/state/onlyoffice-opencode)
  --workspace <diretório>     Workspace do OpenCode (padrão: ~/.local/share/onlyoffice-opencode/workspace)
  --main-db <arquivo>         Banco principal do OpenCode, de onde as credenciais são copiadas
                              (padrão: ~/.local/share/opencode/opencode.db)
  --max-context-chars <n>     Limite de caracteres do documento (padrão: 200000)
  --no-seed-credentials       Não copia credenciais do banco principal para o isolado
  --isolate-db                Isola o banco do OpenCode (padrão)
  --shared-db                 Não isola o banco do OpenCode
  --no-isolate-db             Mesmo que --shared-db
  --version                   Mostra a versão
  --help                      Mostra esta ajuda
`;
}

function parseArgs(argv) {
  const args = {
    port: 18765,
    host: "127.0.0.1",
    token: DEFAULT_TOKEN,
    opencode: path.join(os.homedir(), ".opencode/bin/opencode"),
    opencodeUrl: null,
    opencodePassword: "",
    stateDir: path.join(
      process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"),
      "onlyoffice-opencode",
    ),
    workspace: path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
      "onlyoffice-opencode/workspace",
    ),
    mainDb:
      process.env.OPENCODE_DB ||
      path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
        "opencode/opencode.db",
      ),
    maxContextChars: 200_000,
    isolateDb: true,
    seedCredentials: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--help" || raw === "-h") return { help: true };
    if (raw === "--version" || raw === "-v") return { version: true };
    if (raw === "--isolate-db") {
      args.isolateDb = true;
      continue;
    }
    if (raw === "--shared-db" || raw === "--no-isolate-db") {
      args.isolateDb = false;
      continue;
    }
    if (raw === "--no-seed-credentials") {
      args.seedCredentials = false;
      continue;
    }

    const eq = raw.indexOf("=");
    const key = eq >= 0 ? raw.slice(0, eq) : raw;
    const takeValue = () => {
      if (eq >= 0) return raw.slice(eq + 1);
      i += 1;
      if (i >= argv.length) throw new Error(`Faltou valor para ${key}`);
      return argv[i];
    };

    switch (key) {
      case "--port":
        args.port = Number(takeValue());
        break;
      case "--host":
        args.host = takeValue();
        break;
      case "--token":
        args.token = takeValue();
        break;
      case "--opencode":
        args.opencode = takeValue();
        break;
      case "--opencode-url":
        args.opencodeUrl = takeValue();
        break;
      case "--opencode-password":
        args.opencodePassword = takeValue();
        break;
      case "--state-dir":
        args.stateDir = takeValue();
        break;
      case "--workspace":
        args.workspace = takeValue();
        break;
      case "--main-db":
        args.mainDb = takeValue();
        break;
      case "--max-context-chars":
        args.maxContextChars = Number(takeValue());
        break;
      default:
        throw new Error(`Opção desconhecida: ${key}`);
    }
  }

  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) {
    throw new Error("Porta inválida");
  }
  if (!Number.isInteger(args.maxContextChars) || args.maxContextChars < 1000) {
    throw new Error("--max-context-chars precisa ser >= 1000");
  }
  return args;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function ensureWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  const template = path.join(__dirname, "workspace/AGENTS.md");
  const target = path.join(workspace, "AGENTS.md");
  if (fs.existsSync(template) && !fs.existsSync(target)) {
    fs.copyFileSync(template, target);
  }
  if (fs.existsSync(target)) {
    // O arquivo vem do store (somente leitura); deixa o usuário editá-lo.
    try {
      fs.chmodSync(target, 0o644);
    } catch {
      // ignore
    }
  }
}

function tokenMatches(expected, received) {
  const a = crypto.createHash("sha256").update(String(expected)).digest();
  const b = crypto.createHash("sha256").update(String(received)).digest();
  return crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(new Error("Corpo da requisição muito grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (rejected) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON inválido"));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sameModel(a, b) {
  return Boolean(a && b && a.id === b.id && a.providerID === b.providerID);
}

class Bridge {
  constructor({
    oc,
    store,
    workspace,
    token,
    maxContextChars,
    port,
    host,
    isolated,
  }) {
    this.oc = oc;
    this.store = store;
    this.workspace = workspace;
    this.token = token;
    this.maxContextChars = maxContextChars;
    this.port = port;
    this.host = host;
    this.isolated = isolated;
    this.clients = new Set();
    this.stopped = false;
    this.server = null;
    this.eventAbort = null;
    this.heartbeat = null;
    this.refreshInFlight = new Map();
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: formatError(err) });
        } else {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        const address = this.server.address();
        this.port = address.port;
        resolve();
      });
    });

    this.heartbeat = setInterval(() => {
      for (const res of this.clients) {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          this.clients.delete(res);
        }
      }
    }, 15_000);
    this.heartbeat.unref?.();

    this.startEvents();
    console.log(`[bridge] escutando em http://${this.host}:${this.port}`);
  }

  startEvents() {
    const controller = new AbortController();
    this.eventAbort = controller;

    (async () => {
      while (!this.stopped) {
        try {
          this.broadcast({ type: "bridge", status: "upstream-ok" });
          await this.oc.events({
            signal: controller.signal,
            onEvent: (event) => {
              const normalized = normalizeEvent(event);
              if (normalized) this.broadcast(normalized);
            },
          });
        } catch (err) {
          if (this.stopped) break;
          this.broadcast({
            type: "bridge",
            status: "upstream-lost",
            error: formatError(err),
          });
          console.error(`[bridge] stream de eventos: ${formatError(err)}`);
        }
        if (!this.stopped) await delay(1000);
      }
    })();
  }

  broadcast(event) {
    if (this.clients.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  addSseClient(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    this.clients.add(res);
    req.on("close", () => this.clients.delete(res));
  }

  cors(req, res) {
    const origin = req.headers.origin;
    const ownOrigins = [
      `http://${this.host}:${this.port}`,
      `http://127.0.0.1:${this.port}`,
      `http://localhost:${this.port}`,
    ];
    const localFileOrigins = new Set(["null", "file://"]);
    const allowed = new Set([...localFileOrigins, ...ownOrigins]);

    if (origin && !allowed.has(origin)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Origem não permitida");
      return false;
    }

    // O CEF do ONLYOFFICE envia "Origin: file://" para plugins em file://.
    // Para essas origens usamos "*" (não há cookies/credenciais); o token da
    // query continua sendo exigido nas rotas /api/*.
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin && !localFileOrigins.has(origin) ? origin : "*",
    );
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "content-type,x-opencode-bridge-token",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    return true;
  }

  requireToken(req, url) {
    const received =
      url.searchParams.get("token") ??
      req.headers["x-opencode-bridge-token"] ??
      "";
    return tokenMatches(this.token, received);
  }

  async handle(req, res) {
    if (!this.cors(req, res)) return;

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
    const route = url.pathname;
    const docKey = url.searchParams.get("docKey") ?? "";

    if (route === "/health") {
      const info = await this.health();
      sendJson(res, 200, info);
      return;
    }

    if (!route.startsWith("/api/")) {
      sendJson(res, 404, { error: "Rota não encontrada" });
      return;
    }

    if (!this.requireToken(req, url)) {
      sendJson(res, 401, { error: "Token do bridge inválido" });
      return;
    }

    try {
      if (route === "/api/config" && req.method === "GET") {
        sendJson(res, 200, await this.getConfig());
        return;
      }

      if (route === "/api/session" && req.method === "GET") {
        if (!isValidDocKey(docKey)) {
          sendJson(res, 400, { error: "docKey inválido" });
          return;
        }
        sendJson(res, 200, await this.getSession(docKey));
        return;
      }

      if (route === "/api/messages" && req.method === "GET") {
        if (!isValidDocKey(docKey)) {
          sendJson(res, 400, { error: "docKey inválido" });
          return;
        }
        sendJson(res, 200, await this.getSession(docKey));
        return;
      }

      if (route === "/api/chat" && req.method === "POST") {
        const body = await readJson(req);
        sendJson(res, 200, await this.chat(body));
        return;
      }

      if (route === "/api/reset" && req.method === "POST") {
        const body = await readJson(req);
        if (!isValidDocKey(body.docKey)) {
          sendJson(res, 400, { error: "docKey inválido" });
          return;
        }
        this.store.delete(body.docKey);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (route === "/api/interrupt" && req.method === "POST") {
        const body = await readJson(req);
        sendJson(res, 200, await this.interrupt(body.docKey));
        return;
      }

      if (route === "/api/permission" && req.method === "POST") {
        const body = await readJson(req);
        sendJson(res, 200, await this.replyPermission(body));
        return;
      }

      if (route === "/api/sessions" && req.method === "GET") {
        sendJson(res, 200, { sessions: this.store.list() });
        return;
      }

      if (route === "/api/events" && req.method === "GET") {
        this.addSseClient(req, res);
        return;
      }

      sendJson(res, 404, { error: "Rota não encontrada" });
    } catch (err) {
      if (err instanceof OpenCodeError) {
        const status =
          err.status === 409
            ? 409
            : err.status >= 400 && err.status < 600
              ? err.status
              : 502;
        sendJson(res, status, {
          error: formatError(err),
          details: err.body ?? null,
        });
        return;
      }
      sendJson(res, 500, { error: formatError(err) });
    }
  }

  async health() {
    try {
      const info = await this.oc.info();
      return {
        ok: true,
        bridgeVersion: VERSION,
        opencode: { version: info.version ?? this.oc.version ?? null },
        workspace: this.workspace,
        isolatedDatabase: this.isolated,
        maxContextChars: this.maxContextChars,
      };
    } catch (err) {
      return {
        ok: false,
        bridgeVersion: VERSION,
        error: formatError(err),
        workspace: this.workspace,
        isolatedDatabase: this.isolated,
      };
    }
  }

  async getConfig() {
    const location = `location%5Bdirectory%5D=${encodeURIComponent(this.workspace)}`;
    const [modelsRes, agentsRes] = await Promise.all([
      this.oc.request(`/api/model?${location}`),
      this.oc.request(`/api/agent?${location}`),
    ]);

    const models = (Array.isArray(modelsRes?.data) ? modelsRes.data : [])
      .filter((model) => model.enabled !== false)
      .map((model) => ({
        id: model.id,
        name: model.name,
        providerID: model.providerID,
        modelID: model.modelID,
        cost: model.cost ?? [],
        limit: model.limit ?? null,
        status: model.status ?? "active",
      }))
      .sort((a, b) =>
        `${a.providerID}/${a.name}`.localeCompare(
          `${b.providerID}/${b.name}`,
          "pt-BR",
        ),
      );

    const agents = (Array.isArray(agentsRes?.data) ? agentsRes.data : [])
      .filter(
        (agent) =>
          !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
      )
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description ?? "",
        model: agent.model ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    return { models, agents, workspace: this.workspace };
  }

  async getSession(docKey) {
    const entry = this.store.get(docKey);
    if (!entry) {
      return {
        sessionID: null,
        messages: [],
        model: null,
        agent: null,
        title: "",
      };
    }

    try {
      const [sessionRes, messagesRes] = await Promise.all([
        this.oc.request(`/api/session/${entry.sessionID}`),
        this.oc.request(
          `/api/session/${entry.sessionID}/message?limit=200&order=asc`,
        ),
      ]);
      const session = sessionRes.data;
      return {
        sessionID: session.id,
        title: session.title ?? entry.title ?? "",
        model: session.model ?? entry.model ?? null,
        agent: session.agent ?? null,
        messages: normalizeMessages(messagesRes?.data),
      };
    } catch (err) {
      if (err instanceof OpenCodeError && err.status === 404) {
        this.store.delete(docKey);
        return {
          sessionID: null,
          messages: [],
          model: null,
          agent: null,
          title: "",
        };
      }
      throw err;
    }
  }

  async ensureSession(docKey, { title, model, agent }) {
    const entry = this.store.get(docKey);
    let session = null;

    if (entry) {
      try {
        session = (await this.oc.request(`/api/session/${entry.sessionID}`))
          .data;
      } catch (err) {
        if (err instanceof OpenCodeError && err.status === 404) {
          this.store.delete(docKey);
          session = null;
        } else {
          throw err;
        }
      }
    }

    if (!session) {
      const body = {
        title: title || "ONLYOFFICE",
        location: { directory: this.workspace },
      };
      if (model) body.model = model;
      if (agent) body.agent = agent;

      const created = (
        await this.oc.request("/api/session", { method: "POST", body })
      ).data;
      this.store.set(docKey, {
        sessionID: created.id,
        title: body.title,
        model: created.model ?? model ?? null,
        agent: created.agent ?? agent ?? null,
      });
      return created;
    }

    if (model && !sameModel(session.model, model)) {
      await this.oc.request(`/api/session/${session.id}/model`, {
        method: "POST",
        body: { model },
      });
      session.model = model;
    }

    if (agent && session.agent !== agent) {
      await this.oc.request(`/api/session/${session.id}/agent`, {
        method: "POST",
        body: { agent },
      });
      session.agent = agent;
    }

    this.store.set(docKey, {
      sessionID: session.id,
      title: session.title ?? entry?.title ?? "ONLYOFFICE",
      model: session.model ?? null,
      agent: session.agent ?? null,
    });

    return session;
  }

  async maxCharsForModel(model) {
    let maxChars = this.maxContextChars;
    if (!model) return maxChars;

    try {
      const location = `location%5Bdirectory%5D=${encodeURIComponent(this.workspace)}`;
      const res = await this.oc.request(`/api/model?${location}`);
      const info = (res?.data ?? []).find(
        (candidate) =>
          candidate.providerID === model.providerID &&
          candidate.id === model.id,
      );
      if (info?.limit?.context) {
        // ~4 caracteres por token. Reserva metade da janela para saída,
        // histórico e ferramentas.
        maxChars = Math.min(
          maxChars,
          Math.max(20_000, Math.floor(info.limit.context * 0.5 * 4)),
        );
      }
    } catch {
      // Se a listagem falhar, usa o limite configurado.
    }

    return maxChars;
  }

  async chat(body) {
    if (!isValidDocKey(body.docKey)) throw new Error("docKey inválido");
    if (typeof body.displayText !== "string" || !body.displayText.trim()) {
      throw new Error("Mensagem vazia");
    }

    const model =
      body.model &&
      typeof body.model === "object" &&
      body.model.providerID &&
      body.model.id
        ? {
            providerID: String(body.model.providerID),
            id: String(body.model.id),
          }
        : null;
    const agent =
      typeof body.agent === "string" && body.agent ? body.agent : null;

    const session = await this.ensureSession(body.docKey, {
      title: body.title,
      model,
      agent,
    });

    const maxChars = await this.maxCharsForModel(
      model ?? session.model ?? null,
    );
    const selection =
      typeof body.selection === "string"
        ? body.selection.slice(0, Math.min(20_000, maxChars))
        : "";
    const documentBudget = Math.max(4_000, maxChars - selection.length);
    const document = truncateDocument(
      typeof body.document === "string" ? body.document : "",
      documentBudget,
    );

    const prompt = buildPrompt({
      displayText: body.displayText,
      document: document.text,
      selection,
      editor: body.editor,
      title: body.title,
      metadata: { truncated: document.truncated },
    });

    let promptRes;
    try {
      promptRes = await this.oc.request(`/api/session/${session.id}/prompt`, {
        method: "POST",
        body: { text: prompt },
        timeoutMs: 120_000,
      });
    } catch (err) {
      if (err instanceof OpenCodeError && err.status === 409) {
        throw new OpenCodeError(
          "O OpenCode ainda está respondendo à mensagem anterior. Aguarde ou interrompa.",
          { status: 409 },
        );
      }
      throw err;
    }

    this.store.set(body.docKey, {
      sessionID: session.id,
      title: session.title ?? body.title ?? "ONLYOFFICE",
      model: session.model ?? model ?? null,
      agent: session.agent ?? agent ?? null,
    });

    return {
      sessionID: session.id,
      messageID: promptRes?.data?.id ?? null,
      model: session.model ?? model ?? null,
      agent: session.agent ?? agent ?? null,
      contextChars: document.text.length + selection.length,
      truncated: document.truncated,
      droppedChars: document.droppedChars,
    };
  }

  async interrupt(docKey) {
    if (!isValidDocKey(docKey)) throw new Error("docKey inválido");
    const entry = this.store.get(docKey);
    if (!entry) return { ok: false, reason: "sem sessão" };

    try {
      await this.oc.request(`/api/session/${entry.sessionID}/interrupt`, {
        method: "POST",
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof OpenCodeError && err.status === 404) {
        this.store.delete(docKey);
        return { ok: false, reason: "sessão não encontrada" };
      }
      throw err;
    }
  }

  async replyPermission({ sessionID, requestID, reply }) {
    if (!sessionID || !requestID)
      throw new Error("sessionID e requestID são obrigatórios");
    if (!["once", "always", "reject"].includes(reply))
      throw new Error("reply inválido");

    await this.oc.request(
      `/api/session/${sessionID}/permission/${requestID}/reply`,
      {
        method: "POST",
        body: { reply },
      },
    );
    return { ok: true };
  }

  async close() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.eventAbort) this.eventAbort.abort();
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
    }
  }
}

let shuttingDown = false;

async function spawnOpenCode({ args, isolatedDb }) {
  if (!fs.existsSync(args.opencode)) {
    throw new Error(`binário do OpenCode não encontrado: ${args.opencode}`);
  }

  const internalPort = await findFreePort();
  const password = crypto.randomBytes(32).toString("base64url");
  const env = {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  };
  if (isolatedDb) env.OPENCODE_DB = isolatedDb;

  const child = spawn(
    args.opencode,
    ["serve", "--hostname", "127.0.0.1", "--port", String(internalPort)],
    {
      cwd: args.workspace,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (data) => process.stdout.write(`[opencode] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[opencode] ${data}`));

  let expectedExit = false;
  child.on("exit", (code, signal) => {
    if (!expectedExit && !shuttingDown) {
      console.error(
        `[bridge] opencode terminou (code=${code}, signal=${signal})`,
      );
      process.exit(1);
    }
  });

  const baseUrl = `http://127.0.0.1:${internalPort}`;
  const client = new OpenCodeClient({ baseUrl, password });

  const stop = async () => {
    expectedExit = true;
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(5000).then(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }),
    ]);
  };

  return { child, baseUrl, password, client, stop };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[bridge] ${formatError(err)}`);
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }

  fs.mkdirSync(args.stateDir, { recursive: true });
  ensureWorkspace(args.workspace);

  const store = new SessionStore(path.join(args.stateDir, "sessions.json"));

  let runtime = null;
  let oc = null;
  let isolated = false;

  if (args.opencodeUrl) {
    oc = new OpenCodeClient({
      baseUrl: args.opencodeUrl,
      password: args.opencodePassword,
    });
    try {
      await oc.waitReady({ timeoutMs: 60_000 });
    } catch (err) {
      console.error(`[bridge] OpenCode indisponível: ${formatError(err)}`);
      process.exit(1);
    }
  } else {
    const isolatedDb = args.isolateDb
      ? path.join(args.stateDir, "opencode.db")
      : null;
    isolated = Boolean(isolatedDb);

    if (args.isolateDb && !fs.existsSync(args.mainDb)) {
      console.warn(
        `[bridge] banco principal do OpenCode não encontrado em ${args.mainDb}; ` +
          "os modelos podem exigir credenciais configuradas por variável de ambiente",
      );
    }

    if (
      args.isolateDb &&
      args.seedCredentials &&
      credentialsNeedSync({ mainDb: args.mainDb, isolatedDb })
    ) {
      console.log(
        "[bridge] preparando banco isolado e copiando credenciais do OpenCode...",
      );
      const bootstrap = await spawnOpenCode({ args, isolatedDb });
      try {
        await bootstrap.client.waitReady({ timeoutMs: 60_000 });
        const seeded = seedCredentials({ mainDb: args.mainDb, isolatedDb });
        if (seeded.error) {
          console.warn(
            `[bridge] não foi possível copiar credenciais do banco principal: ${seeded.error}`,
          );
        } else if (seeded.copied > 0) {
          console.log(
            `[bridge] ${seeded.copied} credencial(is) do OpenCode copiada(s) para o banco isolado`,
          );
        }
      } finally {
        await bootstrap.stop();
      }
    }

    runtime = await spawnOpenCode({ args, isolatedDb });
    oc = runtime.client;
    try {
      await oc.waitReady({ timeoutMs: 60_000 });
    } catch (err) {
      console.error(`[bridge] OpenCode indisponível: ${formatError(err)}`);
      await runtime.stop();
      process.exit(1);
    }
  }

  console.log(`[bridge] OpenCode ${oc.version ?? "?"} pronto em ${oc.baseUrl}`);

  const bridge = new Bridge({
    oc,
    store,
    workspace: args.workspace,
    token: args.token,
    maxContextChars: args.maxContextChars,
    port: args.port,
    host: args.host,
    isolated,
  });

  await bridge.start();

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[bridge] encerrando (${signal})`);
    await bridge.close();
    if (runtime) await runtime.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(`[bridge] erro fatal: ${formatError(err)}`);
  process.exit(1);
});
