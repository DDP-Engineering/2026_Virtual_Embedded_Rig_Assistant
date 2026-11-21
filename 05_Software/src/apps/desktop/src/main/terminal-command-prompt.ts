import { randomUUID } from "node:crypto";
import { type CommandBlockShell, veraError } from "@vera/shared";

const notReady = () => ({ ...veraError("CONFLICT"), messageKey: "chatActions.promptNotReady" });
const startupReplies: Record<string, string> = {
  "\u001b[6n": "\u001b[1;1R",
  "\u001b[?6n": "\u001b[?1;1R",
  "\u001b[5n": "\u001b[0n",
  "\u001b[c": "\u001b[?1;2c",
  "\u001b[0c": "\u001b[?1;2c",
};

/** One-shot proof of an empty initial prompt in a profile-free shell; ordinary terminals are unverified. */
export class TerminalCommandPrompt {
  private readonly nonce = randomUUID();
  readonly marker = `\u001b]633;VERA;${this.nonce}\u0007`;
  /** The prompt of a PowerShell outside Full Language, such as Constrained Language under a host policy. */
  readonly constrainedMarker = `\u001b]633;VERA;${this.nonce};constrained\u0007`;
  private state: "starting" | "timed-out" | "ready" | "used" = "starting";
  private reportedConstrained = false;
  private carry = "";
  private listeners = new Set<() => void>();

  /** Pristine startup is selectable until it times out; only its expected prompt can restore eligibility. */
  get dispatchEligible(): boolean {
    return this.state === "starting" || this.state === "ready";
  }

  /** The proven prompt came from a PowerShell outside Full Language, which refuses .NET method calls. */
  get constrained(): boolean {
    return this.reportedConstrained;
  }

  startup(
    shell: CommandBlockShell,
    env: Record<string, string>,
  ): { args: string[]; env: Record<string, string> } {
    if (shell === "powershell") {
      // The initial read bypasses ConsoleHost/PSReadLine editing and its post-prompt cursor queries.
      const full = `[Console]::Write("PS $($executionContext.SessionState.Path.CurrentLocation)> ${this.marker}"); $veraInitialCommand = [Console]::ReadLine(); if ($null -ne $veraInitialCommand) { . ([scriptblock]::Create($veraInitialCommand)) }; Remove-Variable veraInitialCommand -ErrorAction SilentlyContinue`;
      // Constrained Language refuses those .NET calls; these cmdlets are allowed and also read one line.
      const constrained = `Write-Host -NoNewline "PS $($executionContext.SessionState.Path.CurrentLocation)> ${this.constrainedMarker}"; $veraInitialCommand = Read-Host; if ($null -ne $veraInitialCommand) { Invoke-Expression $veraInitialCommand }; Remove-Variable veraInitialCommand -ErrorAction SilentlyContinue`;
      const prompt = `if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') { ${full} } else { ${constrained} }`;
      return {
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NoExit",
          "-EncodedCommand",
          Buffer.from(prompt, "utf16le").toString("base64"),
        ],
        env,
      };
    }
    // No profile or prompt hook may start a reader before this initial prompt is displayed.
    const { PROMPT_COMMAND: _hook, ...clean } = env;
    return {
      args: ["--noprofile", "--norc", "-i"],
      env: { ...clean, PS1: `\\u@\\h:\\w\\$ \\[${this.marker}\\]` },
    };
  }

  /** Terminal input, execution or closure permanently invalidates this initial-prompt proof. */
  invalidate(): void {
    this.state = "used";
    for (const listener of this.listeners) listener();
  }

  /** Services startup VT queries before a surface exists and removes split private prompt markers. */
  output(data: string, reply: (data: string) => void): string {
    let text = this.carry + data;
    let visible = "";
    this.carry = "";
    const controls = [this.marker, this.constrainedMarker, ...Object.keys(startupReplies)];
    while (text) {
      const found = controls
        .map((control) => ({ control, offset: text.indexOf(control) }))
        .filter(({ offset }) => offset >= 0)
        .sort((a, b) => a.offset - b.offset)[0];
      if (!found) break;
      visible += text.slice(0, found.offset);
      text = text.slice(found.offset + found.control.length);
      if (found.control === this.marker || found.control === this.constrainedMarker) {
        if (this.state === "starting" || this.state === "timed-out") {
          this.state = "ready";
          this.reportedConstrained = found.control === this.constrainedMarker;
        }
        for (const listener of this.listeners) listener();
      } else if (this.state === "starting" || this.state === "timed-out") {
        // No profile/user code has run in this pristine shell; these replies contain no command input.
        reply(startupReplies[found.control] as string);
      } else visible += found.control;
    }
    for (let size = Math.min(text.length, this.constrainedMarker.length - 1); size > 0; size--) {
      if (!controls.some((control) => text.endsWith(control.slice(0, size)) && size < control.length))
        continue;
      this.carry = text.slice(-size);
      return visible + text.slice(0, -size);
    }
    return visible + text;
  }

  async wait(): Promise<void> {
    if (this.state === "starting") {
      await new Promise<void>((resolve, reject) => {
        const changed = () => {
          clearTimeout(timer);
          this.listeners.delete(changed);
          resolve();
        };
        const timer = setTimeout(() => {
          this.listeners.delete(changed);
          this.state = "timed-out";
          for (const listener of this.listeners) listener();
          reject(notReady());
        }, 5000);
        this.listeners.add(changed);
      });
    }
    if (this.state !== "ready") throw notReady();
  }

  /** Must run synchronously with the PTY write, after rechecking workbench ownership. */
  consume(): void {
    if (this.state !== "ready") throw notReady();
    this.invalidate();
  }
}
