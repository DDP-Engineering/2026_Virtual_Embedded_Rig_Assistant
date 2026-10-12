import { existsSync, lstatSync, readFileSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  configWarnings,
  mergeWorkbench,
  type RecentWorkbenchState,
  veraError,
  type WorkbenchConfig,
  type WorkbenchEvent,
  type WorkbenchPatch,
  type WorkbenchSnapshot,
  type WorkbenchWarning,
  workbenchPatchSchema,
  workbenchSchema,
  workbenchTemplate,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { ulid } from "ulid";
import { LineCounter, parseDocument, stringify } from "yaml";
import { type DocumentProcessor, Ingester } from "../knowledge/ingest.js";
import type { WorkbenchHost } from "../ports.js";
import { inspectDatabase, openDb, type WorkbenchDatabase } from "../storage/db.js";
import { acquireGuard } from "./guard.js";
import { createIgnoreRules } from "./ignore.js";
import { WriteQueue } from "./write-queue.js";

function requireJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || ancestors.has(value)) throw veraError("INVALID");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw veraError("INVALID");
  ancestors.add(value);
  for (const item of Object.values(value)) requireJson(item, ancestors);
  ancestors.delete(value);
}

export function parseConfig(text: string): WorkbenchConfig {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  if (doc.errors.length) {
    const at = lines.linePos(doc.errors[0]?.pos[0] ?? 0);
    throw { code: "INVALID", messageKey: "errors.YAML_INVALID", params: { line: at.line, column: at.col } };
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 100 });
    requireJson(data);
  } catch {
    throw veraError("INVALID");
  }
  if (
    typeof data === "object" &&
    data !== null &&
    "format" in data &&
    typeof data.format === "number" &&
    Number.isInteger(data.format) &&
    data.format > 1
  )
    throw veraError("WORKBENCH_TOO_NEW");
  const parsed = workbenchSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(String) ?? [];
    const node = doc.getIn(path, true);
    const at = lines.linePos(
      typeof node === "object" && node !== null && "range" in node && Array.isArray(node.range)
        ? node.range[0]
        : 0,
    );
    throw {
      code: "INVALID",
      messageKey: "errors.CONFIG_INVALID",
      params: { path: path.join("."), line: at.line },
    };
  }
  return parsed.data;
}
export function isNetworkShare(folder: string): boolean {
  return /^(?:\\\\|\/\/)/.test(folder) && !/^\\\\\?\\[A-Za-z]:\\/.test(folder);
}
export function pinnedTemplate(name: string): string {
  return workbenchTemplate(name);
}
function code(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
async function ordinary(path: string, directory: boolean): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))
      throw veraError("DENIED");
    return true;
  } catch (error) {
    if (code(error) === "ENOENT") return false;
    throw error;
  }
}
async function exclusive(path: string, text: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export class WorkbenchService {
  private state: WorkbenchSnapshot | undefined;
  private owned: { folder: string; token: string } | undefined;
  private database: WorkbenchDatabase | undefined;
  private ingest: Ingester | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly writes = new WriteQueue();
  getWriteQueue(): WriteQueue {
    this.current();
    return this.writes;
  }
  constructor(
    private readonly host: WorkbenchHost,
    private readonly processDocument?: DocumentProcessor,
  ) {}
  private startIngest(): void {
    if (!this.state || this.state.readOnly || !this.database || this.ingest) return;
    const state = this.state;
    this.ingest = new Ingester({
      root: state.folder,
      db: this.database.db,
      config: () => this.current().config,
      assertWritable: () => this.assertSessionWritable(),
      now: () => this.host.now(),
      emit: (event) => this.emit(state.config.id, event),
      ...(this.processDocument ? { process: this.processDocument } : {}),
    });
  }
  private async stopIngest(): Promise<void> {
    await this.ingest?.close();
    this.ingest = undefined;
  }
  reindexDocuments(): Promise<void> {
    // Admit on the lifecycle queue, then wait outside it so close/switch can abort processing.
    return this.run(async () => {
      this.assertSessionWritable();
      if (!this.ingest) throw veraError("NOT_FOUND");
      return { completion: this.ingest.reindex() };
    }).then(({ completion }) => completion);
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private async folder(input: string): Promise<string> {
    if (!isAbsolute(input)) throw veraError("INVALID");
    try {
      const folder = await realpath(input);
      if (!(await ordinary(folder, true))) throw veraError("NOT_FOUND");
      return folder;
    } catch (error) {
      if (code(error) === "ENOENT") throw veraError("NOT_FOUND");
      throw error;
    }
  }
  private async layout(folder: string): Promise<void> {
    if (!(await ordinary(folder, true))) throw veraError("NOT_FOUND");
    for (const file of ["workbench.yaml", "WORKBENCH.md", ".veraignore"])
      await ordinary(join(folder, file), false);
    for (const dir of ["docs", "skills", ".vera"]) await ordinary(join(folder, dir), true);
    for (const file of [".gitignore", "lock"]) await ordinary(join(folder, ".vera", file), false);
  }
  private async config(folder: string): Promise<WorkbenchConfig> {
    const path = join(folder, "workbench.yaml");
    if (!(await ordinary(path, false))) throw veraError("NOT_FOUND");
    const content = await this.host.files.read(path);
    if (content === undefined) throw veraError("NOT_FOUND");
    return parseConfig(content);
  }
  private async prepare(folder: string): Promise<void> {
    await mkdir(join(folder, ".vera"), { recursive: true });
    try {
      await exclusive(join(folder, ".vera/.gitignore"), "*\n");
    } catch (error) {
      if (code(error) !== "EEXIST") throw error;
    }
  }
  create(input: string, name: string): Promise<WorkbenchSnapshot> {
    return this.run(async () => {
      const folder = await this.folder(input);
      await this.layout(folder);
      if (await ordinary(join(folder, "workbench.yaml"), false)) throw veraError("CONFLICT");
      const config = workbenchSchema.parse({ format: 1, id: `wb_${ulid(this.host.now().getTime())}`, name });
      try {
        await exclusive(join(folder, "workbench.yaml"), stringify(config));
      } catch (error) {
        if (code(error) === "EEXIST") throw veraError("CONFLICT");
        throw error;
      }
      for (const dir of ["docs", "skills"]) await mkdir(join(folder, dir), { recursive: true });
      try {
        await exclusive(join(folder, "WORKBENCH.md"), pinnedTemplate(config.name));
      } catch (error) {
        if (code(error) !== "EEXIST") throw error;
      }
      return this.openFolder(folder, input);
    });
  }
  open(input: string): Promise<WorkbenchSnapshot> {
    return this.run(async () => this.openFolder(await this.folder(input), input));
  }
  private async openFolder(folder: string, input: string): Promise<WorkbenchSnapshot> {
    await this.writes.drain();
    const config = await this.config(folder);
    await this.layout(folder);
    const warnings: WorkbenchWarning[] = configWarnings(config, this.host.catalogs);
    if (isNetworkShare(input)) warnings.push({ code: "NETWORK_SHARE_UNSUPPORTED" });
    const same = this.state?.folder === folder;
    const databasePath = join(folder, ".vera/vera.db");
    const storageOptions = { workbenchId: config.id, appVersion: this.host.appVersion };
    await inspectDatabase(databasePath, storageOptions);
    const acquired = await this.acquire(folder, warnings);
    const newlyOwned = acquired.owned !== undefined && acquired.owned !== this.owned;
    const next = { folder, config, warnings, readOnly: acquired.readOnly };
    let database: WorkbenchDatabase | undefined;
    try {
      database =
        same && acquired.owned === this.owned && this.database?.db.open && !acquired.readOnly
          ? this.database
          : !acquired.readOnly || existsSync(databasePath)
            ? await openDb(databasePath, { ...storageOptions, readOnly: acquired.readOnly })
            : undefined;
      const snapshot = this.host.settings.get();
      if (!snapshot.readOnly) {
        const previous = snapshot.settings.recentWorkbenches.find((entry) => entry.folder === folder);
        const recent = snapshot.settings.recentWorkbenches.filter((entry) => entry.folder !== folder);
        await this.host.settings.update({
          recentWorkbenches: [
            {
              ...previous,
              folder,
              name: config.name,
              id: config.id,
              lastOpened: this.host.now().toISOString(),
            },
            ...recent,
          ].slice(0, 10),
        });
      }
    } catch (error) {
      if (database !== this.database) database?.close();
      if (newlyOwned && acquired.owned) await this.release(acquired.owned);
      throw error;
    }
    await this.stopIngest();
    if (!same && this.owned) {
      try {
        await this.release(this.owned, () => {
          if (this.database?.db.open) this.database.db.pragma("wal_checkpoint(TRUNCATE)");
        });
      } catch (error) {
        if (database !== this.database) database?.close();
        if (acquired.owned) await this.release(acquired.owned);
        this.startIngest();
        throw error;
      }
    }
    const preceding = this.state;
    if (database !== this.database) this.database?.close(true);
    this.database = database;
    this.state = next;
    this.owned = acquired.owned;
    if (!same && preceding) this.emit(preceding.config.id, { type: "closed" });
    if (!same) this.emit(config.id, { type: "opened", workbench: next });
    this.startIngest();
    return structuredClone(this.state);
  }
  private emit(id: string, event: WorkbenchEvent): void {
    try {
      this.host.changed({ topic: "workbench", id, event });
    } catch {
      /* observers never undo saves */
    }
  }
  private current(): WorkbenchSnapshot {
    if (!this.state) throw veraError("NOT_FOUND");
    return this.state;
  }
  /** Core-only storage access; a foreign owner supplies a read-only snapshot. */
  getDatabase(): Database.Database {
    this.current();
    if (!this.database) throw veraError("NOT_FOUND");
    return this.database.db;
  }
  getSnapshot(): WorkbenchSnapshot {
    return structuredClone(this.current());
  }
  /** Sessions recheck ownership immediately before synchronous SQLite mutations. */
  assertSessionWritable(): void {
    const state = this.current();
    if (state.readOnly || !this.owned) throw veraError("DENIED");
    try {
      const directory = lstatSync(join(state.folder, ".vera"));
      const file = lstatSync(join(state.folder, ".vera/lock"));
      if (directory.isSymbolicLink() || !directory.isDirectory() || file.isSymbolicLink() || !file.isFile())
        throw veraError("DENIED");
      const lock: unknown = JSON.parse(readFileSync(join(state.folder, ".vera/lock"), "utf8"));
      if (
        !lock ||
        typeof lock !== "object" ||
        !("token" in lock) ||
        lock.token !== this.owned.token ||
        !("pid" in lock) ||
        lock.pid !== this.host.pid
      )
        throw veraError("DENIED");
    } catch {
      throw veraError("DENIED");
    }
  }
  private async writable(): Promise<WorkbenchSnapshot> {
    const state = this.current();
    if (state.readOnly || !this.owned) throw veraError("DENIED");
    await this.layout(state.folder);
    const config = await this.config(state.folder);
    if (config.id !== state.config.id) throw veraError("CONFLICT");
    const lock = await this.lock(state.folder);
    if (lock?.token !== this.owned.token || lock.pid !== this.host.pid) throw veraError("DENIED");
    return state;
  }
  getConfig(): Promise<{ config: WorkbenchConfig; warnings: WorkbenchWarning[] }> {
    return this.run(async () => {
      const state = this.current();
      const config = await this.config(state.folder);
      if (config.id !== state.config.id) throw veraError("CONFLICT");
      return { config, warnings: configWarnings(config, this.host.catalogs) };
    });
  }
  updateConfig(patch: WorkbenchPatch): Promise<{ config: WorkbenchConfig; warnings: WorkbenchWarning[] }> {
    return this.run(() =>
      this.writes.run(async () => {
        const parsed = workbenchPatchSchema.safeParse(patch);
        if (!parsed.success) throw veraError("INVALID");
        const state = await this.writable();
        const current = await this.config(state.folder);
        if (current.id !== state.config.id) throw veraError("CONFLICT");
        const config = mergeWorkbench(current, parsed.data);
        const warnings = configWarnings(config, this.host.catalogs);
        if (JSON.stringify(config) !== JSON.stringify(current)) {
          await this.host.files.writeAtomic(join(state.folder, "workbench.yaml"), stringify(config));
          this.state = { ...state, config, warnings };
          this.emit(config.id, { type: "config.changed", config, warnings });
          this.ingest?.request();
        }
        return { config: structuredClone(config), warnings };
      }),
    );
  }
  private async pinned(folder: string): Promise<{ content: string; oversized: boolean }> {
    if (!(await ordinary(folder, true))) throw veraError("NOT_FOUND");
    const path = join(folder, "WORKBENCH.md");
    if (!(await ordinary(path, false))) return { content: "", oversized: false };
    const content = (await this.host.files.read(path)) ?? "";
    return { content, oversized: Buffer.byteLength(content, "utf8") > 16384 };
  }
  getPinned(): Promise<{ content: string; oversized: boolean }> {
    return this.run(() => this.pinned(this.current().folder));
  }
  recent(remove?: string): Promise<RecentWorkbenchState[]> {
    return this.run(async () => {
      let snapshot = this.host.settings.get();
      if (remove !== undefined) {
        if (snapshot.readOnly) throw veraError("DENIED");
        snapshot = await this.host.settings.update({
          recentWorkbenches: snapshot.settings.recentWorkbenches.filter((entry) => entry.folder !== remove),
        });
      }
      return Promise.all(
        snapshot.settings.recentWorkbenches.map(async (entry) => {
          try {
            const info = await lstat(entry.folder);
            return { ...entry, missing: !info.isDirectory() };
          } catch (error) {
            if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return { ...entry, missing: true };
            throw error;
          }
        }),
      );
    });
  }
  files(query: string): Promise<string[]> {
    return this.run(async () => {
      if (typeof query !== "string") throw veraError("INVALID");
      const folder = this.current().folder;
      if (!(await ordinary(folder, true))) throw veraError("NOT_FOUND");
      const path = join(folder, ".veraignore");
      await ordinary(path, false);
      const ignored = createIgnoreRules((await this.host.files.read(path)) ?? "");
      const paths: string[] = [];
      const needle = query.toLowerCase();
      async function walk(relative: string): Promise<void> {
        if (!(await ordinary(join(folder, relative), true))) return;
        const entries = await readdir(join(folder, relative), { withFileTypes: true });
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
          if (paths.length >= 50) return;
          const name = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isSymbolicLink() || ignored(entry.isDirectory() ? `${name}/` : name)) continue;
          if (entry.isDirectory()) await walk(name);
          else if (entry.isFile() && name.toLowerCase().includes(needle)) paths.push(name);
        }
      }
      await walk("");
      return paths;
    });
  }
  updatePinned(content: string): Promise<{ content: string; oversized: boolean }> {
    return this.run(() =>
      this.writes.run(async () => {
        if (typeof content !== "string") throw veraError("INVALID");
        const state = await this.writable();
        await this.host.files.writeAtomic(join(state.folder, "WORKBENCH.md"), content);
        return { content, oversized: Buffer.byteLength(content, "utf8") > 16384 };
      }),
    );
  }
  private async lock(folder: string): Promise<{ pid: number; token: string | undefined } | undefined> {
    const path = join(folder, ".vera/lock");
    if (!(await ordinary(path, false))) return undefined;
    const raw = await this.host.files.read(path);
    if (raw === undefined) return undefined;
    try {
      const data: unknown = JSON.parse(raw);
      if (
        typeof data !== "object" ||
        data === null ||
        !("pid" in data) ||
        typeof data.pid !== "number" ||
        !Number.isSafeInteger(data.pid) ||
        data.pid <= 0 ||
        !("app" in data) ||
        typeof data.app !== "string" ||
        !("since" in data) ||
        typeof data.since !== "string"
      )
        throw veraError("CONFLICT");
      return {
        pid: data.pid,
        token: "token" in data && typeof data.token === "string" ? data.token : undefined,
      };
    } catch {
      throw veraError("CONFLICT");
    }
  }
  private async acquire(
    folder: string,
    warnings: WorkbenchWarning[],
  ): Promise<{ readOnly: boolean; owned?: { folder: string; token: string } }> {
    const observed = await this.lock(folder);
    if (observed && this.host.isProcessAlive(observed.pid)) {
      if (
        this.owned?.folder === folder &&
        observed.token === this.owned.token &&
        observed.pid === this.host.pid
      )
        return { readOnly: false, owned: this.owned };
      return { readOnly: true };
    }
    const release = await acquireGuard(folder);
    if (!release) {
      warnings.push({ code: "LOCK_GUARD_BUSY" });
      return { readOnly: true };
    }
    try {
      await mkdir(join(folder, ".vera"), { recursive: true });
      const lock = await this.lock(folder);
      if (lock && this.host.isProcessAlive(lock.pid)) return { readOnly: true };
      if (lock) await unlink(join(folder, ".vera/lock"));
      await this.prepare(folder);
      const token = this.host.token();
      await exclusive(
        join(folder, ".vera/lock"),
        JSON.stringify({
          pid: this.host.pid,
          app: this.host.appVersion,
          since: this.host.now().toISOString(),
          token,
        }),
      );
      return { readOnly: false, owned: { folder, token } };
    } finally {
      await release();
    }
  }
  private async release(owned: { folder: string; token: string }, beforeRelease?: () => void): Promise<void> {
    if (!(await ordinary(owned.folder, true)) || !(await ordinary(join(owned.folder, ".vera"), true))) return;
    const release = await acquireGuard(owned.folder);
    if (!release) throw veraError("BUSY");
    try {
      const lock = await this.lock(owned.folder);
      if (lock?.token === owned.token && lock.pid === this.host.pid) {
        beforeRelease?.();
        await unlink(join(owned.folder, ".vera/lock"));
      }
    } finally {
      await release();
    }
  }
  close(): Promise<void> {
    return this.run(async () => {
      await this.writes.drain();
      await this.stopIngest();
      try {
        if (this.owned)
          await this.release(this.owned, () => {
            if (this.database?.db.open) this.database.db.pragma("wal_checkpoint(TRUNCATE)");
          });
      } catch (error) {
        this.startIngest();
        throw error;
      }
      this.database?.close(true);
      this.database = undefined;
      const id = this.state?.config.id;
      this.state = undefined;
      this.owned = undefined;
      if (id) this.emit(id, { type: "closed" });
    });
  }
}
