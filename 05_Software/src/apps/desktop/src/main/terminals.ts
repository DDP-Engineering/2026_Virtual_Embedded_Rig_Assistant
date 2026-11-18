import { randomUUID } from "node:crypto";
import {
  type CommandShellHost,
  capToolResult,
  interactiveShellArguments,
  OutputDecoder,
  type TerminalReader,
} from "@vera/core";
import {
  type TerminalSnapshot,
  type TerminalSummary,
  terminalIdSchema,
  terminalSizeSchema,
  veraError,
} from "@vera/shared";
import { z } from "zod";

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
  shared: boolean;
  grant: number;
  running: boolean;
  exitCode?: number;
  output: string;
  /** Characters trimmed from the head of `output` so far. */
  dropped: number;
  listeners: { dispose(): void }[];
};
const BUFFER = 262144;
const leaseSchema = z.strictObject({ id: terminalIdSchema, grant: z.number().int().nonnegative() });
const readSchema = z.strictObject({
  truncated: z.literal(true).optional(),
  leases: z.array(leaseSchema).max(8),
  terminals: z
    .array(
      z.strictObject({ id: terminalIdSchema, number: z.number().int().positive(), running: z.boolean() }),
    )
    .max(8),
  text: z.string().max(12000).optional(),
});

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
      pty: PtyFactory;
      scrub(text: string): string;
      maskUserOutput(): boolean;
      maskAgentOutput?(): boolean;
      secrets(): readonly string[];
    },
  ) {}

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
      running: entry.running,
      ...(entry.exitCode === undefined ? {} : { exitCode: entry.exitCode }),
    };
  }
  list(owner: string): TerminalSummary[] {
    this.owner(owner);
    return [...this.entries.values()]
      .filter((entry) => entry.owner === owner)
      .map((entry) => this.summary(entry));
  }
  async create(owner: string, cols: number, rows: number): Promise<TerminalSummary> {
    terminalSizeSchema.parse({ cols, rows });
    const current = this.owner(owner);
    const generation = this.generation;
    if (this.entries.size + this.creating >= 8) throw veraError("BUSY");
    this.creating++;
    try {
      const shell = await this.host.shell.resolve();
      this.owner(owner);
      if (generation !== this.generation) throw veraError("CONFLICT");
      const pty = this.host.pty.spawn(shell.executable, interactiveShellArguments(shell), {
        cwd: current.folder,
        env: this.host.shell.environment(),
        cols,
        rows,
      });
      const entry: Entry = {
        id: randomUUID(),
        number: ++this.number,
        owner,
        pty,
        shared: false,
        grant: 0,
        running: true,
        output: "",
        dropped: 0,
        listeners: [],
      };
      this.entries.set(entry.id, entry);
      entry.listeners.push(
        pty.onData((data) => {
          if (this.entries.get(entry.id) !== entry) return;
          entry.output += data;
          if (entry.output.length > BUFFER) {
            const length = entry.output.length;
            const tail = entry.output.slice(-BUFFER);
            // Drop a cut line rather than disclose the suffix of a secret at the buffer boundary.
            entry.output = tail.slice(tail.indexOf("\n") < 0 ? tail.length : tail.indexOf("\n") + 1);
            entry.dropped += length - entry.output.length;
          }
        }),
        pty.onExit(({ exitCode }) => {
          entry.running = false;
          entry.exitCode = exitCode;
        }),
      );
      return this.summary(entry);
    } finally {
      this.creating--;
    }
  }
  private publicOutput(entry: Pick<Entry, "output">): string {
    const text = entry.output;
    // A secret split over PTY callbacks must not reveal its leading fragment on an interim poll.
    const trim = (value: string) => {
      let held = 0;
      for (const secret of this.host.secrets()) {
        for (let size = Math.min(secret.length - 1, value.length); size > held; size--) {
          if (value.endsWith(secret.slice(0, size))) {
            held = size;
            break;
          }
        }
      }
      return { text: held ? value.slice(0, -held) : value, held };
    };
    const raw = trim(text),
      plain = trim(this.strip(text));
    const masked = this.host.scrub(raw.text);
    // Keep VT behavior normally; secrets split by formatting require a safe plain-text projection.
    const visible = this.strip(masked);
    return (
      plain.held > raw.held || this.host.scrub(visible) !== visible ? this.host.scrub(plain.text) : masked
    ).slice(-BUFFER);
  }
  output(owner: string, id: string): TerminalSnapshot {
    const entry = this.entry(owner, id);
    return {
      ...this.summary(entry),
      output: this.host.maskUserOutput() ? this.publicOutput(entry) : entry.output,
      // Lets the renderer tell a trimmed head from changed content and append only the new tail.
      start: entry.dropped,
    };
  }
  input(owner: string, id: string, data: string): void {
    z.string().min(1).max(16384).parse(data);
    const entry = this.entry(owner, id);
    if (!entry.running) throw veraError("CONFLICT");
    entry.pty.write(data);
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
    for (const listener of entry.listeners) listener.dispose();
    await this.host.pty.stop(entry.pty);
  }
  async closeAll(): Promise<void> {
    this.generation++;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) for (const listener of entry.listeners) listener.dispose();
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
          ...(id ? { text: this.recent(entries[0] as Entry, false) } : {}),
        };
        return data;
      },
      publish: (output) => {
        this.owner(owner);
        const data = readSchema.parse(JSON.parse(output));
        for (const lease of data.leases) {
          const entry = this.entry(owner, lease.id);
          if (!entry.shared || entry.grant !== lease.grant) throw Error("Terminal read consent was revoked.");
        }
        const entries = data.leases.map((lease) => this.entry(owner, lease.id));
        return capToolResult({
          ...(data.truncated ? { truncated: true } : {}),
          terminals: entries.map((entry) => ({ id: entry.id, number: entry.number, running: entry.running })),
          ...(data.text === undefined
            ? {}
            : { text: this.recent(entries[0] as Entry, this.host.maskAgentOutput?.() !== false) }),
        }).text;
      },
    };
  }
  private recent(entry: Entry, mask: boolean): string {
    const text = this.strip(mask ? this.publicOutput(entry) : entry.output);
    if (text.length <= 12000) return text;
    const tail = text.slice(-12000);
    const first = tail.charCodeAt(0);
    return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
  }
  private strip(text: string): string {
    const decoder = new OutputDecoder();
    // A snapshot is still streaming: flushing a partial escape would defeat secret-prefix holding.
    return decoder.write(new TextEncoder().encode(text));
  }
}
