// testbenches + docs (+ docs_fts). Docs are indexed for search_testbench_docs (FTS5, bm25).
import type { TestbenchConfig, TestbenchDoc } from "@benchpilot/shared";
import type { Db } from "../index.ts";

export interface DocInput {
  path: string;
  title: string;
  content: string;
  pinned: boolean;
}

export function insertTestbench(db: Db, config: TestbenchConfig, docs: DocInput[], createdAt: string): void {
  const insDoc = db.prepare("INSERT INTO docs(testbench_id, path, title, content, pinned) VALUES (?, ?, ?, ?, ?)");
  const insFts = db.prepare("INSERT INTO docs_fts(rowid, title, content) VALUES (?, ?, ?)");
  db.transaction(() => {
    db.prepare("INSERT INTO testbenches(id, name, config_json, created_at) VALUES (?, ?, ?, ?)").run(
      config.id,
      config.name,
      JSON.stringify(config),
      createdAt,
    );
    for (const d of docs) {
      const { lastInsertRowid } = insDoc.run(config.id, d.path, d.title, d.content, d.pinned ? 1 : 0);
      insFts.run(lastInsertRowid, d.title, d.content);
    }
  })();
}

export function getTestbenchConfig(db: Db, id: string): TestbenchConfig | null {
  const row = db.prepare("SELECT config_json FROM testbenches WHERE id = ?").get(id) as { config_json: string } | undefined;
  return row ? (JSON.parse(row.config_json) as TestbenchConfig) : null;
}

export function getDoc(db: Db, testbenchId: string, docPath: string): DocInput | null {
  const r = db.prepare("SELECT path, title, content, pinned FROM docs WHERE testbench_id = ? AND path = ?").get(testbenchId, docPath) as
    | { path: string; title: string; content: string; pinned: number }
    | undefined;
  return r ? { ...r, pinned: r.pinned === 1 } : null;
}

/** Full-text search, bm25 order. Each word becomes a quoted FTS5 term, so user text cannot inject query syntax. */
export function searchDocs(db: Db, testbenchId: string, query: string, limit = 5): { path: string; title: string; snippet: string }[] {
  const terms = query.match(/[\p{L}\p{N}_.-]+/gu) ?? [];
  if (!terms.length) return [];
  const match = terms.map((t) => `"${t}"`).join(" OR ");
  return db
    .prepare(
      `SELECT d.path, d.title, snippet(docs_fts, 1, '[', ']', '…', 12) AS snippet
       FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
       WHERE docs_fts MATCH ? AND d.testbench_id = ? ORDER BY bm25(docs_fts) LIMIT ?`,
    )
    .all(match, testbenchId, limit) as { path: string; title: string; snippet: string }[];
}

// ---------------------------------------------------------------- P3: API (testbench edits, documents)

export function listTestbenchRows(db: Db): { config: TestbenchConfig; createdAt: string }[] {
  return (db.prepare("SELECT config_json, created_at FROM testbenches ORDER BY id").all() as { config_json: string; created_at: string }[]).map((r) => ({
    config: JSON.parse(r.config_json) as TestbenchConfig,
    createdAt: r.created_at,
  }));
}

export function testbenchCreatedAt(db: Db, id: string): string | null {
  return (db.prepare("SELECT created_at FROM testbenches WHERE id = ?").get(id) as { created_at: string } | undefined)?.created_at ?? null;
}

export function updateTestbenchConfig(db: Db, config: TestbenchConfig): void {
  db.prepare("UPDATE testbenches SET name = ?, config_json = ? WHERE id = ?").run(config.name, JSON.stringify(config), config.id);
}

interface DocRow {
  id: number;
  testbench_id: string;
  path: string;
  title: string;
  content: string;
  pinned: number;
}

const toDoc = (r: DocRow): TestbenchDoc => ({ id: r.id, testbenchId: r.testbench_id, path: r.path, title: r.title, content: r.content, pinned: r.pinned === 1 });

export function listDocs(db: Db, testbenchId: string): TestbenchDoc[] {
  return (db.prepare("SELECT * FROM docs WHERE testbench_id = ? ORDER BY pinned DESC, path").all(testbenchId) as DocRow[]).map(toDoc);
}

export function getDocById(db: Db, testbenchId: string, id: number): TestbenchDoc | null {
  const r = db.prepare("SELECT * FROM docs WHERE testbench_id = ? AND id = ?").get(testbenchId, id) as DocRow | undefined;
  return r ? toDoc(r) : null;
}

export function insertDoc(db: Db, testbenchId: string, d: DocInput): TestbenchDoc {
  const id = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO docs(testbench_id, path, title, content, pinned) VALUES (?, ?, ?, ?, ?)")
      .run(testbenchId, d.path, d.title, d.content, d.pinned ? 1 : 0);
    db.prepare("INSERT INTO docs_fts(rowid, title, content) VALUES (?, ?, ?)").run(lastInsertRowid, d.title, d.content);
    return Number(lastInsertRowid);
  })();
  return getDocById(db, testbenchId, id)!;
}

/** Replaces a doc's content and re-indexes it (external-content FTS5 needs the old values to delete). */
export function updateDocContent(db: Db, testbenchId: string, id: number, title: string, content: string): TestbenchDoc | null {
  const cur = getDocById(db, testbenchId, id);
  if (!cur) return null;
  db.transaction(() => {
    db.prepare("INSERT INTO docs_fts(docs_fts, rowid, title, content) VALUES ('delete', ?, ?, ?)").run(id, cur.title, cur.content);
    db.prepare("UPDATE docs SET title = ?, content = ? WHERE id = ?").run(title, content, id);
    db.prepare("INSERT INTO docs_fts(rowid, title, content) VALUES (?, ?, ?)").run(id, title, content);
  })();
  return getDocById(db, testbenchId, id);
}

export function deleteDoc(db: Db, testbenchId: string, id: number): boolean {
  const cur = getDocById(db, testbenchId, id);
  if (!cur) return false;
  db.transaction(() => {
    db.prepare("INSERT INTO docs_fts(docs_fts, rowid, title, content) VALUES ('delete', ?, ?, ?)").run(id, cur.title, cur.content);
    db.prepare("DELETE FROM docs WHERE id = ?").run(id);
  })();
  return true;
}
