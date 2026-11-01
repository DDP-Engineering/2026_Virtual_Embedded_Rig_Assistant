import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SKILL_BYTES, type SkillSource, type SkillSummary, skillNameSchema, veraError } from "@vera/shared";
import { parseDocument } from "yaml";
import { isBinary } from "../tools/binary.js";
import { createIgnoreRules } from "../workbench/ignore.js";
import { PathGuard, validateRelativePath } from "../workbench/path-guard.js";

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
/** Separately authorized roots; callers supply names rather than filesystem authority. */
export class SkillCatalog {
  constructor(
    private readonly options: {
      root: string;
      userData?: string;
      disabled: () => readonly string[];
      assertCurrent?: () => void;
      refresh?: () => Promise<void>;
    },
  ) {}
  check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.options.assertCurrent?.();
  }
  root(source: SkillSource): string {
    const root = source === "workbench" ? join(this.options.root, ".vera") : this.options.userData;
    if (!root) throw veraError("DENIED");
    return root;
  }
  async path(source: SkillSource, name: string, file = "SKILL.md") {
    if (!name || name === "." || name === ".." || /[\\/:\0]/.test(name)) throw veraError("INVALID");
    validateRelativePath(name);
    const slash = validateRelativePath(file);
    if (slash.split("/").some((p) => !p || p === "." || p === "..")) throw veraError("DENIED");
    const root = resolve(this.root(source));
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
    const target = await this.path(source, name, file);
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
      const current = await lstat(await this.path(source, name, file));
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
      const selected = bytes.subarray(0, count);
      if (isBinary(selected)) throw veraError("INVALID");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(selected);
      return { content, sha256: createHash("sha256").update(selected).digest("hex") };
    } finally {
      await handle.close();
    }
  }
  private async discover(source: SkillSource): Promise<string[]> {
    await this.path(source, "placeholder");
    const names: string[] = [];
    let scanned = 0;
    try {
      const dir = await opendir(join(this.root(source), "skills"));
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
    const selected = new Map<string, SkillSource>();
    if (this.options.userData) for (const name of await this.discover("user")) selected.set(name, "user");
    for (const name of await this.discover("workbench")) selected.set(name, "workbench");
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
    this.check();
    await this.options.refresh?.();
    this.check();
    const selected = await this.selection();
    const results: SkillSummary[] = [];
    for (const [name, source] of [...selected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const base = { name, source, description: "", enabled: !this.options.disabled().includes(name) };
      try {
        const loaded = await this.read(source, name);
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
    await this.options.refresh?.();
    this.check();
    return results.map((s) => ({ ...s, enabled: !this.options.disabled().includes(s.name) }));
  }
  async metadata() {
    return (await this.list())
      .filter((s) => s.enabled && !s.error)
      .map(({ name, description }) => ({ name, description }));
  }
  private async source(name: string): Promise<SkillSource> {
    for (const source of ["workbench", "user"] as const) {
      if (source === "user" && !this.options.userData) continue;
      // An existing workbench folder shadows the user skill even if its content is invalid.
      await this.path(source, name);
      try {
        await lstat(join(this.root(source), "skills", name));
        return source;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    throw veraError("NOT_FOUND");
  }
  async load(name: string, file: string | undefined, signal: AbortSignal): Promise<Record<string, unknown>> {
    this.check(signal);
    await this.options.refresh?.();
    this.check(signal);
    skillNameSchema.parse(name);
    if (this.options.disabled().includes(name)) throw veraError("DENIED");
    const source = await this.source(name);
    await this.agentPath(source, name, "SKILL.md");
    if (file) await this.agentPath(source, name, file);
    const primary = await this.read(source, name, "SKILL.md", signal);
    const skill = parseSkill(primary.content, name);
    const text = file ? (await this.read(source, name, file, signal)).content : skill.body;
    await this.options.refresh?.();
    await this.agentPath(source, name, "SKILL.md");
    if (file) await this.agentPath(source, name, file);
    if (
      (await this.source(name)) !== source ||
      (await this.read(source, name, "SKILL.md", signal)).sha256 !== primary.sha256
    )
      throw veraError("CONFLICT");
    this.check(signal);
    if (this.options.disabled().includes(name)) throw veraError("DENIED");
    return { name, ...(file ? { file } : {}), text };
  }
}
