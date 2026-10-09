import { execFile, spawn } from "node:child_process";

const TIMEOUT_MS = 15_000;

/** First line of `tshark -v`, or null if the binary is missing or fails. Args array, no shell (01 NOTES). */
export function readTsharkVersion(tsharkPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      tsharkPath,
      ["-v"],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        const first = stdout.split(/\r?\n/, 1)[0]?.trim();
        resolve(first ? first : null);
      },
    );
  });
}

export class TsharkError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number | string | null,
  ) {
    super(message);
    this.name = "TsharkError";
  }
}

export interface TsharkRunOptions {
  /** Default 15 s (01 NOTES). Ingest of large captures passes more. */
  timeoutMs?: number;
  /** Output cap in bytes; exceeding it fails the call. Default 64 MiB. */
  maxBytes?: number;
}

/** Runs tshark with an args array (no shell, Windows paths with spaces stay intact). Non-zero exit → TsharkError. */
export function runTshark(tsharkPath: string, args: string[], opts: TsharkRunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      tsharkPath,
      args,
      {
        timeout: opts.timeoutMs ?? TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: opts.maxBytes ?? 64 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (err) {
          const firstErr = stderr.split(/\r?\n/).find((l) => l.trim()) ?? err.message;
          const code = (err as NodeJS.ErrnoException & { code?: number | string }).code ?? null;
          return reject(new TsharkError(`tshark failed: ${firstErr.trim()}`, stderr, code));
        }
        resolve(stdout);
      },
    );
  });
}

/** Separator between occurrences of one field (`-E aggregator`). Never appears in the fields we read. */
const AGG = "\u001f";

export interface FieldsQuery {
  file: string;
  fields: string[];
  /** Display filter (`-Y`). */
  filter?: string;
  /** Extra args before the field list, e.g. `--disable-protocol x`. */
  extraArgs?: string[];
}

/**
 * `tshark -T fields` with every occurrence of every field: one row per frame, one string[] per field
 * (empty array when the field is absent). Tab-separated, no quoting.
 */
export async function tsharkFields(tsharkPath: string, q: FieldsQuery, opts?: TsharkRunOptions): Promise<string[][][]> {
  const args = ["-r", q.file, ...(q.extraArgs ?? [])];
  if (q.filter) args.push("-Y", q.filter);
  args.push("-T", "fields", "-E", "separator=/t", "-E", "quote=n", "-E", "occurrence=a", "-E", `aggregator=${AGG}`);
  for (const f of q.fields) args.push("-e", f);
  const out = await runTshark(tsharkPath, args, opts);
  const rows: string[][][] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split("\t");
    rows.push(q.fields.map((_, i) => (cols[i] ? cols[i]!.split(AGG) : [])));
  }
  return rows;
}

/** tshark 4.6 prints booleans as `True`/`False` in `-T fields`; older versions print `1`/`0`. */
export function tsharkBool(v: string | undefined): boolean {
  return v === "1" || v === "True" || v === "true";
}

export interface TsharkLinesOptions {
  /** 01 NOTES: 15 s for agent-driven calls. */
  timeoutMs?: number;
  /** Stop (and kill tshark) after this many output lines; `truncated` is set. */
  maxLines: number;
  /** Hard cap on bytes read from stdout. */
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface TsharkLines {
  lines: string[];
  truncated: boolean;
}

/**
 * Agent-facing tshark (query_packets, evidence trees): `spawn` with an args array (no shell), a timeout, and
 * output capped by lines and bytes — tshark is killed as soon as a cap is hit, so a broad display filter on a big
 * capture costs at most the cap. A failing filter rejects with TsharkError carrying tshark's first stderr line.
 */
export function tsharkLines(tsharkPath: string, args: string[], opts: TsharkLinesOptions): Promise<TsharkLines> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(tsharkPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const lines: string[] = [];
    let buf = "";
    let bytes = 0;
    let stderr = "";
    let truncated = false;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const stop = () => {
      truncated = true;
      child.kill();
    };
    const onAbort = () => {
      child.kill();
      finish(() => reject(new TsharkError("tshark cancelled", stderr, "ABORT_ERR")));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new TsharkError(`tshark timed out after ${timeoutMs / 1000} s; narrow the display filter`, stderr, "ETIMEDOUT")));
    }, timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (truncated) return;
      bytes += Buffer.byteLength(chunk);
      buf += chunk;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      for (const p of parts) {
        if (!p) continue;
        if (lines.length >= opts.maxLines) return stop();
        lines.push(p);
      }
      if (bytes > maxBytes) stop();
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8192) stderr += chunk;
    });
    child.on("error", (err) => finish(() => reject(new TsharkError(`tshark failed: ${err.message}`, stderr, (err as NodeJS.ErrnoException).code ?? null))));
    child.on("close", (code) => {
      if (!truncated && buf && lines.length < opts.maxLines) lines.push(buf);
      if (code !== 0 && !truncated) {
        const first = stderr.split(/\r?\n/).find((l) => l.trim()) ?? `exit code ${code}`;
        return finish(() => reject(new TsharkError(`tshark failed: ${first.trim()}`, stderr, code)));
      }
      finish(() => resolve({ lines, truncated }));
    });
  });
}
