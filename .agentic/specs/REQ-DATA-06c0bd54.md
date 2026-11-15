# REQ-DATA-06c0bd54 — Electrical project model and results, format 1

## Behavior

The workbench owns one electrical project model, the file `electrical-automation-model.json` at the
workbench root. VERA reads it strictly, never repairs, defaults or migrates it, and changes it only
through `electrical_model_change`: a prepared change with a diff, the before hash and the write queue,
like a file write. Plugins read the file and write their results; they never write the model.

Results of electrical plugins live in `electrical-automation-results/<run-id>/result.json`. A result
copies the model entities it read (`inputs[].snapshot`). VERA derives a result's freshness from those
copies on every listing: there is no second store and VERA never rewrites a result.

Separations kept by the format:

- Identity versus label: an entity `id` is stable and never shown as the reference; `ref` (M1, QF1,
  -K1) is the visible reference and may change without changing the identity.
- Value versus unknown: `value: null` is unknown; it is never read as zero.
- Basis: every quantity says whether it is an `input`, a `requirement`, an `assumption`, a `proposal`
  or `measured`.
- Provenance: a quantity cites a model source by ID (and a page); a source records its title,
  publisher, revision and date.

## Data / interface

### Model document

```json
{
  "kind": "vera-electrical-model",
  "format": 1,
  "project": {"id": "prj-...", "name": "...", "profile": {...}},
  "sources": [Source],
  "objects": [Object],
  "relations": [Relation]
}
```

All objects are strict: an unknown key is a problem. Required keys are listed; optional keys may be
absent but never `null` unless stated.

- ID: `^[a-z][a-z0-9]*(-[a-z0-9]+)+$`, at most 64 characters (lowercase words joined by `-`, at least
  two words, e.g. `mot-p1`, `rel-7f3a9c2e`). One namespace for the project, sources, objects and
  relations. Generated IDs are `<prefix>-<8 lowercase hex>`; prefixes per object type are in
  `electricalIdPrefixes` (motor `mot`, circuit `cir`, ...), `src` for sources, `rel` for relations.
- Text: 1..200 characters without control characters; long text (notes, limits, assumptions) up to
  1000.
- Key (property, attribute and condition names): `^[a-z][A-Za-z0-9]{0,63}$`.
- `project`: `id`, `name`, `profile` {`jurisdiction`: text|null, `domain`: text|null, `standards`:
  [{`id`: text, `edition`: text|null}] (<=50), `limits`: [long text] (<=50)}. The profile records
  what the project applies; it states no conformity.
- Source: `id`, `kind` (`datasheet`, `standard`, `drawing`, `measurement`, `user`, `calculation`,
  `other`), `title`, optional `publisher`, `revision`, `date` (text), `uri` (<=2000 characters). Power-source objects (type `source`) get the ID prefix `sup`.
- Object: `id`, `type`, optional `ref` (1..64 characters, no control characters), `name`, `note`
  (long text), `attributes` {key: text|boolean} (<=64), `properties` {key: Quantity} (<=64).
  Object types: `source`, `board`, `busbar`, `circuit`, `cable`, `load`, `motor`, `protection`,
  `device`, `terminal`, `sensor`, `actuator`, `io`, `tag`, `document`. Lighting is a `load` with
  attribute `category: "lighting"`; an I/O channel is an `io` with attribute `signal` (DI, DO, AI, AO
  or any text).
- Quantity: `value` (finite number or `null` = unknown; the key is required), `unit` (from the unit
  table), `basis`, optional `conditions` {key: Condition} (<=16), `source` {`id`: source ID, `page`:
  text optional}, `note` (long text).
- Condition: `{"value": finite number, "unit": unit}` or `{"text": text}`.
- Relation: `id`, `type`, `from`, `to` (object IDs), optional `note`.

Limits: 1000 sources, 5000 objects, 20000 relations; the file at most 8 MiB.

### Units

One table (`core/src/electrical/units.ts`), spelled like electronics-calc (`Ω` is U+03A9, `°C`,
`µ` U+00B5). No aliases: one spelling per unit.

| Dimension | Units |
|---|---|
| voltage | V, kV, mV |
| current | A, kA, mA |
| power | W, kW, MW |
| apparent-power | VA, kVA, MVA |
| reactive-power | var, kvar, Mvar |
| energy | J, Wh, kWh, MWh |
| frequency | Hz |
| resistance | Ω, mΩ, kΩ |
| capacitance | F, mF, µF |
| inductance | H, mH, µH |
| length | mm, m, km |
| area | mm² |
| time | ms, s, min, h |
| temperature | °C, K |
| ratio | 1, % |
| speed | rpm |
| torque | Nm |
| luminous-flux | lm |
| illuminance | lx |
| luminous-efficacy | lm/W |

Known properties and their dimension: ratedVoltage, voltage: voltage; ratedCurrent, current,
startingCurrent, shortCircuitCurrent, breakingCapacity: current; ratedPower, power: power;
apparentPower: apparent-power; reactivePower: reactive-power; powerFactor, efficiency,
startingCurrentRatio, voltageDrop, phases, poles, demandFactor: ratio; frequency: frequency; speed:
speed; torque: torque; length: length; crossSection: area; ambientTemperature: temperature;
luminousFlux: luminous-flux; illuminance: illuminance; luminousEfficacy: luminous-efficacy;
resistance, impedance: resistance; capacitance: capacitance; inductance: inductance; startTime: time.
Any other property name accepts any unit of the table.

### Relations

| Type | From | To | Max in per `to` | Max out per `from` |
|---|---|---|---|---|
| feeds | source, board, busbar, circuit | board, busbar, circuit, load, motor | 1 | - |
| contains | board, device | busbar, circuit, protection, device, terminal, io | 1 | - |
| protects | protection | circuit, cable, load, motor | - | - |
| routes | cable | circuit | - | 1 |
| controls | device, io | motor, load, actuator, device | - | - |
| signals | sensor, actuator, device, motor, protection | io | 1 | - |
| tag-of | tag | io, device, sensor, actuator, motor, load | - | 1 |
| connects | cable, terminal | terminal, device, motor, load, sensor, actuator, io, protection, busbar | - | - |
| documents | document | any object type | - | - |

A relation never joins an object to itself, and two relations never repeat one type, `from` and `to`.
`feeds` relations form no cycle (radial supply).

### Problems and issues

Refusals (the model is invalid; nothing is read or written): schema violations, duplicate IDs,
duplicate `ref`, a `ref` equal to an ID, a relation or source citation to a missing ID, a disallowed
endpoint type, an exceeded cardinality, a self-relation, a repeated relation, a feeds cycle, an unknown
unit, a unit of another dimension on a known property. At most 20 problems are reported, each
`{path, message}` with a JSON path such as `objects[3].properties.ratedPower.unit`.

Issues (the model is valid but incomplete), reported by the summary view: `unfed` for a board,
circuit, load or motor without an incoming `feeds`; `unprotected` for a circuit or motor that no
`protects` relation reaches, either directly or through the circuit feeding the motor.

### Canonical form

VERA writes the model as `JSON.stringify` with two-space indentation, keys in the order of this spec
(the zod schema order; record keys sorted), arrays in their stored order, and a final `\n`. A valid
canonical file read and written again is byte-identical.

Entity hash: SHA-256 (hex) of the entity as JSON with every object's keys sorted recursively and no
whitespace. The project's entity ID is its `project.id`.

### Result document

```json
{
  "kind": "vera-electrical-result",
  "format": 1,
  "runId": "20261115-120000-a1b2",
  "producer": {"plugin": "electrical-network", "operation": "cable-sizing",
               "engine": {"name": "...", "version": "..."}},
  "method": {"id": "...", "title": "...", "reference": "..."},
  "status": "completed",
  "preliminary": true,
  "startedAt": "2026-11-15T12:00:00Z", "finishedAt": "2026-11-15T12:00:02Z",
  "model": {"path": "electrical-automation-model.json", "sha256": "<file sha256>"},
  "catalog": null,
  "inputs": [{"id": "mot-p1", "snapshot": {...the entity as read...}}],
  "assumptions": ["..."], "sources": ["src-...", "free citation"], "conditions": {"key": Condition},
  "intermediate": [{"name": "...", "subject": "mot-p1", "value": 7.9, "unit": "A"}],
  "criteria": [{"id": "...", "title": "...", "subject": "cir-m1", "verdict": "pass",
                "measured": {"value": 2.1, "unit": "%"}, "limit": {"value": 3, "unit": "%"},
                "note": "..."}],
  "limits": ["..."],
  "messages": ["..."]
}
```

- `runId`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and equal to its folder name.
- `status` (per run): `completed`, `incomplete`, `blocked`, `error`, `interrupted`.
- `verdict` (per criterion): `pass`, `fail`, `unknown`, `not-evaluated`.
- `preliminary`: boolean; a report never calls a preliminary result a verified design or a safety
  certification.
- `finishedAt`: ISO time or `null` (an interrupted run). `catalog`: `{id, version}` of the catalog the run
  used, or `null`; the catalog's own item format is not part of this spec.
- `inputs`: 1..1000 entries `{id, snapshot}`, the snapshot being the JSON of the model entity the run
  read (the `project` object for the project ID).
- `intermediate` values and criterion `measured`/`limit` use `{value: number|null, unit}` from the
  unit table; `subject` is an entity ID.
- Lists hold at most 200 entries; result files at most 4 MiB.

Freshness: `stale` when an input's snapshot hash differs from the current entity's hash (`changed`) or
the entity is gone (`removed`); `current` otherwise. Without a model file every valid result is stale
with all inputs removed. An invalid result is `invalid` with its first problem.

### Tools

- `electrical_model` (read): `{view: "summary" | "objects" | "relations" | "results", type?, ids?
  (<=100), offset?}`. summary: `{exists, path, sha256, project, sources, objects, counts, relations, issues}`
  (issues <=100); objects: <=100 objects per page with `sha256`; relations: <=200 per page, filtered
  by `ids` touching `from` or `to`; results: <=100 results, newest run folder first, each with run
  status, criterion counts and freshness (also without a model). A missing model gives `{exists: false}`
  for the other views.
- `electrical_model_change` (write): `{operations: [Operation] (1..200)}`, applied in order to the
  current model (or to an empty model when the file does not exist yet, which then needs a
  `set-project`):
  - `set-project` {name?, profile?}
  - `add-source` {source} (id optional: generated)
  - `remove-source` {id}
  - `add-object` {object} (id optional: generated)
  - `update-object` {id, ref?, name?, note? (each null removes the field), attributes? and properties?
    (key: value, or null to remove the key)}
  - `remove-object` {id}
  - `add-relation` {relation} (id optional: generated)
  - `remove-relation` {id}
  - `import` {path, mapping}: `path` is a workbench file holding a model document (format 1);
    `mapping` names every source, object and relation ID of the file as `"new"` (added with that ID)
    or as an existing ID of the same kind (and object type) whose content it replaces, keeping the
    existing ID; relation endpoints and source citations are rewritten through the mapping. The
    imported project is ignored.

  The final model must be valid; then the change is prepared (path, before/after SHA-256, unified
  diff) and applied by `commitChange` after approval. The result is `{path, sha256, bytes, ids}` where
  `ids` lists generated IDs in operation order. A change that leaves the bytes unchanged is refused.

## Examples

- `{"value": null, "unit": "kW", "basis": "input"}` is an unknown rated power; `{"value": 0, ...}` is
  zero; `{"unit": "kW", "basis": "input"}` (no `value`) is refused.
- `ratedPower` `{"value": 4, "unit": "V", ...}` is refused: "unit V is not a unit of power (W, kW, MW)".
- A result that read `mot-p1` turns stale when `mot-p1`'s rated power changes; a result that read only
  the lighting circuit stays current.

## Acceptance

The requirements of task TASK-bdafefcf pass their core and session tests on Windows and on Linux
(WSL2), and the two-pump fixture validates and round-trips byte for byte.
