import type { ProcessExit, ProcessHost, ProcessSpawnOptions, SpawnedProcess } from "../ports.js";

interface OutputPipe {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  destroy(): unknown;
}
interface ChildLike {
  readonly pid?: number | undefined;
  readonly stdout: OutputPipe | null;
  readonly stderr: OutputPipe | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}
/** The subset of `child_process.spawn` the host uses; desktop main and the CLI inject the real one. */
export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    shell: false;
    windowsHide: true;
    detached: boolean;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildLike;

/**
 * The Node.js ProcessHost. Every program starts without a shell (arguments reach it unchanged), without
 * a console window, with stdin closed so an interactive program fails instead of hanging, and, when
 * `group` is set, as the leader of a new process group. `exit` waits for both pipes to close, but at
 * most `closeGraceMs` after the program itself exited: a descendant that inherited the pipes must not
 * keep the run open forever.
 */
export class NodeProcessHost implements ProcessHost {
  readonly platform: string = process.platform;
  readonly env: Readonly<Record<string, string | undefined>> = process.env;
  constructor(
    private readonly spawnProcess: SpawnFunction,
    private readonly closeGraceMs = 2000,
  ) {}

  spawn(executable: string, args: readonly string[], options: ProcessSpawnOptions): SpawnedProcess {
    let child: ChildLike;
    try {
      child = this.spawnProcess(executable, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: options.group,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      // Node throws some start failures (EINVAL for a .cmd without a shell, a NUL in an argument).
      const code = (error as NodeJS.ErrnoException).code ?? "ERROR";
      return { pid: undefined, exit: Promise.resolve({ code: null, signal: null, error: code }) };
    }
    child.stdout?.on("data", (chunk) => options.output("stdout", chunk));
    child.stderr?.on("data", (chunk) => options.output("stderr", chunk));
    const exit = new Promise<ProcessExit>((resolve) => {
      let failure: string | undefined;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const settle = (code: number | null, signal: string | null) => {
        clearTimeout(grace);
        resolve({ code, signal, ...(failure === undefined ? {} : { error: failure }) });
      };
      child.once("error", (error) => {
        failure = (error as NodeJS.ErrnoException).code ?? "ERROR";
        // A program that never started has no close event to wait for.
        if (child.pid === undefined) settle(null, null);
      });
      child.once("exit", (code, signal) => {
        grace = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          settle(code, signal);
        }, this.closeGraceMs);
      });
      child.once("close", settle);
    });
    return { pid: child.pid, exit };
  }

  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
