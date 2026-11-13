(function () {
  "use strict";

  const PLUGIN_VERSION = "0.2.0";
  const STORAGE_KEY = "oo-opencode.settings.v1";
  const DEFAULT_BRIDGE_URL = "http://127.0.0.1:18765";
  const DEFAULT_BRIDGE_TOKEN = "onlyoffice-opencode-local";

  const t = (key, vars) => window.OO_I18N.t(key, vars);
  const ctx = window.OOContext;
  const md = window.OO_MARKDOWN;

  const els = {};
  const state = {
    initialized: false,
    starting: false,
    settings: null,
    editorType: "word",
    docKey: null,
    docInfo: null,
    title: "",
    sessionID: null,
    messages: [],
    models: [],
    agents: [],
    busy: false,
    connected: false,
    health: null,
    selectionChars: 0,
    lastContextChars: 0,
    currentAssistant: null,
    eventAbort: null,
    eventGeneration: 0,
    eventReconnectTimer: null,
    refreshTimer: null,
    permission: null,
    pendingTimer: null,
    toastTimer: null,
  };

  // --------------------------------------------------------------- utilidades

  function cacheElements() {
    els.app = document.getElementById("app");
    els.messages = document.getElementById("messages");
    els.input = document.getElementById("input");
    els.send = document.getElementById("btn-send");
    els.stop = document.getElementById("btn-stop");
    els.newChat = document.getElementById("btn-new");
    els.settings = document.getElementById("btn-settings");
    els.refreshContext = document.getElementById("btn-refresh-context");
    els.contextTitle = document.getElementById("context-title");
    els.contextDetail = document.getElementById("context-detail");
    els.contextHint = document.getElementById("context-hint");
    els.quickActions = document.getElementById("quick-actions");
    els.statusBanner = document.getElementById("status-banner");
    els.permissionPanel = document.getElementById("permission-panel");
    els.toast = document.getElementById("toast");
    els.settingsDialog = document.getElementById("settings-dialog");
    els.settingBridgeUrl = document.getElementById("setting-bridge-url");
    els.settingBridgeToken = document.getElementById("setting-bridge-token");
    els.settingModel = document.getElementById("setting-model");
    els.settingAgent = document.getElementById("setting-agent");
    els.settingIncludeDocument = document.getElementById(
      "setting-include-document",
    );
    els.settingRichInsert = document.getElementById("setting-rich-insert");
    els.settingLanguage = document.getElementById("setting-language");
    els.connectionResult = document.getElementById("connection-result");
    els.diagnostics = document.getElementById("diagnostics");
    els.settingsClose = document.getElementById("btn-settings-close");
    els.settingsSave = document.getElementById("btn-settings-save");
    els.testConnection = document.getElementById("btn-test-connection");
    els.copyDiagnostics = document.getElementById("btn-copy-diagnostics");
  }

  function loadSettings() {
    const bridge = window.OPENCODE_BRIDGE || {};
    const defaults = {
      bridgeUrl: bridge.url || DEFAULT_BRIDGE_URL,
      bridgeToken: bridge.token || DEFAULT_BRIDGE_TOKEN,
      model: "",
      agent: "",
      includeDocument: true,
      richInsert: true,
      lang: window.OO_I18N.detect(),
    };

    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...defaults, ...stored };
    } catch {
      return defaults;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      // localStorage pode estar indisponível no iframe; o bridge mantém o estado.
    }
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

  async function copyText(text, silent) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      if (!silent) toast(t("copied"), "success");
      return true;
    } catch {
      // Em iframes file:// a Clipboard API pode ser bloqueada; usa o fallback.
      try {
        fallbackCopy(text);
        if (!silent) toast(t("copied"), "success");
        return true;
      } catch {
        toast(t("copyFailed"), "error");
        return false;
      }
    }
  }

  function editorLabel(type) {
    switch (type) {
      case "cell":
        return t("editorCell");
      case "slide":
        return t("editorSlide");
      case "pdf":
        return t("editorPdf");
      default:
        return t("editorWord");
    }
  }

  function formatTime(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function modelLabel(model) {
    if (!model) return "";
    return model.name || model.id || `${model.providerID}/${model.id}`;
  }

  function truncateText(text, max) {
    const value = String(text || "");
    if (value.length <= max) return value;
    return `${value.slice(0, max)}\n\n[... ${value.length - max} caracteres omitidos ...]`;
  }

  function stripAnsi(text) {
    return String(text || "").replace(/\u001b\[[0-9;]*m/g, "");
  }

  function stripTags(html) {
    return String(html || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function executeMethodWithTimeout(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Tempo esgotado em ${method}`));
      }, timeoutMs || 8000);

      ctx
        .executeMethod(method, params)
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  // ------------------------------------------------------------- status / UI

  function showBanner(kind, message, action) {
    els.statusBanner.className = `banner ${kind}`;
    els.statusBanner.textContent = "";

    const text = document.createElement("span");
    text.textContent = message;
    els.statusBanner.appendChild(text);

    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "banner-action";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      els.statusBanner.appendChild(button);
    }

    els.statusBanner.classList.remove("hidden");
  }

  function hideBanner() {
    els.statusBanner.classList.add("hidden");
    els.statusBanner.textContent = "";
  }

  function toast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = `toast ${kind || "info"}`;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      els.toast.classList.add("hidden");
    }, 3500);
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    els.app.dataset.status = state.busy
      ? "busy"
      : state.connected
        ? "online"
        : "offline";
    els.stop.classList.toggle("hidden", !state.busy);
    updateSendButton();
    if (state.busy) {
      if (state.pendingTimer) clearTimeout(state.pendingTimer);
      state.pendingTimer = setTimeout(
        () => {
          setBusy(false);
          scheduleRefresh(true);
        },
        5 * 60 * 1000,
      );
    } else if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function updateSendButton() {
    const hasText = els.input.value.trim().length > 0;
    els.send.disabled = state.busy || !hasText || !state.connected;
  }

  function autoResize() {
    els.input.style.height = "auto";
    els.input.style.height = `${Math.min(els.input.scrollHeight, 180)}px`;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function applyI18n() {
    if (!els.quickActions) return;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((node) => {
      const value = t(node.dataset.i18nTitle);
      node.title = value;
      node.setAttribute("aria-label", value);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    renderQuickActions();
    if (state.initialized) {
      if (!state.busy) renderMessages();
      updateContextBar(false);
    }
  }

  // ------------------------------------------------------------------ bridge

  function bridgeBase() {
    return (state.settings.bridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
  }

  function bridgeToken() {
    return state.settings.bridgeToken || DEFAULT_BRIDGE_TOKEN;
  }

  function withToken(path) {
    const separator = path.includes("?") ? "&" : "?";
    return `${bridgeBase()}${path}${separator}token=${encodeURIComponent(bridgeToken())}`;
  }

  async function api(path, options) {
    const opts = options || {};
    const init = { method: opts.method || "GET" };

    if (opts.body !== undefined) {
      init.headers = { "Content-Type": "text/plain;charset=UTF-8" };
      init.body = JSON.stringify(opts.body);
    }

    const res = await fetch(withToken(path), init);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }

    if (!res.ok) {
      const error = new Error((data && data.error) || `HTTP ${res.status}`);
      error.status = res.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function checkHealth(options) {
    const opts = options || {};
    try {
      const health = await api("/health");
      if (!health || health.ok !== true) {
        throw new Error((health && health.error) || "bridge indisponível");
      }
      state.health = health;
      state.connected = true;
      els.app.dataset.status = state.busy ? "busy" : "online";
      hideBanner();
      updateSendButton();
      return health;
    } catch (error) {
      state.health = null;
      state.connected = false;
      els.app.dataset.status = "offline";
      if (!opts.silent) {
        showBanner("error", t("bridgeOffline"), {
          label: t("retry"),
          onClick: () => start(),
        });
      }
      updateSendButton();
      throw error;
    }
  }

  async function loadConfig() {
    const config = await api("/api/config");
    state.models = Array.isArray(config.models) ? config.models : [];
    state.agents = Array.isArray(config.agents) ? config.agents : [];
    populateModelSelect();
    populateAgentSelect();
    updateDiagnostics();
  }

  function populateModelSelect() {
    const select = els.settingModel;
    if (!select) return;
    select.textContent = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t("defaultModel");
    select.appendChild(defaultOption);

    const groups = new Map();
    for (const model of state.models) {
      const provider = model.providerID || "outros";
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider).push(model);
    }

    for (const [provider, models] of groups) {
      const group = document.createElement("optgroup");
      group.label = provider;
      for (const model of models) {
        const option = document.createElement("option");
        option.value = `${model.providerID}|${model.id}`;
        option.textContent = model.name || model.id;
        group.appendChild(option);
      }
      select.appendChild(group);
    }

    const wanted = state.settings.model || "";
    select.value = [...select.options].some((option) => option.value === wanted)
      ? wanted
      : "";
  }

  function populateAgentSelect() {
    const select = els.settingAgent;
    if (!select) return;
    select.textContent = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t("defaultAgent");
    select.appendChild(defaultOption);

    for (const agent of state.agents) {
      const option = document.createElement("option");
      option.value = agent.id;
      option.textContent = agent.name || agent.id;
      select.appendChild(option);
    }

    const wanted = state.settings.agent || "";
    select.value = [...select.options].some((option) => option.value === wanted)
      ? wanted
      : "";
  }

  function selectedModel() {
    const value = state.settings.model || "";
    if (!value) return null;
    const separator = value.indexOf("|");
    if (separator === -1) return null;
    const providerID = value.slice(0, separator);
    const id = value.slice(separator + 1);
    return providerID && id ? { providerID, id } : null;
  }

  // ------------------------------------------------------------------- SSE

  function connectEvents() {
    if (state.eventAbort) state.eventAbort.abort();
    const controller = new AbortController();
    state.eventAbort = controller;
    const generation = state.eventGeneration + 1;
    state.eventGeneration = generation;

    (async () => {
      try {
        const res = await fetch(withToken("/api/events"), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error("Sem corpo de eventos");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                handleEvent(JSON.parse(payload));
              } catch (error) {
                console.warn("[opencode] evento inválido", error);
              }
            }
          }
        }

        if (
          !controller.signal.aborted &&
          generation === state.eventGeneration
        ) {
          scheduleReconnect();
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        if (generation !== state.eventGeneration) return;
        state.connected = false;
        els.app.dataset.status = "offline";
        showBanner("warn", t("upstreamLost"));
        updateSendButton();
        scheduleReconnect();
      }
    })();
  }

  function scheduleReconnect() {
    if (state.eventReconnectTimer) return;
    state.eventReconnectTimer = setTimeout(async () => {
      state.eventReconnectTimer = null;
      try {
        await checkHealth({ silent: true });
        connectEvents();
        loadConfig().catch(() => {});
        loadSession().catch(() => {});
      } catch {
        scheduleReconnect();
      }
    }, 3000);
  }

  function handleEvent(event) {
    if (!event || typeof event !== "object") return;

    if (event.sessionID) {
      if (!state.sessionID) state.sessionID = event.sessionID;
      if (event.sessionID !== state.sessionID) return;
    }

    switch (event.type) {
      case "text-start":
        startAssistant(event.messageID);
        break;
      case "text":
        appendDelta(event.delta);
        break;
      case "text-end":
        finishAssistant();
        break;
      case "state":
        if (event.status === "busy") {
          setBusy(true);
        } else if (event.status === "error") {
          setBusy(false);
          finishAssistant();
          addErrorMessage(event.error || t("error"));
          scheduleRefresh(true);
        } else {
          setBusy(false);
          finishAssistant();
          scheduleRefresh(true);
        }
        break;
      case "refresh":
        scheduleRefresh();
        break;
      case "permission":
        showPermission(event);
        break;
      case "permission-replied":
        if (
          !state.permission ||
          state.permission.requestID === event.requestID
        ) {
          hidePermission();
        }
        break;
      case "retry":
        showBanner("info", event.message || t("retryScheduled"));
        break;
      case "bridge":
        if (event.status === "upstream-lost") {
          showBanner("warn", t("upstreamLost"));
        } else if (event.status === "upstream-ok") {
          hideBanner();
        }
        break;
      default:
        break;
    }
  }

  function scheduleRefresh(force) {
    if (state.busy && !force) return;
    if (state.refreshTimer) return;
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      loadSession().catch((error) => {
        console.warn("[opencode] falha ao recarregar sessão", error);
      });
    }, 900);
  }

  // -------------------------------------------------------------- rendering

  function renderQuickActions() {
    if (!els.quickActions) return;
    els.quickActions.textContent = "";

    const actions = [
      ["promptSummarize", "quickSummarize"],
      ["promptReview", "quickReview"],
      ["promptImprove", "quickImprove"],
      ["promptTranslate", "quickTranslate"],
      ["promptExplain", "quickExplain"],
    ];

    for (const [promptKey, labelKey] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = t(labelKey);
      button.addEventListener("click", () => runQuick(promptKey));
      els.quickActions.appendChild(button);
    }
  }

  function renderEmptyState() {
    els.messages.textContent = "";

    const wrapper = document.createElement("div");
    wrapper.className = "empty-state";

    const mark = document.createElement("div");
    mark.className = "empty-mark";
    mark.textContent = "›_";
    wrapper.appendChild(mark);

    const title = document.createElement("h2");
    title.textContent = t("emptyTitle");
    wrapper.appendChild(title);

    const text = document.createElement("p");
    text.textContent = t("emptyText");
    wrapper.appendChild(text);

    const grid = document.createElement("div");
    grid.className = "empty-actions";

    const actions = [
      ["promptSummarize", "quickSummarize"],
      ["promptReview", "quickReview"],
      ["promptImprove", "quickImprove"],
      ["promptTranslate", "quickTranslate"],
    ];

    for (const [promptKey, labelKey] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "empty-action";
      button.textContent = t(labelKey);
      button.addEventListener("click", () => runQuick(promptKey));
      grid.appendChild(button);
    }

    wrapper.appendChild(grid);
    els.messages.appendChild(wrapper);
  }

  function renderMessages() {
    els.messages.textContent = "";
    state.currentAssistant = null;

    if (!state.messages.length) {
      renderEmptyState();
      return;
    }

    for (const message of state.messages) {
      els.messages.appendChild(renderMessage(message));
    }
    scrollToBottom();
  }

  function renderMessage(message) {
    const wrapper = document.createElement("article");
    wrapper.className = `message message-${message.role}`;
    wrapper.dataset.messageId = message.id;

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const role = document.createElement("span");
    role.className = "message-role";
    role.textContent = message.role === "user" ? t("you") : t("assistant");
    meta.appendChild(role);

    if (message.created) {
      const time = document.createElement("span");
      time.className = "message-time";
      time.textContent = formatTime(message.created);
      meta.appendChild(time);
    }

    if (message.role === "assistant" && message.model) {
      const model = document.createElement("span");
      model.className = "message-model";
      model.textContent = modelLabel(message.model);
      meta.appendChild(model);
    }

    wrapper.appendChild(meta);

    if (message.role === "user" && message.metadata) {
      const chips = document.createElement("div");
      chips.className = "message-chips";
      if (message.metadata.selection) {
        chips.appendChild(chip(t("selectionChip")));
      }
      if (message.metadata.truncated) {
        chips.appendChild(chip(t("truncatedChip"), "warn"));
      }
      if (chips.childElementCount > 0) wrapper.appendChild(chips);
    }

    const body = document.createElement("div");
    body.className = "message-text";

    if (message.role === "assistant" && message.error) {
      const error = document.createElement("div");
      error.className = "message-error";
      error.textContent = message.error;
      body.appendChild(error);
    }

    if (message.role === "assistant") {
      body.appendChild(md.render(message.text || ""));
    } else {
      body.textContent = message.text || "";
    }

    wrapper.appendChild(body);

    if (message.role === "assistant" && message.reasoning) {
      wrapper.appendChild(
        renderDetails(t("reasoning"), message.reasoning, "reasoning-card"),
      );
    }

    if (
      message.role === "assistant" &&
      message.tools &&
      message.tools.length > 0
    ) {
      wrapper.appendChild(renderTools(message.tools));
    }

    if (
      message.role === "assistant" &&
      !message.streaming &&
      (message.text || "").trim()
    ) {
      wrapper.appendChild(renderMessageActions(message));
    }

    return wrapper;
  }

  function chip(text, kind) {
    const node = document.createElement("span");
    node.className = `chip-tag ${kind || ""}`;
    node.textContent = text;
    return node;
  }

  function renderDetails(title, content, className) {
    const details = document.createElement("details");
    details.className = `details-card ${className || ""}`;
    const summary = document.createElement("summary");
    summary.textContent = title;
    details.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = stripAnsi(truncateText(content, 8000));
    details.appendChild(pre);
    return details;
  }

  function renderTools(tools) {
    const wrapper = document.createElement("div");
    wrapper.className = "tool-list";

    for (const tool of tools) {
      const details = document.createElement("details");
      details.className = "tool-card";

      const summary = document.createElement("summary");
      const name = document.createElement("span");
      name.className = "tool-name";
      name.textContent = tool.name || t("tool");
      const status = document.createElement("span");
      status.className = `tool-status status-${tool.status || "unknown"}`;
      status.textContent = tool.status || "?";
      summary.appendChild(name);
      summary.appendChild(status);
      details.appendChild(summary);

      const pre = document.createElement("pre");
      const payload = {
        input: tool.input,
        content: tool.content,
        error: tool.error,
      };
      pre.textContent = stripAnsi(
        truncateText(JSON.stringify(payload, null, 2), 6000),
      );
      details.appendChild(pre);
      wrapper.appendChild(details);
    }

    return wrapper;
  }

  function renderMessageActions(message) {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copy = actionButton(t("copy"), "copy", message.id);
    actions.appendChild(copy);

    if (state.editorType !== "pdf") {
      actions.appendChild(actionButton(t("insert"), "insert", message.id));
      actions.appendChild(actionButton(t("replace"), "replace", message.id));
    }

    return actions;
  }

  function actionButton(label, action, messageId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.messageId = messageId;
    return button;
  }

  function startAssistant(messageID) {
    if (state.currentAssistant) finishAssistant();

    const message = {
      id: messageID || `stream-${Date.now()}`,
      role: "assistant",
      text: "",
      tools: [],
      streaming: true,
      created: Date.now(),
    };

    state.messages.push(message);
    const node = renderMessage(message);
    els.messages.appendChild(node);

    const textEl = node.querySelector(".message-text");
    state.currentAssistant = { message, node, textEl };
    scrollToBottom();
  }

  function appendDelta(delta) {
    if (!state.currentAssistant) startAssistant(null);
    if (!state.currentAssistant) return;

    const { message, textEl } = state.currentAssistant;
    message.text += delta || "";
    textEl.textContent = message.text;
    scrollToBottom();
  }

  function finishAssistant() {
    if (!state.currentAssistant) return;

    const { message, node, textEl } = state.currentAssistant;
    message.streaming = false;
    state.currentAssistant = null;

    if (!message.text.trim() && !(message.tools && message.tools.length)) {
      node.remove();
      state.messages = state.messages.filter((item) => item !== message);
      return;
    }

    textEl.textContent = "";
    textEl.appendChild(md.render(message.text || ""));

    if (message.reasoning) {
      node.appendChild(
        renderDetails(t("reasoning"), message.reasoning, "reasoning-card"),
      );
    }
    if (message.tools && message.tools.length > 0) {
      node.appendChild(renderTools(message.tools));
    }
    node.appendChild(renderMessageActions(message));
    scrollToBottom();
  }

  function addErrorMessage(text) {
    const message = {
      id: `error-${Date.now()}`,
      role: "assistant",
      text: "",
      error: text || t("error"),
      created: Date.now(),
    };
    state.messages.push(message);
    els.messages.appendChild(renderMessage(message));
    scrollToBottom();
  }

  function updateContextBar(readSelection) {
    if (!els.contextTitle) return;
    els.contextTitle.textContent = state.title || t("emptyDocTitle");
    els.contextTitle.title = state.title || t("emptyDocTitle");

    const parts = [editorLabel(state.editorType)];
    if (state.selectionChars > 0) {
      parts.push(
        `${t("contextSelection")}: ${t("chars", { n: state.selectionChars })}`,
      );
    } else {
      parts.push(t("noSelection"));
    }
    if (state.settings.includeDocument) parts.push(t("contextFull"));
    els.contextDetail.textContent = parts.join(" · ");

    if (state.lastContextChars > 0) {
      els.contextHint.textContent = `${t("contextSent")} · ${t("chars", { n: state.lastContextChars })}`;
    } else {
      els.contextHint.textContent = t("sendHint");
    }

    if (readSelection) {
      ctx
        .getSelection(state.editorType)
        .then((text) => {
          state.selectionChars = (text || "").length;
          const nextParts = [editorLabel(state.editorType)];
          if (state.selectionChars > 0) {
            nextParts.push(
              `${t("contextSelection")}: ${t("chars", { n: state.selectionChars })}`,
            );
          } else {
            nextParts.push(t("noSelection"));
          }
          if (state.settings.includeDocument) nextParts.push(t("contextFull"));
          els.contextDetail.textContent = nextParts.join(" · ");
        })
        .catch(() => {});
    }
  }

  // ---------------------------------------------------------------- ações

  async function pasteRich(text) {
    if (!md.toHtml) return false;
    const html = md.toHtml(text);
    if (!html || !stripTags(html)) return false;
    await executeMethodWithTimeout("PasteHtml", [html], 5000);
    return true;
  }

  async function insertText(text) {
    try {
      if (state.settings.richInsert && state.editorType === "word") {
        try {
          if (await pasteRich(text)) {
            toast(t("insertedFormatted"), "success");
            return;
          }
        } catch (error) {
          console.warn("[opencode] PasteHtml", error);
        }
      }

      await ctx.executeMethod("PasteText", [text]);
      toast(t("inserted"), "success");
    } catch (error) {
      console.warn("[opencode] insert", error);
      toast(t("insertError"), "error");
    }
  }

  async function replaceSelection(text) {
    try {
      if (state.editorType === "word") {
        if (state.settings.richInsert) {
          try {
            await ctx.runInEditor(() => {
              const range = Api.GetDocument().GetRangeBySelect();
              if (range && range.Delete) range.Delete();
            });
            if (await pasteRich(text)) {
              toast(t("replacedFormatted"), "success");
              return;
            }
          } catch (error) {
            console.warn("[opencode] replace rich", error);
          }
        }

        await ctx.runInEditor(
          (value) => Api.ReplaceTextSmart(value.split(/\r?\n/)),
          text,
        );
        toast(t("replaced"), "success");
        return;
      }

      if (state.editorType === "cell") {
        const ok = await ctx.runInEditor((value) => {
          const selection = Api.GetSelection();
          if (selection && selection.SetValue) {
            selection.SetValue(value);
            return true;
          }
          return false;
        }, text);
        if (!ok) await ctx.executeMethod("PasteText", [text]);
      } else {
        await ctx.executeMethod("PasteText", [text]);
      }
      toast(t("replaced"), "success");
    } catch (error) {
      console.warn("[opencode] replace", error);
      toast(t("replaceError"), "error");
    }
  }

  async function handleMessageAction(action, messageId) {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) return;
    const text = message.text || "";

    if (action === "copy") {
      await copyText(text);
    } else if (action === "insert") {
      await insertText(text);
    } else if (action === "replace") {
      await replaceSelection(text);
    }
  }

  async function runQuick(promptKey) {
    if (!state.connected) {
      showBanner("error", t("bridgeOffline"), {
        label: t("retry"),
        onClick: () => start(),
      });
      return;
    }
    els.input.value = t(promptKey);
    autoResize();
    updateSendButton();
    await send();
  }

  // --------------------------------------------------------------- sessão

  async function refreshIdentity() {
    state.editorType = ctx.getEditorType();
    try {
      const identity = await ctx.getDocumentIdentity(state.editorType);
      state.docKey = identity.key;
      state.title = identity.title || t("emptyDocTitle");
      state.docInfo = identity.docInfo;
    } catch (error) {
      console.warn("[opencode] identidade do documento", error);
      state.docKey = `doc-${ctx.fnv1a(`${state.editorType}-${Date.now()}`)}`;
      state.title = t("emptyDocTitle");
    }
    updateContextBar(true);
  }

  async function loadSession() {
    if (!state.docKey || state.busy) return;

    const data = await api(
      `/api/session?docKey=${encodeURIComponent(state.docKey)}`,
    );
    state.sessionID = data.sessionID || null;

    if (Array.isArray(data.messages)) {
      state.messages = data.messages.map((message) => ({
        ...message,
        streaming: false,
      }));
    } else {
      state.messages = [];
    }

    const lastUser = [...state.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (lastUser && lastUser.metadata) {
      state.lastContextChars =
        (lastUser.metadata.documentChars || 0) +
        (lastUser.metadata.selectionChars || 0);
    }

    updateContextBar(false);
    updateDiagnostics();
    renderMessages();
  }

  async function send() {
    const text = els.input.value.trim();
    if (!text || state.busy || !state.connected) return;

    setBusy(true);
    els.input.value = "";
    autoResize();
    updateSendButton();

    const userMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      text,
      metadata: { selection: false },
      created: Date.now(),
    };
    state.messages.push(userMessage);
    renderMessages();
    scrollToBottom();

    let selection = "";
    let documentText = "";

    els.contextHint.textContent = t("loading");

    try {
      try {
        selection = await ctx.getSelection(state.editorType);
      } catch {
        selection = "";
      }

      if (state.settings.includeDocument) {
        try {
          documentText = await ctx.getDocumentContext(state.editorType);
        } catch {
          documentText = "";
        }
      }

      state.selectionChars = selection.length;
      userMessage.metadata = {
        editor: state.editorType,
        title: state.title,
        selection: Boolean(selection),
        selectionChars: selection.length,
        documentChars: documentText.length,
      };
      renderMessages();

      const result = await api("/api/chat", {
        method: "POST",
        body: {
          docKey: state.docKey,
          title: state.title,
          displayText: text,
          document: documentText,
          selection,
          editor: state.editorType,
          model: selectedModel(),
          agent: state.settings.agent || null,
        },
      });

      state.sessionID = result.sessionID || state.sessionID;
      state.lastContextChars = result.contextChars || 0;
      updateContextBar(false);
      updateDiagnostics();

      if (result.truncated) {
        toast(t("contextTruncated"), "warn");
      }
    } catch (error) {
      setBusy(false);
      addErrorMessage(error.message);
    }
  }

  async function newChat() {
    if (state.messages.length > 0 && !window.confirm(t("newChatConfirm")))
      return;

    try {
      await api("/api/reset", {
        method: "POST",
        body: { docKey: state.docKey },
      });
    } catch (error) {
      console.warn("[opencode] reset", error);
    }

    state.sessionID = null;
    state.messages = [];
    state.lastContextChars = 0;
    state.currentAssistant = null;
    renderMessages();
    updateContextBar(false);
    updateDiagnostics();
    els.input.focus();
  }

  async function interrupt() {
    if (!state.sessionID) return;
    try {
      await api("/api/interrupt", {
        method: "POST",
        body: { docKey: state.docKey },
      });
    } catch (error) {
      toast(error.message, "error");
    }
  }

  // -------------------------------------------------------------- permissão

  function showPermission(event) {
    state.permission = event;
    els.permissionPanel.textContent = "";

    const title = document.createElement("div");
    title.className = "permission-title";
    title.textContent = t("permissionTitle");
    els.permissionPanel.appendChild(title);

    const detail = document.createElement("div");
    detail.className = "permission-detail";
    detail.textContent = t("permissionText", { action: event.action || "?" });
    els.permissionPanel.appendChild(detail);

    if (event.resources && event.resources.length) {
      const list = document.createElement("ul");
      list.className = "permission-resources";
      for (const resource of event.resources.slice(0, 6)) {
        const item = document.createElement("li");
        item.textContent = resource;
        list.appendChild(item);
      }
      els.permissionPanel.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "permission-actions";

    const allowOnce = document.createElement("button");
    allowOnce.type = "button";
    allowOnce.className = "primary";
    allowOnce.textContent = t("allowOnce");
    allowOnce.addEventListener("click", () => replyPermission("once"));

    const allowAlways = document.createElement("button");
    allowAlways.type = "button";
    allowAlways.className = "secondary";
    allowAlways.textContent = t("allowAlways");
    allowAlways.addEventListener("click", () => replyPermission("always"));

    const deny = document.createElement("button");
    deny.type = "button";
    deny.className = "danger";
    deny.textContent = t("deny");
    deny.addEventListener("click", () => replyPermission("reject"));

    actions.appendChild(allowOnce);
    actions.appendChild(allowAlways);
    actions.appendChild(deny);
    els.permissionPanel.appendChild(actions);
    els.permissionPanel.classList.remove("hidden");
  }

  function hidePermission() {
    state.permission = null;
    els.permissionPanel.classList.add("hidden");
    els.permissionPanel.textContent = "";
  }

  async function replyPermission(reply) {
    const permission = state.permission;
    if (!permission) return;

    try {
      await api("/api/permission", {
        method: "POST",
        body: {
          sessionID: permission.sessionID || state.sessionID,
          requestID: permission.requestID,
          reply,
        },
      });
      hidePermission();
      toast(t("permissionReplied"), "success");
    } catch (error) {
      toast(t("permissionError"), "error");
      console.warn("[opencode] permissão", error);
    }
  }

  // -------------------------------------------------------------- settings

  function updateDiagnostics() {
    if (!els.diagnostics) return;
    const pluginInfo =
      (window.Asc && window.Asc.plugin && window.Asc.plugin.info) || null;
    const data = {
      plugin: "onlyoffice-opencode",
      version: PLUGIN_VERSION,
      editorType: state.editorType,
      docKey: state.docKey,
      title: state.title,
      sessionID: state.sessionID,
      messages: state.messages.length,
      selectionChars: state.selectionChars,
      lastContextChars: state.lastContextChars,
      connected: state.connected,
      health: state.health,
      models: state.models.length,
      agents: state.agents.length,
      bridgeUrl: state.settings.bridgeUrl,
      pluginInfo,
    };
    els.diagnostics.textContent = JSON.stringify(data, null, 2);
  }

  function openSettings() {
    if (!els.settingsDialog) return;

    els.settingBridgeUrl.value = state.settings.bridgeUrl || "";
    els.settingBridgeToken.value = state.settings.bridgeToken || "";
    els.settingIncludeDocument.checked = Boolean(
      state.settings.includeDocument,
    );
    els.settingRichInsert.checked = Boolean(state.settings.richInsert);
    els.settingLanguage.value = state.settings.lang || window.OO_I18N.getLang();
    els.connectionResult.textContent = "";

    populateModelSelect();
    populateAgentSelect();
    updateDiagnostics();

    if (typeof els.settingsDialog.showModal === "function") {
      els.settingsDialog.showModal();
    } else {
      els.settingsDialog.setAttribute("open", "open");
    }
  }

  function closeSettings() {
    if (typeof els.settingsDialog.close === "function") {
      els.settingsDialog.close();
    } else {
      els.settingsDialog.removeAttribute("open");
    }
  }

  async function testConnection() {
    const url = (els.settingBridgeUrl.value || "").trim().replace(/\/+$/, "");
    const token = (els.settingBridgeToken.value || "").trim();

    if (!url) return;
    els.connectionResult.textContent = t("testing");

    try {
      const res = await fetch(
        `${url}/health?token=${encodeURIComponent(token)}`,
      );
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      els.connectionResult.textContent = `${t("connectionOk")} · ${t("opencodeVersion")} ${data.opencode?.version || "?"}`;
    } catch (error) {
      els.connectionResult.textContent = `${t("connectionFailed")}: ${error.message}`;
    }
  }

  async function saveSettingsFromDialog() {
    const previousUrl = state.settings.bridgeUrl;
    const previousToken = state.settings.bridgeToken;

    state.settings.bridgeUrl =
      (els.settingBridgeUrl.value || "").trim() || DEFAULT_BRIDGE_URL;
    state.settings.bridgeToken =
      (els.settingBridgeToken.value || "").trim() || DEFAULT_BRIDGE_TOKEN;
    state.settings.model = els.settingModel.value || "";
    state.settings.agent = els.settingAgent.value || "";
    state.settings.includeDocument = els.settingIncludeDocument.checked;
    state.settings.richInsert = els.settingRichInsert.checked;
    state.settings.lang = els.settingLanguage.value || "pt-BR";

    window.OO_I18N.setLang(state.settings.lang);
    saveSettings();
    applyI18n();
    closeSettings();
    toast(t("settingsSaved"), "success");
    updateContextBar(false);

    const connectionChanged =
      previousUrl !== state.settings.bridgeUrl ||
      previousToken !== state.settings.bridgeToken;

    if (connectionChanged) {
      state.connected = false;
      state.models = [];
      state.agents = [];
      if (state.eventAbort) state.eventAbort.abort();
      await start();
    } else {
      loadConfig().catch(() => {});
    }
  }

  // --------------------------------------------------------------- inicial

  function bindUi() {
    els.input.addEventListener("input", () => {
      autoResize();
      updateSendButton();
    });

    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        send();
      }
    });

    els.send.addEventListener("click", () => send());
    els.stop.addEventListener("click", () => interrupt());
    els.newChat.addEventListener("click", () => newChat());
    els.settings.addEventListener("click", () => openSettings());
    els.refreshContext.addEventListener("click", async () => {
      await refreshIdentity();
      await loadSession().catch(() => {});
    });

    els.messages.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      handleMessageAction(button.dataset.action, button.dataset.messageId);
    });

    els.settingsClose.addEventListener("click", () => closeSettings());
    els.settingsSave.addEventListener("click", () => saveSettingsFromDialog());
    els.testConnection.addEventListener("click", () => testConnection());
    els.copyDiagnostics.addEventListener("click", async () => {
      const ok = await copyText(els.diagnostics.textContent, true);
      if (ok) toast(t("diagnosticsCopied"), "success");
    });

    els.settingsDialog.addEventListener("click", (event) => {
      if (event.target === els.settingsDialog) closeSettings();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (state.permission) hidePermission();
    });
  }

  function setupTheme() {
    const apply = (theme) => {
      const type = theme && theme.type ? theme.type : "light";
      document.documentElement.dataset.theme = type;
    };

    let initialTheme = "light";
    try {
      initialTheme =
        new URLSearchParams(window.location.search).get("theme-type") ||
        "light";
    } catch {
      initialTheme = "light";
    }
    apply({ type: initialTheme });

    if (window.Asc && window.Asc.plugin) {
      window.Asc.plugin.onThemeChanged = (theme) => {
        if (typeof window.Asc.plugin.onThemeChangedBase === "function") {
          window.Asc.plugin.onThemeChangedBase(theme);
        }
        apply(theme);
      };
      window.Asc.plugin.onTranslate = () => applyI18n();
    }
  }

  async function start() {
    if (state.starting) return;
    state.starting = true;

    try {
      await refreshIdentity();

      try {
        await checkHealth();
      } catch {
        renderMessages();
        return;
      }

      await Promise.allSettled([loadConfig()]);
      await loadSession().catch((error) => {
        console.warn("[opencode] sessão", error);
      });
      connectEvents();
    } finally {
      state.starting = false;
    }
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    cacheElements();
    state.settings = loadSettings();
    window.OO_I18N.setLang(state.settings.lang || window.OO_I18N.detect());

    md.setCopyHandler((text) => copyText(text, true));
    bindUi();
    applyI18n();
    renderMessages();
    updateSendButton();

    await start();
  }

  // Registra tema/tradução antes do host chamar init.
  setupTheme();

  // O host do ONLYOFFICE chama Asc.plugin.init quando o painel abre.
  if (window.Asc && window.Asc.plugin) {
    window.Asc.plugin.init = init;
    window.Asc.plugin.button = () => {};
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      const app = document.getElementById("app");
      if (app) {
        app.textContent = "Falha ao carregar o SDK de plugins do ONLYOFFICE.";
      }
    });
  }
})();
