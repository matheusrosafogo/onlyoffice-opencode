import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Bridge,
  TOOL_NAMES,
  TOOL_PERMISSIONS,
  ensureWorkspaceConfig,
} from "../server.mjs";

function makeBridge(storeEntries) {
  return new Bridge({
    oc: {},
    store: {
      list: () => storeEntries,
    },
    workspace: os.tmpdir(),
    token: "test-token",
    maxContextChars: 10000,
    port: 0,
    host: "127.0.0.1",
    isolated: false,
  });
}

function fakeClient() {
  const chunks = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(chunk);
    },
    end() {},
  };
}

function parseEvent(chunk) {
  assert.match(chunk, /^data: /);
  return JSON.parse(chunk.slice("data: ".length).trim());
}

test("TOOL_NAMES e permissões cobrem o MVP", () => {
  assert.deepEqual([...TOOL_NAMES].sort(), [
    "accept_all_revisions",
    "apply_office_doc",
    "get_document",
    "get_selection",
    "insert_text",
    "reject_all_revisions",
    "replace_selection",
  ]);

  const effects = Object.fromEntries(
    TOOL_PERMISSIONS.map((rule) => [rule.action, rule.effect]),
  );
  assert.equal(effects.onlyoffice_get_document, "allow");
  assert.equal(effects.onlyoffice_get_selection, "allow");
  for (const name of [
    "onlyoffice_insert_text",
    "onlyoffice_replace_selection",
    "onlyoffice_apply_office_doc",
    "onlyoffice_accept_all_revisions",
    "onlyoffice_reject_all_revisions",
  ]) {
    assert.equal(effects[name], "ask");
  }
});

test("ensureWorkspaceConfig gera o MCP e preserva o restante do config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oo-tools-"));
  const configPath = path.join(dir, "opencode.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      model: "provider/model",
      permissions: [
        { action: "bash", resource: "*", effect: "deny" },
        { action: "onlyoffice_insert_text", resource: "*", effect: "allow" },
      ],
    }),
  );

  try {
    ensureWorkspaceConfig({ workspace: dir, port: 18765, token: "secret" });
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    assert.equal(config.model, "provider/model");
    assert.equal(config.mcp.servers.onlyoffice.type, "local");
    assert.equal(config.mcp.servers.onlyoffice.codemode, false);
    assert.equal(
      config.mcp.servers.onlyoffice.environment.OPENCODE_ONLYOFFICE_BRIDGE,
      "http://127.0.0.1:18765",
    );
    assert.equal(
      config.mcp.servers.onlyoffice.environment.OPENCODE_ONLYOFFICE_TOKEN,
      "secret",
    );
    assert.ok(
      config.mcp.servers.onlyoffice.command[1].endsWith("mcp-server.mjs"),
    );

    assert.ok(
      config.permissions.some(
        (rule) => rule.action === "bash" && rule.effect === "deny",
      ),
    );
    assert.equal(
      config.permissions.filter(
        (rule) => rule.action === "onlyoffice_insert_text",
      ).length,
      1,
    );
    assert.equal(
      config.permissions.find(
        (rule) => rule.action === "onlyoffice_insert_text",
      ).effect,
      "ask",
    );
    assert.ok(fs.existsSync(`${configPath}.bak`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("callTool roteia por sessionID e resolve o resultado", async () => {
  const bridge = makeBridge([{ docKey: "doc-1", sessionID: "ses-1" }]);
  const client = fakeClient();
  bridge.toolClients.set("doc-1", client);

  const pending = bridge.callTool({
    name: "insert_text",
    arguments: { text: "Olá" },
    sessionID: "ses-1",
  });

  assert.equal(client.chunks.length, 1);
  const event = parseEvent(client.chunks[0]);
  assert.equal(event.type, "tool-call");
  assert.equal(event.docKey, "doc-1");
  assert.equal(event.name, "insert_text");
  assert.deepEqual(event.arguments, { text: "Olá" });
  assert.equal(typeof event.callID, "string");

  const resolved = bridge.resolveToolCall({
    callID: event.callID,
    docKey: "doc-1",
    ok: true,
    result: { ok: true, tracked: true },
  });
  assert.deepEqual(resolved, { ok: true });
  assert.deepEqual(await pending, { ok: true, tracked: true });
});

test("callTool rejeita quando não há painel conectado", async () => {
  const bridge = makeBridge([{ docKey: "doc-1", sessionID: "ses-1" }]);
  await assert.rejects(
    bridge.callTool({
      name: "get_document",
      arguments: {},
      sessionID: "ses-1",
    }),
    /Abra o painel OpenCode/,
  );

  await assert.rejects(
    bridge.callTool({ name: "nope", arguments: {}, sessionID: "ses-1" }),
    /Ferramenta desconhecida/,
  );
});

test("replyPermission usa decision no protocolo do OpenCode V2", async () => {
  const bridge = makeBridge([]);
  const calls = [];
  bridge.oc = {
    request: async (pathname, options) => {
      calls.push({ pathname, options });
    },
  };

  await bridge.replyPermission({
    sessionID: "ses-1",
    requestID: "req-1",
    reply: "once",
  });

  assert.equal(calls[0].pathname, "/api/session/ses-1/permission/req-1/reply");
  assert.deepEqual(calls[0].options.body, { decision: "once" });

  await assert.rejects(
    bridge.replyPermission({
      sessionID: "ses-1",
      requestID: "req-1",
      reply: "nope",
    }),
    /reply inválido/,
  );
});

test("resolveToolCall ignora docKey diferente", async () => {
  const bridge = makeBridge([{ docKey: "doc-1", sessionID: "ses-1" }]);
  const client = fakeClient();
  bridge.toolClients.set("doc-1", client);

  const pending = bridge.callTool({
    name: "get_selection",
    arguments: {},
    sessionID: "ses-1",
  });
  const event = parseEvent(client.chunks[0]);

  assert.deepEqual(
    bridge.resolveToolCall({
      callID: event.callID,
      docKey: "doc-2",
      ok: true,
      result: { ok: true },
    }),
    { ok: false, reason: "documento não corresponde" },
  );

  bridge.resolveToolCall({
    callID: event.callID,
    docKey: "doc-1",
    ok: false,
    error: "falhou",
  });
  await assert.rejects(pending, /falhou/);
});
