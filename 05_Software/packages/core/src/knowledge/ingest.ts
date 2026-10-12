import { createHash } from "node:crypto";
import { constants, lstatSync, readFileSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";
import {
  type DocumentKind,
  type DocumentReason,
  type DocumentRecord,
  veraError,
  type WorkbenchConfig,
  type WorkbenchEvent,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { type FSWatcher, watch } from "chokidar";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { isBinary } from "../tools/binary.js";
import { validateGlob } from "../tools/discovery.js";
import { createIgnoreRules } from "../workbench/ignore.js";
import { PathGuard } from "../workbench/path-guard.js";
import { WriteQueue } from "../workbench/write-queue.js";
import type { Chunk } from "./chunk.js";

export const PDF_LIMIT = 100 * 1024 * 1024;
export const TEXT_LIMIT = 20 * 1024 * 1024;
export interface DocumentInput {
  root: string;
  path: string;
  kind: Exclude<DocumentKind, "other">;
  sha256: string;
  signal: AbortSignal;
  assertWritable: () => void;
}
export interface DocumentResult {
  status: "indexed" | "failed" | "unsupported" | "needs_ocr";
  pages?: number;
  reason?: DocumentReason;
  chunks?: Chunk[];
}
export type DocumentProcessor = (input: DocumentInput) => Promise<DocumentResult>;
export interface IngestOptions {
  root: string;
  db: Database.Database;
  config: () => WorkbenchConfig;
  assertWritable: () => void;
  now: () => Date;
  emit: (event: WorkbenchEvent) => void;
  process?: DocumentProcessor;
}
const textExtensions = new Set([
  ".txt",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".ini",
  ".cfg",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".rs",
  ".go",
  ".java",
  ".sh",
  ".conf",
]);
export function documentKind(path: string): DocumentKind {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".html" || ext === ".htm") return "html";
  return textExtensions.has(ext) ? "text" : "other";
}
const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Match tinyglobby's directory expansion/negation once, for both discovery and admission. */
function selection(docs: WorkbenchConfig["docs"]): { include: string[]; exclude: string[] } {
  const include: string[] = [],
    exclude: string[] = [];
  const normalize = (pattern: string) => {
    validateGlob(pattern);
    let result = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
    if (!result.endsWith("*")) result += "/**";
    return posix.normalize(result);
  };
  for (const pattern of docs.exclude) {
    if (pattern && (!pattern.startsWith("!") || pattern.startsWith("!("))) exclude.push(normalize(pattern));
  }
  for (const pattern of docs.include) {
    if (!pattern) continue;
    if (!pattern.startsWith("!") || pattern.startsWith("!(")) include.push(normalize(pattern));
    else if (!pattern.startsWith("!!") || pattern.startsWith("!!("))
      exclude.push(normalize(pattern.slice(1)));
  }
  return { include, exclude };
}

/** One serial ingest queue owned by one writable workbench, independent of session writes. */
export class Ingester {
  private readonly rows: DocumentsRepository;
  private readonly queue = new WriteQueue();
  private readonly abort = new AbortController();
  private readonly watcher: FSWatcher;
  private readonly ready: Promise<void>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private active = false;
  private requested = false;
  private closePromise: Promise<void> | undefined;
  private ignored = createIgnoreRules();
  private patterns = "";
  private matches = (_path: string) => false;
  private refreshPolicy(): void {
    try {
      const path = join(this.options.root, ".veraignore");
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) throw veraError("DENIED");
      this.ignored = createIgnoreRules(readFileSync(path, "utf8"));
    } catch (error) {
      if (missing(error)) this.ignored = createIgnoreRules();
      else this.ignored = () => true;
    }
    const docs = this.options.config().docs;
    const key = JSON.stringify([docs.include, docs.exclude]);
    if (key === this.patterns) return;
    this.patterns = key;
    try {
      const patterns = selection(docs);
      const include = picomatch(patterns.include, { dot: true, posix: true });
      const exclude = picomatch(patterns.exclude, { dot: true, posix: true });
      this.matches = (path) => include(path) && !exclude(path);
    } catch {
      this.matches = () => false;
    }
  }

  constructor(private readonly options: IngestOptions) {
    this.rows = new DocumentsRepository(options.db);
    this.refreshPolicy();
    const ignored = createIgnoreRules();
    this.watcher = watch(options.root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path) => {
        const rel = relative(options.root, path).split(sep).join("/");
        return !!rel && ignored(rel);
      },
    });
    this.ready = new Promise((resolve) => {
      this.watcher.once("ready", resolve);
      this.watcher.once("error", () => resolve());
    });
    this.watcher.on("all", (event, path) => {
      const rel = relative(options.root, path).split(sep).join("/");
      if (rel === ".veraignore" || rel === "workbench.yaml") {
        this.refreshPolicy();
        this.request();
      } else if (!this.ignored(rel) && (event === "addDir" || event === "unlinkDir" || this.matches(rel)))
        this.request();
    });
    this.watcher.on("error", () => this.emit({ type: "index.progress", pending: 0, done: 0, failed: 1 }));
    void this.ready.then(() => this.request());
  }
  private emit(event: WorkbenchEvent): void {
    if (this.closed) return;
    try {
      this.options.emit(event);
    } catch {
      /* observers cannot undo storage */
    }
  }
  private mutation<T>(action: () => T): T {
    if (this.closed) throw veraError("DENIED");
    this.options.assertWritable();
    return this.options.db.transaction(action)();
  }
  request(): void {
    if (this.closed) return;
    const docs = this.options.config().docs;
    if (this.patterns !== JSON.stringify([docs.include, docs.exclude])) this.refreshPolicy();
    this.requested = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.schedule();
    }, 1000);
  }
  private schedule(): void {
    if (this.closed || this.active) return;
    this.active = true;
    void this.queue.run(async () => {
      this.requested = false;
      try {
        await this.reconcile();
      } catch {
        this.emit({ type: "index.progress", pending: 0, done: 0, failed: 1 });
      } finally {
        this.active = false;
        if (this.requested && !this.timer) this.request();
      }
    });
  }
  /** Explicit reindex executes in the same queue as background batches. */
  reindex(): Promise<void> {
    if (this.closed) return Promise.reject(veraError("DENIED"));
    return this.queue.run(async () => {
      const removed = this.rows.list();
      this.mutation(() => {
        for (const row of removed) this.rows.remove(row.path);
      });
      for (const row of removed) this.emit({ type: "index.document", path: row.path, document: null });
      await this.reconcile();
    });
  }
  async waitIdle(): Promise<void> {
    await this.ready;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.schedule();
    }
    await this.queue.drain();
  }
  private async selected(): Promise<{ guard: PathGuard; paths: string[] }> {
    const guard = await PathGuard.create(this.options.root);
    const { include, exclude } = selection(this.options.config().docs);
    const paths = include.length
      ? await glob(include, {
          cwd: this.options.root,
          ignore: exclude,
          dot: true,
          onlyFiles: true,
          followSymbolicLinks: false,
          expandDirectories: false,
        })
      : [];
    const allowed: string[] = [];
    for (const path of paths.sort()) {
      if (this.closed) break;
      try {
        await this.ordinary(guard, path);
        allowed.push(path);
      } catch (error) {
        if (missing(error)) this.request();
      }
    }
    return { guard, paths: allowed };
  }
  /** Unlike tool reads, ingest follows no file/directory aliases, even within the root. */
  private async ordinary(guard: PathGuard, path: string) {
    const target = await guard.resolve(path);
    const parts = path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const info = await lstat(join(this.options.root, ...parts.slice(0, n)));
      if (info.isSymbolicLink() || (n < parts.length ? !info.isDirectory() : !info.isFile()))
        throw veraError("DENIED");
    }
    return target;
  }
  private async reconcile(): Promise<void> {
    this.options.assertWritable();
    const { guard, paths } = await this.selected();
    if (this.closed) return;
    const selected = new Set(paths);
    const removed = this.rows.list().filter((row) => !selected.has(row.path));
    this.mutation(() => {
      for (const row of removed) this.rows.remove(row.path);
    });
    for (const row of removed) this.emit({ type: "index.document", path: row.path, document: null });
    let pending = paths.length,
      done = 0,
      failed = 0;
    const progress = () => this.emit({ type: "index.progress", pending, done, failed });
    progress();
    for (const path of paths) {
      if (this.closed) return;
      if ((await this.ingest(guard, path)) === "failed") failed++;
      else done++;
      pending--;
      progress();
    }
  }
  private publish(record: Omit<DocumentRecord, "id">, invalidate = false, chunks?: Chunk[]): DocumentRecord {
    const row = this.mutation(() => {
      const old = this.rows.get(record.path);
      if (invalidate && old) this.rows.clearDerived(old.id);
      const saved = this.rows.save(record);
      if (chunks) this.rows.replaceChunks(saved.id, chunks);
      return saved;
    });
    this.emit({ type: "index.document", path: row.path, document: row });
    return row;
  }
  private async ingest(guard: PathGuard, path: string): Promise<string> {
    const old = this.rows.get(path);
    const kind = documentKind(path);
    let record: Omit<DocumentRecord, "id"> = {
      path,
      kind,
      sha256: null,
      bytes: 0,
      mtime: this.options.now().toISOString(),
      pages: null,
      status: "pending",
      error: null,
      indexedAt: null,
    };
    try {
      const target = await this.ordinary(guard, path);
      const before = await lstat(target.absolute);
      record = { ...record, bytes: before.size, mtime: before.mtime.toISOString() };
      if (before.size > (kind === "pdf" ? PDF_LIMIT : TEXT_LIMIT)) {
        if (
          old?.status !== "unsupported" ||
          old.error !== "SIZE_LIMIT" ||
          old.bytes !== before.size ||
          old.mtime !== record.mtime
        )
          this.publish({ ...record, status: "unsupported", error: "SIZE_LIMIT" }, true);
        return "unsupported";
      }
      const handle = await open(target.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const hash = createHash("sha256");
      let binary = false;
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) {
          this.request();
          return "pending";
        }
        const buffer = Buffer.alloc(64 * 1024);
        let bytes = 0;
        for (;;) {
          this.abort.signal.throwIfAborted();
          const read = await handle.read(buffer, 0, buffer.length, null);
          if (!read.bytesRead) break;
          if (bytes === 0 && kind !== "pdf" && kind !== "other")
            binary = isBinary(buffer.subarray(0, read.bytesRead));
          bytes += read.bytesRead;
          if (bytes > (kind === "pdf" ? PDF_LIMIT : TEXT_LIMIT)) {
            this.request();
            return "pending";
          }
          hash.update(buffer.subarray(0, read.bytesRead));
        }
        const after = await handle.stat();
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs
        ) {
          this.request();
          return "pending";
        }
      } finally {
        await handle.close();
      }
      await this.ordinary(guard, path);
      const final = await lstat(target.absolute);
      if (
        final.ino !== before.ino ||
        final.dev !== before.dev ||
        final.size !== before.size ||
        final.mtimeMs !== before.mtimeMs ||
        final.ctimeMs !== before.ctimeMs
      ) {
        this.request();
        return "pending";
      }
      record.sha256 = hash.digest("hex");
      if (
        old?.sha256 === record.sha256 &&
        old.kind === kind &&
        old.status !== "failed" &&
        !(old.status === "pending" && this.options.process)
      )
        return old.status;
      if (kind === "other") {
        this.publish({ ...record, status: "unsupported", error: "TYPE_UNSUPPORTED" }, true);
        return "unsupported";
      }
      if (binary) {
        this.publish({ ...record, status: "unsupported", error: "BINARY" }, true);
        return "unsupported";
      }
      const pending = this.publish(record, true);
      if (!this.options.process) return "pending";
      const result = await this.options.process({
        root: this.options.root,
        path,
        kind,
        sha256: record.sha256,
        signal: this.abort.signal,
        assertWritable: () => {
          if (this.closed) throw veraError("DENIED");
          this.options.assertWritable();
        },
      });
      if (this.closed) return "pending";
      const current = await lstat((await this.ordinary(guard, path)).absolute);
      if (
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs ||
        current.ctimeMs !== before.ctimeMs
      ) {
        this.request();
        return "pending";
      }
      if (this.rows.get(path)?.sha256 !== pending.sha256) {
        this.request();
        return "pending";
      }
      this.publish(
        {
          ...record,
          status: result.status,
          pages: result.pages ?? null,
          error:
            result.reason ??
            (result.status === "needs_ocr" ? "NEEDS_OCR" : result.status === "failed" ? "PROCESSING" : null),
          indexedAt: result.status === "indexed" ? this.options.now().toISOString() : null,
        },
        false,
        result.status === "indexed" ? result.chunks : [],
      );
      return result.status;
    } catch (error) {
      if (this.closed) return "pending";
      if (missing(error)) {
        this.request();
        return "pending";
      }
      this.publish({ ...record, status: "failed", error: record.sha256 ? "PROCESSING" : "IO" }, true);
      return "failed";
    }
  }
  close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closed = true;
      if (this.timer) clearTimeout(this.timer);
      this.abort.abort();
      await this.watcher.close();
      await this.queue.drain();
    })();
    return this.closePromise;
  }
}
