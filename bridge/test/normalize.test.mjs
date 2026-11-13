import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPrompt,
  normalizeEvent,
  normalizeMessages,
  stripContext,
  truncateDocument,
} from "../normalize.mjs";

test("buildPrompt e stripContext fazem roundtrip", () => {
  const prompt = buildPrompt({
    displayText: "Resuma o contrato.",
    document: "# Contrato\n\nCláusula 1",
    selection: "Cláusula 1",
    editor: "word",
    title: "Contrato.docx",
  });

  const parsed = stripContext(prompt);
  assert.equal(parsed.displayText, "Resuma o contrato.");
  assert.equal(parsed.metadata.editor, "word");
  assert.equal(parsed.metadata.title, "Contrato.docx");
  assert.equal(parsed.metadata.selection, true);
  assert.match(parsed.context, /Cláusula 1/);
});

test("stripContext devolve o texto original quando não há contexto", () => {
  const parsed = stripContext("  apenas uma pergunta  ");
  assert.equal(parsed.displayText, "apenas uma pergunta");
  assert.equal(parsed.metadata, null);
});

test("truncateDocument mantém começo e fim", () => {
  const document = `${"A".repeat(1000)}MEIO${"Z".repeat(1000)}`;
  const result = truncateDocument(document, 500);
  assert.equal(result.truncated, true);
  assert.equal(result.droppedChars, document.length - 500);
  assert.ok(result.text.startsWith("A"));
  assert.ok(result.text.endsWith("Z"));
  assert.match(result.text, /caracteres omitidos/);
});

test("normalizeMessages remove o contexto do usuário e extrai texto/tools", () => {
  const prompt = buildPrompt({
    displayText: "Pergunta",
    document: "conteúdo",
    selection: "",
    editor: "word",
    title: "Doc",
  });

  const messages = normalizeMessages([
    {
      id: "u1",
      type: "user",
      text: prompt,
      time: { created: 1 },
    },
    {
      id: "a1",
      type: "assistant",
      time: { created: 2 },
      model: { providerID: "opencode", id: "model" },
      content: [
        { type: "reasoning", text: "pensando" },
        { type: "text", text: "Resposta" },
        {
          type: "tool",
          id: "t1",
          name: "read",
          state: { status: "completed", input: { path: "x" }, content: [] },
        },
      ],
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].text, "Pergunta");
  assert.equal(messages[0].metadata.editor, "word");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].text, "Resposta");
  assert.equal(messages[1].reasoning, "pensando");
  assert.equal(messages[1].tools[0].name, "read");
  assert.equal(messages[1].tools[0].status, "completed");
});

test("normalizeEvent traduz os eventos usados pelo plugin", () => {
  assert.deepEqual(
    normalizeEvent({
      type: "session.text.delta",
      data: { sessionID: "s1", assistantMessageID: "a1", delta: "Olá" },
    }),
    { type: "text", sessionID: "s1", messageID: "a1", delta: "Olá" },
  );

  assert.deepEqual(
    normalizeEvent({
      type: "session.execution.started",
      data: { sessionID: "s1" },
    }),
    { type: "state", status: "busy", sessionID: "s1" },
  );

  assert.deepEqual(
    normalizeEvent({
      type: "permission.asked",
      data: { sessionID: "s1", id: "p1", action: "shell", resources: ["*"] },
    }),
    {
      type: "permission",
      sessionID: "s1",
      requestID: "p1",
      action: "shell",
      resources: ["*"],
      message: "",
      save: [],
    },
  );

  assert.equal(normalizeEvent({ type: "server.connected", data: {} }), null);
});
