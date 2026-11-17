import type { ProcessExit, ProcessHost, ProcessSpawnOptions } from "../ports.js";

function terminationTarget(executable: string, args: readonly string[]): string | undefined {
  if (executable.endsWith("taskkill.exe")) return args[3];
  const encoded = args.indexOf("-EncodedCommand");
  return executable.endsWith("powershell.exe") && encoded >= 0
    ? /\$targetPid = (\d+)/.exec(Buffer.from(args[encoded + 1] ?? "", "base64").toString("utf16le"))?.[1]
    : undefined;
}

/** A scripted process: tests print output and finish it by hand. */
export class FakeProcess {
  exited = false;
  private settle!: (exit: ProcessExit) => void;
  readonly exit = new Promise<ProcessExit>((resolve) => {
    this.settle = resolve;
  });
  constructor(
    readonly pid: number | undefined,
    readonly executable: string,
    readonly args: readonly string[],
    readonly options: ProcessSpawnOptions,
  ) {}
  print(text: string, stream: "stdout" | "stderr" = "stdout") {
    this.options.output(stream, Buffer.from(text));
  }
  finish(exit: ProcessExit) {
    if (this.exited) return;
    this.exited = true;
    this.settle(exit);
  }
}

/** A ProcessHost that records spawns and kills without starting processes. */
export class FakeHost implements ProcessHost {
  readonly processes: FakeProcess[] = [];
  readonly signals: [number, string][] = [];
  failNext: string | undefined;
  private nextPid = 100;
  constructor(
    readonly platform = "linux",
    readonly env: Record<string, string> = { PATH: "/usr/bin" },
  ) {}
  get programs() {
    return this.processes.filter((process) => !terminationTarget(process.executable, process.args));
  }
  spawn(executable: string, args: readonly string[], options: ProcessSpawnOptions) {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      const failed = new FakeProcess(undefined, executable, args, options);
      this.processes.push(failed);
      failed.finish({ code: null, signal: null, error });
      return failed;
    }
    const process = new FakeProcess(this.nextPid++, executable, args, options);
    this.processes.push(process);
    const treeTarget = terminationTarget(executable, args);
    if (treeTarget) {
      this.programs.find((program) => String(program.pid) === treeTarget)?.finish({ code: 1, signal: null });
      process.finish({ code: 0, signal: null });
    }
    return process;
  }
  signal(pid: number, signal: "SIGTERM" | "SIGKILL") {
    this.signals.push([pid, signal]);
    const target = this.programs.find((process) => process.pid === -pid && !process.exited);
    target?.finish({ code: null, signal });
    return Boolean(target);
  }
}
