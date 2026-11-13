import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionStore, isValidDocKey } from "../sessions.mjs";

test("SessionStore persiste e recarrega", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oo-opencode-sessions-"));
  const file = path.join(dir, "sessions.json");

  const store = new SessionStore(file);
  store.set("doc-1", { sessionID: "ses_1", title: "Doc 1" });

  const reloaded = new SessionStore(file);
  assert.equal(reloaded.get("doc-1").sessionID, "ses_1");
  assert.equal(reloaded.get("doc-1").title, "Doc 1");
  assert.ok(reloaded.get("doc-1").updated > 0);

  reloaded.delete("doc-1");
  assert.equal(reloaded.get("doc-1"), null);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("isValidDocKey aceita chaves comuns e rejeita lixo", () => {
  assert.equal(isValidDocKey("word-abc_123:xyz"), true);
  assert.equal(isValidDocKey(""), false);
  assert.equal(isValidDocKey("a/b"), false);
  assert.equal(isValidDocKey("a b"), false);
  assert.equal(isValidDocKey("x".repeat(241)), false);
});
