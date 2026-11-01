# decode_register — specification

PURPOSE: CAP-02, an internal `read` tool that decodes a captured register value against a local
definition file, field by field, without precision loss.
DONE-WHEN: the acceptance cases of §5 pass on Windows x64 and Linux x64. Shared rules:
[contracts](../../contracts.md); work: [PLAN](PLAN.md).
STATUS: rewritten 2026-11-01; nothing implemented yet.

## 1. Boundary

The tool interprets a value the user or a log already supplied. It never reads or writes a device,
evaluates expressions or infers a fault from one flag. Reading a live register is a plugin command
(OpenOCD or GDB, `device-read`); its output can then be decoded here. Importing CMSIS-SVD files
into this format is a later extension.

## 2. Definition file

One JSON file per device, holding several registers:

```json
{
  "schemaVersion": 1,
  "device": { "id": "VERA-DEMO-01", "revision": "A" },
  "sourceRefs": ["sources/reference-manual.md#L7-L7"],
  "registers": [
    { "name": "I2C1_CR1", "widthBits": 32, "address": "0x40005400",
      "fields": [
        { "name": "PE", "lsb": 0, "width": 1 },
        { "name": "TXIE", "lsb": 1, "width": 1 },
        { "name": "RXIE", "lsb": 2, "width": 1 },
        { "name": "ERRIE", "lsb": 7, "width": 1 }
      ] }
  ]
}
```

- `widthBits` is 8, 16, 32 or 64; at most 512 registers and 64 fields per register; names unique;
  `lsb + width ≤ widthBits`; field masks never overlap.
- Optional per field: `description` (≤ 256 characters) and `enum` (≤ 16 `{value, label}` entries
  with distinct values that fit the field).
- `sourceRefs`: 1…8 workbench line references; per-register `sourceRefs` are optional.
- UTF-8, at most 1 MiB. Duplicate JSON keys are refused: parse with the `yaml` package and
  `uniqueKeys: true` (JSON is valid YAML), as `core/src/skills/catalog.ts` already does for skill
  frontmatter.

## 3. Arguments and result

```ts
type DecodeRegisterArgs = {
  definitionPath: string;                  // workbench-relative, ≤ 256 characters
  register: string;
  value: string;                           // unsigned decimal or 0x/0X hexadecimal, ≤ 80 characters
  device?: { id: string; revision?: string };   // when given, must match the definition
  expectedSha256?: string;
};
type DecodeRegisterResult = {
  device: { id: string; revision: string };
  register: string; widthBits: 8 | 16 | 32 | 64; address?: string;
  valueHex: string; valueDec: string;
  fields: { name: string; lsb: number; width: number; valueHex: string; valueDec: string;
            label: string | null }[];
  unmappedMaskHex: string; unmappedSetBitsHex: string;
  source: { path: string; sha256: string; ref: string };
  sourceRefs: string[];
};
```

- All arithmetic uses BigInt; numbers cross JSON as strings. Hex is lowercase and padded to the
  register width. Signs, fractions, expressions and values wider than the register are refused.
- Fields are returned by increasing `lsb`. `label: null` means no declared enum value matches.
  Unmapped set bits are reported, never called reserved or faulty.
- `source.ref` covers the whole definition file. Schemas live in `shared/src/tools/decode-register.ts`.

## 4. Execution and errors

Runs in the main process (contracts §4): the file read is capped at 1 MiB and decoding is constant
time. Missing file → `NOT_FOUND`; path refused → `DENIED`; invalid value or definition, duplicate
keys, unknown register → `INVALID`; `device` mismatch, changed file or `expectedSha256` mismatch →
`CONFLICT`.

## 5. Acceptance

- `definitions/registers/vera-demo-01.json`, `I2C1_CR1`, value `0x81`: `valueDec` `129`; PE 1, TXIE 0,
  RXIE 0, ERRIE 1; `unmappedMaskHex` `0xffffff78`; `unmappedSetBitsHex` `0x00000000`.
- Decimal and hexadecimal inputs give identical results; bit 63 and `0xffffffffffffffff` survive a JSON
  round trip.
- Overlapping fields, a field beyond the width, duplicate keys, duplicate enum values and a wrong
  `device` are refused.
- Agent and CLI return identical results; a replay answer cites the definition and the reference
  manual line.
