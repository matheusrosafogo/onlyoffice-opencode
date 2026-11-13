import test from "node:test";
import assert from "node:assert/strict";
import officeDoc from "../plugin/scripts/office-doc.js";

test("extrai um bloco office-doc", () => {
  const text = [
    "Segue o documento:",
    "```office-doc",
    JSON.stringify({
      blocks: [
        { type: "heading", text: "Título" },
        { type: "table", rows: [["A", "B"]] },
      ],
    }),
    "```",
  ].join("\n");

  const spec = officeDoc.extract(text);
  assert.ok(spec);
  assert.equal(spec.blocks.length, 2);
  assert.deepEqual(officeDoc.summary(spec), {
    blocks: 2,
    tables: 1,
    textBoxes: 0,
    pageBreaks: 0,
  });
});

test("extrai um bloco json com blocks", () => {
  const text = '```json\n{"blocks":[{"type":"paragraph","text":"Oi"}]}\n```';
  const spec = officeDoc.extract(text);
  assert.equal(spec.blocks[0].text, "Oi");
});

test("extrai JSON puro", () => {
  const spec = officeDoc.extract(
    '{"blocks":[{"type":"paragraph","text":"Oi"}]}',
  );
  assert.equal(spec.blocks.length, 1);
});

test("rejeita JSON inválido, sem blocks ou grande demais", () => {
  assert.equal(officeDoc.extract("```office-doc\n{ nope }\n```"), null);
  assert.equal(officeDoc.extract('```office-doc\n{"foo":1}\n```'), null);
  assert.equal(
    officeDoc.extract(`\`\`\`office-doc\n${"x".repeat(200001)}\n\`\`\``),
    null,
  );
  assert.equal(officeDoc.extract("texto normal"), null);
});

test("summary conta quadros e quebras", () => {
  const spec = {
    blocks: [
      { type: "textBox", text: "Nota" },
      { type: "frame", text: "Outro" },
      { type: "pageBreak" },
      { type: "paragraph", text: "Fim" },
    ],
  };
  assert.deepEqual(officeDoc.summary(spec), {
    blocks: 4,
    tables: 0,
    textBoxes: 2,
    pageBreaks: 1,
  });
});
