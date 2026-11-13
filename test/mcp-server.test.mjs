import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpServer = path.join(here, "..", "bridge", "mcp-server.mjs");

function startMockBridge() {
  let lastCall = null;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/api/tools/call")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      lastCall = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          result: {
            echo: lastCall,
            token: new URL(req.url, "http://localhost").searchParams.get(
              "token",
            ),
          },
        }),
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        server,
        getLastCall: () => lastCall,
      });
    });
  });
}

function startClient(port) {
  const child = spawn(process.execPath, [mcpServer], {
    env: {
      ...process.env,
      OPENCODE_ONLYOFFICE_BRIDGE: `http://127.0.0.1:${port}`,
      OPENCODE_ONLYOFFICE_TOKEN: "test-token",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  const queue = [];
  const waiters = [];
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    }
  });

  const read = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((resolve) => waiters.push(resolve));

  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  return { child, read, send, getStderr: () => stderr };
}

async function stopClient(client) {
  if (client.child.exitCode !== null) return;
  const exited = new Promise((resolve) => client.child.once("exit", resolve));
  client.child.kill("SIGTERM");
  await exited;
}

async function stopMock(mock) {
  mock.server.closeAllConnections();
  await new Promise((resolve) => mock.server.close(resolve));
}

test("servidor MCP lista as ferramentas e encaminha sessionID", async () => {
  const mock = await startMockBridge();
  const client = startClient(mock.port);

  try {
    client.send({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });
    const init = await client.read();
    assert.equal(init.id, 0);
    assert.equal(init.result.serverInfo.name, "onlyoffice");
    assert.equal(init.result.protocolVersion, "2024-11-05");

    client.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const list = await client.read();
    assert.equal(list.id, 2);
    assert.equal(list.result.tools.length, 7);
    assert.deepEqual(list.result.tools.map((tool) => tool.name).sort(), [
      "accept_all_revisions",
      "apply_office_doc",
      "get_document",
      "get_selection",
      "insert_text",
      "reject_all_revisions",
      "replace_selection",
    ]);

    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "insert_text",
        arguments: { text: "Olá", formatted: true },
        _meta: { "ai.opencode/sessionID": "ses-42" },
      },
    });
    const call = await client.read();
    assert.equal(call.id, 3);
    const payload = JSON.parse(call.result.content[0].text);
    assert.equal(payload.echo.name, "insert_text");
    assert.deepEqual(payload.echo.arguments, {
      text: "Olá",
      formatted: true,
    });
    assert.equal(payload.echo.sessionID, "ses-42");
    assert.equal(payload.token, "test-token");
    assert.equal(mock.getLastCall().sessionID, "ses-42");
  } finally {
    await stopClient(client);
    await stopMock(mock);
  }
});

test("servidor MCP rejeita ferramenta desconhecida", async () => {
  const mock = await startMockBridge();
  const client = startClient(mock.port);

  try {
    client.send({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "not_a_tool", arguments: {} },
    });
    const response = await client.read();
    assert.equal(response.id, 10);
    assert.match(response.error.message, /Ferramenta desconhecida/);
  } finally {
    await stopClient(client);
    await stopMock(mock);
  }
});
