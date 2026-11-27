import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SKILL_BYTES, type SkillSource, type SkillSummary, skillNameSchema, veraError } from "@vera/shared";
import { parseDocument } from "yaml";
import { waitForAbort } from "../abort.js";
import { isBinary } from "../tools/binary.js";
import { createIgnoreRules } from "../workbench/ignore.js";
import { PathGuard, validateRelativePath } from "../workbench/path-guard.js";
import { createPluginSkill } from "./create-plugin.js";

const identity = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export function parseSkill(content: string, folder: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!match) throw Error("frontmatter");
  const doc = parseDocument(match[1] ?? "", { uniqueKeys: true });
  if (doc.errors.length) throw Error("frontmatter");
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw Error("frontmatter");
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("name" in data) ||
    !skillNameSchema.safeParse(data.name).success ||
    data.name !== folder
  )
    throw Error("name");
  if (
    !("description" in data) ||
    typeof data.description !== "string" ||
    !data.description.trim() ||
    data.description.length > 1024
  )
    throw Error("description");
  return { name: folder, description: data.description.trim(), body: match[2] ?? "" };
}
/** The installed folder of an enabled plugin whose skills/<name>/SKILL.md folders join the catalog. */
export interface SkillPluginRoot {
  id: string;
  folder: string;
  sha256?: string;
}
type Selection = { source: "plugin"; plugin: SkillPluginRoot } | { source: Exclude<SkillSource, "plugin"> };
const byId = (a: SkillPluginRoot, b: SkillPluginRoot) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/**
 * Separately authorized roots; callers supply names rather than filesystem authority. A name resolves
 * to the workbench skill, else the user skill, else the skill of the enabled plugin with the lowest id.
 */
export class SkillCatalog {
  constructor(
    private readonly options: {
      root: string;
      userData?: string;
      disabled: () => readonly string[];
      assertCurrent?: () => void;
      refresh?: (signal?: AbortSignal) => Promise<void>;
      /** Enabled, issue-free plugins of the workbench. */
      plugins?: (signal?: AbortSignal) => Promise<readonly SkillPluginRoot[]>;
    },
  ) {}
  check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.options.assertCurrent?.();
  }
  root(source: SkillSource): string {
    const root =
      source === "workbench"
        ? join(this.options.root, ".vera")
        : source === "user"
          ? this.options.userData
          : undefined;
    if (!root) throw veraError("DENIED");
    return root;
  }
  private async plugins(signal?: AbortSignal): Promise<SkillPluginRoot[]> {
    this.check(signal);
    return [...(await waitForAbort(this.options.plugins?.(signal) ?? Promise.resolve([]), signal))].sort(
      byId,
    );
  }
  private async refresh(signal?: AbortSignal) {
    this.check(signal);
    if (this.options.refresh) await waitForAbort(this.options.refresh(signal), signal);
    this.check(signal);
  }
  /** The enabled plugin with the lowest id that has a skills/<name> entry. */
  private async pluginOf(name: string, signal?: AbortSignal): Promise<SkillPluginRoot | undefined> {
    for (const plugin of await this.plugins(signal)) {
      this.check(signal);
      try {
        const entry = await lstat(join(plugin.folder, "skills", name));
        if (entry.isDirectory() || entry.isSymbolicLink()) return plugin;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return undefined;
  }
  async path(source: SkillSource, name: string, file = "SKILL.md") {
    return this.selectedPath(await this.selectSource(source, name), name, file);
  }
  private async selectSource(source: SkillSource, name: string, signal?: AbortSignal): Promise<Selection> {
    if (source !== "plugin") return { source };
    if (!name || name === "." || name === ".." || /[\\/:\0]/.test(name)) throw veraError("INVALID");
    validateRelativePath(name);
    const plugin = await this.pluginOf(name, signal);
    if (!plugin) throw veraError("NOT_FOUND");
    return { source, plugin };
  }
  private selectedPath(selected: Selection, name: string, file: string) {
    return this.pathAt(
      selected.source === "plugin" ? selected.plugin.folder : this.root(selected.source),
      name,
      file,
    );
  }
  private async pathAt(base: string, name: string, file: string) {
    if (!name || name === "." || name === ".." || /[\\/:\0]/.test(name)) throw veraError("INVALID");
    validateRelativePath(name);
    const slash = validateRelativePath(file);
    if (slash.split("/").some((p) => !p || p === "." || p === "..")) throw veraError("DENIED");
    const root = resolve(base);
    const parts = ["skills", name, ...slash.split("/")];
    let target = root;
    // The host-chosen root may live behind an OS redirection above it (folder redirection, an MSIX
    // container, a junctioned parent); it is trusted where it resolves. Below it, every segment must
    // resolve to itself, so links inside the skills tree are still refused.
    let canonical = "";
    for (const [i, part] of ["", ...parts].entries()) {
      if (part) target = join(target, part);
      try {
        const stat = await lstat(target);
        const resolved = identity(await realpath(target));
        const expected = part ? identity(join(canonical, part)) : resolved;
        if (
          stat.isSymbolicLink() ||
          resolved !== expected ||
          (i < parts.length ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
        )
          throw veraError("DENIED");
        canonical = resolved;
      } catch (error) {
        if (missing(error)) return join(target, ...parts.slice(i));
        throw error;
      }
    }
    return target;
  }
  async read(source: SkillSource, name: string, file = "SKILL.md", signal?: AbortSignal) {
    this.check(signal);
    return this.readNow(await this.selectSource(source, name, signal), name, file, signal);
  }
  private async readNow(selected: Selection, name: string, file: string, signal?: AbortSignal) {
    this.check(signal);
    if (selected.source === "official") {
      if (name !== createPluginSkill.name || file !== "SKILL.md") throw veraError("NOT_FOUND");
      const content = `---\nname: ${createPluginSkill.name}\ndescription: ${createPluginSkill.description}\n---\n${createPluginSkill.body}`;
      return { content, sha256: createHash("sha256").update(content).digest("hex") };
    }
    const target = await this.selectedPath(selected, name, file);
    this.check(signal);
    const handle = await open(target, "r");
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > SKILL_BYTES) throw veraError("DENIED");
      const bytes = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < bytes.length) {
        this.check(signal);
        const read = await handle.read(bytes, count, bytes.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      const after = await handle.stat();
      const current = await lstat(await this.selectedPath(selected, name, file));
      this.check(signal);
      if (
        count !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        before.ino !== current.ino ||
        before.dev !== current.dev ||
        before.size !== current.size ||
        before.mtimeMs !== current.mtimeMs ||
        before.ctimeMs !== current.ctimeMs
      )
        throw veraError("CONFLICT");
      const contentBytes = bytes.subarray(0, count);
      if (isBinary(contentBytes)) throw veraError("INVALID");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
      return { content, sha256: createHash("sha256").update(contentBytes).digest("hex") };
    } finally {
      await handle.close();
    }
  }
  private async discover(root: string): Promise<string[]> {
    await this.pathAt(root, "placeholder", "SKILL.md");
    const names: string[] = [];
    let scanned = 0;
    try {
      const dir = await opendir(join(root, "skills"));
      for await (const entry of dir) {
        if (++scanned > 4096) throw veraError("INVALID");
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        names.push(entry.name);
        if (names.length > 1024) throw veraError("INVALID");
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }
    this.check();
    return names;
  }
  private async selection() {
    const selected = new Map<string, Selection>([[createPluginSkill.name, { source: "official" }]]);
    for (const plugin of (await this.plugins()).reverse())
      for (const name of await this.discover(plugin.folder)) selected.set(name, { source: "plugin", plugin });
    if (this.options.userData)
      for (const name of await this.discover(this.root("user"))) selected.set(name, { source: "user" });
    for (const name of await this.discover(this.root("workbench")))
      selected.set(name, { source: "workbench" });
    return selected;
  }
  async names() {
    return [...(await this.selection()).keys()];
  }
  private async agentPath(source: SkillSource, name: string, file: string) {
    const relative = `skills/${name}/${validateRelativePath(file)}`;
    if (source === "workbench")
      await (await PathGuard.create(this.root(source), this.options.root)).resolve(relative);
    else {
      const ignored = createIgnoreRules("");
      if (ignored(relative) || ignored(`${relative}/`)) throw veraError("DENIED");
    }
  }
  async list(): Promise<SkillSummary[]> {
    await this.refresh();
    return this.summaries();
  }
  private async summaries(): Promise<SkillSummary[]> {
    const selected = await this.selection();
    const results: SkillSummary[] = [];
    for (const [name, selection] of [...selected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const { source } = selection;
      const base = {
        name,
        source,
        ...(selection.source === "plugin" ? { plugin: selection.plugin.id } : {}),
        description: "",
        enabled: !this.options.disabled().includes(name),
      };
      try {
        const loaded = await this.readNow(selection, name, "SKILL.md");
        const { description } = parseSkill(loaded.content, name);
        await this.agentPath(source, name, "SKILL.md");
        results.push({ ...base, description });
      } catch (error) {
        this.check();
        const message = error instanceof Error ? error.message : "";
        const diagnostic =
          message === "name" || message === "description" || message === "frontmatter"
            ? message
            : "unavailable";
        results.push({ ...base, error: diagnostic });
      }
    }
    await this.refresh();
    return results.map((s) => ({ ...s, enabled: !this.options.disabled().includes(s.name) }));
  }
  async metadata() {
    return (await this.list())
      .filter((s) => s.enabled && !s.error)
      .map(({ name, description }) => ({ name, description }));
  }
  private async source(name: string, signal: AbortSignal): Promise<Selection> {
    for (const source of ["workbench", "user"] as const) {
      this.check(signal);
      if (source === "user" && !this.options.userData) continue;
      // An existing workbench folder shadows the user skill even if its content is invalid.
      await this.pathAt(this.root(source), name, "SKILL.md");
      try {
        await lstat(join(this.root(source), "skills", name));
        return { source };
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    const plugin = await this.pluginOf(name, signal);
    if (plugin) return { source: "plugin", plugin };
    if (name === createPluginSkill.name) return { source: "official" };
    throw veraError("NOT_FOUND");
  }
  private requireEnabled(name: string) {
    if (this.options.disabled().includes(name))
      throw { ...veraError("DENIED"), messageKey: "skills.disabled" };
  }
  async load(name: string, file: string | undefined, signal: AbortSignal) {
    await this.refresh(signal);
    skillNameSchema.parse(name);
    this.requireEnabled(name);
    const selected = await this.source(name, signal);
    await this.agentPath(selected.source, name, "SKILL.md");
    if (file) await this.agentPath(selected.source, name, file);
    const primary = await this.readNow(selected, name, "SKILL.md", signal);
    const skill = parseSkill(primary.content, name);
    const text = file ? (await this.readNow(selected, name, file, signal)).content : skill.body;
    await this.refresh(signal);
    this.requireEnabled(name);
    await this.agentPath(selected.source, name, "SKILL.md");
    if (file) await this.agentPath(selected.source, name, file);
    const current = await this.source(name, signal);
    if (
      current.source !== selected.source ||
      (current.source === "plugin" &&
        selected.source === "plugin" &&
        (current.plugin.id !== selected.plugin.id ||
          current.plugin.folder !== selected.plugin.folder ||
          current.plugin.sha256 !== selected.plugin.sha256)) ||
      (await this.readNow(current, name, "SKILL.md", signal)).sha256 !== primary.sha256
    )
      throw veraError("CONFLICT");
    this.check(signal);
    this.requireEnabled(name);
    return { name, ...(file ? { file } : {}), text };
  }
}
