# REQ-DATA-d7e27def — Industrial catalog, format 1, and documented selection

## Behavior

An industrial catalog holds manufacturer data for low-voltage equipment (contactors, protection devices,
motors, drives, PLC and I/O modules, accessories) as one JSON file per catalog in the workbench folder
`electrical-automation-catalogs/`, named `<catalog id>.json`. The engineer writes or imports these files
(the ordinary approved file write); VERA reads them strictly and never repairs, defaults or migrates them.
The plugin `industrial-catalog` (ecosystem `electrical`) brings the selection skill; the tool
`industrial_catalog` is offered with the other electrical tools (REQ-SEC-4dfa2a5b).

Separations kept by the format:

- Manufacturer order code versus distributor SKU: an item is identified by its family's manufacturer and
  its `orderCode`; distributor SKUs live only in `distributors` with the time they were captured. A
  distributor's own parameter texts are never catalog parameters.
- Item versus variant: items that differ only in a variant attribute (a coil voltage) share
  `variant.base` and stay separate items with separate parameters.
- Item versus accessory: an accessory is its own item; `accessories` only references it. Its
  parameters are never evaluated for the item that lists it.
- Confirmed versus extracted: a parameter typed and checked against its source is `confirmed`; one
  taken from a PDF or table extraction and not yet checked is `extracted` and never decides a firm
  requirement.
- Value versus unknown: `value: null` is unknown, never zero; an absent parameter is unknown.

The catalog quantity shape is the electrical model's quantity (REQ-DATA-06c0bd54): `{value, unit, basis,
conditions?, source, note?}`, units from the one unit table (`core/src/electrical/units.ts`).

## Data / interface

### Catalog document

```json
{
  "kind": "vera-industrial-catalog",
  "format": 1,
  "id": "cat-schneider-tesys",
  "version": "2026-11-15.1",
  "title": "...",
  "sources": [Source],
  "families": [Family],
  "items": [Item],
  "coordination": [CoordinationTable]
}
```

All objects are strict (an unknown key is a problem); text, key and ID rules are the electrical model's.

- `id`: an electrical ID (`cat-...`), equal to the file name without `.json`. `version`: text, the
  catalog revision that results cite as `catalog: {id, version}`.
- Source: the model's source (`id`, `kind`, `title`, optional `publisher`, `revision`, `date`, `uri`)
  plus required `license` (text: the terms under which the values are held, e.g. "public product page;
  values quoted with citation"). A `uri` must be `https:` or `http:`, without user information and
  without a query or fragment parameter whose name contains `key`, `token`, `secret`, `passw`, `auth`, `sig`,
  `credential`, `session`, `sid`, `jwt`, `bearer` or `cookie`, ignoring case (REQ-SEC-07040413).
- Family: `id`, `manufacturer` (text), `name` (text), `category` (text, e.g. `contactor`,
  `motor-circuit-breaker`, `auxiliary-contact-block`), optional `note`.
- Item: `id`, `family` (a family ID), `orderCode` (1..64 characters, no control characters, unique per
  manufacturer, compared exactly), optional `name`, `variant` {`base`: text, `label`: text},
  `attributes` {key: text|boolean} (<=64), `parameters` [Parameter] (<=256), `accessories`
  [{`item`: item ID, `role`: text, `note`?}] (<=32; never the item itself), `distributors`
  [{`supplier`: text, `sku`: text, `capturedAt`: ISO date-time with offset, `uri`?}] (<=16).
- Parameter: a quantity with required `name` (key), required `source` {`id`: source ID, `page`?: text,
  `table`?: text} and required `status` (`confirmed`|`extracted`). Datasheet values are typed with basis `input`; the basis is not
  evaluated by the selection.
  Conditions are the model's conditions ({`value`, `unit`} or {`text`}). A bound in a condition is
  written as a key ending in `Min` or `Max` (`voltageMax: 440 V` = "at <= 440 V"); a range is both.
- CoordinationTable: `id`, `title`, `kind` (text, e.g. "fuse coordination type 2"), `conditions`
  (record of conditions, may be empty), `entries` [{`items`: [item ID] (1..4, distinct), `parameters`
  [Parameter] (1..16, each citing its own source), `note`?}] (1..200).
- Limits: 200 sources, 100 families, 2000 items, 100 coordination tables, file 4 MiB, 50 catalog files
  listed.
- Units: every unit is in the unit table; a known property name (`ratedCurrent`, `breakingCapacity`,
  ...) takes only units of its dimension; a condition key that is a known property, or is one with `Min`/`Max`
  removed (`voltageMax` -> `voltage`), takes only units of that dimension; other condition units need only be in
  the table.

Every reference resolves: item → family, parameter/table → source, accessory/entry → item; IDs are unique
across sources, families, items and tables; (manufacturer, orderCode) is unique.

### Tool `industrial_catalog` (read)

`{view: "list"}` → `{path, catalogs: [{file, id?, version?, title?, sha256?, families?, items?, tables?,
valid, problem?}]}`, at most 50 files sorted by name; a broken file is `valid: false` with its first
problems; a missing folder gives an empty list.

`{view: "items", catalog, orderCode? | sku?, family?, category?, offset?}` → items (<=50 per page), each
with its family, manufacturer, variant, accessories (order codes), distributors and parameters; with
`orderCode` or `sku` each item carries `match: "order-code"` or `"distributor-sku"` (exact, case
sensitive after trimming).

`{view: "select", catalog, family?, category?, requirements: [Requirement] (1..32)}` → Selection.

`{view: "coordination", catalog, items: [item ID] (1..4), conditions?}` → Coordination.

Requirement: `{id, parameter, op: ">=" | "<=" | "==", value: {value, unit} | {text}, conditions?}`.
A `{text}` requirement compares (`==` only, case-insensitive, trimmed) with the item attribute of that
name; a numeric one with the item's parameters of that name.

### Selection algorithm

For each item of the catalog (after `family`/`category` filters; accessories are items of their own
family and are evaluated only when their family is selected):

1. For each requirement, collect the item's parameters of that name with a value (`null` counts as absent).
   None → `unknown`, reason `absent`. A `{text}` requirement reads the item attribute of that name instead.
2. Keep values whose conditions cover the requested conditions: each requested condition `c` is met by a
   parameter condition `c` (equal number after unit scaling, or equal text ignoring case), by `cMin`
   (requested >= bound) and/or `cMax` (requested <= bound). A parameter condition the request does not
   name is reported with the evidence but does not exclude the value. None left → `unknown`, reason
   `conditions` (with the condition sets available).
3. Of those, only `confirmed` values decide. None → `unknown`, reason `unconfirmed`.
4. With several deciding values the most conservative one counts (the smallest for `>=`, the largest for
   `<=`; for `==` all must be equal). Compare after scaling both to the dimension's base unit; a
   numeric requirement whose unit's dimension differs from the parameter's is refused as a bad request.
5. Verdict `pass` or `fail`, with `measured` (the deciding value) and `limit` (the requirement).

Outcome per item: `eliminated` when any requirement fails, else `unknown` when any is unknown, else
`eligible`. Order: eligible, unknown, eliminated; then by `orderCode`, then by item ID. Price, stock and
name similarity are never used and are not equivalence.

Selection output: `{catalog: {id, version, sha256, path}, requirements, counts {eligible, unknown,
eliminated}, items: [{id, orderCode, manufacturer, family, category, name?, variant?, outcome, criteria:
[{requirement, verdict, reason?, measured?, limit, available? (condition sets on offer, reason conditions),
evidence?: {value, unit, conditions?, status, source: {id, kind, title, publisher?, revision?, date?, uri?,
license, page?, table?}}}], accessories: [{item, orderCode, role, note?}], distributors}], commercial:
"Distributor SKUs and capture times are as recorded in the catalog; nothing was looked up live. Price, stock
and similar names are not evidence of equivalence."}`. An `unconfirmed` criterion carries the extracted value
as `evidence` so that it can be checked. Identical input gives identical output (REQ-REL-6546e9a4).

### Coordination lookup

Entries of every table whose `items` set equals the requested set are `applicable` when the requested
conditions satisfy the table's conditions with the same rules as step 2, and every table condition is
named in the request; otherwise `not-applicable` with reason `conditions` (named) or `missing-condition`.
Entries naming any of the requested items with another set are listed as `not-applicable`, reason
`other-products`; entries naming none of them are not listed. An applicable entry lists under `unevaluated`
the requested conditions its table does not name: it states nothing about them. Each returned entry carries its parameters with their sources (page/table) and the
catalog id, version and SHA-256.

## Examples

- Requirement `{id: "ie", parameter: "ratedCurrent", op: ">=", value: {value: 9, unit: "A"}, conditions:
  {utilisationCategory: {text: "AC-3"}, voltage: {value: 400, unit: "V"}}}` passes LC1D09P7 (9 A, at
  AC-3, voltageMax 440 V, ambientTemperatureMax 60 °C).
- `{parameter: "breakingCapacity", ...}` on a contactor → unknown, reason absent.
- Coordination for [LC1D09P7] at `voltage: 400 V`, `circuit: power` → type 2 entry `fuseRating` 20 A (gG);
  for [LC1D12P7] the LC1D09P7 entry is not returned; at 1000 V → not-applicable, reason conditions; without
  `voltage` → not-applicable, reason missing-condition (`voltageMax`).

## Acceptance

The focused tests named by the requirements of TASK-15cb5dad pass on Windows and Linux (WSL2).

## Assumptions and open decisions

- Product web pages without a document revision are cited with the capture date as `revision`
  (OBSERVED: se.com UK pages show no revision).
- Manufacturer coordination tables that are licensed (vendor selection guides) are not in the fixture;
  the fixture uses the per-product fuse coordination values published on each product page.
