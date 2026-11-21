// REQ-SEC-1b68aa62
import { spawn } from "node:child_process";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { GitComparison, GitDiffResult, GitHistoryEligibility, GitHistoryResult } from "@vera/shared";
import { readPathDiff } from "./diff.js";
import { historyEligibility, historyReadFailure, readPathHistory } from "./history.js";
import { checkIndexScope } from "./index-scope.js";
import { containsPath, GitReadError, type GitRepository, prepareRepository } from "./repository.js";

const windows = process.platform === "win32";
const nullDevice = windows ? "NUL" : "/dev/null";
const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
const localAbsolute = (path: string) => isAbsolute(path) && (!windows || /^[a-z]:[\\/]/i.test(path));

function readProcess(
  file: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  limit: number,
  input?: Buffer,
  allowMissingHead?: true,
): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...(windows ? { SystemRoot: systemRoot, WINDIR: systemRoot } : {}),
        PATH: cwd,
        HOME: cwd,
        USERPROFILE: cwd,
        XDG_CONFIG_HOME: cwd,
        TMPDIR: cwd,
        TEMP: cwd,
        TMP: cwd,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_SYSTEM: nullDevice,
        GIT_CONFIG_GLOBAL: nullDevice,
        GIT_ATTR_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PROTOCOL_FROM_USER: "0",
        GIT_ALLOW_PROTOCOL: "",
      },
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    let overflow = false;
    let warnings = false;
    const stop = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, 6_000);
    signal.addEventListener("abort", stop, { once: true });
    child.stdin.on("error", () => {
      failed = true;
    });
    child.stdin.end(input);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        overflow = true;
        stop();
      } else chunks.push(chunk);
    });
    child.stderr.on("data", () => {
      warnings = true;
    });
    child.once("error", () => {
      failed = true;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted) reject(signal.reason);
      else if (overflow) reject(new GitReadError("output-limit"));
      else if (failed || warnings || (code !== 0 && !(allowMissingHead && code === 1 && bytes === 0)))
        reject(new GitReadError("failed"));
      else resolve(Buffer.concat(chunks, bytes));
    });
  });
}

/** Uses OS-managed Git locations and never looks in CWD, a repository or PATH. */
export async function installedGit(cwd: string, signal: AbortSignal): Promise<string | undefined> {
  const locations = windows ? [] : ["/usr/bin/git"];
  if (windows) {
    const candidates = (base: string) =>
      ["ucrt64", "mingw64"].map((folder) => join(base, folder, "bin", "git.exe"));
    const programFiles = process.env.ProgramW6432 ?? process.env.ProgramFiles;
    if (programFiles) locations.push(...candidates(join(programFiles, "Git")));
    if (localAbsolute(systemRoot)) {
      try {
        const registry = await readProcess(
          join(systemRoot, "System32", "reg.exe"),
          ["query", "HKLM\\SOFTWARE\\GitForWindows", "/v", "InstallPath"],
          cwd,
          signal,
          4096,
        );
        const installed = /^\s*InstallPath\s+REG_SZ\s+([^\r\n]+)\s*$/im
          .exec(registry.toString())?.[1]
          ?.trim();
        if (installed && localAbsolute(installed)) locations.push(...candidates(installed));
      } catch {
        signal.throwIfAborted();
      }
    }
  }
  for (const location of locations) {
    signal.throwIfAborted();
    try {
      const executable = await realpath(location);
      if (localAbsolute(executable) && (await lstat(executable)).isFile()) return executable;
    } catch {
      // An unavailable location does not prevent trying another trusted installation.
    }
  }
  return undefined;
}

const fixedSettings = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "diff.renameLimit=1000",
  "-c",
  "diff.renames=true",
];

type GitReadMode = "allow-unborn-head" | "exact-file-paths";
export type GitCommand = (
  args: readonly string[],
  limit: number,
  mode?: GitReadMode,
  input?: Buffer,
) => Promise<Buffer>;

/** Runs fixed local Git reads against an app-owned Git directory. */
export class GitReader {
  private verified?: string;
  constructor(
    private readonly appData: string,
    private readonly locate = installedGit,
    private readonly run = readProcess,
  ) {}

  async status(
    repo: GitRepository,
    signal: AbortSignal,
  ): Promise<{ status: Buffer; head: string; tracked: ReadonlySet<string>; gitlinks: ReadonlySet<string> }> {
    return this.withRepository(repo, signal, async (run, head) => {
      const scope = ["--", ...(repo.prefix ? [repo.prefix] : [])];
      const { tracked, gitlinks } = await this.readIndex(repo, signal, run, scope);
      const status = await run(
        [
          "status",
          "--porcelain=v2",
          "-z",
          "--branch",
          "--no-ahead-behind",
          "--untracked-files=all",
          "--ignored=matching",
          "--ignore-submodules=all",
          "--renames",
          ...scope,
        ],
        4 * 1024 * 1024,
      );
      return { status, head, tracked, gitlinks };
    });
  }

  async diff(
    repo: GitRepository,
    path: string,
    comparison: GitComparison,
    signal: AbortSignal,
  ): Promise<GitDiffResult> {
    return this.withRepository(repo, signal, async (run) =>
      readPathDiff(repo, path, comparison, await this.readIndex(repo, signal, run), run, signal),
    );
  }

  async historyEligibility(
    repo: GitRepository,
    path: string,
    signal: AbortSignal,
  ): Promise<GitHistoryEligibility> {
    try {
      return await this.withRepository(repo, signal, (run, head) =>
        historyEligibility(repo, path, run, head, signal),
      );
    } catch {
      signal.throwIfAborted();
      return "unavailable";
    }
  }

  async history(repo: GitRepository, path: string, signal: AbortSignal): Promise<GitHistoryResult> {
    try {
      return await this.withRepository(repo, signal, (run, head) =>
        readPathHistory(repo, path, run, head, signal),
      );
    } catch (error) {
      signal.throwIfAborted();
      return historyReadFailure(error);
    }
  }

  private async readIndex(
    repo: GitRepository,
    signal: AbortSignal,
    run: GitCommand,
    scope = ["--", ...(repo.prefix ? [repo.prefix] : [])],
  ) {
    const output = await run(["ls-files", "--cached", "--stage", "-z", ...scope], 8 * 1024 * 1024);
    return checkIndexScope(repo, output, signal);
  }

  private async withRepository<T>(
    repo: GitRepository,
    signal: AbortSignal,
    use: (run: GitCommand, head: string) => Promise<T>,
  ): Promise<T> {
    const parent = await realpath(this.appData);
    if (!localAbsolute(parent) || containsPath(repo.root, parent)) throw new GitReadError("unsupported");
    const scratch = await mkdtemp(join(parent, ".git-read-"));
    try {
      const executable = await this.executable(scratch, repo.root, signal);
      const { metadata, head } = await prepareRepository(repo, scratch, signal, (config) =>
        this.run(
          executable,
          ["config", "--file", "-", "--no-includes", "--null", "--list"],
          scratch,
          signal,
          128 * 1024,
          config,
        ),
      );
      signal.throwIfAborted();
      const args = [
        `--git-dir=${metadata}`,
        `--work-tree=${repo.root}`,
        ...fixedSettings,
        "-c",
        `core.hooksPath=${join(scratch, "disabled-hooks")}`,
      ];
      const run: GitCommand = (command, limit, mode, input) => {
        const pathspecs = mode === "exact-file-paths" ? "--glob-pathspecs" : "--literal-pathspecs";
        return this.run(
          executable,
          ["--no-pager", pathspecs, ...args, ...command],
          scratch,
          signal,
          limit,
          input,
          mode === "allow-unborn-head" ? true : undefined,
        );
      };
      return await use(run, head);
    } finally {
      await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }

  private async executable(cwd: string, root: string, signal: AbortSignal) {
    const executable = this.verified ?? (await this.locate(cwd, signal));
    if (!executable || !localAbsolute(executable)) throw new GitReadError("missing-git");
    if (containsPath(root, executable)) throw new GitReadError("unsupported");
    if (this.verified === executable) return executable;
    const output = await this.run(executable, ["--version"], cwd, signal, 1024);
    const version = /^git version 2\.(\d+)\./.exec(output.toString());
    if (!version || Number(version[1]) < 40) throw new GitReadError("missing-git");
    this.verified = executable;
    return executable;
  }
}
