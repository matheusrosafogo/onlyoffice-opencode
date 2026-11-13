// O OpenCode guarda as conexões dos provedores no banco principal. Quando o
// bridge usa um banco isolado (para não misturar sessões com o TUI), é preciso
// copiar as credenciais para que os modelos continuem disponíveis.
//
// A cópia é feita apenas para a tabela `credential`; sessões, mensagens e
// permissões continuam isoladas no banco novo.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CREDENTIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS credential (
  id text PRIMARY KEY,
  integration_id text,
  label text NOT NULL,
  value text NOT NULL,
  connector_id text,
  method_id text,
  active integer,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
`;

function readCredentialVersions(dbPath) {
  if (!fs.existsSync(dbPath)) return null;

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare("SELECT id, time_updated FROM credential").all();
    return new Map(
      rows.map((row) => [String(row.id), Number(row.time_updated)]),
    );
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export function credentialsNeedSync({ mainDb, isolatedDb }) {
  if (!mainDb || !isolatedDb) return false;
  if (!fs.existsSync(mainDb)) return false;

  const main = readCredentialVersions(mainDb);
  if (!main || main.size === 0) return false;

  const isolated = readCredentialVersions(isolatedDb);
  if (!isolated) return true;

  for (const [id, updated] of main) {
    if (!isolated.has(id) || isolated.get(id) !== updated) return true;
  }
  return false;
}

export function seedCredentials({ mainDb, isolatedDb }) {
  if (!mainDb || !isolatedDb) return { copied: 0, skipped: true };
  if (!fs.existsSync(mainDb))
    return { copied: 0, skipped: true, reason: "main-db-missing" };
  if (path.resolve(mainDb) === path.resolve(isolatedDb)) {
    return { copied: 0, skipped: true, reason: "same-db" };
  }

  fs.mkdirSync(path.dirname(isolatedDb), { recursive: true });

  let db;
  try {
    db = new DatabaseSync(isolatedDb);
    db.exec(CREDENTIAL_SCHEMA);

    const escaped = mainDb.replace(/'/g, "''");
    db.exec(`ATTACH DATABASE '${escaped}' AS main_src`);
    try {
      const result = db
        .prepare(
          `INSERT OR REPLACE INTO credential
             (id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated)
           SELECT id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated
           FROM main_src.credential`,
        )
        .run();
      return { copied: Number(result.changes ?? 0), skipped: false };
    } finally {
      try {
        db.exec("DETACH DATABASE main_src");
      } catch {
        // ignore
      }
    }
  } catch (err) {
    return { copied: 0, skipped: false, error: err.message };
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
    try {
      fs.chmodSync(isolatedDb, 0o600);
    } catch {
      // ignore
    }
  }
}
