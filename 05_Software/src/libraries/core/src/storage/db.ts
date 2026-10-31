import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { veraError } from "@vera/shared";
import Database from "better-sqlite3";
import { checkDatabase, initializeDatabase, type StorageOptions } from "./schema.js";

export interface WorkbenchDatabase {
  readonly db: Database.Database;
  close(preserveSource?: boolean): void;
}
function ordinary(path: string, directory = false): void {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
      throw veraError("DENIED");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
function safePaths(path: string): void {
  ordinary(dirname(path), true);
  for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) ordinary(file);
}
/** SQLite reads a private copy so even WAL recovery/SHM creation cannot alter protected source data. */
function snapshot(path: string): WorkbenchDatabase {
  const temporary = mkdtempSync(join(tmpdir(), "vera-storage-"));
  let db: Database.Database | undefined;
  try {
    const file = join(temporary, "vera.db");
    const data = readFileSync(path);
    const wal = existsSync(`${path}-wal`) ? readFileSync(`${path}-wal`) : undefined;
    // Concurrent foreign writers can checkpoint while copying. Refuse an unstable capture.
    const after = readFileSync(path);
    const afterWal = existsSync(`${path}-wal`) ? readFileSync(`${path}-wal`) : undefined;
    if (!data.equals(after) || (wal ? !afterWal || !wal.equals(afterWal) : afterWal !== undefined))
      throw veraError("BUSY");
    writeFileSync(file, data, { mode: 0o600 });
    if (wal) writeFileSync(`${file}-wal`, wal, { mode: 0o600 });
    db = new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 });
    db.pragma("foreign_keys=ON");
    db.pragma("busy_timeout=5000");
    db.pragma("synchronous=NORMAL");
    db.pragma("query_only=ON");
    const result = db;
    return {
      db: result,
      close() {
        if (result.open) result.close();
        rmSync(temporary, { recursive: true, force: true });
      },
    };
  } catch (error) {
    db?.close();
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}
/** Current-schema validation precedes lock or writable SQLite activity, including for foreign live owners. */
export async function inspectDatabase(path: string, options: StorageOptions): Promise<void> {
  safePaths(path);
  if (!existsSync(path)) return;
  const handle = snapshot(path);
  try {
    checkDatabase(handle.db, options);
  } finally {
    handle.close();
  }
}
export async function openDb(path: string, options: StorageOptions): Promise<WorkbenchDatabase> {
  await inspectDatabase(path, options);
  if (options.readOnly) {
    const handle = snapshot(path);
    try {
      if (!checkDatabase(handle.db, options)) throw veraError("INVALID");
      return handle;
    } catch (error) {
      handle.close();
      throw error;
    }
  }
  const db = new Database(path, { timeout: 5000 });
  let keeper: Database.Database | undefined;
  try {
    const initialized = checkDatabase(db, options);
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");
    db.pragma("busy_timeout=5000");
    db.pragma("synchronous=NORMAL");
    if (!initialized) initializeDatabase(db, options);
    // SQLite checkpoints on the last writable close. Keep a read-only connection active
    // so ownership loss can dispose the writer first without checkpointing foreign data.
    keeper = new Database(path, { readonly: true, fileMustExist: true, timeout: 5000 });
    keeper.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    const readOnlyKeeper = keeper;
    return {
      db,
      close: (preserveSource = false) => {
        if (preserveSource) {
          try {
            if (db.open) db.close();
          } finally {
            if (readOnlyKeeper.open) readOnlyKeeper.close();
          }
        } else {
          if (readOnlyKeeper.open) readOnlyKeeper.close();
          if (db.open) db.close();
        }
      },
    };
  } catch (error) {
    keeper?.close();
    db.close();
    throw error;
  }
}
