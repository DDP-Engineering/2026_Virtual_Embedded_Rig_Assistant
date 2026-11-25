import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import {
  additionalFolderSchema,
  additionalFoldersSchema,
  binaryDocumentKinds,
  builtinToolNames,
  commandPrefixIdsSchema,
  commandPrefixListSchema,
  commandPrefixSchema,
  configWarnings,
  type DocumentGuard,
  type DocumentIndexStatus,
  type DocumentPreview,
  type DocumentScan,
  type DocumentVolume,
  delegatedSessionToolNames,
  type EmbeddingSwitchApproval,
  embeddingSwitchApprovalSchema,
  isDocumentKindIn,
  mergeWorkbench,
  moveRecentWorkbench,
  pagedDocumentKinds,
  parseRef,
  type RecentWorkbenchState,
  resolveAdvanced,
  SKILL_BYTES,
  type SkillSource,
  sectionDocumentKinds,
  skillNameSchema,
  skillTemplate,
  veraError,
  viewerExtensionKind,
  type WorkbenchConfig,
  type WorkbenchCreate,
  type WorkbenchEvent,
  type WorkbenchInspection,
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
import { type DocumentIndexPhase, type DocumentProcessor, Ingester } from "../knowledge/ingest.js";
import { selectionDocs } from "../knowledge/kinds.js";
import { DocumentKnowledge } from "../knowledge/search.js";
import { readGitignores } from "../knowledge/selection.js";
import { DocumentViewer } from "../knowledge/viewer.js";
import { type LoadedPlugin, PluginStore } from "../plugins/store.js";
import type { WorkbenchHost } from "../ports.js";
import { SkillCatalog } from "../skills/catalog.js";
import { openDb, type WorkbenchDatabase } from "../storage/db.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { browserToolNames } from "../tools/browser.js";
import { PREVIEW_TIME_LIMIT_MS, previewDocuments, relativeFolder, scanDocuments } from "./documents-scan.js";
import { acquireGuard } from "./guard.js";
import { createIgnoreRules } from "./ignore.js";
import { readBytes } from "./read-bytes.js";
import { workbenchStorageBytes } from "./storage-size.js";
import { FIND_WALK_LIMIT, findFiles, listFolder, locateEntry, readText, statEntry } from "./tree.js";
import { WriteQueue } from "./write-queue.js";

/** Checks a staged open before it can replace the active workbench or update recents. */
export type WorkbenchOpenGuard = (snapshot: WorkbenchSnapshot, db: Database.Database | undefined) => void;

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
const folderId = (path: string) => createHash("sha256").update(`folder\0${path}`).digest("hex");
const commandPrefixId = (prefix: string) => createHash("sha256").update(prefix).digest("hex");

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
// A foreground switch may replace the WorkbenchService with a different runtime.
let nextIndexLease = 0;

export class WorkbenchService {
  private readonly folderSelections = new Map<string, string>();
  private state: WorkbenchSnapshot | undefined;
  private owned: { folder: string; token: string } | undefined;
  private database: WorkbenchDatabase | undefined;
  private ingest: Ingester | undefined;
  private indexRevision = 0;
  private documentIndexerStopped = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly writes = new WriteQueue();
  getWriteQueue(): WriteQueue {
    this.current();
    return this.writes;
  }
  skillCatalog(id: string): SkillCatalog {
    const state = this.current();
    const token = this.owned?.token,
      database = this.database;
    if (id !== state.config.id) throw veraError("CONFLICT");
    return new SkillCatalog({
      root: state.folder,
      ...(this.host.userData ? { userData: this.host.userData } : {}),
      disabled: () => this.current().config.skills.disabled,
      plugins: async () =>
        (await this.loadPlugins(id)).map((plugin) => ({ id: plugin.manifest.id, folder: plugin.folder })),
      refresh: async () => {
        const config = await this.config(state.folder);
        if (
          config.id !== id ||
          this.current().folder !== state.folder ||
          this.owned?.token !== token ||
          this.database !== database
        )
          throw veraError("CONFLICT");
        this.state = { ...this.current(), config };
      },
      assertCurrent: () => {
        if (
          this.current().config.id !== id ||
          this.current().folder !== state.folder ||
          this.owned?.token !== token ||
          this.database !== database
        )
          throw veraError("CONFLICT");
        if (!state.readOnly) this.assertSessionWritable();
      },
    });
  }
  listSkills(id: string) {
    return this.run(() => this.skillCatalog(id).list());
  }
  private async warnings(config: WorkbenchConfig, root: string) {
    const skills = await new SkillCatalog({
      root,
      ...(this.host.userData ? { userData: this.host.userData } : {}),
      disabled: () => config.skills.disabled,
      plugins: async () =>
        (await this.loadEnabled(config.plugins.enabled, root)).map((plugin) => ({
          id: plugin.manifest.id,
          folder: plugin.folder,
        })),
    }).names();
    return configWarnings(config, {
      skills: [...skills, ...(this.host.catalogs?.skills ?? [])],
      tools: this.host.catalogs?.tools ?? [
        ...builtinToolNames,
        ...delegatedSessionToolNames,
        ...browserToolNames,
      ],
      plugins: this.host.userData
        ? await new PluginStore({ root: join(this.host.userData, "plugins"), workbench: root }).ids()
        : [],
    });
  }
  /**
   * The enabled plugins of the open workbench that load: installed, issue-free and unchanged since
   * review, in plugins.enabled order. Others never load and are skipped.
   */
  async loadPlugins(id: string): Promise<LoadedPlugin[]> {
    return this.loadEnabled(this.enabledPlugins(id), this.current().folder);
  }
  private async loadEnabled(ids: readonly string[], folder: string): Promise<LoadedPlugin[]> {
    if (!this.host.userData || ids.length === 0) return [];
    const store = new PluginStore({ root: join(this.host.userData, "plugins"), workbench: folder });
    const loaded: LoadedPlugin[] = [];
    for (const plugin of ids)
      try {
        loaded.push(await store.load(plugin));
      } catch {
        // Not installed, invalid or changed since review: the plugin stays unavailable.
      }
    return loaded;
  }
  /** Plugins enabled in the current configuration of the open workbench. */
  enabledPlugins(id: string): string[] {
    const state = this.current();
    if (state.config.id !== id) throw veraError("CONFLICT");
    return [...state.config.plugins.enabled];
  }
  /** Plugin enablement is opt-in and stored per workbench in plugins.enabled. */
  togglePlugin(id: string, plugin: string, enabled: boolean) {
    return this.run(() =>
      this.writes.run(async () => {
        const state = await this.writable();
        if (state.config.id !== id) throw veraError("CONFLICT");
        const current = await this.config(state.folder);
        if (current.id !== id) throw veraError("CONFLICT");
        const kept = current.plugins.enabled.filter((item) => item !== plugin);
        const list = !enabled
          ? kept
          : kept.length < current.plugins.enabled.length
            ? current.plugins.enabled
            : [...kept, plugin];
        const config = mergeWorkbench(current, { plugins: { enabled: list } });
        this.assertSessionWritable();
        await this.host.files.writeAtomic(join(state.folder, ".vera/workbench.yaml"), stringify(config));
        this.assertSessionWritable();
        const warnings = await this.warnings(config, state.folder);
        this.state = { ...state, config, warnings };
        this.emit(id, { type: "config.changed", config, warnings });
        return {};
      }),
    );
  }
  toggleSkill(id: string, name: string, enabled: boolean) {
    return this.run(() =>
      this.writes.run(async () => {
        const state = await this.writable();
        if (state.config.id !== id) throw veraError("CONFLICT");
        const current = await this.config(state.folder);
        if (current.id !== id) throw veraError("CONFLICT");
        const disabled = current.skills.disabled.filter((item) => item !== name);
        if (!enabled) disabled.push(name);
        const config = mergeWorkbench(current, { skills: { disabled } });
        this.assertSessionWritable();
        await this.host.files.writeAtomic(join(state.folder, ".vera/workbench.yaml"), stringify(config));
        this.assertSessionWritable();
        const warnings = await this.warnings(config, state.folder);
        this.state = { ...state, config, warnings };
        this.emit(id, { type: "config.changed", config, warnings });
        return {};
      }),
    );
  }
  openSkill(id: string, source: SkillSource, name: string) {
    return this.run(() => this.skillCatalog(id).read(source, name));
  }
  saveSkill(id: string, source: SkillSource, name: string, content?: string, sha256?: string) {
    return this.run(() =>
      this.writes.run(async () => {
        const catalog = this.skillCatalog(id);
        const state = await this.writable();
        catalog.check();
        if (state.config.id !== id) throw veraError("CONFLICT");
        const creating = content === undefined;
        if (creating) skillNameSchema.parse(name);
        const text = content ?? skillTemplate(name);
        if (Buffer.byteLength(text, "utf8") > SKILL_BYTES) throw veraError("INVALID");
        let target = await catalog.path(source, name);
        if (creating) {
          await mkdir(dirname(target), { recursive: true });
          catalog.check();
          target = await catalog.path(source, name);
          catalog.check();
        } else {
          const current = await catalog.read(source, name);
          if (current.sha256 !== sha256) throw veraError("CONFLICT");
          catalog.check();
          target = await catalog.path(source, name);
          catalog.check();
        }
        // Prepare bytes first, then repeat ownership/path/hash admission at publication.
        const temporaryName = `.skill-${randomUUID()}.tmp`;
        const temporary = await catalog.path(source, name, temporaryName);
        let prepared = false;
        try {
          const handle = await open(temporary, "wx", 0o600);
          prepared = true;
          try {
            await handle.writeFile(text, "utf8");
            if (!creating) await handle.chmod((await lstat(target)).mode & 0o777);
            await handle.sync();
          } finally {
            await handle.close();
          }
          catalog.check();
          target = await catalog.path(source, name);
          if (!creating && (await catalog.read(source, name)).sha256 !== sha256) throw veraError("CONFLICT");
          if ((await catalog.path(source, name, temporaryName)) !== temporary) throw veraError("DENIED");
          catalog.check();
          if (creating) {
            try {
              await link(temporary, target);
            } catch (error) {
              if (code(error) === "EEXIST") throw veraError("CONFLICT");
              throw error;
            }
          } else await rename(temporary, target);
        } finally {
          if (prepared) {
            await unlink(temporary).catch((error) =>
              code(error) === "ENOENT" ? undefined : Promise.reject(error),
            );
          }
        }
        catalog.check();
        return catalog.read(source, name);
      }),
    );
  }
  constructor(
    private readonly host: WorkbenchHost,
    private readonly processDocument?: DocumentProcessor,
  ) {}
  private startIngest(): void {
    // A closed database cannot index; a refused close then reports its own error, not this one.
    if (!this.state || this.state.readOnly || !this.database?.db.open || this.ingest) return;
    const state = this.state;
    this.ingest = new Ingester({
      root: state.folder,
      db: this.database.db,
      config: () => this.current().config,
      assertWritable: () => this.assertSessionWritable(),
      now: () => this.host.now(),
      emit: (event) => this.emit(state.config.id, event),
      indexerStopped: this.documentIndexerStopped,
      statusChanged: () => {
        if (this.state?.indexLease !== state.indexLease) return;
        const status = this.documentIndexStatus(state.config.id, state.indexLease);
        this.emit(state.config.id, { type: "index.status", status });
      },
      ...(this.processDocument ? { process: this.processDocument } : {}),
      pauseMs: () =>
        resolveAdvanced("indexingPause", { app: this.host.settings.get().settings.advanced }).value,
    });
  }
  private async stopIngest(): Promise<void> {
    await this.ingest?.close();
    this.ingest = undefined;
    if (this.state) await this.processDocument?.release?.(this.state.folder);
  }
  reindexDocuments(workbenchId?: string): Promise<void> {
    // Admit on the lifecycle queue, then wait outside it so close/switch can abort processing.
    return this.run(async () => {
      if (workbenchId && this.current().config.id !== workbenchId) throw veraError("CONFLICT");
      this.assertSessionWritable();
      if (!this.ingest) throw veraError("NOT_FOUND");
      return { completion: this.ingest.reindex() };
    }).then(({ completion }) => completion);
  }
  /** "Index anyway" for the active workbench's guarded selection of `files` documents. */
  approveDocuments(workbenchId: string, files: number): Promise<void> {
    return this.run(async () => {
      if (this.current().config.id !== workbenchId) throw veraError("CONFLICT");
      this.assertSessionWritable();
      if (!this.ingest) throw veraError("NOT_FOUND");
      this.ingest.approve(files);
    });
  }
  /** Serialize reads against workbench close/switch, rechecking identity and current ownership. */
  readDocuments<T>(id: string, read: (root: string, db: Database.Database) => Promise<T>): Promise<T> {
    return this.run(async () => {
      const state = this.current();
      if (state.config.id !== id) throw veraError("CONFLICT");
      if (!state.readOnly) this.assertSessionWritable();
      const value = await read(state.folder, this.getDatabase());
      if (!state.readOnly) this.assertSessionWritable();
      return value;
    });
  }
  /** One folder of the active workbench for the Docs tree (TASK-66b7d4aa). */
  listFolder(workbenchId: string, path: string) {
    return this.run(async () =>
      listFolder(this.activeFolder(workbenchId), path, this.current().config.docs.gitignore),
    );
  }
  /** Visible files of the active workbench whose path contains the fragment (first 200). */
  findFiles(workbenchId: string, query: string) {
    return this.run(async () =>
      findFiles(this.activeFolder(workbenchId), query, this.current().config.docs.gitignore),
    );
  }
  /** A text file of the active workbench, ignored or not, for the Source tab. */
  readText(workbenchId: string, path: string) {
    return this.run(async () => readText(this.activeFolder(workbenchId), path));
  }
  /** Physical bytes with host-only masking context, always confined to the owning workbench. */
  readBytes(workbenchId: string, path: string, offset: number, length: number) {
    return this.run(async () => readBytes(this.activeFolder(workbenchId), path, offset, length));
  }
  /** Type, size and modified time of a file or folder of the active workbench, ignored or not. */
  statEntry(workbenchId: string, path: string) {
    return this.run(async () => {
      const root = this.activeFolder(workbenchId);
      const properties = await statEntry(root, path);
      let rendered = false;
      if (properties.type === "file" && viewerExtensionKind(extname(path).toLowerCase()) === "rendered") {
        const db = this.getDatabase(),
          doc = new DocumentsRepository(db).get(path);
        const ignored = await this.ignoreRules(root, this.current().config.docs.gitignore);
        rendered =
          !!doc &&
          !ignored(path) &&
          doc.sha256 !== null &&
          doc.bytes === properties.size &&
          doc.mtime === properties.modified &&
          (doc.status === "indexed" || doc.status === "needs_ocr") &&
          (!!db.prepare("SELECT 1 FROM document_extractions WHERE doc_id=?").get(doc.id) ||
            (doc.kind === "pdf" && doc.status === "needs_ocr" && (doc.pages ?? 0) > 0));
      }
      return { ...properties, rendered };
    });
  }
  /** The absolute path and kind of an entry of the active workbench for the Docs tree's OS actions. */
  locateEntry(workbenchId: string, path: string) {
    return this.run(async () => locateEntry(this.activeFolder(workbenchId), path));
  }
  private activeFolder(workbenchId: string): string {
    const state = this.current();
    if (state.config.id !== workbenchId) throw veraError("CONFLICT");
    return state.folder;
  }
  /** Asks the active workbench's ingest to reconcile, for example after the indexer restarted. */
  refreshDocuments(): void {
    this.ingest?.request();
  }
  /** Reflects the host indexer's state in the active lease and resumes reconciliation on restart. */
  setDocumentIndexerStopped(stopped: boolean): void {
    this.documentIndexerStopped = stopped;
    this.ingest?.setIndexerStopped(stopped);
  }

  /** Current indexing state for one active lease, independent of document search. */
  documentIndexStatus(workbenchId: string, indexLease: number): DocumentIndexStatus {
    const state = this.current();
    if (state.config.id !== workbenchId || state.indexLease !== indexLease) throw veraError("CONFLICT");
    return {
      workbenchId,
      indexLease,
      revision: ++this.indexRevision,
      ...(this.ingest?.indexStatus() ?? {
        state: state.readOnly ? "read-only" : this.documentIndexerStopped ? "stopped" : "scanning",
        progress: null,
        searchable: null,
        volume: null,
        guard: null,
      }),
    };
  }

  /** The active workbench's last document selection volume; null before its first selection. */
  documentVolume(workbenchId?: string): DocumentVolume | null {
    if (workbenchId && this.current().config.id !== workbenchId) throw veraError("CONFLICT");
    return this.ingest?.volume() ?? null;
  }
  /** The active workbench's count guard; null when its last selection was indexed. */
  documentGuard(workbenchId?: string): DocumentGuard | null {
    if (workbenchId && this.current().config.id !== workbenchId) throw veraError("CONFLICT");
    return this.ingest?.guard() ?? null;
  }
  listDocuments(id: string) {
    return this.readDocuments(id, async (_root, db) => new DocumentsRepository(db).list());
  }
  /** Live retrieval phase for the active workbench and, when supplied, its exact database lease. */
  documentIndexPhase(id: string, db?: Database.Database): DocumentIndexPhase {
    const state = this.current();
    if (state.config.id !== id || (db !== undefined && this.database?.db !== db)) throw veraError("CONFLICT");
    if (state.readOnly) return "read-only";
    return this.ingest?.phase() ?? "unknown";
  }
  searchDocuments(id: string, query: string, signal: AbortSignal = new AbortController().signal) {
    return this.readDocuments(id, async (root, db) => {
      const listed = resolveAdvanced("docsResults", {
        workbench: this.state?.config.advanced,
        app: this.host.settings.get().settings.advanced,
      }).value;
      const viewer = new DocumentViewer(root, db);
      const knowledge = new DocumentKnowledge(root, db, undefined, undefined, () =>
        this.documentIndexPhase(id, db),
      );
      const { coverage, usage, results } = await knowledge.search(
        { query, mode: "keyword" },
        signal,
        [],
        () => {
          const checked = new Map<string, Awaited<ReturnType<DocumentViewer["currentBounds"]>>>();
          return async (hit, searchSignal) => {
            const ref = parseRef(hit.ref);
            if (!ref || !("path" in ref) || ref.path !== hit.path) return false;
            if (!checked.has(hit.path))
              checked.set(hit.path, await viewer.currentBounds(hit.path, searchSignal));
            const bounds = checked.get(hit.path);
            if (!bounds) return false;
            if (ref.kind === "lines")
              return !isDocumentKindIn(bounds.kind, binaryDocumentKinds) && ref.end <= bounds.lines;
            if (ref.kind === "heading")
              return isDocumentKindIn(bounds.kind, sectionDocumentKinds) && bounds.slugs.has(ref.slug);
            return (
              isDocumentKindIn(bounds.kind, pagedDocumentKinds) &&
              (ref.kind === "page" ? ref.page : ref.end) <= bounds.pages
            );
          };
        },
        listed,
      );
      return {
        coverage,
        usage,
        results: results.map(({ ref, path, snippet, score }) => ({ ref, path, snippet, score })),
      };
    });
  }

  openDocument(id: string, target: string, byPath: boolean) {
    return this.readDocuments(id, (root, db) =>
      byPath ? new DocumentViewer(root, db).openPath(target) : new DocumentViewer(root, db).open(target),
    );
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
    await ordinary(join(folder, ".vera"), true);
    for (const file of [".vera/workbench.yaml", ".vera/WORKBENCH.md", ".vera/.veraignore"])
      await ordinary(join(folder, file), false);
    await ordinary(join(folder, ".vera/skills"), true);
    for (const file of [".gitignore", "lock"]) await ordinary(join(folder, ".vera", file), false);
  }
  private async config(folder: string): Promise<WorkbenchConfig> {
    await ordinary(join(folder, ".vera"), true);
    const path = join(folder, ".vera/workbench.yaml");
    if (!(await ordinary(path, false))) throw veraError("NOT_FOUND");
    const content = await this.host.files.read(path);
    if (content === undefined) throw veraError("NOT_FOUND");
    return parseConfig(content);
  }
  private async prepare(folder: string): Promise<void> {
    await mkdir(join(folder, ".vera"), { recursive: true });
    try {
      await exclusive(
        join(folder, ".vera/.gitignore"),
        "*\n!.gitignore\n!workbench.yaml\n!WORKBENCH.md\n!.veraignore\n!skills/\n!skills/**\n",
      );
    } catch (error) {
      if (code(error) !== "EEXIST") throw error;
    }
  }
  /**
   * The folder's own ignore rules, as ingest applies them, with its .gitignore files when `gitignore`
   * is on; unreadable or redirected rules hide everything.
   */
  private async ignoreRules(folder: string, gitignore = false): Promise<(path: string) => boolean> {
    const git = gitignore ? readGitignores(folder) : undefined;
    try {
      await ordinary(join(folder, ".vera"), true);
      const path = join(folder, ".vera/.veraignore");
      if (!(await ordinary(path, false))) return createIgnoreRules("", git);
      return createIgnoreRules((await this.host.files.read(path)) ?? "", git);
    } catch {
      return () => true;
    }
  }
  // Scans and previews only read directory entries, so they stay outside the lifecycle queue and
  // never hold up create, open or saves.
  /** Documentation folders below a chosen folder; reads directory entries only. */
  async scanDocuments(input: string, gitignore: boolean): Promise<DocumentScan> {
    const folder = await this.folder(input);
    return scanDocuments(folder, await this.ignoreRules(folder, gitignore));
  }
  /**
   * What a documentation selection would index in a chosen folder, counted by the indexer's own
   * selection within PREVIEW_TIME_LIMIT_MS. The active workbench's own folder applies its "Index
   * anyway" approval, as its indexing does.
   */
  async previewDocuments(
    input: string,
    docs: Pick<WorkbenchConfig["docs"], "include" | "exclude" | "gitignore" | "maxFileMB" | "maxFiles">,
  ): Promise<DocumentPreview> {
    const folder = await this.folder(input);
    // Read synchronously, so a workbench closing meanwhile cannot interleave.
    const open = this.state?.folder === folder ? this.state : undefined;
    const approved = open ? (this.ingest?.approved() ?? null) : null;
    // The preview request carries only docs: the open workbench's saved text size applies (RULING-001).
    const selection = selectionDocs({ docs, ...(open ? { advanced: open.config.advanced } : {}) });
    return previewDocuments(folder, selection, {
      signal: AbortSignal.timeout(PREVIEW_TIME_LIMIT_MS),
      approved,
    });
  }
  /** A picked folder as a path relative to a workbench folder; ignored folders are refused. */
  async relativeFolder(rootInput: string, input: string): Promise<string> {
    const root = await this.folder(rootInput);
    const path = await relativeFolder(root, input);
    const ignored = await this.ignoreRules(root);
    if (ignored(path) || ignored(`${path}/`)) throw veraError("DENIED");
    return path;
  }
  /** Reads what creation would start from; never writes to the folder. */
  inspect(input: string): Promise<WorkbenchInspection> {
    return this.run(async () => {
      const folder = await this.folder(input);
      await this.layout(folder);
      const pinned = join(folder, ".vera/WORKBENCH.md");
      const instructions = (await ordinary(pinned, false))
        ? ((await this.host.files.read(pinned)) ?? null)
        : null;
      // Skills are an optional part of the draft: an unreadable catalog must not block creating.
      const skills = await new SkillCatalog({
        root: folder,
        ...(this.host.userData ? { userData: this.host.userData } : {}),
        disabled: () => [],
      })
        .list()
        .catch(() => []);
      return {
        folder,
        name: basename(folder),
        existing: await ordinary(join(folder, ".vera/workbench.yaml"), false),
        instructions,
        skills,
      };
    });
  }
  create(
    input: string,
    name: string,
    initial: Pick<WorkbenchCreate, "config" | "instructions"> = {},
  ): Promise<WorkbenchSnapshot> {
    return this.run(async () => {
      const folder = await this.folder(input);
      await this.layout(folder);
      if (await ordinary(join(folder, ".vera/workbench.yaml"), false)) throw veraError("CONFLICT");
      const defaults = workbenchSchema.parse({
        format: 1,
        id: `wb_${ulid(this.host.now().getTime())}`,
        name,
      });
      const patch = workbenchPatchSchema.omit({ name: true }).safeParse(initial.config ?? {});
      if (!patch.success) throw veraError("INVALID");
      const config = mergeWorkbench(defaults, patch.data);
      await this.prepare(folder);
      try {
        await exclusive(join(folder, ".vera/workbench.yaml"), stringify(config));
      } catch (error) {
        if (code(error) === "EEXIST") throw veraError("CONFLICT");
        throw error;
      }
      await mkdir(join(folder, ".vera/skills"), { recursive: true });
      try {
        await exclusive(
          join(folder, ".vera/WORKBENCH.md"),
          initial.instructions ?? pinnedTemplate(config.name),
        );
      } catch (error) {
        if (code(error) !== "EEXIST") throw error;
      }
      return this.openFolder(folder, input);
    });
  }
  open(input: string, guard?: WorkbenchOpenGuard): Promise<WorkbenchSnapshot> {
    return this.run(async () => this.openFolder(await this.folder(input), input, guard));
  }
  /** The canonical folder that open uses for `input` (INVALID relative, NOT_FOUND missing); reads nothing inside it. */
  locate(input: string): Promise<string> {
    return this.folder(input);
  }
  private async openFolder(
    folder: string,
    input: string,
    guard?: WorkbenchOpenGuard,
  ): Promise<WorkbenchSnapshot> {
    await this.writes.drain();
    const config = await this.config(folder);
    await this.layout(folder);
    const warnings: WorkbenchWarning[] = await this.warnings(config, folder);
    if (isNetworkShare(input)) warnings.push({ code: "NETWORK_SHARE_UNSUPPORTED" });
    const same = this.state?.folder === folder;
    const databasePath = join(folder, ".vera/vera.db");
    if (guard && !existsSync(databasePath)) throw veraError("NOT_FOUND");
    const storageOptions = { workbenchId: config.id, appVersion: this.host.appVersion };
    // An owned database opens in place and is checked before writes; a read-only one is copied first.
    const acquired = await this.acquire(folder, warnings);
    const newlyOwned = acquired.owned !== undefined && acquired.owned !== this.owned;
    const next = { folder, config, warnings, readOnly: acquired.readOnly, indexLease: ++nextIndexLease };
    let database: WorkbenchDatabase | undefined;
    try {
      database =
        same && acquired.owned === this.owned && this.database?.db.open && !acquired.readOnly
          ? this.database
          : !acquired.readOnly || existsSync(databasePath)
            ? await openDb(databasePath, {
                ...storageOptions,
                readOnly: acquired.readOnly,
                existingOnly: guard !== undefined,
              })
            : undefined;
      guard?.(next, database?.db);
      const snapshot = this.host.settings.get();
      // A listed workbench keeps the place the user gave it; a new one goes first.
      const recent = snapshot.settings.recentWorkbenches;
      const index = recent.findIndex((entry) => entry.folder === folder);
      const entry = {
        ...recent[index],
        folder,
        name: config.name,
        id: config.id,
        lastOpened: this.host.now().toISOString(),
      };
      await this.host.settings.update({
        recentWorkbenches:
          index < 0 ? [entry, ...recent] : recent.map((item, at) => (at === index ? entry : item)),
      });
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
  /** Counts local workbench storage without holding the workbench lifecycle queue. */
  async storageSize(id: string): Promise<{ workbenchId: string; bytes: number }> {
    const state = this.current();
    const database = this.database;
    const check = () => {
      const current = this.current();
      if (current.config.id !== id || current.folder !== state.folder || this.database !== database)
        throw veraError("CONFLICT");
    };
    check();
    return { workbenchId: id, bytes: await workbenchStorageBytes(state.folder, check) };
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
  private async refreshConfig(): Promise<WorkbenchConfig> {
    const state = this.current();
    const config = await this.config(state.folder);
    if (config.id !== state.config.id) throw veraError("CONFLICT");
    this.state = { ...state, config };
    return config;
  }
  /** Read current validated configuration without skill/plugin warning discovery. Host-only. */
  readConfig(): Promise<WorkbenchConfig> {
    return this.run(() => this.refreshConfig());
  }
  getConfig(): Promise<WorkbenchSnapshot> {
    return this.run(async () => {
      const config = await this.refreshConfig();
      const state = this.current();
      return { ...state, config, warnings: await this.warnings(config, state.folder) };
    });
  }
  updateConfig(
    patch: WorkbenchPatch,
    expectedId?: string,
    removeCommandPrefixes: readonly string[] = [],
    folders: { add?: readonly string[]; remove?: readonly string[] } = {},
    embeddingSwitch?: EmbeddingSwitchApproval,
  ): Promise<{ config: WorkbenchConfig; warnings: WorkbenchWarning[] }> {
    return this.run(() =>
      this.writes.run(async () => {
        const parsed = workbenchPatchSchema.safeParse(patch);
        const removals = commandPrefixIdsSchema.safeParse(removeCommandPrefixes);
        const added = commandPrefixIdsSchema.safeParse(folders.add ?? []);
        const removed = commandPrefixIdsSchema.safeParse(folders.remove ?? []);
        if (
          !parsed.success ||
          !removals.success ||
          !added.success ||
          !removed.success ||
          ((added.data.length || removed.data.length) &&
            (!expectedId || parsed.data.additional_folders !== undefined)) ||
          (removals.data.length && (!expectedId || parsed.data.agent?.allowed_commands !== undefined))
        )
          throw veraError("INVALID");
        const state = await this.writable();
        if (expectedId !== undefined && state.config.id !== expectedId) throw veraError("CONFLICT");
        const current = await this.config(state.folder);
        if (current.id !== state.config.id) throw veraError("CONFLICT");
        const currentIds = current.agent.allowed_commands.map(commandPrefixId);
        if (removals.data.some((id) => !currentIds.includes(id))) throw veraError("CONFLICT");
        const folderIds = current.additional_folders.map(folderId);
        if (removed.data.some((id) => !folderIds.includes(id))) throw veraError("CONFLICT");
        const selections = added.data.map((id) => this.folderSelections.get(`${expectedId}:${id}`));
        if (selections.some((path) => path === undefined)) throw veraError("CONFLICT");
        const folderPatch =
          added.data.length || removed.data.length
            ? {
                additional_folders: [
                  ...new Set([
                    ...current.additional_folders.filter((path) => !removed.data.includes(folderId(path))),
                    ...(selections as string[]),
                  ]),
                ],
              }
            : {};
        if (
          !additionalFoldersSchema.safeParse(folderPatch.additional_folders ?? current.additional_folders)
            .success
        )
          throw veraError("INVALID");
        const config = mergeWorkbench(
          { ...current, ...folderPatch },
          removals.data.length
            ? {
                ...parsed.data,
                agent: {
                  ...parsed.data.agent,
                  allowed_commands: current.agent.allowed_commands.filter(
                    (prefix) => !removals.data.includes(commandPrefixId(prefix)),
                  ),
                },
              }
            : parsed.data,
        );
        const warnings = await this.warnings(config, state.folder);
        const changingModel = config.embeddings.model !== current.embeddings.model;
        const saveConfig = async () => {
          if (changingModel || embeddingSwitch !== undefined) {
            const confirmation = embeddingSwitchApprovalSchema.safeParse(embeddingSwitch);
            const indexed = this.getDatabase()
              .prepare("SELECT count(*) FROM documents WHERE status='indexed'")
              .pluck()
              .get();
            if (
              !changingModel ||
              !expectedId ||
              !confirmation.success ||
              confirmation.data.from !== current.embeddings.model ||
              confirmation.data.count !== indexed
            )
              throw veraError("CONFLICT");
          }
          if (JSON.stringify(config) !== JSON.stringify(current)) {
            await this.host.files.writeAtomic(join(state.folder, ".vera/workbench.yaml"), stringify(config));
            this.state = { ...state, config, warnings };
            if (changingModel) this.ingest?.embeddingModelChanged();
            else this.ingest?.request();
            this.emit(config.id, { type: "config.changed", config, warnings });
          }
        };
        if (changingModel && this.ingest) await this.ingest.withStableDocuments(saveConfig);
        else await saveConfig();
        const settings = this.host.settings.get();
        await this.host.settings.update({
          recentWorkbenches: settings.settings.recentWorkbenches.map((entry) =>
            entry.folder === state.folder ? { ...entry, name: config.name } : entry,
          ),
        });
        return { config: structuredClone(config), warnings };
      }),
    );
  }
  /** Native user selection is staged as an opaque identity until editor Save. */
  chooseAdditionalFolder(path: string, expectedId: string): Promise<{ id: string; path: string }> {
    return this.run(async () => {
      const state = await this.writable();
      if (state.config.id !== expectedId) throw veraError("CONFLICT");
      if (!additionalFolderSchema.safeParse(path).success || !isAbsolute(path)) throw veraError("INVALID");
      let canonical: string;
      try {
        canonical = await realpath(path);
        if (!(await lstat(canonical)).isDirectory()) throw veraError("INVALID");
      } catch {
        throw veraError("INVALID");
      }
      if (!additionalFolderSchema.safeParse(canonical).success) throw veraError("INVALID");
      const id = folderId(canonical);
      if (this.folderSelections.size >= 64 && !this.folderSelections.has(`${expectedId}:${id}`))
        this.folderSelections.delete(this.folderSelections.keys().next().value as string);
      this.folderSelections.set(`${expectedId}:${id}`, canonical);
      return { id, path: canonical };
    });
  }
  /** Complete grant identities survive credential masking at the presentation boundary. */
  async listAdditionalFolders(expectedId: string): Promise<{ id: string; path: string }[]> {
    const { config } = await this.getConfig();
    if (config.id !== expectedId) throw veraError("CONFLICT");
    return config.additional_folders.map((path) => ({ id: folderId(path), path }));
  }
  /** Complete authoritative grant identities; display masking belongs to the host boundary. */
  async listCommandPrefixes(expectedId: string): Promise<{ id: string; prefix: string }[]> {
    const { config } = await this.getConfig();
    if (config.id !== expectedId) throw veraError("CONFLICT");
    return config.agent.allowed_commands.map((prefix) => ({ id: commandPrefixId(prefix), prefix }));
  }
  /** Add a user-selected prefix without overwriting concurrent configuration changes. */
  allowCommandPrefix(prefix: string, expectedId: string): Promise<void> {
    return this.run(() =>
      this.writes.run(async () => {
        if (!commandPrefixSchema.safeParse(prefix).success) throw veraError("INVALID");
        const state = await this.writable();
        if (state.config.id !== expectedId) throw veraError("CONFLICT");
        const current = await this.config(state.folder);
        const prefixes = commandPrefixListSchema.safeParse([
          ...new Set([...current.agent.allowed_commands, prefix]),
        ]);
        if (!prefixes.success) throw veraError("INVALID");
        const config = mergeWorkbench(current, {
          agent: { allowed_commands: prefixes.data },
        });
        const warnings = await this.warnings(config, state.folder);
        await this.host.files.writeAtomic(join(state.folder, ".vera/workbench.yaml"), stringify(config));
        this.state = { ...state, config, warnings };
        this.emit(config.id, { type: "config.changed", config, warnings });
      }),
    );
  }
  private async pinned(folder: string): Promise<{ content: string; oversized: boolean }> {
    if (!(await ordinary(folder, true))) throw veraError("NOT_FOUND");
    await ordinary(join(folder, ".vera"), true);
    const path = join(folder, ".vera/WORKBENCH.md");
    if (!(await ordinary(path, false))) return { content: "", oversized: false };
    const content = (await this.host.files.read(path)) ?? "";
    return { content, oversized: Buffer.byteLength(content, "utf8") > 16384 };
  }
  getPinned(): Promise<{ content: string; oversized: boolean }> {
    return this.run(() => this.pinned(this.current().folder));
  }
  recent(
    remove?: string,
    pin?: { folder: string; value: boolean },
    move?: { folder: string; offset: -1 | 1 },
  ): Promise<RecentWorkbenchState[]> {
    return this.run(async () => {
      let snapshot = this.host.settings.get();
      if (move !== undefined) {
        snapshot = await this.host.settings.update({
          recentWorkbenches: moveRecentWorkbench(
            snapshot.settings.recentWorkbenches,
            move.folder,
            move.offset,
          ),
        });
      }
      if (pin !== undefined) {
        if (!snapshot.settings.recentWorkbenches.some((entry) => entry.folder === pin.folder))
          throw veraError("NOT_FOUND");
        snapshot = await this.host.settings.update({
          recentWorkbenches: snapshot.settings.recentWorkbenches.map((entry) =>
            entry.folder === pin.folder ? { ...entry, pinned: pin.value } : entry,
          ),
        });
      }
      if (remove !== undefined) {
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
      const path = join(folder, ".vera/.veraignore");
      await ordinary(join(folder, ".vera"), true);
      await ordinary(path, false);
      const ignored = createIgnoreRules((await this.host.files.read(path)) ?? "");
      const paths: string[] = [];
      const needle = query.toLowerCase();
      let visited = 0;
      async function walk(relative: string): Promise<void> {
        if (!(await ordinary(join(folder, relative), true))) return;
        const entries = await readdir(join(folder, relative), { withFileTypes: true });
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
          // The Docs tree's bound: a query with few matches must not walk a huge folder to its end.
          if (paths.length >= 50 || ++visited > FIND_WALK_LIMIT) return;
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
  updatePinned(content: string, expectedId?: string): Promise<{ content: string; oversized: boolean }> {
    return this.run(() =>
      this.writes.run(async () => {
        if (typeof content !== "string") throw veraError("INVALID");
        const state = await this.writable();
        if (expectedId !== undefined && state.config.id !== expectedId) throw veraError("CONFLICT");
        await this.host.files.writeAtomic(join(state.folder, ".vera/WORKBENCH.md"), content);
        return { content, oversized: Buffer.byteLength(content, "utf8") > 16384 };
      }),
    );
  }
  /** The lock's owner; none when there is no lock or it does not parse (a crash can leave it empty). */
  private async lock(folder: string): Promise<{ pid: number; token: string | undefined } | undefined> {
    const path = join(folder, ".vera/lock");
    if (!(await ordinary(path, false))) return undefined;
    const raw = await this.host.files.read(path);
    if (raw === undefined) return undefined;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
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
      return undefined;
    return {
      pid: data.pid,
      token: "token" in data && typeof data.token === "string" ? data.token : undefined,
    };
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
      // Also removes a lock that did not parse, which reads as no owner.
      await rm(join(folder, ".vera/lock"), { force: true });
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
      if (this.owned && (await ordinary(this.owned.folder, true)))
        await ordinary(join(this.owned.folder, ".vera"), true);
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
