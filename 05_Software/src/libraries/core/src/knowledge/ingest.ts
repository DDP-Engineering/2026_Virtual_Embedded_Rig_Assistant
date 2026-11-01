import { lstatSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  type DocumentKind,
  type DocumentReason,
  type DocumentRecord,
  type DocumentVolume,
  veraError,
  type WorkbenchConfig,
  type WorkbenchEvent,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { type FSWatcher, watch } from "chokidar";
import picomatch from "picomatch";
import type { DocumentDerived } from "../storage/repos/documents.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { createIgnoreRules } from "../workbench/ignore.js";
import { PathGuard } from "../workbench/path-guard.js";
import { WriteQueue } from "../workbench/write-queue.js";
import type { Chunk } from "./chunk.js";
import { type InspectInput, inspectSource, type SourceInspection } from "./inspect.js";
import { documentKind, documentSelection, missing, sourceLimit } from "./kinds.js";
import {
  ordinaryFile,
  readIgnorePolicy,
  type SelectInput,
  type Selection,
  selectDocuments,
  skipEntry,
} from "./selection.js";

export { documentKind, documentSelection, PDF_LIMIT, TEXT_LIMIT } from "./kinds.js";

export interface DocumentInput {
  root: string;
  path: string;
  kind: Exclude<DocumentKind, "other">;
  sha256: string;
  embeddings?: WorkbenchConfig["embeddings"];
  signal: AbortSignal;
  assertWritable: () => void;
}
export interface DocumentResult {
  status: "indexed" | "failed" | "unsupported" | "needs_ocr";
  pages?: number;
  reason?: DocumentReason;
  chunks?: Chunk[];
  derived?: DocumentDerived;
}
export type DocumentProcessor = ((input: DocumentInput) => Promise<DocumentResult>) & {
  modelId?: string;
  release?(root: string): Promise<void>;
  /** Document selection; the desktop app runs it in its indexer process (TASK-f09609fd). */
  select?(input: SelectInput): Promise<Selection>;
  /** Source hashing; the desktop app runs it in its indexer process (TASK-f09609fd). */
  inspect?(input: InspectInput): Promise<SourceInspection>;
};
export interface IngestOptions {
  root: string;
  db: Database.Database;
  config: () => WorkbenchConfig;
  assertWritable: () => void;
  now: () => Date;
  emit: (event: WorkbenchEvent) => void;
  process?: DocumentProcessor;
}
/** Literal include prefixes bound recursive monitoring; policy files stay live independently. */
function watchTargets(root: string, docs: WorkbenchConfig["docs"]): string[] {
  let include: string[] = [];
  try {
    include = documentSelection(docs).include;
  } catch {
    // Invalid selection remains a reconcile error; never expand its monitoring outside the root.
  }
  const roots = include.map((pattern) => {
    const parts = picomatch.scan(pattern).base.split("/").filter(Boolean);
    // An explicit nested target must not bypass followSymlinks=false on its ancestors.
    for (let i = 1; i < parts.length; i++) {
      const ancestor = join(root, ...parts.slice(0, i));
      try {
        if (lstatSync(ancestor).isSymbolicLink()) return ancestor;
      } catch (error) {
        if (!missing(error)) return ancestor;
        break;
      }
    }
    return join(root, ...parts);
  });
  return [...new Set([...roots, join(root, ".vera/workbench.yaml"), join(root, ".vera/.veraignore")])].sort();
}

/** One serial ingest queue owned by one writable workbench, independent of session writes. */
export class Ingester {
  private readonly rows: DocumentsRepository;
  private readonly queue = new WriteQueue();
  private readonly abort = new AbortController();
  private watcher: FSWatcher;
  private ready: Promise<void>;
  private cancelReady: () => void;
  private targets: string[];
  private watcherUpdates: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private active = false;
  private requested = false;
  private closePromise: Promise<void> | undefined;
  private ignored = createIgnoreRules();
  private ignoreText = "";
  private patterns = "";
  private matches = (_path: string) => false;
  private excluded = (_path: string) => false;
  private selectedVolume: DocumentVolume | null = null;
  /** Indexer crashes per document content while it was processed (RULING-006). */
  private readonly crashes = new Map<string, number>();
  /**
   * True for a folder the walk and the watcher must not enter, or a file that is no document:
   * neither is listed further, opened or recorded (TASK-e5310cdb).
   */
  private skipped(rel: string, directory: boolean): boolean {
    return skipEntry(rel, directory, this.ignored, this.excluded);
  }
  private refreshPolicy(): void {
    const policy = readIgnorePolicy(this.options.root);
    this.ignoreText = policy.text;
    this.ignored = policy.ignored;
    const docs = this.options.config().docs;
    const key = JSON.stringify([docs.include, docs.exclude]);
    if (key === this.patterns) return;
    this.patterns = key;
    try {
      const patterns = documentSelection(docs);
      const include = picomatch(patterns.include, { dot: true, posix: true });
      const exclude = picomatch(patterns.exclude, { dot: true, posix: true });
      this.matches = (path) => include(path) && !exclude(path);
      this.excluded = (path) => exclude(path);
    } catch {
      this.matches = () => false;
      this.excluded = () => false;
    }
  }

  constructor(private readonly options: IngestOptions) {
    this.rows = new DocumentsRepository(options.db);
    this.refreshPolicy();
    this.targets = watchTargets(options.root, options.config().docs);
    this.watchKey = this.watcherKey(this.targets);
    const initial = this.createWatcher(this.targets);
    this.watcher = initial.watcher;
    this.ready = initial.ready;
    this.cancelReady = initial.cancelReady;
  }
  private createWatcher(targets: string[]): {
    watcher: FSWatcher;
    ready: Promise<void>;
    cancelReady: () => void;
  } {
    const watcher = watch(targets, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path, stats) => {
        const rel = relative(this.options.root, path).split(sep).join("/");
        const policyPath = process.platform === "win32" ? rel.toLowerCase() : rel;
        if (
          policyPath === ".vera" ||
          policyPath === ".vera/.veraignore" ||
          policyPath === ".vera/workbench.yaml"
        )
          return false;
        if (!rel || targets.includes(path)) return false;
        // Excluded folders are never registered, so their contents are not walked or watched.
        if (stats?.isDirectory()) return this.skipped(rel, true);
        if (stats?.isFile()) return this.skipped(rel, false);
        // Type not known yet: only skip what is ignored both as a file and as a folder.
        return this.ignored(rel) && this.ignored(`${rel}/`);
      },
    });
    let settleReady = () => {};
    let cancelled = false;
    const ready = new Promise<void>((resolve) => {
      settleReady = resolve;
      watcher.once("ready", resolve);
      watcher.once("error", () => resolve());
    });
    watcher.on("all", (event, path) => {
      const rel = relative(this.options.root, path).split(sep).join("/");
      const policyPath = process.platform === "win32" ? rel.toLowerCase() : rel;
      if (policyPath === ".vera/.veraignore" || policyPath === ".vera/workbench.yaml") {
        this.refreshPolicy();
        this.request();
      } else if (
        !this.ignored(rel) &&
        (event === "addDir" || event === "unlinkDir" || this.matches(rel) || targets.includes(path))
      )
        this.request();
    });
    watcher.on("error", () => this.emit({ type: "index.progress", pending: 0, done: 0, failed: 1 }));
    void ready.then(() => {
      if (!cancelled) this.request();
    });
    const cancelReady = () => {
      cancelled = true;
      settleReady();
    };
    return { watcher, ready, cancelReady };
  }
  private watchKey = "";
  /** Targets plus the pruning policy: a policy change re-registers newly allowed folders. */
  private watcherKey(targets: string[]): string {
    return JSON.stringify([targets, this.ignoreText, this.patterns]);
  }
  private refreshWatcher(): void {
    const next = watchTargets(this.options.root, this.options.config().docs);
    const key = this.watcherKey(next);
    if (key === this.watchKey) return;
    this.watchKey = key;
    this.targets = next;
    this.watcherUpdates = this.watcherUpdates
      .then(async () => {
        if (this.closed) return;
        this.cancelReady();
        await this.watcher.close();
        if (this.closed) return;
        const current = this.createWatcher(next);
        this.watcher = current.watcher;
        this.ready = current.ready;
        this.cancelReady = current.cancelReady;
      })
      .catch(() => this.emit({ type: "index.progress", pending: 0, done: 0, failed: 1 }));
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
    this.refreshWatcher();
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
      // Select first: a stopped indexer must not leave an emptied index behind.
      const selection = await this.selected();
      const removed = this.rows.list();
      this.mutation(() => {
        for (const row of removed) this.rows.remove(row.path);
      });
      for (const row of removed) this.emit({ type: "index.document", path: row.path, document: null });
      await this.reconcile(selection);
    });
  }
  async waitIdle(): Promise<void> {
    while (!this.closed) {
      const updates = this.watcherUpdates;
      await updates;
      const ready = this.ready;
      await ready;
      if (updates === this.watcherUpdates && ready === this.ready) break;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.schedule();
    }
    await this.queue.drain();
  }
  private async selected(): Promise<{ guard: PathGuard; paths: string[]; bytes: number }> {
    const guard = await PathGuard.create(this.options.root);
    const select = this.options.process?.select ?? selectDocuments;
    const selection = await select({
      root: this.options.root,
      docs: this.options.config().docs,
      signal: this.abort.signal,
    });
    if (selection.retry) this.request();
    return {
      guard,
      paths: selection.paths.map((entry) => entry.path),
      bytes: selection.paths.reduce((sum, entry) => sum + entry.size, 0),
    };
  }
  /** The last selection's document count and source bytes; null before the first one. */
  volume(): DocumentVolume | null {
    return this.selectedVolume && { ...this.selectedVolume };
  }
  /** Unlike tool reads, ingest follows no file/directory aliases, even within the root. */
  private async ordinary(guard: PathGuard, path: string) {
    return (await ordinaryFile(this.options.root, guard, path)).target;
  }
  private async reconcile(selection?: Awaited<ReturnType<Ingester["selected"]>>): Promise<void> {
    this.options.assertWritable();
    const { guard, paths, bytes } = selection ?? (await this.selected());
    if (this.closed) return;
    this.selectedVolume = { files: paths.length, bytes };
    this.emit({ type: "index.volume", files: paths.length, bytes });
    const fingerprint = JSON.stringify(this.options.config().embeddings);
    const previous = this.options.db
      .prepare("SELECT value FROM meta WHERE key='indexing_config'")
      .pluck()
      .get();
    if (previous !== fingerprint) {
      this.mutation(() => {
        for (const row of this.rows.list()) this.rows.remove(row.path);
        this.options.db
          .prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('indexing_config',?)")
          .run(fingerprint);
      });
    }
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
  private publish(
    record: Omit<DocumentRecord, "id">,
    invalidate = false,
    chunks?: Chunk[],
    derived?: DocumentDerived,
  ): DocumentRecord {
    const row = this.mutation(() => {
      const old = this.rows.get(record.path);
      if (invalidate && old) this.rows.clearDerived(old.id);
      const saved = this.rows.save(record);
      if (chunks) this.rows.replaceChunks(saved.id, chunks, derived);
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
      if (before.size > sourceLimit(kind)) {
        if (
          old?.status !== "unsupported" ||
          old.error !== "SIZE_LIMIT" ||
          old.bytes !== before.size ||
          old.mtime !== record.mtime
        )
          this.publish({ ...record, status: "unsupported", error: "SIZE_LIMIT" }, true);
        return "unsupported";
      }
      // Selection admits documents only; a stray other path is recorded without being read.
      if (kind === "other") {
        this.publish({ ...record, status: "unsupported", error: "TYPE_UNSUPPORTED" }, true);
        return "unsupported";
      }
      const inspect = this.options.process?.inspect ?? inspectSource;
      const inspection = await inspect({
        root: this.options.root,
        path,
        kind,
        identity: { ino: before.ino, dev: before.dev },
        signal: this.abort.signal,
      });
      if (inspection.status === "changed") {
        this.request();
        return "pending";
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
      record.sha256 = inspection.sha256;
      // A document that crashed the indexer twice stays failed until its content changes.
      if ((this.crashes.get(`${path}\n${record.sha256}`) ?? 0) >= 2) {
        if (old?.status !== "failed" || old.sha256 !== record.sha256)
          this.publish({ ...record, status: "failed", error: "PROCESSING" }, true);
        return "failed";
      }
      if (
        old?.sha256 === record.sha256 &&
        old.kind === kind &&
        old.status !== "failed" &&
        !(old.status === "pending" && this.options.process) &&
        !(
          old.status === "indexed" &&
          this.options.process?.modelId &&
          this.options.db.prepare("SELECT count(*) FROM chunks WHERE doc_id=?").pluck().get(old.id) !==
            this.options.db
              .prepare(
                "SELECT count(*) FROM embeddings e JOIN chunks c ON c.id=e.chunk_id WHERE c.doc_id=? AND e.model_id=?",
              )
              .pluck()
              .get(old.id, this.options.process.modelId)
        )
      )
        return old.status;
      if (inspection.binary) {
        this.publish({ ...record, status: "unsupported", error: "BINARY" }, true);
        return "unsupported";
      }
      const pending = this.publish(record, true);
      if (!this.options.process) return "pending";
      const embeddings = this.options.config().embeddings;
      const result = await this.options.process({
        embeddings,
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
      if (JSON.stringify(embeddings) !== JSON.stringify(this.options.config().embeddings)) {
        this.request();
        return "pending";
      }
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
        result.status === "indexed" ? result.derived : undefined,
      );
      return result.status;
    } catch (error) {
      if (this.closed) return "pending";
      // A lost indexer process is retried by the next reconciliation (TASK-f09609fd).
      const lost = error as { retry?: unknown; crashed?: unknown } | null;
      if (lost?.crashed === true && record.sha256) {
        const key = `${path}\n${record.sha256}`;
        const count = (this.crashes.get(key) ?? 0) + 1;
        this.crashes.set(key, count);
        if (count >= 2) {
          this.publish({ ...record, status: "failed", error: "PROCESSING" }, true);
          return "failed";
        }
      }
      if (missing(error) || lost?.retry === true) {
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
      this.cancelReady();
      await this.watcherUpdates;
      await this.watcher.close();
      await this.queue.drain();
    })();
    return this.closePromise;
  }
}
