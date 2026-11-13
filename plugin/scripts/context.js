(function (root) {
  "use strict";

  function fnv1a(value) {
    const text = String(value);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }

  function sanitizeKey(value) {
    return String(value)
      .replace(/[^a-zA-Z0-9._:-]/g, "_")
      .slice(0, 200);
  }

  function getEditorType() {
    const info = (root.Asc && root.Asc.plugin && root.Asc.plugin.info) || {};
    return info.editorType || "word";
  }

  function executeMethod(method, params) {
    return new Promise((resolve) => {
      try {
        root.Asc.plugin.executeMethod(method, params || [], resolve);
      } catch {
        resolve(undefined);
      }
    });
  }

  function callCommand(fn, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      try {
        root.Asc.scope.__ooArgs = args || [];
        // callCommand serializa a função e a executa no contexto do editor.
        // O wrapper abaixo inlina o código da função para não depender de
        // closures do plugin (que não existem do outro lado).
        const source = `return (${fn.toString()})(...Asc.scope.__ooArgs);`;
        const command = new Function(source);
        root.Asc.plugin.callCommand(command, false, true, done);
        setTimeout(
          () => fail(new Error("A operação no editor demorou demais")),
          20000,
        );
      } catch (error) {
        fail(error);
      }
    });
  }

  async function runInEditor(fn, ...args) {
    if (root.Editor && typeof root.Editor.RunMacro === "function") {
      try {
        return await root.Editor.RunMacro(fn, ...args);
      } catch (error) {
        // Se o editor não suportar RunMacro para esta operação, tenta o
        // caminho antigo antes de desistir.
        if (!root.Asc || !root.Asc.plugin || !root.Asc.plugin.callCommand)
          throw error;
      }
    }

    return callCommand(fn, args);
  }

  async function getSelection(editorType) {
    const type = await executeMethod("GetSelectionType");
    if (type && type !== "none" && type !== "drawing") {
      const text = await executeMethod("GetSelectedText", [
        { Numbering: false },
      ]);
      if (typeof text === "string" && text.trim()) return text;
    }

    if (editorType === "cell") {
      try {
        const text = await runInEditor(() => {
          const selection = Api.GetSelection();
          return selection && selection.GetText ? selection.GetText() : "";
        });
        if (typeof text === "string" && text.trim()) return text;
      } catch {
        // sem seleção de célula
      }
    }

    return "";
  }

  async function getDocumentContext(editorType) {
    try {
      if (editorType === "word") {
        try {
          const markdown = await runInEditor(() =>
            Api.GetDocument().ToMarkdown(false, false, true, false),
          );
          if (typeof markdown === "string" && markdown.trim()) return markdown;
        } catch {
          // ToMarkdown pode não existir em versões antigas.
        }
        return await runInEditor(() => Api.GetDocument().GetText());
      }

      if (editorType === "cell") {
        return await runInEditor(() => {
          const sheet = Api.GetActiveSheet();
          const range = sheet.GetUsedRange ? sheet.GetUsedRange() : null;
          const text = range && range.GetText ? range.GetText() : "";
          return `## ${sheet.GetName ? sheet.GetName() : "Planilha"}\n\n${text}`;
        });
      }

      if (editorType === "slide") {
        return await runInEditor(() => {
          const presentation = Api.GetPresentation();
          if (!presentation || !presentation.GetAllSlides) return "";
          const slides = presentation.GetAllSlides();
          return slides
            .map((slide, index) => {
              const shapes = slide.GetAllShapes ? slide.GetAllShapes() : [];
              const texts = shapes
                .map((shape) => {
                  try {
                    const range = shape.GetTextRange
                      ? shape.GetTextRange()
                      : null;
                    return range && range.GetText ? range.GetText() : "";
                  } catch {
                    return "";
                  }
                })
                .filter(Boolean);
              return `## Slide ${index + 1}\n\n${texts.join("\n")}`;
            })
            .join("\n\n");
        });
      }

      // PDF: extração de texto completo não é confiável; usa a seleção.
      return "";
    } catch (error) {
      console.warn("[opencode] falha ao ler o documento", error);
      return "";
    }
  }

  async function getDocumentIdentity(editorType) {
    const info = (root.Asc && root.Asc.plugin && root.Asc.plugin.info) || {};
    let docInfo = {};
    let internalId = "";

    try {
      docInfo = await runInEditor(() => {
        if (Api.GetDocument && Api.GetDocument().GetDocumentInfo) {
          return Api.GetDocument().GetDocumentInfo();
        }
        if (Api.GetDocumentInfo) return Api.GetDocumentInfo();
        return {};
      });
    } catch {
      docInfo = {};
    }

    try {
      internalId = await runInEditor(() => {
        if (Api.GetDocument && Api.GetDocument().GetInternalId) {
          return Api.GetDocument().GetInternalId();
        }
        return "";
      });
    } catch {
      internalId = "";
    }

    const title = (docInfo && (docInfo.Title || docInfo.title)) || "";
    const documentKey = info.documentKey ? sanitizeKey(info.documentKey) : "";
    const cleanInternalId = internalId ? sanitizeKey(internalId) : "";

    let key = documentKey || cleanInternalId;
    if (!key) {
      key = `doc-${fnv1a(
        [
          editorType,
          title,
          docInfo && docInfo.CreatedRaw,
          docInfo && docInfo.LastModifiedRaw,
        ].join("|"),
      )}`;
    }

    if (!title && !documentKey && !cleanInternalId) {
      // Documento novo e ainda sem título: usa uma amostra do conteúdo para
      // distinguir documentos diferentes na mesma sessão do app.
      let sample = "";
      try {
        sample = await getDocumentContext(editorType);
      } catch {
        sample = "";
      }
      const signature = fnv1a(sample.slice(0, 2000));
      const storageKey = `oo-opencode-untitled-${editorType}-${signature}`;
      try {
        key =
          sessionStorage.getItem(storageKey) ||
          `untitled-${signature}-${fnv1a(`${Date.now()}-${Math.random()}`)}`;
        sessionStorage.setItem(storageKey, key);
      } catch {
        key = `untitled-${signature}`;
      }
    }

    return {
      key: sanitizeKey(key),
      title,
      docInfo,
      editor: editorType,
      internalId: cleanInternalId,
    };
  }

  root.OOContext = {
    fnv1a,
    sanitizeKey,
    getEditorType,
    executeMethod,
    runInEditor,
    getSelection,
    getDocumentContext,
    getDocumentIdentity,
  };
})(window);
