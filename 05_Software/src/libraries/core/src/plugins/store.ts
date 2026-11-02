import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  isPluginRelativePath,
  PLUGIN_LIMITS,
  type PluginInstalled,
  type PluginIssue,
  type PluginManifest,
  pluginIdSchema,
  pluginProgramNameSchema,
  pluginTierSchema,
  type VeraError,
  validatePluginManifest,
  veraError,
} from "@vera/shared";
import { unzipSync } from "fflate";
import { LineCounter, parseDocument } from "yaml";
import { z } from "zod";

/** install.json format 1, written next to the package files of an installed plugin. */
export const pluginRecordSchema = z.strictObject({
  format: z.literal(1),
  id: pluginIdSchema,
  version: z.string().min(1).max(128),
  tier: pluginTierSchema,
  source: z.strictObject({ kind: z.enum(["folder", "zip"]), path: z.string().min(1).max(4096) }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  installedAt: z.iso.datetime(),
  programs: z.record(pluginProgramNameSchema, z.string().min(1).max(128)),
});
export type PluginRecord = z.infer<typeof pluginRecordSchema>;
export interface LoadedPlugin {
  manifest: PluginManifest;
  record: PluginRecord;
  folder: string;
}
type Files = Map<string, Uint8Array>;
const RECORD = "install.json";
const MANIFEST = "plugin.yaml";
const RECORD_BYTES = 64 * 1024;
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fails = (code: VeraError["code"]) => veraError(code);
const errno = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
/** Windows refuses to rename a folder while a file in it is open (an editor, a virus scanner). */
const busy = (error: unknown) =>
  ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY", "EEXIST"].includes(errno(error) ?? "") ? fails("BUSY") : error;
/** Opening never follows a link (where the system supports it) and never blocks on a FIFO. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * SHA-256 over every package file in ascending relative path order; each file contributes its
 * `/`-separated path, NUL, its decimal byte length, NUL and its bytes.
 */
export function pluginIntegrity(files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash("sha256");
  for (const path of [...files.keys()].sort(order)) {
    const data = files.get(path) ?? new Uint8Array();
    hash.update(path, "utf8");
    hash.update(`\0${data.length}\0`, "utf8");
    hash.update(data);
  }
  return hash.digest("hex");
}

/** Lowercased names seen so far: case-insensitive file systems make Docs/ and docs/ one folder. */
interface Names {
  files: Set<string>;
  folders: Map<string, string>;
}
const names = (): Names => ({ files: new Set(), folders: new Map() });
/** Adds one file under the import limits, refusing names that collide by case or as file and folder. */
function admit(files: Files, seen: Names, path: string, data: Uint8Array, total: number): number {
  if (!isPluginRelativePath(path)) throw fails("INVALID");
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const folder = parts.slice(0, i).join("/");
    const key = folder.toLowerCase();
    const known = seen.folders.get(key);
    if (seen.files.has(key) || (known !== undefined && known !== folder)) throw fails("INVALID");
    seen.folders.set(key, folder);
  }
  const key = path.toLowerCase();
  if (seen.files.has(key) || seen.folders.has(key) || files.size >= PLUGIN_LIMITS.files)
    throw fails("INVALID");
  const next = total + data.length;
  if (next > PLUGIN_LIMITS.bytes) throw fails("INVALID");
  seen.files.add(key);
  files.set(path, data);
  return next;
}
/** Reads the file lstat saw: a link or another file swapped in after lstat is DENIED. */
async function readSeen(
  path: string,
  seen: Awaited<ReturnType<typeof lstat>>,
  room: number,
): Promise<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if (errno(error) === "ELOOP") throw fails("DENIED");
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== seen.ino || opened.dev !== seen.dev) throw fails("DENIED");
    if (opened.size > room) throw fails("INVALID");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Ordinary files and folders only; a link or any other entry is DENIED. */
async function readFolder(root: string, installed: boolean): Promise<Files> {
  const files: Files = new Map();
  const seen = names();
  let total = 0;
  let scanned = 0;
  const top = await lstat(root);
  if (top.isSymbolicLink() || !top.isDirectory()) throw fails("DENIED");
  const walk = async (relative: string) => {
    for await (const entry of await opendir(relative ? join(root, ...relative.split("/")) : root)) {
      if (++scanned > PLUGIN_LIMITS.files * 2) throw fails("INVALID");
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path === RECORD) {
        if (installed) continue;
        throw fails("INVALID");
      }
      const full = join(root, ...path.split("/"));
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw fails("DENIED");
      if (info.isDirectory()) {
        if (!isPluginRelativePath(path)) throw fails("INVALID");
        await walk(path);
      } else if (info.isFile()) {
        if (total + info.size > PLUGIN_LIMITS.bytes) throw fails("INVALID");
        total = admit(files, seen, path, await readSeen(full, info, PLUGIN_LIMITS.bytes - total), total);
      } else throw fails("DENIED");
    }
  };
  await walk("");
  return files;
}

/**
 * The archive's directory is walked first and refused over the limits; only then is it inflated.
 * The package is either at the root or inside one top folder, which names the package.
 */
function readZip(data: Uint8Array): { files: Files; folder?: string } {
  let count = 0;
  let declared = 0;
  let inflated: Record<string, Uint8Array>;
  try {
    unzipSync(data, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        count++;
        // A stored entry is copied by its compressed size, whatever the directory claims.
        if (file.compression === 0 && file.size !== file.originalSize) throw fails("INVALID");
        declared += Math.max(file.size, file.originalSize);
        if (count > PLUGIN_LIMITS.files || declared > PLUGIN_LIMITS.bytes) throw fails("INVALID");
        if (!isPluginRelativePath(file.name)) throw fails("INVALID");
        return false;
      },
    });
    inflated = unzipSync(data, { filter: (file) => !file.name.endsWith("/") });
  } catch {
    throw fails("INVALID");
  }
  const entries = Object.keys(inflated);
  let strip = "";
  let folder: string | undefined;
  if (!entries.includes(MANIFEST)) {
    const tops = new Set(entries.map((name) => name.split("/")[0]));
    const [top] = tops;
    if (tops.size === 1 && top && entries.every((name) => name.startsWith(`${top}/`))) {
      strip = `${top}/`;
      folder = top;
    }
  }
  const files: Files = new Map();
  const seen = names();
  let total = 0;
  for (const name of entries.sort(order)) {
    const path = name.slice(strip.length);
    if (path === RECORD) throw fails("INVALID");
    total = admit(files, seen, path, inflated[name] ?? new Uint8Array(), total);
  }
  return { files, ...(folder ? { folder } : {}) };
}

/** Manifest issues of a package; the manifest is returned whenever it parses, for listing. */
function examine(
  files: Files,
  folder: string | undefined,
): { manifest?: PluginManifest; issues: PluginIssue[] } {
  const raw = files.get(MANIFEST);
  if (!raw || raw.length > PLUGIN_LIMITS.manifestBytes) return { issues: [{ code: "manifest" }] };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return { issues: [{ code: "manifest" }] };
  }
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  const error = doc.errors[0];
  if (error) return { issues: [{ code: "yaml", line: lines.linePos(error.pos[0]).line }] };
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch {
    return { issues: [{ code: "yaml" }] };
  }
  const { manifest, issues } = validatePluginManifest(data);
  if (!manifest) return { issues };
  if (folder !== undefined && manifest.id !== folder) issues.push({ code: "id", path: "id" });
  for (const [name, program] of Object.entries(manifest.programs))
    if ("script" in program.install && !files.has(program.install.script))
      issues.push({ code: "field", path: `programs.${name}.install.script`, issue: "missing_file" });
  manifest.docs.forEach((doc, index) => {
    if (!/^https?:\/\//.test(doc) && !files.has(doc))
      issues.push({ code: "field", path: `docs.${index}`, issue: "missing_file" });
  });
  return { manifest, issues };
}

async function readRecord(path: string): Promise<PluginRecord | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > RECORD_BYTES) return undefined;
    const parsed = pluginRecordSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Installed plugins under `<root>/installed/<id>/`, each with install.json. Nothing is cached:
 * every list and load re-reads the files and recomputes the integrity hash, so an edit after
 * install shows as "changed" and a restart sees exactly what is on disk.
 */
export class PluginStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly installed: string;
  private readonly staging: string;
  constructor(private readonly options: { root: string; now?: () => Date; uuid?: () => string }) {
    this.installed = join(options.root, "installed");
    this.staging = join(options.root, "staging");
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }
  private uuid() {
    return (this.options.uuid ?? randomUUID)();
  }
  /** Installed folder names, including invalid ones. */
  async ids(): Promise<string[]> {
    try {
      const entries = await readdir(this.installed, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort(order)
        .slice(0, 1024);
    } catch (error) {
      if (errno(error) === "ENOENT") return [];
      throw error;
    }
  }
  private async inspect(id: string) {
    const folder = join(this.installed, id);
    const issues: PluginIssue[] = [];
    const record = await readRecord(join(folder, RECORD));
    if (!record) issues.push({ code: "record" });
    let manifest: PluginManifest | undefined;
    try {
      const files = await readFolder(folder, true);
      if (record && pluginIntegrity(files) !== record.sha256) issues.push({ code: "changed" });
      const examined = examine(files, id);
      manifest = examined.manifest;
      issues.push(...examined.issues);
      if (record && manifest && (record.id !== id || record.version !== manifest.version))
        issues.push({ code: "record" });
    } catch (error) {
      issues.push({ code: (error as VeraError | undefined)?.code === "DENIED" ? "changed" : "unavailable" });
    }
    return { folder, record, manifest, issues: issues.slice(0, PLUGIN_LIMITS.issues) };
  }
  private async summary(id: string): Promise<PluginInstalled> {
    const { record, manifest, issues } = await this.inspect(id);
    return {
      id,
      issues,
      ...(manifest
        ? {
            version: manifest.version,
            name: manifest.name,
            description: manifest.description,
            ecosystem: manifest.ecosystem,
            platforms: manifest.platforms,
          }
        : {}),
      ...(manifest && !issues.length
        ? {
            irreversible: manifest.rules
              .filter((rule) => rule.risk === "irreversible")
              .map(({ match, note }) => (note === undefined ? { match } : { match, note })),
          }
        : {}),
      ...(record
        ? {
            tier: record.tier,
            source: record.source.kind,
            sha256: record.sha256,
            installedAt: record.installedAt,
          }
        : {}),
    };
  }
  /**
   * Reads run outside the install queue: during the rename window of a reinstall a plugin may list as
   * unavailable for a moment, never as valid with mixed files.
   */
  async list(): Promise<PluginInstalled[]> {
    const result: PluginInstalled[] = [];
    for (const id of await this.ids()) result.push(await this.summary(id));
    return result;
  }
  /** The manifest of an installed plugin without any issue; a plugin with issues never loads. */
  async load(id: string): Promise<LoadedPlugin> {
    if (!pluginIdSchema.safeParse(id).success || !(await this.ids()).includes(id)) throw fails("NOT_FOUND");
    const { folder, record, manifest, issues } = await this.inspect(id);
    if (issues.length || !record || !manifest) throw fails("INVALID");
    return { folder, record, manifest };
  }
  /** Installs a folder or a .zip file as a local plugin, replacing an installed one of the same id. */
  install(path: string): Promise<PluginInstalled> {
    return this.serial(async () => {
      const source = resolve(path);
      let info: Awaited<ReturnType<typeof lstat>>;
      try {
        info = await lstat(source);
      } catch (error) {
        if (errno(error) === "ENOENT") throw fails("NOT_FOUND");
        throw error;
      }
      let pkg: { files: Files; folder?: string; kind: "folder" | "zip" };
      if (info.isSymbolicLink()) throw fails("DENIED");
      if (info.isDirectory())
        pkg = { files: await readFolder(source, false), folder: basename(source), kind: "folder" };
      else if (info.isFile() && /\.zip$/i.test(source)) {
        if (info.size > PLUGIN_LIMITS.zipBytes) throw fails("INVALID");
        pkg = { ...readZip(await readFile(source)), kind: "zip" };
      } else throw fails("INVALID");
      const { manifest, issues } = examine(pkg.files, pkg.folder);
      const first = issues[0];
      if (first || !manifest)
        throw {
          ...fails("INVALID"),
          params: { issue: first?.code ?? "manifest", ...(first?.path ? { path: first.path } : {}) },
        };
      const record: PluginRecord = {
        format: 1,
        id: manifest.id,
        version: manifest.version,
        tier: "local",
        source: { kind: pkg.kind, path: source },
        sha256: pluginIntegrity(pkg.files),
        installedAt: (this.options.now?.() ?? new Date()).toISOString(),
        programs: {},
      };
      await mkdir(this.staging, { recursive: true });
      const stage = join(this.staging, this.uuid());
      try {
        for (const [relative, data] of pkg.files) {
          const target = join(stage, ...relative.split("/"));
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, data, { flag: "wx" });
        }
        await writeFile(join(stage, RECORD), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
        await mkdir(this.installed, { recursive: true });
        const target = join(this.installed, manifest.id);
        const previous = join(this.staging, this.uuid());
        let replaced = false;
        try {
          await rename(target, previous);
          replaced = true;
        } catch (error) {
          if (errno(error) !== "ENOENT") throw busy(error);
        }
        try {
          await rename(stage, target);
        } catch (error) {
          if (replaced) await rename(previous, target).catch(() => {});
          throw busy(error);
        }
        // The new version is in place; a leftover old folder in staging is only disk space.
        if (replaced) await rm(previous, { recursive: true, force: true }).catch(() => {});
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
      return this.summary(manifest.id);
    });
  }
  /**
   * Adds program versions to install.json after provisioning, atomically and only while the installed
   * plugin is the one the versions were probed for (its hash); a reinstall in between is CONFLICT.
   */
  recordPrograms(id: string, sha256: string, programs: Readonly<Record<string, string>>): Promise<void> {
    return this.serial(async () => {
      if (!pluginIdSchema.safeParse(id).success || !(await this.ids()).includes(id)) throw fails("NOT_FOUND");
      const path = join(this.installed, id, RECORD);
      const record = await readRecord(path);
      if (!record || record.sha256 !== sha256) throw fails("CONFLICT");
      const next = pluginRecordSchema.parse({ ...record, programs: { ...record.programs, ...programs } });
      // Written beside the plugins, never inside one: a stray file there would fail its integrity hash.
      await mkdir(this.staging, { recursive: true });
      const temporary = join(this.staging, `${this.uuid()}.json`);
      try {
        await writeFile(
          temporary,
          `${JSON.stringify(next, null, 2)}
`,
          { flag: "wx" },
        );
        await rename(temporary, path).catch((error) => {
          throw busy(error);
        });
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  uninstall(id: string): Promise<void> {
    return this.serial(async () => {
      if (!pluginIdSchema.safeParse(id).success || !(await this.ids()).includes(id)) throw fails("NOT_FOUND");
      await mkdir(this.staging, { recursive: true });
      const removed = join(this.staging, this.uuid());
      await rename(join(this.installed, id), removed).catch((error) => {
        throw busy(error);
      });
      await rm(removed, { recursive: true, force: true }).catch(() => {});
    });
  }
}
