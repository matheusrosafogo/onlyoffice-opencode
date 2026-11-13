(function (root) {
  "use strict";

  let copyHandler = null;

  function elem(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function defaultCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      return;
    }
    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch {
      // ignore
    }
    area.remove();
  }

  function copy(text) {
    if (copyHandler) copyHandler(text);
    else defaultCopy(text);
  }

  function appendInline(fragment, text) {
    const tokenRe =
      /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
    let last = 0;
    let match;

    while ((match = tokenRe.exec(text)) !== null) {
      if (match.index > last) {
        fragment.appendChild(
          document.createTextNode(text.slice(last, match.index)),
        );
      }
      const token = match[0];

      if (
        token.startsWith("[") &&
        token.includes("](") &&
        token.endsWith(")")
      ) {
        const close = token.indexOf("](");
        const label = token.slice(1, close);
        const url = token.slice(close + 2, -1);
        const span = elem("span", "md-link");
        span.appendChild(document.createTextNode(label));
        if (url && url !== label) {
          span.appendChild(document.createTextNode(` (${url})`));
        }
        span.title = url;
        fragment.appendChild(span);
      } else if (
        (token.startsWith("**") && token.endsWith("**")) ||
        (token.startsWith("__") && token.endsWith("__"))
      ) {
        fragment.appendChild(elem("strong", null, token.slice(2, -2)));
      } else {
        fragment.appendChild(elem("em", null, token.slice(1, -1)));
      }

      last = match.index + token.length;
    }

    if (last < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  function inline(text) {
    const fragment = document.createDocumentFragment();
    const parts = String(text).split(/(`[^`\n]+`)/g);

    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        fragment.appendChild(elem("code", "md-inline-code", part.slice(1, -1)));
      } else {
        appendInline(fragment, part);
      }
    }

    return fragment;
  }

  function isBlockStart(line) {
    return (
      /^\s*```/.test(line) ||
      /^\s{0,3}#{1,6}\s+/.test(line) ||
      /^\s*>\s?/.test(line) ||
      /^\s*[-*+]\s+/.test(line) ||
      /^\s*\d+[.)]\s+/.test(line) ||
      /^\s*([-*_])\1{2,}\s*$/.test(line)
    );
  }

  function render(text) {
    const fragment = document.createDocumentFragment();
    const lines = String(text || "")
      .replace(/\r\n/g, "\n")
      .split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^\s*```([\w.+-]*)\s*$/);
      if (fence) {
        const lang = fence[1] || "";
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;

        const wrapper = elem("div", "code-block");
        const head = elem("div", "code-head");
        head.appendChild(elem("span", "code-lang", lang || "código"));
        const button = elem("button", "code-copy", "copiar");
        button.type = "button";
        button.addEventListener("click", () => {
          copy(codeLines.join("\n"));
          button.textContent = "copiado";
          setTimeout(() => {
            button.textContent = "copiar";
          }, 1500);
        });
        head.appendChild(button);
        const pre = elem("pre", "code-pre");
        pre.appendChild(elem("code", null, codeLines.join("\n")));
        wrapper.appendChild(head);
        wrapper.appendChild(pre);
        fragment.appendChild(wrapper);
        continue;
      }

      if (!line.trim()) {
        i += 1;
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.min(6, heading[1].length);
        const node = elem(`h${level}`, "md-heading");
        node.appendChild(inline(heading[2]));
        fragment.appendChild(node);
        i += 1;
        continue;
      }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        fragment.appendChild(elem("hr", "md-hr"));
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        const quote = elem("blockquote", "md-quote");
        quote.appendChild(inline(quoteLines.join(" ")));
        fragment.appendChild(quote);
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
      if (unordered) {
        const list = elem("ul", "md-list");
        while (i < lines.length) {
          const item = lines[i].match(/^\s*[-*+]\s+(.*)$/);
          if (!item) break;
          const li = elem("li");
          li.appendChild(inline(item[1]));
          list.appendChild(li);
          i += 1;
        }
        fragment.appendChild(list);
        continue;
      }

      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ordered) {
        const list = elem("ol", "md-list");
        while (i < lines.length) {
          const item = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
          if (!item) break;
          const li = elem("li");
          li.appendChild(inline(item[1]));
          list.appendChild(li);
          i += 1;
        }
        fragment.appendChild(list);
        continue;
      }

      const paragraphLines = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
        paragraphLines.push(lines[i]);
        i += 1;
      }
      if (paragraphLines.length === 0) {
        paragraphLines.push(line);
        i += 1;
      }
      const paragraph = elem("p", "md-paragraph");
      paragraphLines.forEach((paragraphLine, index) => {
        if (index > 0) paragraph.appendChild(document.createElement("br"));
        paragraph.appendChild(inline(paragraphLine));
      });
      fragment.appendChild(paragraph);
    }

    return fragment;
  }

  root.OO_MARKDOWN = {
    render,
    setCopyHandler(handler) {
      copyHandler = handler;
    },
  };
})(window);
