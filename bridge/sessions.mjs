// Mapa persistente docKey -> sessão do OpenCode.
//
// O plugin manda um identificador estável do documento. O bridge guarda a
// sessão correspondente em JSON para que a conversa sobreviva ao fechamento do
// painel, do ONLYOFFICE ou do próprio bridge.

import fs from "node:fs";
import path from "node:path";

export function isValidDocKey(key) {
  return typeof key === "string" && /^[a-zA-Z0-9._:-]{1,240}$/.test(key);
}

export class SessionStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      this.data = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      this.data = {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(docKey) {
    return this.data[docKey] ?? null;
  }

  set(docKey, value) {
    this.data[docKey] = {
      ...value,
      updated: Date.now(),
    };
    this.save();
    return this.data[docKey];
  }

  delete(docKey) {
    if (!(docKey in this.data)) return false;
    delete this.data[docKey];
    this.save();
    return true;
  }

  list() {
    return Object.entries(this.data).map(([docKey, value]) => ({
      docKey,
      ...value,
    }));
  }
}
