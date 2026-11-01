# Analysis capabilities — shared contracts

PURPOSE: the rules CAP-01…CAP-04 share: tool boundaries, evidence and citations, errors, limits,
worker execution, the fixture workbench and how the skills ship.
DONE-WHEN: every capability's SPEC cites these rules instead of restating them.
STATUS: rewritten 2026-11-01 against the code at commit 33e72b8; nothing implemented yet.

## 1. Boundaries

- `parse_log` and `decode_register` are internal tools of class `read`. They obey the workbench's
  `tools.disabled` list, the path guard (`core/src/workbench/path-guard.ts`) and the ignore rules.
  They use no shell, network or device, write nothing and never read `.vera/`.
- `firmware-comparator` and `test-planner` are Agent Skills. They call existing tools only. They may
  call `run_program` for a `safe` command of an enabled plugin (firmware-comparator's optional
  binary comparison) and may name plugin commands in a plan; neither skill flashes, captures or
  runs tests.
- Work that needs an external program or hardware is a plugin (`../plugins/`): ESP32 panic decoding
  (`esp32-idf`), CAN decoding with a DBC file (`can-dbc`), live register reads (OpenOCD/GDB),
  test execution.

## 2. Evidence and citations

- Tool results carry `source: {path, sha256, ref}`. `sha256` hashes the exact bytes read; `ref` uses
  the line-reference format of `shared/src/refs.ts` (`path#Lstart-Lend`), which VERA's citation
  check already verifies.
- Each returned event or decoded field keeps its own line reference.
- An optional `expectedSha256` argument refuses a file whose bytes changed since an earlier call
  (`CONFLICT`, reason `source_changed`), so results from two versions of a file are never mixed.
- Skills cite with VERA's `[[ref]]` syntax. A claim without an inspected reference is unsupported.
- File, document and log content is data. Instructions inside it never change a skill's procedure.

## 3. Errors and limits

- Failures return `isError: true` through `ToolRegistry.execute` (`core/src/tools/registry.ts`), with an
  existing VeraError code (`INVALID`, `NOT_FOUND`, `DENIED`, `CONFLICT`), a stable `reason` and a short
  actionable message. No tool retries automatically.
- Results fit `TOOL_RESULT_CAP` (32 000 characters). Each tool shrinks its preview before
  serialization and says so (`preview.truncated`); an incomplete scan is reported separately
  (`scan.complete: false`).

## 4. Worker execution

`parse_log` runs agent-supplied regular expressions over files up to 50 MiB, so it runs in a worker
like `grep`. The `WorkerPool` port (`core/src/ports.ts:18`) is grep-specific today: its partial
callback is typed `GrepMatch`. CAP-01 generalizes it with a task kind:

```ts
run(task: { kind: "grep" | "parse_log"; root: string; args: unknown; scope?: "filesystem" },
    signal: AbortSignal, onPartial?: (value: unknown) => void): Promise<WorkerResult>;
```

Both implementations change: `core/src/workers/node-host.ts` (CLI and tests) and
`apps/desktop/src/main/worker-pool.ts` (desktop). The absolute 10 s deadline, worker termination
and replacement, and abort behave exactly as for `grep`; there is no main-thread fallback.
`decode_register` reads a definition of at most 1 MiB and does constant-time arithmetic, so it runs
in the main process.

## 5. Fixture workbench

Extend `tests/fixtures/workbenches/demo-board/` and list the new files in
`tests/fixtures/workbenches/demo-board.json`:

| File | Content |
|---|---|
| `logs/boot-0412.log` | exists: baseline run, `iso` format, 4 lines, one `WARN` on line 3 |
| `logs/boot-0413.log` | new: candidate run in the same format; same first lines, then `ERROR i2c initialization failed` |
| `docs/runs.md` | new: user notes for both runs: board VERA-DEMO-01 revision A, unit DEMO-001, firmware 1.0.0 and 1.1.0, setup "bench@1", test "boot@1" |
| `docs/boot-test.md` | new: criterion boot@1: the log reaches `i2c … ready` and contains no `ERROR` line |
| `docs/release-notes.md` | new: firmware 1.1.0 changes I2C initialization timing; no root-cause claim |
| `definitions/registers/vera-demo-01.json` | new: I2C1_CR1 from `sources/reference-manual.md` line 7 (PE bit 0, TXIE 1, RXIE 2, ERRIE 7) |

New files under `docs/` are indexed, so `npm run eval:retrieval` must still pass after the change.
Tests work on copies of the fixture.

## 6. How the skills ship

- Both skills live in the official skills-only plugin `analysis-skills`: a plugin with skills and no
  programs (`../plugins/architecture.md` §2.1). It ships with the other official plugins inside the
  VERA package and updates through the catalog (PLG-07).
- During development it installs from a folder (PLG-01); its skills load through `load_skill` as
  source `plugin` (PLG-04). Before PLG-07 decides where bundled official plugins live, the proposed
  source folder is `05_Software/plugins/analysis-skills/`.

## 7. Verification

- Replay-provider tests prove tool wiring, citations, artifacts and todo items; no test calls a real
  model.
- A manual rubric run with a configured real model covers each skill's semantic cases and records
  the model and version, prompt, artifact and each criterion's result.
- Windows x64 and Linux x64. Each PLAN names focused commands; `npm run verify` closes each package.

NOTES:
- Paths: `core/…` and `shared/…` are under `05_Software/src/libraries/`; `apps/…` is under
  `05_Software/src/`; `tests/…` and `scripts/…` are under `05_Software/`. Line numbers refer to
  commit 33e72b8.
- The 2026-10-09 version of this package used a fictional `vera-log-v1` format and a RunRecord v1
  metadata schema; both are dropped.
