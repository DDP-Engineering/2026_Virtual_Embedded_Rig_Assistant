import { constants, existsSync, lstatSync, rmSync } from "node:fs";
import { copyFile, type FileHandle, lstat, mkdtemp, open, readdir, rm } from "node:fs/promises";
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
function busy(error: unknown): unknown {
  const code = (error as NodeJS.ErrnoException).code;
  // Windows refuses to copy a file another process holds with EBUSY or EPERM.
  return code === "EBUSY" || code === "EPERM" ? veraError("BUSY") : error;
}
/** File identity, size, mtime and the 32-byte header (WAL salts and checkpoint sequence). */
async function stamp(path: string): Promise<string | undefined> {
  let file: FileHandle;
  try {
    file = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const { dev, ino, size, mtimeNs } = await file.stat({ bigint: true });
    const { buffer, bytesRead } = await file.read(Buffer.alloc(32), 0, 32, 0);
    return `${dev}:${ino}:${size}:${mtimeNs}:${buffer.subarray(0, bytesRead).toString("hex")}`;
  } finally {
    await file.close();
  }
}
/** Copies db and WAL; a changed stamp of either during the copy means a concurrent writer. */
async function capture(path: string, file: string): Promise<boolean> {
  await rm(`${file}-wal`, { force: true });
  const before = [await stamp(path), await stamp(`${path}-wal`)];
  await copyFile(path, file, constants.COPYFILE_FICLONE);
  if (before[1] !== undefined) {
    try {
      await copyFile(`${path}-wal`, `${file}-wal`, constants.COPYFILE_FICLONE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return before[0] === (await stamp(path)) && before[1] === (await stamp(`${path}-wal`));
}
const SNAPSHOT_PREFIX = "vera-storage-";
const STALE_MS = 24 * 60 * 60 * 1000;
/** Removes private copies older than a day that a crash or a held file left in the temp folder; best effort. */
async function sweepSnapshots(): Promise<void> {
  const names = await readdir(tmpdir()).catch(() => []);
  for (const name of names) {
    if (!name.startsWith(SNAPSHOT_PREFIX)) continue;
    const folder = join(tmpdir(), name);
    try {
      const info = await lstat(folder);
      if (info.isDirectory() && Date.now() - info.mtimeMs > STALE_MS)
        await rm(folder, { recursive: true, force: true });
    } catch {
      // Another process still holds or already removed it.
    }
  }
}
/**
 * SQLite reads a private copy so even WAL recovery/SHM creation cannot alter protected source data.
 * The copy is asynchronous, so a large database does not block the main process.
 */
async function snapshot(path: string): Promise<WorkbenchDatabase> {
  await sweepSnapshots();
  const temporary = await mkdtemp(join(tmpdir(), SNAPSHOT_PREFIX));
  let db: Database.Database | undefined;
  try {
    const file = join(temporary, "vera.db");
    // A concurrent foreign writer can commit or checkpoint while copying: retry once, then refuse.
    if (!(await capture(path, file)) && !(await capture(path, file))) throw veraError("BUSY");
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
        try {
          rmSync(temporary, { recursive: true, force: true });
        } catch {
          // Windows can still hold the copy (EBUSY, EPERM); a later snapshot sweeps what stays behind.
        }
      },
    };
  } catch (error) {
    db?.close();
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw busy(error);
  }
}
/**
 * Read-only opens query a private snapshot. A writable open is for a workbench whose lock the caller
 * holds: the database is VERA's own and opens in place, with no copy. The current schema is checked
 * with query_only=ON before any pragma or write, so a refused database is not written.
 */
export async function openDb(
  path: string,
  options: StorageOptions & { existingOnly?: boolean },
): Promise<WorkbenchDatabase> {
  safePaths(path);
  if (options.readOnly) {
    const handle = await snapshot(path);
    try {
      if (!checkDatabase(handle.db, options)) throw veraError("INVALID");
      return handle;
    } catch (error) {
      handle.close();
      throw error;
    }
  }
  let db: Database.Database;
  try {
    db = new Database(path, { timeout: 5000, fileMustExist: options.existingOnly ?? false });
  } catch (error) {
    if (options.existingOnly && !existsSync(path)) throw veraError("NOT_FOUND");
    throw error;
  }
  let keeper: Database.Database | undefined;
  try {
    db.pragma("query_only=ON");
    const initialized = checkDatabase(db, options);
    if (!initialized && options.existingOnly) throw veraError("NOT_FOUND");
    db.pragma("query_only=OFF");
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
