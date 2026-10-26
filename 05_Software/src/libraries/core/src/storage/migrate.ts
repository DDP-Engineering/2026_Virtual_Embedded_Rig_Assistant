import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { veraError } from "@vera/shared";
import type Database from "better-sqlite3";
import * as initial from "./migrations/0001_initial.js";
import * as keyword from "./migrations/0002_keyword.js";
import * as embeddings from "./migrations/0003_embeddings.js";

export interface Migration {
  readonly version: number;
  readonly sql: string;
}
export const migrations: readonly Migration[] = [initial, keyword, embeddings];
export interface StorageOptions {
  workbenchId: string;
  appVersion: string;
  readOnly?: boolean;
  migrations?: readonly Migration[];
}
function invalid(reason: string): never {
  throw { ...veraError("INVALID"), params: { reason } };
}
export function catalogue(options: StorageOptions): readonly Migration[] {
  const list = options.migrations ?? migrations;
  if (!list.length) invalid("empty migration catalogue");
  for (const [i, migration] of list.entries()) {
    if (migration.version !== i + 1 || typeof migration.sql !== "string" || !migration.sql.trim())
      invalid("migration catalogue must be contiguous and ordered from 1");
  }
  return list;
}
function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}
function key(version: number): string {
  return `migration_${String(version).padStart(4, "0")}_sha256`;
}
/** Read-only metadata inspection. Newer versions take precedence over all other checks. */
export function checkDatabase(db: Database.Database, options: StorageOptions): number {
  const list = catalogue(options);
  const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
  if (!hasMeta) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get())
      invalid("existing database has no schema metadata");
    return 0;
  }
  const value = db.prepare("SELECT value FROM meta WHERE key=?").pluck();
  const raw = value.get("schema_version");
  if (typeof raw !== "string" || !/^(0|[1-9]\d*)$/.test(raw)) invalid("invalid schema_version");
  const version = Number(raw);
  if (version > list.length) throw veraError("WORKBENCH_TOO_NEW");
  if (!Number.isSafeInteger(version) || version < 1) invalid("invalid schema_version");
  for (const migration of list.slice(0, version)) {
    if (value.get(key(migration.version)) !== checksum(migration.sql))
      invalid(`migration ${migration.version} checksum mismatch`);
  }
  if (value.get("workbench_id") !== options.workbenchId) throw veraError("CONFLICT");
  return version;
}
/** Back up the committed WAL view before each atomic migration; recovery files are exclusive. */
export async function migrate(db: Database.Database, path: string, options: StorageOptions): Promise<void> {
  const list = catalogue(options);
  const version = checkDatabase(db, options);
  for (const migration of list.slice(version)) {
    const backupPath = join(dirname(path), "backups", `vera.db.v${migration.version - 1}.bak`);
    await mkdir(dirname(backupPath), { recursive: true });
    let reserved: Awaited<ReturnType<typeof open>>;
    try {
      reserved = await open(backupPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw veraError("CONFLICT");
      throw error;
    }
    await reserved.close();
    try {
      await db.backup(backupPath);
      const durable = await open(backupPath, "r+");
      try {
        await durable.sync();
      } finally {
        await durable.close();
      }
    } catch (error) {
      await unlink(backupPath);
      throw error;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      const put = db.prepare(
        "INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      );
      put.run(key(migration.version), checksum(migration.sql));
      put.run("schema_version", String(migration.version));
      if (migration.version === 1) {
        put.run("workbench_id", options.workbenchId);
        put.run("created_by", options.appVersion);
      }
    }).immediate();
  }
}
