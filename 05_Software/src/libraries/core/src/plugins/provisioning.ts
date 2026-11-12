import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createContext, Script } from "node:vm";
import {
  downloadForm,
  downloadName,
  type PluginPlatform,
  type PluginProgram,
  type PluginProgramProblem,
  type PluginProgramStatus,
  type PluginSettings,
  veraError,
  versionInRange,
} from "@vera/shared";
import type { Clock, ProcessExit, ProcessHost } from "../ports.js";
import { ArchiveError, checkTree, extractZip, tarCommand } from "./archive.js";
import { programInvocation } from "./launcher.js";
import { hostVariable, killProcessTree } from "./process-tree.js";
import type { ProgramResolver, ResolvedProgram } from "./program-tools.js";
import { OutputDecoder, TailBuffer } from "./run-output.js";
import { programEnvironment } from "./runner.js";
import type { LoadedPlugin } from "./store.js";

// biome-ignore lint/suspicious/noTemplateCurlyInString: literal manifest placeholder.
const PLUGIN_DIR = "${pluginDir}";

/** The plugin platform of a host, or undefined where VERA has no build. */
export function pluginPlatform(platform: string, arch: string): PluginPlatform | undefined {
  if (platform === "win32") return arch === "x64" ? "windows-x64" : undefined;
  if (platform === "linux")
    return arch === "x64" ? "linux-x64" : arch === "arm64" ? "linux-arm64" : undefined;
  return undefined;
}

/** What provisioning needs of the plugin store. */
export interface ProvisionerStore {
  load(id: string): Promise<LoadedPlugin>;
  recordPrograms(id: string, sha256: string, programs: Readonly<Record<string, string>>): Promise<void>;
}
export interface ProvisionerOptions {
  store: ProvisionerStore;
  /** `<userData>/plugins/runtime`; everything provisioning writes stays below it. */
  root: string;
  /** The bundled uv; without it pip and script programs are unavailable. */
  uv?: ResolvedProgram | undefined;
  host: ProcessHost;
  clock: Pick<Clock, "sleep">;
  platform: PluginPlatform | undefined;
  fetch(url: string, init: { signal?: AbortSignal | undefined }): Promise<Response>;
  settings(): PluginSettings | undefined;
  timeouts?: { installMs?: number; probeMs?: number };
}

/** One managed CPython for every plugin: the newest minor release with wheels for common packages. */
export const UV_PYTHON = "3.13";
const DOWNLOAD_LIMIT = 2 * 1024 ** 3;
const PROBE_TEXT = 64 * 1024;
const DETAIL = 2000;
const MATCH_MS = 100;
const INSTALL_MS = 15 * 60_000;
const PROBE_MS = 30_000;
// Vendor activation launchers may start PowerShell and initialize an SDK before printing a version.
const ACTIVATION_PROBE_MS = 120_000;

type Kind = PluginProgramStatus["kind"];
interface Inspection {
  status: PluginProgramStatus;
  resolved?: ResolvedProgram;
}
interface Executed {
  exit: ProcessExit;
  timedOut: boolean;
  /** The first 64 KiB of output (stdout and stderr interleaved, ANSI removed). */
  head: string;
  /** The last 2 000 characters of output. */
  tail: string;
}
const kindOf = (program: PluginProgram): Kind =>
  "pip" in program.install
    ? "pip"
    : "script" in program.install
      ? "script"
      : "download" in program.install && program.install.download !== undefined
        ? "download"
        : "find";
const isFile = async (path: string) => (await stat(path).catch(() => undefined))?.isFile() === true;
/** The chunks of a body; a stream that stalls still ends when the signal aborts. */
async function* chunks(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await untilAborted(reader.read(), signal);
      if (done) return;
      yield value;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
/** `promise`, or the caller's abort when it comes first; the shared work itself goes on. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
const exists = async (path: string) => (await stat(path).catch(() => undefined)) !== undefined;
const aborted = (error: unknown) => (error as Error | undefined)?.name === "AbortError";
/** The first http(s) link of a hint, without trailing sentence punctuation. */
const linkOf = (hint: string) => /https?:\/\/[^\s<>"'()[\]]+/.exec(hint)?.[0].replace(/[.,;:!?]+$/, "");
/** The capture of `source` in `text`; a pattern running longer than MATCH_MS matches nothing. */
function boundedMatch(source: string, text: string): string | undefined {
  try {
    const context = createContext({ pattern: new RegExp(source), text });
    const found = new Script("pattern.exec(text)?.[1]").runInContext(context, { timeout: MATCH_MS });
    return typeof found === "string" && found ? found : undefined;
  } catch {
    return undefined;
  }
}
/** Matches `*` within one path segment, tried highest name first (`tool-1.10` before `tool-1.9`). */
async function* globMatches(pattern: string, ignoreCase: boolean): AsyncGenerator<string> {
  const normalized = pattern.replaceAll("\\", "/");
  const drive = /^[A-Za-z]:\//.exec(normalized)?.[0];
  // Only absolute local patterns: a relative pattern has no base and a share path would reach the network.
  if (!drive && (!normalized.startsWith("/") || normalized.startsWith("//"))) return;
  const root = drive ?? "/";
  const segments = normalized.slice(root.length).split("/").filter(Boolean);
  async function* walk(base: string, index: number): AsyncGenerator<string> {
    const segment = segments[index];
    if (segment === undefined) {
      yield base;
      return;
    }
    if (!segment.includes("*")) {
      yield* walk(join(base, segment), index + 1);
      return;
    }
    const source = segment
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    const matcher = new RegExp(`^${source}$`, ignoreCase ? "i" : "");
    let names: string[];
    try {
      names = await readdir(base);
    } catch {
      return;
    }
    const matching = names
      .filter((name) => matcher.test(name))
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    for (const name of matching) yield* walk(join(base, name), index + 1);
  }
  yield* walk(root, 0);
}

/**
 * Installs and locates plugin programs (plugins architecture §5). `install` is the user's action;
 * `resolve` and `statuses` never download, install or synchronise anything. Results are cached per
 * plugin hash, installation, recorded versions and program until an install or `invalidate`.
 * Explicitly checked failures remain authoritative across unrelated invalidation until a new actual
 * check/install supersedes them or the package/installation/program record identity changes.
 */
export class Provisioner implements ProgramResolver {
  private static nextIdentity = 0;
  private readonly identity = ++Provisioner.nextIdentity;
  private readonly cache = new Map<string, Promise<Inspection | undefined>>();
  /** Known failures survive unrelated invalidation; ready resolutions still recheck file/discovery state. */
  private readonly checked = new Map<string, { identity: string; inspection: Inspection | undefined }>();
  /** Aborted by close(): stops installs and probes when the app quits. */
  private readonly lifetime = new AbortController();
  private readonly executions = new Set<Promise<unknown>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly checks = new Map<string, Promise<PluginProgramStatus[]>>();
  constructor(private readonly options: ProvisionerOptions) {}

  private get windows() {
    return this.options.host.platform === "win32";
  }
  private get downloads() {
    return join(this.options.root, "downloads");
  }
  private executableName(program: string) {
    return this.windows ? `${program}.exe` : program;
  }
  private tools(plugin: LoadedPlugin) {
    return join(
      this.options.root,
      "tools",
      ...(plugin.runtimeKey ? [plugin.runtimeKey] : []),
      plugin.manifest.id,
    );
  }
  /** The uv variables of every call (spec REQ-FUNC-714e26bc.md): nothing outside the runtime folder. */
  uvEnvironment(plugin: LoadedPlugin): Record<string, string> {
    const { root } = this.options;
    const tools = this.tools(plugin);
    const settings = this.options.settings() ?? {};
    return {
      UV_CACHE_DIR: join(root, "cache"),
      UV_PYTHON_INSTALL_DIR: join(root, "python"),
      UV_PYTHON_BIN_DIR: join(root, "python", "bin"),
      UV_TOOL_DIR: tools,
      UV_TOOL_BIN_DIR: join(tools, "bin"),
      UV_MANAGED_PYTHON: "1",
      UV_PYTHON,
      UV_PYTHON_INSTALL_BIN: "0",
      UV_PYTHON_INSTALL_REGISTRY: "0",
      UV_NO_CONFIG: "1",
      UV_NO_PROGRESS: "1",
      ...(settings.index ? { UV_DEFAULT_INDEX: settings.index } : {}),
      ...(settings.proxy ? { HTTPS_PROXY: settings.proxy, HTTP_PROXY: settings.proxy } : {}),
    };
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Forgets every cached resolution, for example after a plugin is enabled or reinstalled. */
  private generation = 0;
  invalidate(): void {
    this.generation++;
    this.cache.clear();
  }

  async resolve(
    plugin: LoadedPlugin,
    program: string,
    signal?: AbortSignal,
  ): Promise<ResolvedProgram | undefined> {
    await plugin.verify?.();
    const resolved = (await this.inspect(plugin, program, signal))?.resolved;
    await plugin.verify?.();
    return resolved;
  }

  /** Load through the caller's store and read the same observations as the runtime resolver. */
  async statuses(id: string, signal?: AbortSignal, authority?: Provisioner): Promise<PluginProgramStatus[]> {
    const plugin = await this.options.store.load(id);
    if (!authority) return this.list(plugin, new Map(), signal);
    const scopedSignal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    return authority.list(plugin, new Map(), scopedSignal);
  }

  /** Explicit fresh version checks, shared while pending and ordered with installs. Never installs. */
  async check(id: string, signal?: AbortSignal, authority?: Provisioner): Promise<PluginProgramStatus[]> {
    const authorityGeneration = authority?.generation;
    this.lifetime.signal.throwIfAborted();
    const identity = await this.options.store.load(id);
    const key = JSON.stringify([
      id,
      identity.runtimeKey ?? "",
      identity.record.sha256,
      authority?.identity,
      authorityGeneration,
    ]);
    let pending = this.checks.get(key);
    if (!pending) {
      pending = this.serial(async () => {
        this.lifetime.signal.throwIfAborted();
        const plugin = await this.options.store.load(id);
        if (plugin.record.sha256 !== identity.record.sha256 || plugin.runtimeKey !== identity.runtimeKey)
          throw veraError("CONFLICT");
        this.invalidate();
        // Populate every fresh cache entry before yielding, so a passive read cannot seed a later
        // recorded program with its old version while this check awaits an earlier probe.
        await Promise.all(
          Object.keys(plugin.manifest.programs).map((name) =>
            this.inspect(plugin, name, this.lifetime.signal, true),
          ),
        );
        const current = await this.options.store.load(id).catch(() => {
          throw veraError("CONFLICT");
        });
        if (current.record.sha256 !== identity.record.sha256 || current.runtimeKey !== identity.runtimeKey)
          throw veraError("CONFLICT");
        const statuses = await this.list(current, new Map(), this.lifetime.signal, true);
        // Publish while this checked operation still owns the scoped queue. An intervening runtime
        // install/invalidation supersedes these observations and requires a new explicit check.
        const observations = await Promise.all(
          Object.keys(current.manifest.programs).map(
            async (name) => [name, await this.cache.get(this.inspectionKey(current, name))] as const,
          ),
        );
        if (authority && authority.generation !== authorityGeneration) throw veraError("CONFLICT");
        for (const [name, observed] of observations) {
          this.observe(current, name, observed);
          authority?.observe(current, name, observed);
        }
        return statuses;
      });
      this.checks.set(key, pending);
      const current = pending;
      void current
        .finally(() => {
          if (this.checks.get(key) === current) this.checks.delete(key);
        })
        .catch(() => {});
    }
    return untilAborted(pending, signal);
  }

  /** The native picker chooses bytes; the manifest alone supplies their identity and entry point. */
  installArchive(
    id: string,
    name: string,
    path: string,
    packageSha: string,
    signal?: AbortSignal,
    authority?: Provisioner,
  ): Promise<PluginProgramStatus[]> {
    const outer = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    return this.serial(async () => {
      outer.throwIfAborted();
      const plugin = await this.options.store.load(id);
      if (plugin.record.sha256 !== packageSha) throw veraError("CONFLICT");
      const program = plugin.manifest.programs[name];
      const entry =
        program && "download" in program.install && this.options.platform
          ? program.install.download?.[this.options.platform]
          : undefined;
      if (!program || !entry) throw veraError("INVALID");
      await plugin.verify?.();
      const deadline = AbortSignal.timeout(this.options.timeouts?.installMs ?? INSTALL_MS);
      const scopedSignal = AbortSignal.any([outer, deadline]);
      const failures = new Map<string, PluginProgramStatus>();
      let probed = false;
      const verifyIdentity = async () => {
        const current = await this.options.store.load(id).catch(() => {
          throw veraError("CONFLICT");
        });
        if (current.record.sha256 !== packageSha) throw veraError("CONFLICT");
        await current.verify?.();
      };
      try {
        const file = downloadName(entry);
        const folder = join(this.downloads, entry.sha256);
        const failure = file
          ? await this.download(entry, file, folder, scopedSignal, path, verifyIdentity)
          : "archive";
        const current = await this.options.store.load(id);
        if (current.record.sha256 !== packageSha) throw veraError("CONFLICT");
        await current.verify?.();
        if (failure)
          failures.set(name, {
            name,
            kind: "download",
            state: "missing",
            problem: failure,
            detail: "The selected file must be the exact dependency archive declared by this plugin.",
          });
        else {
          probed = true;
          const measured = await this.probe(
            {
              executable: join(folder, ...(file as string).split("/")),
              ...(entry.prefix ? { prefix: entry.prefix } : {}),
            },
            program,
            scopedSignal,
            plugin.folder,
            plugin.verify,
          );
          if (measured.version)
            await this.options.store.recordPrograms(id, packageSha, { [name]: measured.version });
          else
            failures.set(name, {
              name,
              kind: "download",
              state: "unavailable",
              problem: "version",
              ...(measured.detail ? { detail: measured.detail } : {}),
            });
        }
      } finally {
        this.invalidate();
      }
      const current = await this.options.store.load(id);
      if (current.record.sha256 !== packageSha) throw veraError("CONFLICT");
      await current.verify?.();
      if (probed)
        this.publishInstall(
          current,
          new Map([
            [
              name,
              failures.has(name)
                ? { status: failures.get(name) as PluginProgramStatus }
                : await this.examine(current, name, outer),
            ],
          ]),
          authority,
        );
      return this.list(current, failures, outer);
    });
  }

  /**
   * Removes staging folders older than the install deadline: a crash left them. A younger one may belong to
   * an install still running here or in another VERA process sharing this runtime folder.
   */
  private async sweepStaging(): Promise<void> {
    const staging = join(this.downloads, ".staging");
    const before = Date.now() - (this.options.timeouts?.installMs ?? INSTALL_MS);
    let names: string[];
    try {
      names = await readdir(staging);
    } catch {
      return;
    }
    for (const name of names) {
      const info = await stat(join(staging, name)).catch(() => undefined);
      if (info && info.mtimeMs < before)
        await rm(join(staging, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Stops running installs and probes (their process trees are killed) and refuses new installs. */
  close(): void {
    this.lifetime.abort();
  }
  /** Cancels admission and waits for process exits and asynchronous tree termination at host shutdown. */
  drain(): Promise<void> {
    this.close();
    // Shutdown must retain the host until both child exits and asynchronous tree kills finish.
    return Promise.allSettled([...this.executions]).then(() => {});
  }

  /**
   * Installs every program of the plugin that is not ready, one install at a time (a user action). Each
   * program has one deadline for its transfer, extraction, uv run and probe; its version is recorded as
   * soon as it is probed, so a later failure or a stop keeps it.
   */
  install(id: string, signal?: AbortSignal, authority?: Provisioner): Promise<PluginProgramStatus[]> {
    const outer = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    return this.serial(async () => {
      outer.throwIfAborted();
      const { store } = this.options;
      const plugin = await store.load(id);
      this.invalidate();
      await this.sweepStaging();
      const failures = new Map<string, PluginProgramStatus>();
      const observed = new Map<string, Inspection | undefined>();
      const installed = new Set<string>();
      try {
        for (const name of Object.keys(plugin.manifest.programs).sort()) {
          await plugin.verify?.();
          outer.throwIfAborted();
          const current = await this.inspect(plugin, name, outer, true);
          observed.set(name, current);
          if (
            !current ||
            current.status.kind === "find" ||
            (current.status.external && !current.status.downloadAvailable) ||
            (current.status.state !== "missing" &&
              !(
                current.status.state === "unavailable" &&
                ["version", "range"].includes(current.status.problem ?? "")
              ) &&
              !current.status.downloadAvailable)
          )
            continue;
          const deadline = AbortSignal.timeout(this.options.timeouts?.installMs ?? INSTALL_MS);
          let outcome: string | PluginProgramStatus;
          try {
            outcome = await this.installOne(
              plugin,
              name,
              AbortSignal.any([outer, deadline]),
              current.status.state === "unavailable",
            );
          } catch (error) {
            if (outer.aborted || !deadline.aborted) throw error;
            const kind = current.status.kind;
            outcome = { name, kind, state: "missing", problem: kind === "download" ? "download" : "install" };
          }
          if (typeof outcome === "string") {
            await store.recordPrograms(id, plugin.record.sha256, { [name]: outcome });
            installed.add(name);
          } else {
            failures.set(name, outcome);
            observed.set(name, { status: outcome });
          }
        }
      } finally {
        this.invalidate();
      }
      const current = await store.load(id);
      if (current.record.sha256 !== plugin.record.sha256 || current.runtimeKey !== plugin.runtimeKey)
        throw veraError("CONFLICT");
      for (const name of installed) observed.set(name, await this.examine(current, name, outer));
      await current.verify?.();
      this.publishInstall(current, observed, authority);
      return this.list(current, failures, outer);
    });
  }

  private async list(
    plugin: LoadedPlugin,
    overrides: ReadonlyMap<string, PluginProgramStatus>,
    signal?: AbortSignal,
    fresh = false,
  ): Promise<PluginProgramStatus[]> {
    const statuses: PluginProgramStatus[] = [];
    for (const name of Object.keys(plugin.manifest.programs).sort()) {
      await plugin.verify?.();
      const status = overrides.get(name) ?? (await this.inspect(plugin, name, signal, fresh))?.status;
      if (status) statuses.push(status);
    }
    return statuses;
  }

  private inspect(
    plugin: LoadedPlugin,
    name: string,
    signal?: AbortSignal,
    fresh = false,
  ): Promise<Inspection | undefined> {
    const observed = this.checked.get(this.observationKey(plugin, name));
    if (!fresh && observed?.identity === this.observationIdentity(plugin, name))
      return untilAborted(Promise.resolve(observed.inspection), signal);
    const key = this.inspectionKey(plugin, name);
    let inspection = this.cache.get(key);
    if (!inspection) {
      // Shared by every caller, so it runs under the provisioner's lifetime, never one caller's signal.
      inspection = this.examine(plugin, name, this.lifetime.signal, fresh);
      this.cache.set(key, inspection);
      const current = inspection;
      inspection.catch(() => {
        if (this.cache.get(key) === current) this.cache.delete(key);
      });
    }
    return untilAborted(inspection, signal);
  }

  private inspectionKey(plugin: LoadedPlugin, name: string): string {
    return [
      plugin.runtimeKey ?? "",
      plugin.manifest.id,
      plugin.record.sha256,
      plugin.record.installedAt,
      JSON.stringify(plugin.record.programs),
      name,
    ].join("\0");
  }

  private observationKey(plugin: LoadedPlugin, name: string): string {
    return JSON.stringify([plugin.runtimeKey ?? "", plugin.manifest.id, name]);
  }
  private observationIdentity(plugin: LoadedPlugin, name: string): string {
    return JSON.stringify([
      plugin.record.sha256,
      plugin.record.installedAt,
      plugin.record.programs[name] ?? null,
    ]);
  }
  private observe(plugin: LoadedPlugin, name: string, inspection: Inspection | undefined): void {
    const key = this.observationKey(plugin, name);
    if (!inspection || inspection.status.state === "ready") this.checked.delete(key);
    else this.checked.set(key, { identity: this.observationIdentity(plugin, name), inspection });
    this.cache.set(this.inspectionKey(plugin, name), Promise.resolve(inspection));
  }
  private publishInstall(
    plugin: LoadedPlugin,
    observed: ReadonlyMap<string, Inspection | undefined>,
    authority?: Provisioner,
  ): void {
    // A completed, actually probed install supersedes older pending runtime checks.
    authority?.invalidate();
    for (const [name, inspection] of observed) {
      this.observe(plugin, name, inspection);
      authority?.observe(plugin, name, inspection);
    }
  }

  /** The status and resolution of one program, from files and, for find programs, a probe. */
  private async examine(
    plugin: LoadedPlugin,
    name: string,
    signal?: AbortSignal,
    fresh = false,
  ): Promise<Inspection | undefined> {
    const program = plugin.manifest.programs[name];
    if (!program) return undefined;
    const kind = kindOf(program);
    const not = (
      state: "missing" | "unavailable",
      problem?: PluginProgramProblem,
      extra = {},
    ): Inspection => ({
      status: { name, kind, state, ...(problem ? { problem } : {}), ...extra },
    });
    const { platform } = this.options;
    if (!platform || !plugin.manifest.platforms.includes(platform)) return not("unavailable", "platform");
    const { install } = program;
    const recorded = Object.hasOwn(plugin.record.programs, name) ? plugin.record.programs[name] : undefined;
    const download = "download" in install && install.download;
    const entry = download ? download[platform] : undefined;
    const preferDownload = "preferDownload" in install && install.preferDownload === true;
    const downloaded = async () => {
      const file = entry && downloadName(entry);
      if (!entry || !file || recorded === undefined) return undefined;
      const executable = join(this.downloads, entry.sha256, ...file.split("/"));
      if (!(await isFile(executable))) return undefined;
      const resolved = { executable, ...(entry.prefix ? { prefix: entry.prefix } : {}) };
      const measured = fresh
        ? await this.probe(resolved, program, signal, plugin.folder, plugin.verify)
        : { version: recorded };
      return this.versionCheck(name, kind, program, resolved, measured.version, measured.detail);
    };
    const preferred = preferDownload ? await downloaded() : undefined;
    if (preferred) return preferred;
    if ("find" in install) {
      const list = this.windows ? install.find.windows : install.find.linux;
      const found = list && (await this.search(program.launcher?.[0] ?? name, list));
      if (!found && !install.download) {
        if (!list) return not("unavailable", "platform");
        const link = install.hint ? linkOf(install.hint) : undefined;
        return not(
          "missing",
          "notFound",
          install.hint ? { hint: install.hint, ...(link ? { link } : {}) } : {},
        );
      }
      if (found) {
        const resolved: ResolvedProgram = {
          executable: found,
          ...(program.launcher
            ? {
                prefix: program.launcher.slice(1),
                launcher: {
                  command: name,
                  mode: program.launcherMode as "argv" | "string",
                  platform: this.windows ? "win32" : "linux",
                },
              }
            : {}),
        };
        const measured = await this.probe(resolved, program, signal, plugin.folder, plugin.verify);
        const foundProgram = this.versionCheck(
          name,
          kind,
          program,
          resolved,
          measured.version,
          measured.detail,
        );
        if (install.hint) {
          foundProgram.status.hint = install.hint;
          const link = linkOf(install.hint);
          if (link) foundProgram.status.link = link;
        }
        if (preferDownload && entry) foundProgram.status.downloadAvailable = true;
        if (download) foundProgram.status.external = true;
        return foundProgram;
      }
    }
    if (download) {
      if (!entry) return not("unavailable", "platform");
      return (preferDownload ? undefined : await downloaded()) ?? not("missing");
    }
    if ("find" in install || "download" in install) return not("unavailable", "platform");
    if (!this.options.uv) return not("unavailable", "uv");
    if (recorded === undefined) return not("missing");
    if ("pip" in install) {
      const executable = join(this.tools(plugin), "bin", this.executableName(name));
      if (!(await isFile(executable))) return not("missing");
      const measured = fresh
        ? await this.probe({ executable }, program, signal, plugin.folder, plugin.verify)
        : { version: recorded };
      return this.versionCheck(name, kind, program, { executable }, measured.version, measured.detail);
    }
    const resolved = this.scriptProgram(plugin, install.script);
    const measured = fresh
      ? await this.probe(resolved, program, signal, plugin.folder, plugin.verify)
      : { version: recorded };
    return this.versionCheck(name, kind, program, resolved, measured.version, measured.detail);
  }

  /** Ready with its version when the version is known and in range; unavailable otherwise. */
  private versionCheck(
    name: string,
    kind: Kind,
    program: PluginProgram,
    resolved: ResolvedProgram,
    version: string | undefined,
    detail?: string,
  ): Inspection {
    const { range } = program.version;
    if (version === undefined)
      return {
        status: { name, kind, state: "unavailable", problem: "version", ...(detail ? { detail } : {}) },
      };
    if (range !== undefined && !versionInRange(version, range))
      return { status: { name, kind, state: "unavailable", problem: "range", version, range } };
    return {
      status: { name, kind, state: "ready", version, ...(range !== undefined ? { range } : {}) },
      resolved: { ...resolved, version },
    };
  }

  /** uv runs an installed PEP 723 script offline: a run never installs its dependencies. */
  private scriptProgram(plugin: LoadedPlugin, script: string): ResolvedProgram {
    const uv = this.options.uv as ResolvedProgram;
    return {
      executable: uv.executable,
      prefix: [
        ...(uv.prefix ?? []),
        "run",
        "--quiet",
        "--offline",
        "--script",
        join(plugin.folder, ...script.split("/")),
      ],
      env: this.uvEnvironment(plugin),
    };
  }

  /** The first regular file a find list names (spec "find search"). */
  private async search(program: string, list: readonly string[]): Promise<string | undefined> {
    const { host } = this.options;
    const windows = this.windows;
    const executable = this.executableName(program);
    for (const entry of list) {
      if (entry === (windows ? "%PATH%" : "$PATH")) {
        for (const folder of (hostVariable(host, "PATH") ?? "").split(windows ? ";" : ":")) {
          const directory = folder.replace(/^"(.*)"$/, "$1");
          if (directory && (await this.usable(join(directory, executable))))
            return join(directory, executable);
        }
        continue;
      }
      const pattern = this.expand(entry);
      if (pattern === undefined) continue;
      for await (const match of globMatches(pattern, windows)) {
        const info = await stat(match).catch(() => undefined);
        const candidate = info?.isDirectory() ? join(match, executable) : match;
        if (windows && !/\.exe$/i.test(candidate)) continue;
        if (await this.usable(candidate)) return candidate;
      }
    }
    return undefined;
  }
  /** A regular file that, outside Windows, this user may execute. */
  private async usable(path: string): Promise<boolean> {
    if (!(await isFile(path))) return false;
    if (this.windows) return true;
    return access(path, constants.X_OK).then(
      () => true,
      () => false,
    );
  }
  /** `~` and host variables (`%NAME%` on Windows, `$NAME` or `${NAME}` elsewhere); unset ones skip the entry. */
  private expand(entry: string): string | undefined {
    const { host } = this.options;
    let value = entry;
    if (/^~(?=$|[\\/])/.test(value)) {
      const home = hostVariable(host, this.windows ? "USERPROFILE" : "HOME");
      if (!home) return undefined;
      value = home + value.slice(1);
    }
    let unset = false;
    const variables = this.windows
      ? /%([A-Za-z_][A-Za-z0-9_]*)%/g
      : /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
    value = value.replace(variables, (_, braced: string | undefined, plain: string | undefined) => {
      const resolved = hostVariable(host, (braced ?? plain) as string);
      if (!resolved) unset = true;
      return resolved ?? "";
    });
    return unset ? undefined : value;
  }

  /** Runs a program from the runtime folder with the minimal environment, a timeout and a tree kill. */
  private async execute(
    executable: string,
    args: readonly string[],
    own: Readonly<Record<string, string>>,
    timeoutMs: number,
    signal?: AbortSignal,
    verify?: () => Promise<void>,
  ): Promise<Executed> {
    signal?.throwIfAborted();
    const { host, clock, root } = this.options;
    await mkdir(root, { recursive: true });
    const decoders = { stdout: new OutputDecoder(), stderr: new OutputDecoder() };
    const tail = new TailBuffer(DETAIL);
    let head = "";
    const push = (text: string) => {
      if (head.length < PROBE_TEXT) head += text.slice(0, PROBE_TEXT - head.length);
      tail.push(text);
    };
    await verify?.();
    signal?.throwIfAborted();
    const child = host.spawn(executable, args, {
      cwd: root,
      env: programEnvironment(host, [], own),
      // As for program runs: a process group only off Windows. Started detached on Windows, a console program
      // such as KiCad's kicad-cli prints nothing; taskkill /T stops the tree there without a group.
      group: host.platform !== "win32",
      output: (stream, chunk) => push(decoders[stream].write(chunk)),
    });
    this.executions.add(child.exit);
    void child.exit.then(
      () => this.executions.delete(child.exit),
      () => this.executions.delete(child.exit),
    );
    let timedOut = false;
    let killing: Promise<void> | undefined;
    const kill = () => {
      if (child.pid === undefined || killing) return;
      const task = killProcessTree(host, child.pid, clock).catch(() => {});
      killing = task;
      this.executions.add(task);
      void task.then(() => this.executions.delete(task));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    try {
      const exit = await child.exit;
      push(decoders.stdout.end());
      push(decoders.stderr.end());
      signal?.throwIfAborted();
      return { exit, timedOut, head, tail: tail.text().trim() };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
    }
  }

  /** The version a program prints for its version arguments; any exit code counts, a timeout does not. */
  private async probe(
    resolved: ResolvedProgram,
    program: PluginProgram,
    signal?: AbortSignal,
    pluginDir = "",
    verify?: () => Promise<void>,
  ): Promise<{ version?: string; detail?: string }> {
    const result = await this.execute(
      resolved.executable,
      programInvocation(resolved, [
        ...(resolved.launcher
          ? (program.prefix ?? []).map((arg) => arg.replaceAll(PLUGIN_DIR, pluginDir))
          : []),
        ...program.version.args,
      ]),
      resolved.env ?? {},
      this.options.timeouts?.probeMs ?? (resolved.launcher ? ACTIVATION_PROBE_MS : PROBE_MS),
      signal,
      verify,
    );
    const version =
      result.exit.error || result.timedOut ? undefined : boundedMatch(program.version.match, result.head);
    if (version) return { version };
    const reason =
      result.exit.error ??
      (result.timedOut ? "Version check timed out." : "No matching version was printed.");
    return { detail: `${reason}\n${result.tail}`.slice(-DETAIL) };
  }

  /** Installs one program; the probed version, or the status that explains the failure. */
  private async installOne(
    plugin: LoadedPlugin,
    name: string,
    signal?: AbortSignal,
    repair = false,
  ): Promise<string | PluginProgramStatus> {
    await plugin.verify?.();
    const program = plugin.manifest.programs[name] as PluginProgram;
    const kind = kindOf(program);
    const failed = (problem: PluginProgramProblem, detail?: string): PluginProgramStatus => ({
      name,
      kind,
      state: "missing",
      problem,
      ...(detail ? { detail: detail.slice(-DETAIL) } : {}),
    });
    const probed = async (resolved: ResolvedProgram) => {
      const measured = await this.probe(resolved, program, signal, plugin.folder, plugin.verify);
      return (
        measured.version ??
        ({
          name,
          kind,
          state: "unavailable",
          problem: "version",
          ...(measured.detail ? { detail: measured.detail } : {}),
        } satisfies PluginProgramStatus)
      );
    };
    const { install } = program;
    const installMs = this.options.timeouts?.installMs ?? INSTALL_MS;
    if ("pip" in install || "script" in install) {
      const uv = this.options.uv as ResolvedProgram;
      const args =
        "pip" in install
          ? ["tool", "install", ...(repair ? ["--reinstall"] : []), install.pip]
          : [
              "sync",
              ...(repair ? ["--reinstall"] : []),
              "--script",
              join(plugin.folder, ...install.script.split("/")),
            ];
      let result = await this.execute(
        uv.executable,
        [...(uv.prefix ?? []), ...args],
        this.uvEnvironment(plugin),
        installMs,
        signal,
        plugin.verify,
      );
      if (result.exit.code !== 0 && !result.timedOut && (await this.repairPythonAlias(result.tail))) {
        result = await this.execute(
          uv.executable,
          [...(uv.prefix ?? []), ...args],
          this.uvEnvironment(plugin),
          installMs,
          signal,
          plugin.verify,
        );
      }
      if (result.exit.error) return failed("install", result.exit.error);
      if (result.timedOut || result.exit.code !== 0) return failed("install", result.tail);
      if ("script" in install) return probed(this.scriptProgram(plugin, install.script));
      const executable = join(this.tools(plugin), "bin", this.executableName(name));
      if (!(await isFile(executable)))
        return failed("install", result.tail || `uv installed no ${name} entry point.`);
      return probed({ executable });
    }
    if ("download" in install && install.download) {
      const entry = install.download[this.options.platform as PluginPlatform];
      const file = entry && downloadName(entry);
      if (!entry || !file) return failed("download");
      const folder = join(this.downloads, entry.sha256);
      if (!(await exists(folder))) {
        const problem = await this.download(entry, file, folder, signal);
        if (problem) return failed(problem);
      }
      const executable = join(folder, ...file.split("/"));
      if (!(await isFile(executable))) return failed("archive");
      return probed({ executable, ...(entry.prefix ? { prefix: entry.prefix } : {}) });
    }
    return failed("notFound");
  }

  /** A uv cache repair during explicit install, never a recursive deletion or an outside target. */
  private async repairPythonAlias(detail: string): Promise<boolean> {
    if (!this.windows || !detail.includes("Missing expected target directory for Python minor version link"))
      return false;
    const python = resolve(this.options.root, "python");
    const alias = join(python, "cpython-3.13-windows-x86_64-none");
    try {
      // The configured runtime may itself be redirected. Its nested Python directory may not
      // redirect outside that canonical root, or unlink would mutate an unrelated installation.
      const canonicalRoot = await realpath(this.options.root);
      if ((await realpath(python)).toLowerCase() !== join(canonicalRoot, "python").toLowerCase())
        return false;
      if (!(await lstat(alias)).isSymbolicLink()) return false;
      const target = resolve(python, (await readlink(alias)).replace(/^\\\\\?\\/, ""));
      if (
        dirname(target).toLowerCase() !== python.toLowerCase() ||
        !/^cpython-3\.13\.\d+-windows-x86_64-none$/.test(basename(target))
      )
        return false;
      const folder = await lstat(target),
        exe = await lstat(join(target, "python.exe"));
      if (!folder.isDirectory() || folder.isSymbolicLink() || !exe.isFile() || exe.isSymbolicLink())
        return false;
      await unlink(alias);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Downloads, verifies and unpacks one entry into `folder` through a staging folder that is always
   * removed; returns the problem when it fails, so nothing of a failed download remains.
   */
  private async download(
    entry: { url: string; sha256: string },
    file: string,
    folder: string,
    signal?: AbortSignal,
    localPath?: string,
    verifyIdentity?: () => Promise<void>,
  ): Promise<PluginProgramProblem | undefined> {
    const staging = join(this.downloads, ".staging", randomUUID());
    await mkdir(staging, { recursive: true });
    try {
      const part = join(staging, "download");
      const hash = createHash("sha256");
      const handle = await open(part, "wx");
      try {
        let total = 0;
        const source = localPath ? this.localBytes(localPath, signal) : this.remoteBytes(entry.url, signal);
        for await (const chunk of source) {
          total += chunk.length;
          if (total > DOWNLOAD_LIMIT) return localPath ? "archive" : "download";
          hash.update(chunk);
          await handle.write(chunk);
        }
      } catch (error) {
        if (aborted(error)) throw error;
        return localPath ? "archive" : "download";
      } finally {
        await handle.close();
      }
      if (hash.digest("hex") !== entry.sha256) return "sha256";
      await verifyIdentity?.();
      // Local bytes are always verified first, including when a prior extraction already exists.
      if (localPath && (await exists(folder))) return undefined;
      const tree = join(staging, "tree");
      await mkdir(tree);
      const form = downloadForm(entry.url);
      try {
        if (form === "zip") await extractZip(part, tree, signal);
        else if (form === "tar") {
          const command = tarCommand(this.options.host, part, tree);
          const result = await this.execute(
            command.executable,
            command.args,
            {},
            this.options.timeouts?.installMs ?? INSTALL_MS,
            signal,
          );
          if (result.exit.error || result.timedOut || result.exit.code !== 0) return "archive";
        } else {
          const target = join(tree, ...file.split("/"));
          await mkdir(dirname(target), { recursive: true });
          await rename(part, target);
        }
        await checkTree(tree);
      } catch (error) {
        if (error instanceof ArchiveError) return "archive";
        throw error;
      }
      const executable = join(tree, ...file.split("/"));
      if (!(await isFile(executable))) return "archive";
      if (!this.windows) await chmod(executable, 0o755);
      await verifyIdentity?.();
      try {
        await rename(tree, folder);
      } catch (error) {
        // Another install of the same hash finished first; its folder holds the same bytes.
        if (!(await exists(folder))) throw error;
      }
      return undefined;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  private async *remoteBytes(url: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const response = await this.options.fetch(url, { signal });
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get("content-length") ?? 0) > DOWNLOAD_LIMIT
    ) {
      await response.body?.cancel().catch(() => {});
      throw new ArchiveError("The download could not be read.");
    }
    yield* chunks(response.body, signal);
  }

  private async *localBytes(path: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const seen = await lstat(path);
    if (!seen.isFile() || seen.isSymbolicLink() || seen.size > DOWNLOAD_LIMIT)
      throw new ArchiveError("Choose an ordinary dependency archive within the size limit.");
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.ino !== seen.ino ||
        opened.dev !== seen.dev ||
        opened.size > DOWNLOAD_LIMIT
      )
        throw new ArchiveError("The selected archive changed.");
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        signal?.throwIfAborted();
        yield chunk as Uint8Array;
      }
    } finally {
      await handle.close();
    }
  }
}
