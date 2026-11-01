# parse_log — implementation plan

PURPOSE: build CAP-01 in three tasks. Spec: [SPEC](SPEC.md); shared rules: [contracts](../../contracts.md).
DONE-WHEN: all three tasks pass their tests on Windows x64 and Linux x64 and `npm run verify` passes.
STATUS: planned 2026-11-01. Implementation follows the repository's AEGIS workflow.

## Task 1 — schemas and profiles

- Create `shared/src/tools/parse-log.ts`: argument and result schemas (zod), the three built-in
  profiles and level normalization.
- Tests: defaults, exactly one of `profile`/`pattern`, limits, each profile against its sample lines,
  ANSI stripping, both ESP-IDF timestamp forms.

## Task 2 — worker task kind and scanner

- Generalize `WorkerPool` (`core/src/ports.ts:18`) with `kind: "grep" | "parse_log"` (contracts §4);
  update `core/src/workers/node-host.ts`, `apps/desktop/src/main/worker-pool.ts` and the grep caller in
  `core/src/tools/grep.ts`. Existing grep tests stay green unchanged.
- Add the parse_log worker entry next to the grep worker (`core/src/tools/grep-worker.ts`,
  `apps/desktop/src/main/grep-worker.ts`): stream the file, hash its bytes, match each line,
  count, collect events and checkpoints every 1 000 lines.
- Tests: counts and refs on the fixture logs, timeout returns a partial result, catastrophic
  pattern terminated, CRLF/BOM, size limits, changed file → `CONFLICT`.

## Task 3 — tool, registry, UI text and CLI

- Create `core/src/tools/parse-log.ts`; add `parse_log` to `builtinToolNames` (`shared/src/tools.ts`)
  and `builtinDefinitions` (`core/src/tools/registry.ts`).
- Add its description to the tool list in `apps/desktop/src/renderer/locales/{en,ro,de}.json`
  (beside `web_download`) so the workbench tool editor lists it.
- Extend the fixture per contracts §5 (`logs/boot-0413.log` and the `docs/` files); update
  `tests/fixtures/workbenches/demo-board.json`.
- Tests: replay test that calls `parse_log` and cites `logs/boot-0412.log#L3-L3`; disabled tool not
  offered; CLI parity through `vera run`; `npm run eval:retrieval` still passes.

NOTES:
- Commands: `npm test -- --run <test files>` for each task, then `npm run verify` from `05_Software/`.
