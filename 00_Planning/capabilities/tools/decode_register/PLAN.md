# decode_register — implementation plan

PURPOSE: build CAP-02 in two tasks. Spec: [SPEC](SPEC.md); shared rules: [contracts](../../contracts.md).
DONE-WHEN: both tasks pass their tests on Windows x64 and Linux x64 and `npm run verify` passes.
STATUS: planned 2026-11-01. Implementation follows the repository's AEGIS workflow. Independent of
CAP-01: no worker is needed.

## Task 1 — schema, parser and decoder

- Create `shared/src/tools/decode-register.ts`: definition, argument and result schemas (zod).
- Create `core/src/tools/decode-register/definition.ts`: load through the path guard with a 1 MiB
  cap, parse with `yaml` `parseDocument(text, { uniqueKeys: true })`, validate widths, masks and enums.
- Create `core/src/tools/decode-register/decode.ts`: pure BigInt decoding.
- Tests: the 0x81 example, all four widths, bit 63 and the 64-bit maximum, decimal/hex equivalence,
  overlap and width errors, duplicate keys, duplicate enum values, unmapped set bits.

## Task 2 — tool, registry, UI text, fixture and CLI

- Create `core/src/tools/decode-register.ts`; add `decode_register` to `builtinToolNames`
  (`shared/src/tools.ts`) and `builtinDefinitions` (`core/src/tools/registry.ts`).
- Add its description to `apps/desktop/src/renderer/locales/{en,ro,de}.json` beside the other tools.
- Add `definitions/registers/vera-demo-01.json` to the fixture (contracts §5) and to
  `tests/fixtures/workbenches/demo-board.json`.
- Tests: replay answer citing the definition and `sources/reference-manual.md#L7-L7`; `device`
  mismatch; changed file; disabled tool not offered; CLI parity.

NOTES:
- Commands: `npm test -- --run <test files>`, then `npm run verify` from `05_Software/`.
