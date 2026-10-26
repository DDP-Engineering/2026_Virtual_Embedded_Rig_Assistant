# parse_log Implementation Plan

PURPOSE: implement CAP-01, turning one explicit log format into bounded, cited evidence in the agent
and CLI. STATE: planned; product implementation follows the repository's AGENTS.md when requested.
DONE-WHEN: the acceptance cases below pass on Windows and Ubuntu. This document authorizes no commit.

**Architecture:** schemas live in shared; streaming parsing runs in a Node worker; a small adapter
binds the result to WP-11's registry. The optional run record is validated and bound to the scanned log.
**Tech Stack:** planned TypeScript ESM, zod, Node worker threads, node:crypto, Vitest and replay fixtures.
**Spec:** [SPEC.md](SPEC.md), [shared contracts](../../contracts.md).

## Global constraints and review focus

Run from `05_Software/` after WP-11; agent/CLI integration also needs WP-13/WP-15. The parser supports
only vera-log-v1; log cap 50 MiB, line cap 16 KiB, record cap 16 KiB, host deadline 10,000 ms, output
32,000 characters. No network, shell, writes or new npm package is needed. Preserve complete tool pairs
and the M1 context budget. The tasks below cover these five review cases:

| Case | Owner |
|---|---|
| Partial preview mistaken for partial scan, or timeout counts mistaken for final totals | task 2 |
| Unparsed crash continuations or decreasing clocks silently dropped | task 2 |
| Manifest binds another file/profile or an old digest | task 2 |
| Valid input creates malformed/oversized serialized output | task 2 |
| Stop, ignore rules, disabled tools or a long first turn bypass the ordinary runtime | task 3 |

## Task 1: Schemas, bounded-host adapter and exact fixtures

**Files:** create `src/libraries/shared/src/tools/parse-log.ts`,
`src/libraries/shared/src/capabilities/run-record.ts` and adjacent `.test.ts` files;
`src/libraries/core/src/tools/capabilities/host.ts` and `host.test.ts`;
`tests/fixtures/workbenches/demo-board/{logs,runs,docs}/` files named in shared contracts.
**Interfaces:** produce the SPEC's schema/type exports and `CapabilityWorkerHost`;
`CapabilityTimeout extends Error`; adapt WP-11 WorkerPool's deadline/abort to that interface.

- [ ] Write failing schema tests `parse_log_args_limits`, `run_record_shape_and_missing_evidence`
  and `host_timeout_and_abort_are_distinct`. Pin defaults, unknown keys and hash normalization:

```ts
expect(ParseLogArgsSchema.parse({path: "logs/candidate.log", profile: "vera-log-v1"}))
  .toMatchObject({fromLine: 1, maxEvents: 20});
expect(ParseLogArgsSchema.safeParse({path: "x", profile: "auto"}).success).toBe(false);
expect(ParseLogArgsSchema.safeParse({path: "x", profile: "vera-log-v1", maxEvents: 101}).success).toBe(false);
```

- [ ] Run `npm test -- --run src/libraries/shared/src/tools/parse-log.test.ts src/libraries/shared/src/capabilities/run-record.test.ts src/libraries/core/src/tools/capabilities/host.test.ts`;
  expect failure from missing exports/behaviour, not from a broken test runner.
- [ ] Implement strict zod schemas, the WorkerPool adapter and the shared fixtures named in contracts.
  Calculate both log hashes from their exact fixture bytes and verify every source range.
  Add tests for mismatched metadata shape, duplicate measurement IDs, no pass/fail refs and the host
  terminating/replacing timed-out workers while propagating abort.
- [ ] Rerun the focused command; all assertions pass. The fixtures validate against RunRecordSchema.

## Task 2: Line parser, bounded scanner and worker

**Files:** create `src/libraries/core/src/tools/parse-log/{profile,scanner,worker}.ts` and their `.test.ts` files.
**Interfaces:** consume task 1 schemas and host. Produce
`parseVeraLogLine(line: string, lineNumber: number, clockSegment: number): Omit<ParsedLogEvent, "ref"> | null`;
`scanLog(lines: AsyncIterable<{line: number; text: string; bytes: number}>, args: ParseLogArgs,
signal: AbortSignal, checkpoint: (result: ParsedLogResult) => void): Promise<ParsedLogResult>`;
`parseLogFile(root: string, args: ParseLogArgs, signal: AbortSignal,
checkpoint: (result: ParsedLogResult) => void): Promise<ParsedLogResult>`.
The worker entry resolves/guards both files and calls parseLogFile; scanner owns aggregate/preview
logic and adds refs using args.path. The file layer owns byte limits, digests, source checks and
metadata binding.

- [ ] Write failing tests `candidate_counts_and_refs`, `crlf_bom_and_unparsed_lines`,
  `uint64_and_clock_segments`, `preview_is_not_scan_truncation`, `timeout_checkpoint`,
  `file_line_and_record_caps`, `changed_source_and_manifest_binding` and `json_budget`:

```ts
expect(parseVeraLogLine("[20 ms] ERROR boot: init_failed", 3, 0))
  .toMatchObject({line: 3, timestampMs: "20", severity: "ERROR", component: "boot", message: "init_failed"});
// For the candidate fixture scanned with maxEvents=1:
expect(result.counts).toMatchObject({INFO: 2, ERROR: 1, unparsed: 0});
expect(result.scan.complete).toBe(true);
expect(result.preview.omittedEvents).toBe(2);
expect(JSON.stringify(result).length).toBeLessThanOrEqual(32000);
```

- [ ] Run `npm test -- --run src/libraries/core/src/tools/parse-log`; expect the named behavioural tests to fail.
- [ ] Implement the signatures above, streaming UTF-8 decoding, checkpoints, run binding and complete
  JSON budgeting. Add boundary fixtures: empty input; malformed UTF-8; uint64 max and overflow;
  timestamps 10 then 0; 16 KiB and over-limit lines; metadata over 16 KiB; maxEvents/fromLine edges;
  messages requiring JSON escaping. Inject file changes through the file-access port for repeatability.
- [ ] Rerun the focused command. Timeout never returns a full digest or verified record; stale expected
  hashes and mismatched record path/profile/digest return CONFLICT. Source files remain byte-identical.

## Task 3: Registry, replay session and CLI parity

**Files:** create `src/libraries/core/src/tools/parse-log/index.ts` and `index.test.ts`;
modify `src/libraries/core/src/tools/registry.ts`; create `src/libraries/core/test/parse-log.test.ts`,
`tests/fixtures/llm-scripts/parse-log-answer.jsonl` and `tests/e2e/parse-log.test.ts`;
create `src/apps/cli/src/parse-log.test.ts` using the WP-15 CLI integration helpers.
**Interfaces:** consume CapabilityWorkerHost and task 2 worker. Produce
`executeParseLog(root: string, args: ParseLogArgs, host: CapabilityWorkerHost,
signal: AbortSignal): Promise<ParsedLogResult>`; register `parse_log` as class read.
The registry adapter maps ordinary tool errors and aborted outcomes. On CapabilityTimeout it returns
the last checkpoint as partial; with no checkpoint it constructs the zero-count timeout result.

- [ ] Write failing tests `parse_log_registered_and_disabled`, `parse_log_confined_and_ignored`,
  `replay_parse_and_cite`, `cli_parse_parity`, `stop_during_scan` and `many_results_one_turn`.
  Pin a replay call to the candidate file and the answer ref `logs/candidate.log#L3-L3`;
  assert disabled parse_log is not offered and a fabricated disabled call is rejected.
- [ ] Run `npm test -- --run src/libraries/core/src/tools/parse-log/index.test.ts src/libraries/core/test/parse-log.test.ts src/apps/cli/src/parse-log.test.ts`;
  expect missing registration/integration failures.
- [ ] Bind worker dispatch, source refs and ToolDef to the existing registry; use existing tool rows,
  IPC events and CLI paths. Add no dedicated screen or alternate agent loop. Exercise timeout with
  a shortened injected host deadline and ensure app.info still responds and the next worker task succeeds.
- [ ] Rerun focused tests. CLI integration launches `vera run` on a temporary demo copy with
  `parse-log-answer.jsonl`, expecting a complete cited answer and exit 0. Run
  `npm run test:e2e -- tests/e2e/parse-log.test.ts`, then `npm run verify`. Preserve failure/limit exit codes.

## Done

CAP-01 is complete only when schemas, worker limits, source binding, agent/CLI parity and responsive
Stop pass on both target platforms. Report the fixture-only profile limitation and verification evidence.
No live-board compatibility or model interpretation quality is claimed by these tests.
