import { lstatSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  type DocumentGuard,
  type DocumentKind,
  type DocumentReason,
  type DocumentRecord,
  type DocumentVolume,
  type EmbeddingModelId,
  veraError,
  type WorkbenchConfig,
  type WorkbenchEvent,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { type FSWatcher, watch } from "chokidar";
import picomatch from "picomatch";
import type { DocumentDerived } from "../storage/repos/documents.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import {
  beginEmbeddingRebuild,
  finishEmbeddingRebuild,
  rebuildingEmbeddings,
} from "../storage/repos/embedding-rebuild.js";
import { createIgnoreRules } from "../workbench/ignore.js";
import { PathGuard } from "../workbench/path-guard.js";
import { WriteQueue } from "../workbench/write-queue.js";
import { pruneExtractionCache } from "./cache-prune.js";
import type { Chunk } from "./chunk.js";
import type { Extraction } from "./extraction.js";
import { documentGuard } from "./guard.js";
import { type InspectInput, inspectSource, type SourceInspection } from "./inspect.js";
import { documentKind, documentSelection, missing, sizeLimit } from "./kinds.js";
import {
  ordinaryFile,
  portablePath,
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
  extraction?: Extraction;
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
  modelId?(model: EmbeddingModelId): string;
  release?(root: string): Promise<void>;
  /** Document selection; the desktop app runs it in its indexer process (TASK-f09609fd). */
  select?(input: SelectInput): Promise<Selection>;
  /** Source hashing; the desktop app runs it in its indexer process (TASK-f09609fd). */
  inspect?(input: InspectInput): Promise<SourceInspection>;
};
/** Live selection phase, scoped by WorkbenchService to the workbench that owns the ingester. */
export type DocumentIndexPhase =
  | "scanning"
  | "indexing"
  | "settled"
  | "settled-with-exceptions"
  | "blocked"
  | "read-only"
  | "unknown";

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
  // The .gitignore files in the folders above each target apply to it; the ones inside a target
  // are watched with it.
  const gitignores = docs.gitignore ? [join(root, ".gitignore")] : [];
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
      if (docs.gitignore) gitignores.push(join(ancestor, ".gitignore"));
    }
    return join(root, ...parts);
  });
  return [
    ...new Set([
      ...roots,
      ...gitignores,
      join(root, ".vera/workbench.yaml"),
      join(root, ".vera/.veraignore"),
    ]),
  ].sort();
}
const isGitignore = (rel: string) => rel === ".gitignore" || rel.endsWith("/.gitignore");
/** The coarsest file time step in use (FAT): closer than this, two writes can share one time. */
const RACY_MS = 2000;

/** One serial ingest queue owned by one writable workbench, independent of session writes. */
export class Ingester {
  private readonly rows: DocumentsRepository;
  private readonly queue = new WriteQueue();
  private readonly publications = new WriteQueue();
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
  private reindexRuns = 0;
  private passPhase: DocumentIndexPhase = "scanning";
  private closePromise: Promise<void> | undefined;
  private ignored = createIgnoreRules();
  private ignoreText = "";
  /** Counts .gitignore edits, so the watcher registers the folders an edit lets back in. */
  private gitignoreEdits = 0;
  private patterns = "";
  private matches = (_path: string) => false;
  private excluded = (_path: string) => false;
  private selectedVolume: DocumentVolume | null = null;
  private selectedGuard: DocumentGuard | null = null;
  /** Indexer crashes per document content while it was processed (RULING-006). */
  private readonly crashes = new Map<string, number>();
  /**
   * Document content processed since this workbench opened. A failure stored by an earlier open
   * gets one more try, so a transient one (worker crash, deadline on a busy machine) heals itself.
   */
  private readonly attempted = new Set<string>();
  /**
   * True for a folder the walk and the watcher must not enter, or a file that is no document:
   * neither is listed further, opened or recorded (TASK-e5310cdb).
   */
  private skipped(rel: string, directory: boolean): boolean {
    return skipEntry(rel, directory, this.ignored, this.excluded);
  }
  private refreshPolicy(): void {
    const docs = this.options.config().docs;
    const policy = readIgnorePolicy(this.options.root, docs.gitignore);
    this.ignoreText = policy.text;
    this.ignored = policy.ignored;
    const key = JSON.stringify([docs.include, docs.exclude, docs.gitignore]);
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
    this.syncIndexingConfig(false);
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
        if (this.options.config().docs.gitignore && isGitignore(rel) && !stats?.isDirectory())
          return this.ignored(rel);
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
      } else if (this.options.config().docs.gitignore && isGitignore(rel) && !this.ignored(rel)) {
        this.gitignoreEdits++;
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
    // A root can appear after Chokidar's initial stat but before its parent listener is ready.
    // Its ready reconciliation then sees files without having registered their change listeners.
    // Rebinding when target kinds change closes that gap through the existing readiness queue.
    const roots = targets.map((target) => {
      try {
        const info = lstatSync(target);
        return [target, info.isSymbolicLink() ? "link" : info.isDirectory() ? "directory" : "file"];
      } catch {
        return [target, "missing"];
      }
    });
    return JSON.stringify([roots, this.ignoreText, this.patterns, this.gitignoreEdits]);
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
    if (this.patterns !== JSON.stringify([docs.include, docs.exclude, docs.gitignore])) this.refreshPolicy();
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
        // A missing root can appear after the ready event, while this debounce is pending.
        // Register it and await that generation before publishing rows from its first scan.
        this.refreshWatcher();
        await this.waitForWatcher();
        await this.runPass(false);
      } catch {
        this.passPhase = "blocked";
        this.emit({ type: "index.progress", pending: 0, done: 0, failed: 1 });
      } finally {
        this.active = false;
        if (this.requested && !this.timer) this.request();
      }
    });
  }
  /** Keep the indexed document count stable during confirmation validation and saving. */
  withStableDocuments<T>(action: () => Promise<T>): Promise<T> {
    return this.publications.run(action);
  }

  /** Discard this workbench's old vectors and admit replacement work in the background. */
  embeddingModelChanged(): void {
    try {
      this.mutation(() => {
        beginEmbeddingRebuild(this.options.db);
        this.saveIndexingConfig(JSON.stringify(this.options.config().embeddings));
      });
    } finally {
      this.request();
    }
  }

  private saveIndexingConfig(fingerprint: string): void {
    this.options.db
      .prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('indexing_config',?)")
      .run(fingerprint);
  }

  private syncIndexingConfig(resetChunks: boolean): void {
    const settings = this.options.config().embeddings;
    const fingerprint = JSON.stringify(settings);
    const previous = this.options.db
      .prepare("SELECT value FROM meta WHERE key='indexing_config'")
      .pluck()
      .get();
    if (previous === fingerprint) return;
    const changedModel = typeof previous === "string" && JSON.parse(previous).model !== settings.model;
    if (!changedModel && !resetChunks) return;
    this.mutation(() => {
      if (changedModel) beginEmbeddingRebuild(this.options.db);
      else if (previous !== undefined) for (const row of this.rows.list()) this.rows.remove(row.path);
      this.saveIndexingConfig(fingerprint);
    });
  }

  /** Explicit reindex executes in the same queue as background batches. */
  reindex(): Promise<void> {
    if (this.closed) return Promise.reject(veraError("DENIED"));
    this.reindexRuns++;
    return this.queue.run(async () => {
      try {
        await this.runPass(true);
      } finally {
        this.reindexRuns--;
      }
    });
  }

  /** Initial watcher readiness and queued reconciliation are unsettled selection states. */
  phase(): DocumentIndexPhase {
    if (this.closed) return "unknown";
    if (this.passPhase === "indexing") return "indexing";
    return this.requested || this.reindexRuns > 0 || this.active ? "scanning" : this.passPhase;
  }

  private async runPass(clear: boolean): Promise<void> {
    this.passPhase = "scanning";
    try {
      // Select before a full reindex so an unavailable indexer or guard leaves the old index intact.
      await this.reconcile(clear ? await this.selected() : undefined, clear);
    } catch (error) {
      this.passPhase = "blocked";
      throw error;
    }
  }

  /**
   * "Index anyway": stores the approved selection count in the workbench database, where it
   * survives Reindex, and reconciles again (TASK-4321c06b).
   */
  approve(files: number): void {
    this.mutation(() => {
      this.options.db
        .prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('index_approved_files',?)")
        .run(String(files));
    });
    this.request();
  }
  /** The count approved with "Index anyway"; null without an approval. */
  approved(): number | null {
    const value = this.options.db
      .prepare("SELECT value FROM meta WHERE key='index_approved_files'")
      .pluck()
      .get();
    const files = Number(value);
    return typeof value === "string" && Number.isSafeInteger(files) && files > 0 ? files : null;
  }
  /** The count guard of the last selection; null when it was indexed or before the first one. */
  guard(): DocumentGuard | null {
    return this.selectedGuard && structuredClone(this.selectedGuard);
  }
  private async waitForWatcher(): Promise<void> {
    while (!this.closed) {
      const updates = this.watcherUpdates;
      await updates;
      const ready = this.ready;
      await ready;
      if (updates === this.watcherUpdates && ready === this.ready) break;
    }
  }
  async waitIdle(): Promise<void> {
    await this.waitForWatcher();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.schedule();
    }
    await this.queue.drain();
  }
  /** The selected paths and the skipped ones; the volume counts only what gets indexed. */
  private async selected(): Promise<{ guard: PathGuard; paths: string[]; skipped: string[]; bytes: number }> {
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
      skipped: selection.skipped.map((entry) => entry.path),
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
  private async reconcile(
    selection?: Awaited<ReturnType<Ingester["selected"]>>,
    clear = false,
  ): Promise<void> {
    this.options.assertWritable();
    await this.publications.run(async () => {
      if (!this.closed) this.syncIndexingConfig(false);
    });
    const { guard, paths, skipped, bytes } = selection ?? (await this.selected());
    if (this.closed) return;
    this.selectedVolume = { files: paths.length, bytes };
    this.emit({ type: "index.volume", files: paths.length, bytes });
    // Above the file limit nothing is indexed, changed or removed until the user decides; the
    // selection is never cut to an arbitrary first part (TASK-4321c06b).
    this.selectedGuard = documentGuard(paths, this.options.config().docs.maxFiles, this.approved());
    this.emit({ type: "index.guard", guard: this.selectedGuard });
    if (this.selectedGuard) {
      this.passPhase = "blocked";
      return;
    }
    this.passPhase = "indexing";
    // Skipped documents keep a row, so the Files tab shows them with their reason.
    const selected = new Set([...paths, ...skipped]);
    await this.publications.run(async () => {
      if (this.closed) return;
      const removed = this.rows.list().filter((row) => clear || !selected.has(row.path));
      this.mutation(() => {
        for (const row of removed) this.rows.remove(row.path);
      });
      for (const row of removed) this.emit({ type: "index.document", path: row.path, document: null });
      this.syncIndexingConfig(true);
    });
    let pending = selected.size,
      done = 0,
      failed = 0,
      incomplete = false,
      exceptions = false;
    const progress = () => this.emit({ type: "index.progress", pending, done, failed });
    progress();
    for (const path of [...selected].sort()) {
      if (this.closed) return;
      const status = await this.ingest(guard, path);
      if (status === "failed") failed++;
      else done++;
      incomplete ||= status === "pending";
      exceptions ||= status !== "indexed";
      pending--;
      progress();
    }
    await this.publications.run(async () => {
      if (!this.closed && rebuildingEmbeddings(this.options.db))
        this.mutation(() => finishEmbeddingRebuild(this.options.db));
    });
    // A quiet moment: every selected document has its row and no further run is queued.
    if (!this.closed && !this.requested) await this.pruneCache();
    this.passPhase = incomplete ? "blocked" : exceptions ? "settled-with-exceptions" : "settled";
  }
  /** Drops cached extractions that no stored document refers to; a failure only leaves files behind. */
  private async pruneCache(): Promise<void> {
    try {
      this.options.assertWritable();
      const hashes = this.options.db
        .prepare("SELECT sha256 FROM documents WHERE sha256 IS NOT NULL")
        .pluck()
        .all() as string[];
      await pruneExtractionCache(this.options.root, new Set(hashes));
    } catch {
      /* the cache only saves a repeated extraction */
    }
  }
  private publish(
    record: Omit<DocumentRecord, "id">,
    invalidate = false,
    chunks?: Chunk[],
    derived?: DocumentDerived,
  ): DocumentRecord {
    const valid = chunks && this.rows.validateChunks(chunks, derived);
    const row = this.mutation(() => {
      const old = this.rows.get(record.path);
      if (invalidate && old) this.rows.clearDerived(old.id);
      const saved = this.rows.save(record);
      if (valid) this.rows.writeChunks(saved.id, valid);
      return saved;
    });
    this.emit({ type: "index.document", path: row.path, document: row });
    return row;
  }
  private publishStatus(record: Omit<DocumentRecord, "id">): Promise<DocumentRecord> {
    return this.publications.run(async () => this.publish(record, true));
  }

  /** Whether the unchanged document lacks vectors for a model the processor can identify. */
  private needsEmbedding(doc: DocumentRecord): boolean {
    const model = this.options.config().embeddings.model;
    let modelId: string | undefined;
    try {
      modelId = this.options.process?.modelId?.(model);
    } catch {
      // Keep the existing index. An explicit rebuild still reports the unavailable model in progress.
    }
    const db = this.options.db;
    if (!modelId && !rebuildingEmbeddings(db)) return false;
    return (
      db.prepare("SELECT count(*) FROM chunks WHERE doc_id=?").pluck().get(doc.id) !==
      db
        .prepare(
          "SELECT count(*) FROM embeddings e JOIN chunks c ON c.id=e.chunk_id WHERE c.doc_id=? AND e.model_id=?",
        )
        .pluck()
        .get(doc.id, modelId ?? null)
    );
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
    // The path guard refuses this name on every platform; the row says why and the file is not opened.
    if (!portablePath(path)) {
      if (old?.status !== "unsupported" || old.error !== "NAME_UNSUPPORTED")
        await this.publishStatus({ ...record, status: "unsupported", error: "NAME_UNSUPPORTED" });
      return "unsupported";
    }
    let retainIndex = false;
    let preserveOnInspectionFailure = false;
    let attemptedSettings = this.options.config().embeddings;
    const attemptKey = (hash: string) => JSON.stringify([path, hash, attemptedSettings]);
    try {
      const target = await this.ordinary(guard, path);
      const before = await lstat(target.absolute);
      record = { ...record, bytes: before.size, mtime: before.mtime.toISOString() };
      preserveOnInspectionFailure =
        old?.status === "indexed" &&
        old.kind === kind &&
        old.bytes === record.bytes &&
        old.mtime === record.mtime;
      if (before.size > sizeLimit(kind, this.options.config().docs)) {
        if (
          old?.status !== "unsupported" ||
          old.error !== "SIZE_LIMIT" ||
          old.bytes !== before.size ||
          old.mtime !== record.mtime
        )
          await this.publishStatus({ ...record, status: "unsupported", error: "SIZE_LIMIT" });
        return "unsupported";
      }
      // Selection admits documents only; a stray other path is recorded without being read.
      if (kind === "other") {
        await this.publishStatus({ ...record, status: "unsupported", error: "TYPE_UNSUPPORTED" });
        return "unsupported";
      }
      // An indexed file with the same size and time is not read again. A time too close to the
      // indexing could hide a second write of the same size, so that file is read.
      if (
        old?.status === "indexed" &&
        old.kind === kind &&
        old.bytes === before.size &&
        old.mtime === record.mtime &&
        old.indexedAt !== null &&
        Date.parse(old.indexedAt) - before.mtimeMs > RACY_MS &&
        !this.needsEmbedding(old)
      )
        return "indexed";
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
      const unchanged = old?.sha256 === record.sha256 && old.kind === kind;
      preserveOnInspectionFailure = false;
      retainIndex = unchanged && old.status === "indexed" && this.needsEmbedding(old);
      attemptedSettings = this.options.config().embeddings;
      // A document that crashed the indexer twice stays failed until its content changes.
      if ((this.crashes.get(attemptKey(record.sha256)) ?? 0) >= 2) {
        if (!retainIndex && (old?.status !== "failed" || old.sha256 !== record.sha256))
          await this.publishStatus({ ...record, status: "failed", error: "PROCESSING" });
        return "failed";
      }
      // Unchanged content keeps its result. That includes a failure, once it was tried since the
      // workbench opened: after that it waits for a content change or Reindex, which clears the rows.
      const attempt = attemptKey(record.sha256);
      if (
        unchanged &&
        !(old.status === "pending" && this.options.process) &&
        !retainIndex &&
        !(old.status === "failed" && !this.attempted.has(attempt))
      )
        return old.status;
      if (inspection.binary) {
        await this.publishStatus({ ...record, status: "unsupported", error: "BINARY" });
        return "unsupported";
      }
      const pending = retainIndex && old ? old : await this.publishStatus(record);
      if (!this.options.process) return "pending";
      const extraction = retainIndex ? this.rows.extraction(pending.id) : undefined;
      const embeddings = this.options.config().embeddings;
      attemptedSettings = embeddings;
      this.attempted.add(attemptKey(record.sha256));
      const result = await this.options.process({
        embeddings,
        root: this.options.root,
        path,
        kind,
        sha256: record.sha256,
        ...(extraction ? { extraction } : {}),
        signal: this.abort.signal,
        assertWritable: () => {
          if (this.closed) throw veraError("DENIED");
          this.options.assertWritable();
        },
      });
      return await this.publications.run(async () => {
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
        if (this.closed) return "pending";
        if (
          JSON.stringify(embeddings) !== JSON.stringify(this.options.config().embeddings) ||
          this.rows.get(path)?.sha256 !== pending.sha256
        ) {
          this.request();
          return "pending";
        }
        if (retainIndex) {
          if (
            result.status !== "indexed" ||
            !result.chunks ||
            (result.chunks.length > 0 && !result.derived?.vectors)
          )
            return "failed";
          const valid = this.rows.validateChunks(result.chunks, result.derived);
          this.mutation(() => this.rows.replaceEmbeddings(pending.id, valid));
          return "indexed";
        }
        this.publish(
          {
            ...record,
            status: result.status,
            pages: result.pages ?? null,
            error:
              result.reason ??
              (result.status === "needs_ocr"
                ? "NEEDS_OCR"
                : result.status === "failed"
                  ? "PROCESSING"
                  : null),
            indexedAt: result.status === "indexed" ? this.options.now().toISOString() : null,
          },
          false,
          result.status === "indexed" ? result.chunks : [],
          result.status === "indexed" ? result.derived : undefined,
        );
        return result.status;
      });
    } catch (error) {
      return this.publications.run(async () => {
        if (this.closed) return "pending";
        if (JSON.stringify(attemptedSettings) !== JSON.stringify(this.options.config().embeddings)) {
          this.request();
          return "pending";
        }
        // A lost indexer process is retried by the next reconciliation (TASK-f09609fd).
        const lost = error as { retry?: unknown; crashed?: unknown } | null;
        const preserve =
          retainIndex || (preserveOnInspectionFailure && rebuildingEmbeddings(this.options.db));
        const crashHash = record.sha256 ?? (preserve ? old?.sha256 : undefined);
        if (lost?.crashed === true && crashHash) {
          const key = attemptKey(crashHash);
          const count = (this.crashes.get(key) ?? 0) + 1;
          this.crashes.set(key, count);
          if (count >= 2) {
            if (!preserve) this.publish({ ...record, status: "failed", error: "PROCESSING" }, true);
            return "failed";
          }
        }
        if (missing(error) || lost?.retry === true) {
          this.request();
          return "pending";
        }
        if (!preserve)
          this.publish({ ...record, status: "failed", error: record.sha256 ? "PROCESSING" : "IO" }, true);
        return "failed";
      });
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
