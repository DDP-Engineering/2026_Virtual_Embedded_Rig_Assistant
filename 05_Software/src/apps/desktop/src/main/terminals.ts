import { randomUUID } from "node:crypto";
import {
  type CommandShell,
  type CommandShellHost,
  capToolResult,
  interactiveShellArguments,
  OutputDecoder,
  type TerminalReader,
} from "@vera/core";
import {
  advancedSettings,
  type CommandBlockShell,
  commandBlockShellSchema,
  commandBlockTextSchema,
  type TerminalSnapshot,
  type TerminalSummary,
  terminalIdSchema,
  terminalSizeSchema,
  veraError,
} from "@vera/shared";
import { z } from "zod";
import { TerminalCommandPrompt } from "./terminal-command-prompt.js";

export interface UserPty {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
}
export interface PtyFactory {
  spawn(
    executable: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; cols: number; rows: number },
  ): UserPty;
  stop(pty: UserPty): Promise<void>;
}
type Entry = {
  id: string;
  number: number;
  owner: string;
  pty: UserPty;
  shell: CommandShell["kind"];
  commandPrompt?: TerminalCommandPrompt;
  shared: boolean;
  grant: number;
  running: boolean;
  exitCode?: number;
  output: string;
  /** Characters trimmed from the head of `output` so far. */
  dropped: number;
  /** Escape state immediately before a retained line fragment. */
  headDecoder?: OutputDecoder | undefined;
  /** Characters of output kept: the Terminal buffer when the terminal opened. */
  buffer: number;
  listeners: { dispose(): void }[];
};
/** The application's terminal limits, in characters; read when a terminal opens or the agent reads one. */
export interface TerminalLimits {
  terminals: number;
  bufferChars: number;
  agentChars: number;
}
const defaultLimits: TerminalLimits = {
  terminals: advancedSettings.terminals.default,
  bufferChars: advancedSettings.terminalBufferK.default * 1024,
  agentChars: advancedSettings.terminalAgentChars.default,
};
const leaseSchema = z.strictObject({ id: terminalIdSchema, grant: z.number().int().nonnegative() });
const readSchema = z.strictObject({
  truncated: z.literal(true).optional(),
  terminalId: terminalIdSchema.optional(),
  leases: z.array(leaseSchema).max(advancedSettings.terminals.max),
  terminals: z
    .array(
      z.strictObject({ id: terminalIdSchema, number: z.number().int().positive(), running: z.boolean() }),
    )
    .max(advancedSettings.terminals.max),
});

function withoutClippedSecret(text: string, secrets: readonly string[]): string {
  const first = text[0];
  if (!first) return text;
  let cut = 0;
  for (const secret of secrets) {
    // The discarded part may contain any prefix of a credential that ends inside this window.
    for (let at = secret.indexOf(first, 1); at >= 0; at = secret.indexOf(first, at + 1)) {
      const suffix = secret.slice(at);
      if (text.startsWith(suffix) || suffix.startsWith(text)) {
        cut = Math.max(cut, Math.min(text.length, suffix.length));
        break;
      }
    }
  }
  if (!cut) return text;
  // The new boundary must also avoid cutting a full credential that overlaps that fragment.
  let previous: number;
  do {
    previous = cut;
    for (const secret of secrets) {
      const at = text.indexOf(secret, Math.max(0, cut - secret.length + 1));
      if (at >= 0 && at < cut) cut = at + secret.length;
    }
  } while (cut > previous);
  return text.slice(cut).replace(/^[\uDC00-\uDFFF]/, "");
}

/** Ephemeral workbench-owned user shells. Only reader() crosses the core agent boundary. */
export class TerminalService {
  private entries = new Map<string, Entry>();
  private generation = 0;
  private number = 0;
  private creating = 0;
  private suspended = false;
  constructor(
    private readonly host: {
      current(): { id: string; folder: string };
      shell: CommandShellHost;
      shellForBlock?(kind: CommandBlockShell): Promise<CommandShell>;
      pty: PtyFactory;
      scrub(text: string): string;
      maskUserOutput(): boolean;
      maskAgentOutput?(): boolean;
      secrets(): readonly string[];
      /** The resolved Advanced terminal limits; the registry defaults when absent. */
      limits?(): TerminalLimits;
    },
  ) {}

  private limits(): TerminalLimits {
    const limits = this.host.limits?.();
    const valid = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    return {
      terminals: valid(limits?.terminals) ? (limits as TerminalLimits).terminals : defaultLimits.terminals,
      bufferChars: valid(limits?.bufferChars)
        ? (limits as TerminalLimits).bufferChars
        : defaultLimits.bufferChars,
      agentChars: valid(limits?.agentChars)
        ? (limits as TerminalLimits).agentChars
        : defaultLimits.agentChars,
    };
  }

  private owner(id: string) {
    if (this.suspended) throw veraError("CONFLICT");
    const current = this.host.current();
    if (current.id !== id) throw veraError("CONFLICT");
    return current;
  }
  private entry(owner: string, id: string): Entry {
    this.owner(owner);
    const entry = this.entries.get(terminalIdSchema.parse(id));
    if (!entry || entry.owner !== owner) throw veraError("NOT_FOUND");
    return entry;
  }
  private summary(entry: Entry): TerminalSummary {
    return {
      id: entry.id,
      number: entry.number,
      shared: entry.shared,
      shell: entry.shell,
      running: entry.running,
      dispatchEligible: entry.running && entry.commandPrompt?.dispatchEligible === true,
      ...(entry.exitCode === undefined ? {} : { exitCode: entry.exitCode }),
    };
  }
  list(owner: string): TerminalSummary[] {
    this.owner(owner);
    return [...this.entries.values()]
      .filter((entry) => entry.owner === owner)
      .map((entry) => this.summary(entry));
  }
  async create(
    owner: string,
    cols: number,
    rows: number,
    requestedShell?: CommandBlockShell,
  ): Promise<TerminalSummary> {
    if (requestedShell !== undefined) commandBlockShellSchema.parse(requestedShell);
    terminalSizeSchema.parse({ cols, rows });
    const current = this.owner(owner);
    const generation = this.generation;
    // A lowered count closes no open terminal; it only refuses new ones (REQ-FUNC-7509bd1e).
    if (this.entries.size + this.creating >= this.limits().terminals) throw veraError("BUSY");
    this.creating++;
    try {
      const shell =
        requestedShell && this.host.shellForBlock
          ? await this.host.shellForBlock(requestedShell)
          : await this.host.shell.resolve();
      if (requestedShell && shell.kind !== requestedShell)
        throw { ...veraError("CONFLICT"), messageKey: "chatActions.shellMismatch" };
      this.owner(owner);
      if (generation !== this.generation) throw veraError("CONFLICT");
      const commandPrompt = requestedShell ? new TerminalCommandPrompt() : undefined;
      const startup =
        commandPrompt && requestedShell
          ? commandPrompt.startup(requestedShell, this.host.shell.environment())
          : { args: interactiveShellArguments(shell), env: this.host.shell.environment() };
      const pty = this.host.pty.spawn(shell.executable, startup.args, {
        cwd: current.folder,
        env: startup.env,
        cols,
        rows,
      });
      const entry: Entry = {
        id: randomUUID(),
        number: ++this.number,
        owner,
        pty,
        shell: shell.kind,
        ...(commandPrompt ? { commandPrompt } : {}),
        shared: false,
        grant: 0,
        running: true,
        output: "",
        dropped: 0,
        buffer: this.limits().bufferChars,
        listeners: [],
      };
      this.entries.set(entry.id, entry);
      entry.listeners.push(
        pty.onData((data) => {
          if (this.entries.get(entry.id) !== entry) return;
          entry.output += entry.commandPrompt
            ? entry.commandPrompt.output(data, (reply) => pty.write(reply))
            : data;
          if (entry.output.length > entry.buffer) {
            let cut = entry.output.length - entry.buffer;
            const newline = entry.output.indexOf("\n", cut);
            if (newline >= 0 && newline + 1 < entry.output.length) {
              cut = newline + 1;
              entry.headDecoder = undefined;
            } else {
              if (/^[\uDC00-\uDFFF]/.test(entry.output.slice(cut, cut + 1))) cut++;
              entry.headDecoder ??= new OutputDecoder();
              entry.headDecoder.writeText(entry.output.slice(0, cut));
            }
            entry.output = entry.output.slice(cut);
            entry.dropped += cut;
          }
        }),
        pty.onExit(({ exitCode }) => {
          entry.commandPrompt?.invalidate();
          entry.running = false;
          entry.exitCode = exitCode;
        }),
      );
      return this.summary(entry);
    } finally {
      this.creating--;
    }
  }
  private publicOutput(entry: Entry): string {
    const text = entry.output;
    const secrets = this.host.secrets();
    // A secret split over PTY callbacks must not reveal its leading fragment on an interim poll.
    const trim = (value: string) => {
      let held = 0;
      for (const secret of secrets) {
        for (let size = Math.min(secret.length - 1, value.length); size > held; size--) {
          if (value.endsWith(secret.slice(0, size))) {
            held = size;
            break;
          }
        }
      }
      return { text: held ? value.slice(0, -held) : value, held };
    };
    if (entry.headDecoder) {
      const plain = entry.headDecoder.previewText(text);
      return this.host.scrub(withoutClippedSecret(trim(plain).text, secrets));
    }
    const raw = trim(text),
      plain = trim(this.strip(text));
    const masked = this.host.scrub(raw.text);
    // Keep VT behavior normally; secrets split by formatting require a safe plain-text projection.
    const visible = this.strip(masked);
    return plain.held > raw.held || this.host.scrub(visible) !== visible
      ? this.host.scrub(plain.text)
      : masked;
  }
  output(owner: string, id: string): TerminalSnapshot {
    const entry = this.entry(owner, id);
    return {
      ...this.summary(entry),
      output: this.host.maskUserOutput()
        ? this.publicOutput(entry)
            .slice(-entry.buffer)
            .replace(/^[\uDC00-\uDFFF]/, "")
        : entry.output,
      // Lets the renderer tell a trimmed head from changed content and append only the new tail.
      start: entry.dropped,
    };
  }
  input(owner: string, id: string, data: string): void {
    z.string().min(1).max(16384).parse(data);
    const entry = this.entry(owner, id);
    if (!entry.running) throw veraError("CONFLICT");
    entry.commandPrompt?.invalidate();
    entry.pty.write(data);
  }
  /** Executes original block text inside its declared shell, never as a line-by-line paste. */
  async execute(owner: string, id: string, shell: CommandBlockShell, text: string): Promise<void> {
    commandBlockShellSchema.parse(shell);
    commandBlockTextSchema.parse(text);
    const entry = this.entry(owner, id);
    if (!entry.running) throw veraError("CONFLICT");
    if (entry.shell !== shell) throw { ...veraError("CONFLICT"), messageKey: "chatActions.shellMismatch" };
    if (!entry.commandPrompt) throw { ...veraError("CONFLICT"), messageKey: "chatActions.promptNotReady" };
    const generation = this.generation;
    await entry.commandPrompt.wait();
    // Input or workbench replacement may have happened while the initial prompt was starting.
    if (generation !== this.generation || this.entry(owner, id) !== entry || !entry.running)
      throw veraError("CONFLICT");
    const constrained = entry.commandPrompt.constrained;
    entry.commandPrompt.consume();
    // Never clear or submit existing input. This one-shot pristine shell is the only proven clean destination.
    const command =
      shell !== "powershell"
        ? `eval -- $'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\r", "\\r").replaceAll("\n", "\\n").replaceAll("\t", "\\t")}'`
        : constrained
          ? // Constrained Language refuses [Convert] and [Text.Encoding]; the exact UTF-16 code units need neither.
            `Invoke-Expression (-join [char[]](${Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)).join(",")}))`
          : `. ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text, "utf8").toString("base64")}'))))`;
    entry.pty.write(`${command}\r`);
  }
  resize(owner: string, id: string, cols: number, rows: number): void {
    terminalSizeSchema.parse({ cols, rows });
    const entry = this.entry(owner, id);
    if (entry.running) entry.pty.resize(cols, rows);
  }
  consent(owner: string, id: string, shared: boolean): TerminalSummary {
    const entry = this.entry(owner, id);
    z.boolean().parse(shared);
    entry.shared = shared;
    entry.grant++;
    return this.summary(entry);
  }
  async close(owner: string, id: string): Promise<void> {
    const entry = this.entry(owner, id);
    this.entries.delete(id);
    entry.commandPrompt?.invalidate();
    for (const listener of entry.listeners) listener.dispose();
    await this.host.pty.stop(entry.pty);
  }
  async closeAll(): Promise<void> {
    this.generation++;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      entry.commandPrompt?.invalidate();
      for (const listener of entry.listeners) listener.dispose();
    }
    await Promise.all(entries.map((entry) => this.host.pty.stop(entry.pty)));
  }
  suspend(): void {
    this.suspended = true;
    this.generation++;
  }
  resume(): void {
    this.suspended = false;
  }
  reader(owner: string): TerminalReader {
    return {
      read: (id) => {
        this.owner(owner);
        const entries = id
          ? [this.entry(owner, id)]
          : [...this.entries.values()].filter((entry) => entry.owner === owner && entry.shared);
        if (entries.some((entry) => !entry.shared))
          throw Error("Terminal read consent is required for this terminal.");
        const data = {
          leases: entries.map((entry) => ({ id: entry.id, grant: entry.grant })),
          terminals: entries.map((entry) => ({ id: entry.id, number: entry.number, running: entry.running })),
          ...(id ? { terminalId: id } : {}),
        };
        return data;
      },
      publish: (output, limit) => {
        this.owner(owner);
        const data = readSchema.parse(JSON.parse(output));
        const entries = data.leases.map((lease) => {
          const entry = this.entry(owner, lease.id);
          if (!entry.shared || entry.grant !== lease.grant) throw Error("Terminal read consent was revoked.");
          return entry;
        });
        const selected = entries.find((entry) => entry.id === data.terminalId);
        if (data.terminalId && !selected) throw Error("Terminal read consent is required for this terminal.");
        return capToolResult(
          {
            ...(data.truncated ? { truncated: true } : {}),
            terminals: entries.map((entry) => ({
              id: entry.id,
              number: entry.number,
              running: entry.running,
            })),
            ...(selected ? this.recent(selected, this.host.maskAgentOutput?.() !== false) : {}),
          },
          [],
          limit,
          "terminal_read",
        ).text;
      },
    };
  }
  private recent(entry: Entry, mask: boolean): { text: string; truncated?: true } {
    const output = mask ? this.publicOutput(entry) : entry.output;
    const text = entry.headDecoder
      ? mask
        ? output
        : entry.headDecoder.previewText(output)
      : this.strip(output);
    const size = this.limits().agentChars;
    return {
      text: text.length <= size ? text : text.slice(-size).replace(/^[\uDC00-\uDFFF]/, ""),
      ...(entry.dropped > 0 || text.length > size ? { truncated: true } : {}),
    };
  }
  private strip(text: string): string {
    const decoder = new OutputDecoder();
    // A snapshot is still streaming: flushing a partial escape would defeat secret-prefix holding.
    return decoder.write(new TextEncoder().encode(text));
  }
}
