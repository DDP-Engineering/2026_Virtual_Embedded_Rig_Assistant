# decode_register specification

Status: proposed. ID: CAP-02. Kind: internal `read` tool.
Read [shared contracts](../../contracts.md) and [implementation plan](PLAN.md).

## 1. Purpose and boundary

Decode an already captured unsigned register value against a local, explicitly identified device
definition. This is numeric interpretation of supplied data. It does not read or write a device,
interpret firmware binaries, execute expressions or infer a hardware fault from one flag.

MVP uses one JSON definition per register. CMSIS-SVD ingestion and byte-dump endianness are later
extensions. The request names the expected device, revision and register; a mismatch is an error.

## 2. Definition format

`RegisterDefinitionSchema` in `packages/shared/src/tools/decode-register.ts` validates this shape:

```json
{
  "schemaVersion": 1,
  "device": { "id": "VERA-DEMO-01", "revision": "A" },
  "name": "RESET_CAUSE",
  "widthBits": 8,
  "sourceRefs": ["docs/registers.md#L1-L8"],
  "fields": [
    { "name": "POR", "lsb": 0, "width": 1,
      "enumeratedValues": [{ "value": "0", "label": "not_set" }, { "value": "1", "label": "set" }] },
    { "name": "WATCHDOG", "lsb": 1, "width": 1,
      "enumeratedValues": [{ "value": "0", "label": "not_set" }, { "value": "1", "label": "set" }] }
  ]
}
```

Objects are strict. widthBits is 8, 16, 32 or 64; at most 64 fields; names/identities 1–80 characters;
lsb is a non-negative integer, width a positive integer, and lsb+width must fit the register.
Field names are unique and masks must not overlap. Empty fields are allowed and leave all bits unmapped.
Optional descriptions are at most 256 characters; enumeratedValues contains at most 16 entries per
field, labels up to 80 characters, with distinct normalized unsigned values fitting the field width.
Definition sourceRefs has 1–8 entries, each at most 256 characters, using workbench-local line refs.
No remote source, alias field, inherited definition or executable formula is accepted.

The definition file is UTF-8, at most 256 KiB, with an optional BOM. Invalid JSON, duplicate JSON
object keys, an unsupported version or an invalid definition produces INVALID with a stable reason.
The parser detects duplicate keys instead of accepting JSON.parse's last-key-wins behaviour.

## 3. Tool contract

```ts
type DecodeRegisterArgs = {
  definitionPath: string; value: string;
  deviceId: string; deviceRevision: string; register: string;
};
type DecodedValue = {
  register: string; widthBits: 8 | 16 | 32 | 64;
  valueHex: string; valueDec: string;
  fields: { name: string; lsb: number; width: number;
            valueHex: string; valueDec: string; enumLabel: string | null }[];
  unmappedMaskHex: string; unmappedSetBitsHex: string;
};
type DecodedRegisterResult = DecodedValue & {
  device: { id: string; revision: string };
  definition: { path: string; sha256: string; ref: string };
  declaredSourceRefs: string[];
};
```

Export `DecodeRegisterArgsSchema`, `RegisterDefinitionSchema`, `DecodedRegisterResultSchema` and
inferred types, including `DecodedValue`. Input paths are at most 256 characters. Value accepts
unsigned decimal or `0x`/`0X` hexadecimal with outer whitespace trimmed;
limit is 80 characters. Negative numbers, signs, floats, arithmetic, partial parses and overflow
are rejected. All arithmetic uses BigInt; no conversion of full register values to Number.
Return decimal strings and lowercase hex, padded to the relevant width in nibbles. BigInt never
crosses IPC or JSON. Fields are returned by increasing lsb; enumLabel=null means no declared match.

For the sample definition and value `0x83`: valueDec=`131`, POR=`1`, WATCHDOG=`1`, both labels `set`,
unmappedMaskHex=`0xfc` and unmappedSetBitsHex=`0x80`. Unmapped bits are reported; they are not
assumed reserved or erroneous. Descriptions are read from the definition when needed, not echoed
for every field in the result.

## 4. Provenance, execution and errors

- File guard and bounded worker host are those of CAP-01/WP-11. Full definition loading, validation,
  duplicate-key detection and decoding run in the worker, with the 10,000-ms absolute deadline.
- Result definition.ref covers its physical lines and sha256 hashes the exact original bytes.
  Declared source refs must have valid syntax and confined, non-ignored paths. Citation existence
  and line bounds are checked by the ordinary resolver when cited. The tool does not certify that
  a manufacturer's document agrees with a user-authored mapping; the skill must inspect the source.
- Requested device/revision/register must exactly match the definition. No automatic fallback to
  another device, filename guess or silent field truncation occurs.
- Missing definition -> NOT_FOUND; path refusal -> DENIED; invalid value/definition -> INVALID;
  requested-target mismatch or observed source change -> CONFLICT. Timeout is INVALID with reason
  `deadline_exceeded`; abort uses the runtime's aborted outcome. Files are unchanged.
- Results must fit the global 32,000-character limit; test worst-case metadata, including JSON escaping.
  An oversized mandatory result is an explicit INVALID error with reason `result_too_large`,
  never a partly decoded register or invalid JSON.

## 5. Acceptance

The sample decode, all four register widths, bits 31/63, uint64 max, decimal/hex equivalence,
normalized enum duplicates, overlapping/out-of-range fields, incorrect target, unknown set bits,
bad UTF-8/JSON/duplicate keys, size/deadline/abort, confinement and JSON round-trip have tests.
Replay and CLI return the same values and reference; the next worker task succeeds after termination.
