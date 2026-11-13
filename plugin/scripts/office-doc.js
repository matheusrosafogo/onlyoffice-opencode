(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OO_OFFICE_DOC = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const FENCE_RE = /```(?:office-doc|json)\s*\n([\s\S]*?)```/i;
  const MAX_SPEC_BYTES = 200000;

  function extract(text) {
    const value = String(text || "");
    const match = FENCE_RE.exec(value);
    let raw = "";

    if (match) {
      raw = match[1].trim();
    } else if (value.trim().startsWith("{")) {
      raw = value.trim();
    } else {
      return null;
    }

    if (!raw || raw.length > MAX_SPEC_BYTES) return null;

    try {
      const spec = JSON.parse(raw);
      return spec && Array.isArray(spec.blocks) ? spec : null;
    } catch {
      return null;
    }
  }

  function summary(spec) {
    const blocks = Array.isArray(spec && spec.blocks) ? spec.blocks : [];
    return {
      blocks: blocks.length,
      tables: blocks.filter((block) => block && block.type === "table").length,
      textBoxes: blocks.filter(
        (block) =>
          block && (block.type === "textBox" || block.type === "frame"),
      ).length,
      pageBreaks: blocks.filter((block) => block && block.type === "pageBreak")
        .length,
    };
  }

  async function apply(spec, options) {
    if (!root.OOContext || !root.OOContext.runInEditor) {
      throw new Error("Editor API indisponível");
    }

    return root.OOContext.runInEditor(
      (spec, replaceSelection) => {
        const doc = Api.GetDocument();

        if (replaceSelection) {
          const range = doc.GetRangeBySelect();
          if (range && range.Delete) range.Delete();
        }
        const MAX_BLOCKS = 400;
        const MAX_RUNS = 200;
        const MAX_ROWS = 60;
        const MAX_COLS = 20;
        const MAX_TEXT = 20000;

        const clamp = (value, min, max, fallback) => {
          const number = Number(value);
          if (!Number.isFinite(number)) return fallback;
          return Math.min(max, Math.max(min, number));
        };

        const text = (value) =>
          String(value == null ? "" : value).slice(0, MAX_TEXT);

        const color = (value) => {
          const match = /^#?([0-9a-f]{6})$/i.exec(String(value || ""));
          if (!match) return null;
          const number = parseInt(match[1], 16);
          return Api.RGB(
            (number >> 16) & 255,
            (number >> 8) & 255,
            number & 255,
          );
        };

        const ptToTwips = (value) => Math.round(clamp(value, 0, 500, 0) * 20);
        const cmToTwips = (value) => Math.round(clamp(value, 0, 50, 0) * 567);
        const cmToEmu = (value) =>
          Math.round(clamp(value, 0.1, 50, 1) * 360000);
        const ptToEmu = (value) => Math.round(clamp(value, 0, 50, 0) * 12700);

        const align = (value) => {
          const normalized = String(value || "left").toLowerCase();
          if (normalized === "justify" || normalized === "both") return "both";
          if (normalized === "center" || normalized === "right")
            return normalized;
          return "left";
        };

        const applyRunFormat = (run, spec) => {
          if (spec.font) run.SetFontFamily(String(spec.font).slice(0, 100));
          if (spec.size != null) {
            run.SetFontSize(Math.round(clamp(spec.size, 4, 200, 12) * 2));
          }
          if (spec.color) {
            const value = color(spec.color);
            if (value) run.SetColor(value);
          }
          if (spec.bold) run.SetBold(true);
          if (spec.italic) run.SetItalic(true);
          if (spec.underline) run.SetUnderline(true);
          if (spec.letterSpacing != null) {
            run.SetSpacing(ptToTwips(spec.letterSpacing));
          }
        };

        const addRuns = (paragraph, block, defaults) => {
          const source = Array.isArray(block.runs)
            ? block.runs.slice(0, MAX_RUNS)
            : [{ text: block.text == null ? "" : block.text }];

          for (const raw of source) {
            const runSpec = typeof raw === "string" ? { text: raw } : raw || {};
            const merged = { ...defaults, ...runSpec };
            const run = Api.CreateRun();
            const lines = text(merged.text).split(/\r?\n/);
            for (let index = 0; index < lines.length; index += 1) {
              if (index > 0) run.AddLineBreak();
              run.AddText(lines[index]);
            }
            applyRunFormat(run, merged);
            paragraph.AddElement(run);
          }
        };

        const applyParagraphFormat = (paragraph, block) => {
          if (block.align) paragraph.SetJc(align(block.align));

          if (block.lineSpacing != null) {
            if (typeof block.lineSpacing === "number") {
              paragraph.SetSpacingLine(
                Math.round(clamp(block.lineSpacing, 0.5, 5, 1) * 240),
                "auto",
              );
            } else if (block.lineSpacing && block.lineSpacing.value != null) {
              const rule = ["auto", "atLeast", "exact"].includes(
                block.lineSpacing.rule,
              )
                ? block.lineSpacing.rule
                : "auto";
              const value =
                rule === "auto"
                  ? Math.round(clamp(block.lineSpacing.value, 0.5, 5, 1) * 240)
                  : ptToTwips(block.lineSpacing.value);
              paragraph.SetSpacingLine(value, rule);
            }
          }

          if (block.spacingBefore != null) {
            paragraph.SetSpacingBefore(ptToTwips(block.spacingBefore));
          }
          if (block.spacingAfter != null) {
            paragraph.SetSpacingAfter(ptToTwips(block.spacingAfter));
          }
          if (block.indentLeft != null)
            paragraph.SetIndLeft(cmToTwips(block.indentLeft));
          if (block.indentRight != null)
            paragraph.SetIndRight(cmToTwips(block.indentRight));
          if (block.indentFirstLine != null) {
            paragraph.SetIndFirstLine(cmToTwips(block.indentFirstLine));
          }
          if (block.pageBreakBefore) paragraph.AddPageBreakBefore();
        };

        const makeParagraph = (block, style) => {
          const paragraph = Api.CreateParagraph();
          if (style) {
            try {
              paragraph.SetStyle(style);
              // O template do ONLYOFFICE pode ter numeração/marcadores no
              // estilo de título; remove para manter só o texto do usuário.
              if (paragraph.SetNumbering) paragraph.SetNumbering(null);
            } catch {
              // estilo indisponível; segue com as propriedades explícitas
            }
          }
          addRuns(paragraph, block, block);
          applyParagraphFormat(paragraph, block);
          return paragraph;
        };

        const makeTable = (block) => {
          const rows = Array.isArray(block.rows)
            ? block.rows.slice(0, MAX_ROWS)
            : [];
          if (rows.length === 0) return null;

          let cols = 1;
          for (const row of rows) {
            if (Array.isArray(row)) cols = Math.max(cols, row.length);
          }
          cols = Math.min(MAX_COLS, cols);

          const table = Api.CreateTable(rows.length, cols);
          table.SetWidth("percent", clamp(block.widthPercent, 10, 100, 100));

          const borderColor = color(block.borderColor || "#CCCCCC");
          if (borderColor) {
            table.SetTableBorderAll(
              "single",
              Math.max(
                1,
                Math.round(clamp(block.borderSizePt, 0.1, 6, 0.5) * 8),
              ),
              0,
              borderColor,
            );
          }
          if (block.align) {
            try {
              table.SetJc(align(block.align));
            } catch {
              // alinhamento de tabela indisponível
            }
          }

          const header = block.header !== false;

          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
            for (let colIndex = 0; colIndex < cols; colIndex += 1) {
              const raw = row[colIndex];
              const cellSpec =
                typeof raw === "string" ? { text: raw } : raw || {};
              const isHeader = header && rowIndex === 0;
              const merged = {
                bold: isHeader ? true : undefined,
                color: isHeader ? block.headerColor || "#FFFFFF" : undefined,
                fill: isHeader ? block.headerFill || "#1F4E79" : undefined,
                ...cellSpec,
              };

              const tableCell = table.GetCell(rowIndex, colIndex);
              const content = tableCell.GetContent();
              let paragraph;
              if (content.GetElementsCount() > 0) {
                paragraph = content.GetElement(0);
              } else {
                paragraph = Api.CreateParagraph();
                content.AddElement(0, paragraph);
              }

              addRuns(paragraph, merged, merged);
              applyParagraphFormat(paragraph, merged);

              if (merged.fill) {
                const fill = color(merged.fill);
                if (fill) tableCell.SetShd(Api.CreateShd("clear", fill));
              }
            }
          }

          return table;
        };

        const makeTextBox = (block) => {
          const fillColor = block.fill ? color(block.fill) : null;
          const fill = fillColor
            ? Api.CreateSolidFill(fillColor)
            : Api.CreateNoFill();
          const borderWidth =
            block.borderWidthPt == null
              ? 1
              : clamp(block.borderWidthPt, 0, 20, 1);
          const borderColor = block.borderColor
            ? color(block.borderColor)
            : color("#000000");
          const stroke =
            borderWidth > 0 && borderColor
              ? Api.CreateStroke(
                  ptToEmu(borderWidth),
                  Api.CreateSolidFill(borderColor),
                )
              : Api.CreateStroke(0, Api.CreateNoFill());

          const shape = Api.CreateShape(
            "textRect",
            cmToEmu(block.widthCm || 10),
            cmToEmu(block.heightCm || 4),
            fill,
            stroke,
          );
          if (!shape) return null;

          const content = shape.GetDocContent();
          if (!content) return null;

          const source =
            Array.isArray(block.paragraphs) && block.paragraphs.length
              ? block.paragraphs.slice(0, 50)
              : [block];

          for (let index = 0; index < source.length; index += 1) {
            const paragraphSpec = { ...block, ...(source[index] || {}) };
            let paragraph;
            if (index === 0 && content.GetElementsCount() > 0) {
              paragraph = content.GetElement(0);
            } else {
              paragraph = Api.CreateParagraph();
              content.AddElement(index, paragraph);
            }
            addRuns(paragraph, paragraphSpec, paragraphSpec);
            applyParagraphFormat(paragraph, paragraphSpec);
          }

          const verticalAlign = ["top", "center", "bottom"].includes(
            block.verticalAlign,
          )
            ? block.verticalAlign
            : null;
          if (verticalAlign && shape.SetVerticalTextAlign) {
            shape.SetVerticalTextAlign(verticalAlign);
          }

          const wrapper = Api.CreateParagraph();
          wrapper.AddDrawing(shape);
          return wrapper;
        };

        if (spec.page && spec.page.marginsCm) {
          const margins = spec.page.marginsCm;
          doc
            .GetFinalSection()
            .SetPageMargins(
              cmToTwips(margins.left == null ? 2 : margins.left),
              cmToTwips(margins.top == null ? 2 : margins.top),
              cmToTwips(margins.right == null ? 2 : margins.right),
              cmToTwips(margins.bottom == null ? 2 : margins.bottom),
            );
        }

        const elements = [];
        const blocks = Array.isArray(spec.blocks)
          ? spec.blocks.slice(0, MAX_BLOCKS)
          : [];
        let tables = 0;
        let textBoxes = 0;
        let skipped = 0;

        for (const block of blocks) {
          if (!block || typeof block !== "object") {
            skipped += 1;
            continue;
          }

          const type = String(block.type || "paragraph").toLowerCase();

          try {
            if (type === "pagebreak") {
              const paragraph = Api.CreateParagraph();
              paragraph.AddPageBreak();
              elements.push(paragraph);
              continue;
            }

            if (type === "table") {
              const table = makeTable(block);
              if (table) {
                elements.push(table);
                tables += 1;
              } else {
                skipped += 1;
              }
              continue;
            }

            if (type === "textbox" || type === "frame" || type === "text-box") {
              const textBox = makeTextBox(block);
              if (textBox) {
                elements.push(textBox);
                textBoxes += 1;
              } else {
                skipped += 1;
              }
              continue;
            }

            if (type === "list") {
              const numbering = doc.CreateNumbering(
                block.ordered ? "numbered" : "bullet",
              );
              const level = numbering.GetLevel(0);
              const items = Array.isArray(block.items)
                ? block.items.slice(0, 200)
                : [];
              for (const raw of items) {
                const itemSpec =
                  typeof raw === "string" ? { text: raw } : raw || {};
                const merged = { ...block, ...itemSpec };
                const paragraph = Api.CreateParagraph();
                paragraph.SetNumbering(level);
                addRuns(paragraph, merged, merged);
                applyParagraphFormat(paragraph, merged);
                elements.push(paragraph);
              }
              continue;
            }

            if (type === "heading") {
              const level = Math.round(clamp(block.level, 1, 9, 1));
              const heading = {
                bold: block.bold !== false,
                size:
                  block.size == null
                    ? Math.max(12, 20 - level * 2)
                    : block.size,
                spacingBefore:
                  block.spacingBefore == null ? 12 : block.spacingBefore,
                spacingAfter:
                  block.spacingAfter == null ? 6 : block.spacingAfter,
                ...block,
              };
              // O estilo nativo dá semântica de título; a numeração que o
              // template possa trazer é removida em makeParagraph.
              elements.push(
                makeParagraph(heading, block.style || `Heading ${level}`),
              );
              continue;
            }

            elements.push(makeParagraph(block, null));
          } catch {
            skipped += 1;
          }
        }

        if (elements.length > 0) {
          doc.InsertContent(elements);
        }

        return { applied: elements.length, tables, textBoxes, skipped };
      },
      spec,
      Boolean(options && options.replaceSelection),
    );
  }

  return { extract, summary, apply };
});
