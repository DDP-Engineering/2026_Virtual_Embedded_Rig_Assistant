# REQ-DATA-6b26f2a5 — parts-compare 1.0.0: request, evidence rules and outputs

Program of the official plugin `parts-search` (`05_Software/plugins/parts-search/`): `parts-compare`, a
standard-library PEP 723 script (`scripts/parts_compare.py` with the support package `scripts/parts_support/`).
It compares candidate components against a structured request, offline: it opens no network connection, places
no order and changes no schematic, BOM or source file. Its path, run-id, output-size and run-folder rules are
those of `elec-calc` (spec REQ-DATA-3d15fdfc §1, §4 size rule, §8 results directory), through a byte-identical
copy of `workspace.py`.

## 1 Command line

```text
parts-compare --version                  prints "parts-compare <version>"
parts-compare --help | -h
parts-compare compare (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
```

Default results directory `electronics-results`. Exit codes: `0` completed (`status: "ok"`, whatever the
candidates' outcome), `2` refused arguments or request (`status: "error"`), `3` an input or output failure after
the request was accepted. JSON rules as elec-calc §2 (unique keys, finite numbers, exact keys; free text 1..500
characters on one line without control characters; all problems of one pass reported together).

## 2 Request

```json
{
  "title": "Low-side switch, 24 V / 5 A, 3.3 V gate drive",
  "quantity": 100,
  "currency": "EUR",
  "constraints": [
    {"id": "vds", "parameter": "VDS", "op": ">=", "value": "30 V"},
    {"id": "rdson", "parameter": "RDS(on)", "op": "<=", "value": "40 mΩ",
     "conditions": {"VGS": {"op": "<=", "value": "3.3 V"}}}
  ],
  "preferences": [{"parameter": "RDS(on)", "goal": "min"}, {"criterion": "price"}],
  "replaces": {"manufacturer": "...", "mpn": "...", "pinout": "1=G 2=S 3=D", "footprint": "SOT-23"},
  "candidates": [
    {"manufacturer": "...", "mpn": "...", "package": "SOT-23",
     "datasheet": {"url": "https://...", "revision": "Rev. 3"},
     "pinout": {"value": "1=G 2=S 3=D", "page": 1},
     "footprint": {"value": "SOT-23", "page": 9},
     "parameters": [
       {"name": "RDS(on)", "value": "32 mΩ", "basis": "max", "conditions": {"VGS": "2.5 V", "ID": "3 A"},
        "source": {"kind": "datasheet", "page": 2, "table": "Electrical characteristics"}, "status": "confirmed"},
       {"name": "VGS(th)", "value": "0.9 V", "basis": "max",
        "source": {"kind": "datasheet", "page": 2}, "status": "confirmed"}
     ],
     "offers": [
       {"supplier": "mouser", "sku": "...", "packaging": "Cut Tape", "stock": 1200, "moq": 1, "multiple": 1,
        "currency": "EUR", "priceBreaks": [{"quantity": 1, "unitPrice": 0.42}, {"quantity": 100, "unitPrice": 0.21}],
        "retrievedAt": "2026-11-13T10:00:00Z", "region": "RO", "url": "https://..."}
     ]}
  ]
}
```

- `title` text; `quantity` integer 1..1 000 000 000; `currency` optional 3 capital letters.
- `constraints` 1..64, unique `id` (`^[a-z0-9][a-z0-9-]{0,63}$`); `op` `<=`, `>=`, `==` or `in`; `value` a
  quantity (text such as `"40 mΩ"` or `{"value", "unit"}`) for `<=`/`>=`/`==`, a text for `==`, a list of 1..32
  texts for `in`; `conditions` optional, 1..8 names (1..40 characters) each `{op: "<=" | ">=" | "==", value:
  quantity}`.
- `preferences` 0..16 in priority order: `{"parameter", "goal": "min" | "max"}` or `{"criterion": "price" |
  "stock"}`.
- `replaces` optional: `manufacturer`, `mpn`, `pinout`, `footprint` texts.
- `candidates` 1..64: `manufacturer`, `mpn` (texts), `package` (text or null), `datasheet` optional `{url,
  revision?}`, `pinout` / `footprint` optional `{value, page}`, `parameters` 0..128, `offers` 0..32.
- A parameter: `name`; `value` a quantity or text; `basis` `min`, `typ`, `max`, `nominal` or `rating`;
  `conditions` optional, name -> quantity; `source` `{"kind": "datasheet", "page"?, "table"?, "figure"?}` or
  `{"kind": "supplier", "supplier", "sku"?}`; `status` `confirmed` or `proposed`.
- An offer: `supplier`, `sku`, `retrievedAt` (ISO 8601 date-time with zone, not more than 5 minutes after the
  run starts), `priceBreaks` 0..32 `{quantity >= 1, each quantity once per offer, unitPrice 0..1e9 or null}`; optional `packaging`, `stock`, `moq`,
  `multiple` (non-negative integers or null), `currency` (3 capital letters or null), `region`, `url`.
- A value is a quantity when its text starts with a number (a sign or a leading dot belongs to the number: `-30 V`,
  `.5 V`), otherwise a text. A text constraint (`in`, or `==` with a text) compares a row by its text as written,
  whichever way the row was read (case sizes such as `0603`).
- Quantities: a number and a unit; the unit is an SI prefix (`p n u µ μ m k M G`) and a base among `V A Ω ohm Ohm W
  F H Hz s C °C K K/W °C/W % dB V/s` (also `V/us`, `V/µs`), or any other unit text, which compares only with the same text.

## 3 Evidence and evaluation

- A parameter row is evidence for a constraint only when: its `name` equals the constraint's `parameter`
  (compared without letter case and surrounding space); `status` is `confirmed`; `source.kind` is `datasheet`
  with a `page` or `table`; every condition of the constraint is stated in the row's `conditions` (same name,
  without letter case) with a value of the same dimension that satisfies the condition; and its `basis` fits the
  operator - `max`, `nominal` or `rating` for `<=`, `min`, `nominal` or `rating` for `>=`, any for `==`/`in`.
  A row of another name - `VGS(th)` for `RDS(on)` - is never evidence.
- Constraint outcome per candidate: no evidence row -> `unknown`, with one reason per rejected row (`proposed, not
  confirmed`, `supplier value, not datasheet`, `typical value is not a guarantee`, `VGS 4.5 V does not meet VGS <=
  3.3 V`, `condition VGS not stated`, `unit not comparable`); otherwise the worst evidence value (largest for
  `<=`, smallest for `>=`; for `==`/`in` every evidence value must match) decides `pass` or `fail`.
- Candidate outcome: `rejected` if a constraint fails; `eligible` if all pass; otherwise `unknown`.
- Order: eligible candidates ranked by the preferences in priority order (a parameter goal uses the worst confirmed datasheet value with a page or table and the basis that proves the
  matching limit - `max`, `nominal` or `rating` for `min`, `min`, `nominal` or `rating` for `max` - without
  conditions; values rank only in one unit - the first recognised unit an eligible device states, in request order, else the
  first unit text - and others rank as without a value with a warning; an eligible candidate without one ranks after those with one; `price` uses the lowest
  extended price (unit price x order quantity, §4) among offers in the request's `currency`, or in the single currency every priced
  offer shares - otherwise the preference is skipped with a warning (different currencies, or no priced offer); `stock` the largest
  declared stock), ties in request order; then `unknown` candidates in request order; then `rejected`. The
  proposed device is the first eligible one; with none, nothing is proposed, whatever the prices.
- Identity: candidates with the same manufacturer (compared without letter case and surrounding space), MPN
  (likewise) and package (likewise, null equal to null) are one device: their offers, parameters and evidence are
  merged, with a warning naming the merged entries; each evidence row keeps the datasheet of its own candidate. The same manufacturer and MPN with another package stays a
  separate device, with a warning. Candidates of different MPN are always separate devices.
- Replacement: with `replaces`, each device is `drop-in: yes` only when its `pinout.value` and `footprint.value`
  are stated with a page and equal those of `replaces` (letter case and runs of spaces ignored), `no` when a
  stated one differs, otherwise `unknown`.

## 4 Offers

- Order quantity: the request quantity raised to the offer's `moq` and then to a whole `multiple` (when known).
  Unit price: the break with the largest `quantity` not above the order quantity; none, or a null price ->
  unknown. Extended price = unit price x order quantity. Stock covers the order when it is known and not smaller.
- Every offer is labelled `snapshot` with its `retrievedAt` and `stale: true` when it is older than 24 hours at the
  start of the run. Taxes, shipping and future availability are never added or estimated.

## 5 Outputs

Run folder `<results-dir>/<run-id>/`, created exclusively, holding:

- `comparison.json`: `format: 1`, `kind: "parts-comparison"`, tool, runId, times, `request` (origin, sha256,
  path), `title`, `quantity`, `currency`, `constraints`, `preferences`, `devices[]` (`rank` or null, `outcome`,
  `manufacturer`, `mpn`, `package`, `mergedFrom`, `dropIn`, `checks[]` {`constraint`, `status`, `value`,
  `evidence[]` {`value`, `unit`, `basis`, `conditions`, `source` with the datasheet URL and revision}, `reasons[]`},
  `unconfirmedValues[]` (supplier rows and proposed rows, never evidence), `offers[]` (§4 fields)), `proposed` (device index or
  null), `warnings`, `limits`.
- `comparison.md`: the same for reading - a summary table, then per device its checks with values, conditions and
  sources, its offers with capture time and stale state, and the limits.
- `bom.csv` (UTF-8, CRLF, RFC 4180 quoting): header `Status,Quantity,Manufacturer,MPN,Package,Supplier,SKU,
  Packaging,OrderQuantity,UnitPrice,Currency,CapturedAt,Stale`; one row `proposed` for the proposed device with its
  offer of the lowest extended price in the comparable currency (supplier columns empty when no offer is comparable), or no data
  row when nothing is proposed.

Standard output: the header of elec-calc §4 with `kind: "parts-compare-summary"`, `operation: "compare"`,
`artifacts` [{`kind`: `comparison-json` | `comparison-markdown` | `bom-csv`, `path`, `bytes`, `sha256`}],
`devices` [{`mpn`, `outcome`, `rank`}], `proposed` (MPN or null) and `warnings`, within 11 000 UTF-16 units. A
failure after the folder is created removes everything the run created and exits 3; the input file is hashed
before and after.

## Acceptance

E03-C (24 V / 5 A with 3.3 V drive: RDS(on) given only at VGS 10 V and VGS(th) 0.9 V -> `unknown`, never
`pass`; a proposed row stays unknown), E03-D (two SKUs - cut tape and reel - of one MPN and package -> one device
with two offers; pinout variants with different MPN -> two devices), E03-E (every check names its evidence and
source; the run writes only into its run folder and opens no network connection), E03-F offline part (a labelled
snapshot is evaluated with capture times and stale flags).
