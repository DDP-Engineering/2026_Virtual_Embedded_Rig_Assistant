# decode_register Implementation Plan

PURPOSE: implement CAP-02, decoding captured values without precision loss or an implicit device
choice. STATE: planned; product implementation follows the repository's AGENTS.md when requested.
DONE-WHEN: the acceptance cases below pass on Windows and Ubuntu. This document authorizes no commit.

**Architecture:** shared schemas describe one register; a pure BigInt decoder operates on validated
data; a worker loads/confines the definition and a registry adapter exposes the read tool.
**Tech Stack:** planned TypeScript, zod, BigInt, Node worker threads, node:crypto and Vitest.
**Spec:** [SPEC.md](SPEC.md), [shared contracts](../../contracts.md).

## Global constraints and review focus

Depends on CAP-01 task 1's host adapter, WP-11 and, for integration, WP-13/WP-15. Work from
`05_Software/`. Definition limit 256 KiB; width 8/16/32/64; <=64 fields and <=16 enum values per field;
deadline 10,000 ms; result <=32,000 characters. No device I/O, network, shell or SVD dependency.

| Case | Owner |
|---|---|
| Bit 63 or uint64 max loses precision through Number/JSON | task 2 |
| Duplicate JSON keys or normalized enum aliases change the interpretation | task 1 |
| Wrong silicon revision or overlapping definitions yield a plausible decode | tasks 1 and 3 |
| Unknown bits are mislabeled reserved/faulty | task 2 |
| Path escape, stale definition, timeout or abort bypasses the shared host | task 3 |

## Task 1: Definition schema, JSON loading and fixture

**Files:** create `src/libraries/shared/src/tools/decode-register.ts` and `decode-register.test.ts`;
`src/libraries/core/src/tools/decode-register/definition.ts` and `definition.test.ts`;
`tests/fixtures/workbenches/demo-board/definitions/registers/reset-cause.json` and `docs/registers.md`.
**Interfaces:** produce the SPEC's schemas/types;
`parseRegisterDefinition(text: string): RegisterDefinition` and
`loadRegisterDefinition(root: string, path: string, signal: AbortSignal): Promise<{definition:
RegisterDefinition; source: {path: string; sha256: string; ref: string}}>`.
The bounded parser rejects duplicate object keys; the loader reuses file access and path guard.

- [ ] Write failing tests `definition_width_and_masks`, `duplicate_keys_and_enum_values`,
  `definition_source_and_size` and `definition_fixture_ranges`:

```ts
expect(RegisterDefinitionSchema.safeParse({ ...definition, widthBits: 24 }).success).toBe(false);
expect(RegisterDefinitionSchema.safeParse({ ...definition,
  fields: [{name: "A", lsb: 0, width: 2}, {name: "B", lsb: 1, width: 1}] }).success).toBe(false);
expect(() => parseRegisterDefinition('{"schemaVersion":1,"schemaVersion":2}')).toThrow();
```

- [ ] Run `npm test -- --run src/libraries/shared/src/tools/decode-register.test.ts src/libraries/core/src/tools/decode-register/definition.test.ts`;
  expect missing implementation/behaviour failures.
- [ ] Implement strict validation, mask/enum invariants and bounded JSON loading. Add the exact
  sample definition and its eight-line synthetic source. Detect duplicate keys with a bounded
  token scan; reject invalid JSON/UTF-8 without eval. Add nested/escaped key tests so duplicate-key
  detection does not mistake keys inside string values for object members.
- [ ] Rerun focused tests; definitions, source refs, size limits and unchanged input bytes pass.

## Task 2: Pure unsigned decoder

**Files:** create `src/libraries/core/src/tools/decode-register/decode.ts` and `decode.test.ts`.
**Interfaces:** consume validated RegisterDefinition; produce
`parseUnsignedValue(value: string, widthBits: 8 | 16 | 32 | 64): bigint` and
`decodeRegister(definition: RegisterDefinition, value: string): DecodedValue`.

- [ ] Write failing tests `sample_0x83`, `decimal_hex_equivalence`, `bits_31_and_63`,
  `all_widths_and_overflow`, `enum_match_and_unknown_bits` and `serializable_result`:

```ts
expect(decodeRegister(definition, "0x83"))
  .toMatchObject({valueHex: "0x83", valueDec: "131", unmappedMaskHex: "0xfc", unmappedSetBitsHex: "0x80"});
expect(parseUnsignedValue("18446744073709551615", 64)).toBe(18446744073709551615n);
expect(() => parseUnsignedValue("18446744073709551616", 64)).toThrow();
expect(() => parseUnsignedValue("1 << 7", 8)).toThrow();
```

- [ ] Run `npm test -- --run src/libraries/core/src/tools/decode-register/decode.test.ts`; expect failure.
- [ ] Implement unsigned BigInt parsing, extraction, enum lookup, unmapped masks and width padding.
  Add fixtures for hex uppercase, whitespace, zero/all bits, negative/sign/float/empty inputs,
  values at each width boundary, empty fields and partial final hex nibble for a field width.
- [ ] Rerun focused tests. Independently assert bit-63 extraction from `0x8000000000000000`,
  all-one masks and JSON round-trip with string values; no result contains a BigInt.

## Task 3: Worker, registry, citations and CLI

**Files:** create `src/libraries/core/src/tools/decode-register/{worker,index}.ts` and adjacent tests;
modify `src/libraries/core/src/tools/registry.ts`; create `src/libraries/core/test/decode-register.test.ts`,
`src/apps/cli/src/decode-register.test.ts`, `tests/fixtures/llm-scripts/decode-register-answer.jsonl`
and `tests/e2e/decode-register.test.ts`.
**Interfaces:** consume CAP-01 CapabilityWorkerHost and tasks 1/2. Produce
`executeDecodeRegister(root: string, args: DecodeRegisterArgs, host: CapabilityWorkerHost,
signal: AbortSignal): Promise<DecodedRegisterResult>` and the read-class registry entry.

- [ ] Write failing tests `exact_target_binding`, `definition_path_and_source_changes`,
  `decode_worker_timeout_abort_and_replacement`, `disabled_decode_rejected` and `replay_cli_decode`.
  Assert target revision B with the A definition yields CONFLICT; an ignored/external/symlinked path
  is denied; a fabricated disabled call is rejected; a replay result cites the definition file.
- [ ] Run `npm test -- --run src/libraries/core/src/tools/decode-register src/libraries/core/test/decode-register.test.ts src/apps/cli/src/decode-register.test.ts`;
  expect integration failures from missing entry points.
- [ ] Register worker dispatch and the normal tool-result/error adapter; validate target identity
  before returning a decode. Use standard transcript rows and citation handling. Add a worst-case
  allowed field/enum-label fixture to prove the result ceiling without dropping fields.
- [ ] Rerun focused tests. CLI integration launches `vera run` on a temporary demo copy and expects
  the same 0x83 decode and exit 0. Run `npm run test:e2e -- tests/e2e/decode-register.test.ts`, then
  `npm run verify`. Record both platforms and worker recovery evidence.

## Done

CAP-02 is complete when definition validation, numeric boundaries and the ordinary agent/CLI path
pass with reproducible source refs. SVD import, live-register reads and interpretation of a real
manufacturer's map remain separate work, not implicit acceptance criteria.
