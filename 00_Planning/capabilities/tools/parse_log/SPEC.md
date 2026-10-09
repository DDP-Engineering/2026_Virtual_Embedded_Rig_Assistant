# parse_log specification

Status: proposed. ID: CAP-01. Kind: internal `read` tool.
Read [shared contracts](../../contracts.md) and [implementation plan](PLAN.md).

## 1. Purpose and first format

Extract bounded, structured evidence from a captured UTF-8 log without asking the model to process
the entire file. MVP supports only `vera-log-v1`, with one event per physical line:

```text
[0 ms] INFO boot: start
[10 ms] INFO reset: cause=0x01
[20 ms] ERROR boot: init_failed
```

Timestamp is unsigned decimal milliseconds, at most uint64, returned as a decimal string. Severity
is exactly DEBUG, INFO, WARN or ERROR. Component has 1–64 ASCII letters/digits or `_`, `-`, `.`;
message is the rest of the line. Spaces around separators are fixed as in the example. Empty lines
are counted separately. Other lines are unparsed, not silently assigned a severity. This includes
stack-trace continuation lines. LF, CRLF and an initial UTF-8 BOM are accepted; invalid UTF-8 is an error.

File order is preserved. A decrease in timestamp starts another `clockSegment` and increments
`timestampRegressions`; it does not prove a reset or establish an absolute date. No cross-device
clock alignment, custom regex execution or automatic firmware-format detection is included.

## 2. Input and output

`packages/shared/src/tools/parse-log.ts` exports `ParseLogArgsSchema`, `ParsedLogResultSchema` and
their inferred `ParseLogArgs` / `ParsedLogResult` types, plus `ParsedLogEvent`. Unknown input fields
are rejected. Input paths are at most 256 characters.

```ts
type ParseLogArgs = {
  path: string;
  profile: "vera-log-v1";
  fromLine?: number;             // integer >= 1; default 1; selects preview, not scan scope
  maxEvents?: number;            // integer 1..100; default 20
  expectedSha256?: string;       // optional full-content digest; checked at EOF
  runRecordPath?: string;        // optional RunRecord v1, max 16 KiB
};
type ParsedLogEvent = {
  line: number; timestampMs: string; clockSegment: number;
  severity: "DEBUG" | "INFO" | "WARN" | "ERROR";
  component: string; message: string; messageTruncated: boolean; ref: string;
};
type ParsedLogResult = {
  profileVersion: "vera-log-v1@1";
  source: { path: string; sha256: string | null; ref: string | null };
  scan: { complete: boolean; stopReason: "eof" | "timeout";
          linesScanned: number; bytesScanned: number };
  counts: { DEBUG: number; INFO: number; WARN: number; ERROR: number;
            unparsed: number; blank: number; timestampRegressions: number };
  events: ParsedLogEvent[];
  preview: { truncated: boolean; omittedEvents: number };
  unparsedSamples: { line: number; text: string; ref: string }[];
  runRecord?: { record: RunRecord; source: { path: string; sha256: string; ref: string };
                logVerified: boolean };
};
```

All recognized events contribute to counts, including those before fromLine or after maxEvents.
Preview takes the first maxEvents eligible events. `omittedEvents` counts every recognized event
not returned. Up to five unparsed samples are returned. Message/sample previews are at most 256
characters, retaining their raw-line references. Source ref covers scanned complete physical lines;
an empty source has ref null. Full-file hashing includes the original bytes, BOM and line endings.

Serialize compact JSON and remove preview/sample rows from the end until it fits 32,000 characters.
Update omission flags/counts accordingly. Preserve counts, scan state, provenance and validated
run metadata. If mandatory fields alone exceed the ceiling, return INVALID with reason
`result_too_large`. fromLine beyond EOF returns an empty preview with full counts. Requesting later rows
with expectedSha256 prevents mixing results from changed files.

## 3. Scanning and run binding

- Stream and parse in the bounded worker, not on the main thread. Limit log input to 50 MiB,
  physical lines to 16 KiB of bytes excluding the LF/CRLF terminator, and run-record JSON to 16 KiB.
  Growth beyond the cap also fails. File byte caps and hashes include BOMs and line endings.
- Emit bounded checkpoints every 1,000 complete lines or 250 ms of progress. The host's 10-second
  absolute deadline can terminate the worker even if it makes no checkpoint.
- A timeout returns the last checkpoint with scan.complete=false, stopReason=timeout, source.sha256
  null and runRecord.logVerified=false. No checkpoint returns zero counts and no refs. Counts cover
  only reported lines; they are not final counts. Abort returns the normal aborted tool outcome.
- At EOF, verify expectedSha256 if present. A run record must validate against RunRecordSchema and
  declare this canonical log path/profile. Compare its log.sha256 with the full scan digest. Path,
  profile or digest mismatch produces CONFLICT; no successful bound record is returned.
- Only a complete scan can set logVerified=true. Firmware, setup, outcome and measurements remain
  declarations supplied by the run author, even then. Parsed severity counts are tool-computed facts.
- All errors preserve the source file: missing path -> NOT_FOUND; confinement/ignore refusal ->
  DENIED; unsupported profile, malformed JSON/UTF-8, too-large file/line/record -> INVALID; changed
  source or digest binding mismatch -> CONFLICT. Each has a stable reason.

## 4. Acceptance and limitations

- The candidate fixture produces INFO=2, ERROR=1, WARN=DEBUG=unparsed=blank=0, three events,
  timestamps `0`, `10`, `20`, segments 0 and a line-3 citation. Baseline produces INFO=3, ERROR=0.
- LF/CRLF/BOM variants produce identical event fields; their byte digests can differ.
- With maxEvents=1, all counts remain complete and omittedEvents=2. A scan timeout is visibly partial.
- Empty input, unknown lines, 64-bit timestamps, clock regressions, long lines, source changes,
  traversal, symlinks, disabled tool, invalid metadata and result-size limits have explicit tests.
- Desktop IPC and Stop stay responsive during scanning; CLI and agent use the same implementation.
- The tool reports observed text and counts. It does not diagnose root cause, execute code in logs,
  evaluate test outcomes or write a report. Skills interpret results and use artifact_save.
