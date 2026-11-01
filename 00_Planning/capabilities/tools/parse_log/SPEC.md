# parse_log — specification

PURPOSE: CAP-01, an internal `read` tool that turns a captured log into counts and cited events
without the model reading the whole file.
DONE-WHEN: the acceptance cases of §5 pass on Windows x64 and Linux x64. Shared rules:
[contracts](../../contracts.md); work: [PLAN](PLAN.md).
STATUS: rewritten 2026-11-01; nothing implemented yet.

## 1. Profiles

A profile is a regular expression with named groups `level` and `message` (required), `time` and
`source` (optional). ANSI colour codes are stripped from each line before matching.

| Profile | Example line | Level values |
|---|---|---|
| `esp-idf` | `I (1234) wifi: connected` or `I (12:34:56.789) wifi: connected` | `E`, `W`, `I`, `D`, `V` |
| `zephyr` | `[00:00:01.234,567] <inf> net: ready` | `err`, `wrn`, `inf`, `dbg` |
| `iso` | `2026-04-12T08:00:00Z INFO VERA-DEMO-01 revision=A boot=demo` | `TRACE`, `DEBUG`, `INFO`, `WARN`, `WARNING`, `ERROR`, `FATAL` |
| `pattern` | an agent-supplied JavaScript regular expression with the same named groups | words or letters, case-insensitive |

Levels normalize to `error`, `warn`, `info`, `debug`, `verbose` or `other` (`F`/`FATAL` → `error`,
`TRACE`/`V` → `verbose`, anything unknown → `other`). A line that does not match is `unparsed`;
stack-trace continuations and ESP32 panic dumps are unparsed lines. Decoding a panic backtrace needs
the toolchain and belongs to the `esp32-idf` plugin (PLG-10).

## 2. Arguments

```ts
type ParseLogArgs = {
  path: string;                 // workbench-relative, ≤ 256 characters
  profile?: "esp-idf" | "zephyr" | "iso";
  pattern?: string;             // ≤ 512 characters; exactly one of profile or pattern
  levels?: ("error" | "warn" | "info" | "debug" | "verbose" | "other")[];
  contains?: string;            // case-insensitive substring of the message, ≤ 200 characters
  fromLine?: number;            // ≥ 1, default 1
  maxEvents?: number;           // 1…200, default 50
  expectedSha256?: string;      // refuse a changed file
};
```

Schemas live in `shared/src/tools/parse-log.ts` (zod, strict objects).

## 3. Result

```ts
type ParseLogResult = {
  profile: string;
  source: { path: string; sha256: string | null; ref: string | null };
  scan: { complete: boolean; stopReason: "eof" | "timeout"; lines: number; bytes: number };
  counts: { error: number; warn: number; info: number; debug: number; verbose: number;
            other: number; unparsed: number; blank: number };
  events: { line: number; time?: string; level: string; source?: string; message: string; ref: string }[];
  preview: { truncated: boolean; omitted: number };
  unparsedSamples: { line: number; text: string; ref: string }[];   // at most 5
};
```

- `counts` cover every scanned line. `levels`, `contains` and `fromLine` filter only `events`;
  `omitted` counts filtered events that were not returned.
- Messages and samples are cut at 256 characters; their `ref` points at the full line.
- `source.ref` covers the scanned lines; an empty file has `ref: null`. `sha256` is null when the
  scan is incomplete.

## 4. Limits and errors

- File ≤ 50 MiB, line ≤ 16 KiB, UTF-8 with LF or CRLF and an optional BOM.
- Runs in the worker of contracts §4: absolute 10 s deadline. A timeout returns the last checkpoint
  with `scan.complete: false`, `stopReason: "timeout"` and `sha256: null`. A catastrophic `pattern`
  is terminated the same way; IPC and Stop stay responsive.
- Errors: missing file → `NOT_FOUND`; path refused → `DENIED`; invalid UTF-8, invalid or
  over-long `pattern`, a pattern without `level` or `message`, size limits → `INVALID`; changed file or
  `expectedSha256` mismatch → `CONFLICT`. Results fit 32 000 characters by dropping events from the end.

## 5. Acceptance

- `logs/boot-0412.log` with `iso`: `info` 3, `warn` 1, `error` 0, and the `WARN` event cites
  `logs/boot-0412.log#L3-L3`. `logs/boot-0413.log`: `error` 1, cited at its line.
- An `esp-idf` sample with ANSI colours and both timestamp forms, and a `zephyr` sample, parse to
  the same normalized levels.
- A `pattern` without `level` is refused; a catastrophic pattern is stopped by the deadline and the
  next worker task succeeds.
- `levels: ["error"]` with `maxEvents: 1` returns one event while `counts` stay complete.
- LF, CRLF and BOM variants give identical events; traversal, ignored paths, a disabled tool and a
  changed file are refused.
- Agent and CLI (`vera run`) return identical results.

NOTES:
- The tool reports what the log says. It does not diagnose causes or evaluate tests; skills do that.
