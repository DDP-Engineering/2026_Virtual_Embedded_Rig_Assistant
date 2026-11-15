# REQ-DATA-963cbdf6 - QElectroTech projects: strict reading, mapping, candidates, checks and edits

Requirements: REQ-DATA-963cbdf6 (strict XML), REQ-FUNC-778b9fc6 (project mapping), REQ-FUNC-8958b763 (devices and
cross-references), REQ-FUNC-3f13f78d (model reconciliation), REQ-FUNC-2e3af206 (candidates), REQ-FUNC-07c03695
(candidate validation), REQ-REL-3e094ff0 (writes), REQ-DATA-6609a3b6 (edits), REQ-FUNC-b21bd414 (check result),
REQ-TEST-7eb1927d (fixtures).

## Behavior

### Strict XML (core `electrical/xml-strict.ts`)

VERA reads `.qet` files with its own span-keeping XML reader, not a general parser. Accepted: one optional leading
`<?xml ...?>` declaration (encoding absent or UTF-8), comments, CDATA sections, elements with unique attributes in
single or double quotes, character data, the predefined entities `&lt; &gt; &amp; &quot; &apos;` and decimal or
hexadecimal character references to XML characters. Refused with `Invalid QElectroTech project <path>: line <n>:
<reason>.`: `<!DOCTYPE` (and so every entity, parameter entity and external subset - nothing named by an entity is ever
opened), any other `<!` declaration, a processing instruction other than the leading declaration, any other entity
reference, an unescaped `<` or `&` in an attribute value, a mismatched or unclosed tag, a second root or text outside the
root, a byte-order mark other than UTF-8, invalid UTF-8, control characters other than tab/LF/CR, more than 64 levels
of nesting, more than 500 000 nodes, and files over 16 MiB. The root must be `project`. Every element node keeps its
start-tag span, its content span and, for each attribute, the value span, so edits can splice the source text.

### Project mapping (core `electrical/qet.ts`)

- Project: `version` and `title` attributes of the root.
- Folios: every `diagram` child of the root, in file order, with `order`, `title`, `folio`, `cols`, `rows`, `colsize`,
  `rowsize` (QET defaults 17 x 60 and 8 x 80 when absent) for positions.
- Definitions: every `collection//element[@name]/definition` gives the path `embed://import/<category names>/<name>`
  with `link_type` (simple when absent), `kindInformations` (type, state, number), names (en first, else the first) and
  its `description/terminal` entries (uuid, name, x, y, orientation n|e|s|w).
- Elements: every `diagram/elements/element` with uuid, type, x, y, orientation, prefix, its `elementInformations`
  (name -> text), its `links_uuids/link_uuid` UUIDs and its instance `terminals/terminal` (id, x, y, orientation 0..3).
  An element whose type is not an embedded definition is kept with a problem `definition-missing` (its terminals are
  then unknown).
- Terminals: each element's terminal i is its definition's terminal i; a legacy numeric id names the instance terminal
  whose x, y and orientation equal the definition terminal's.
- Conductors: every `diagram/conductors/conductor`; each end is resolved by `elementN` + `terminalN` (terminal UUID of
  the element's definition) when `elementN` is present, else by the legacy numeric `terminalN` id of the same folio.
  Attributes kept: `num`, `function`, `conductor_section`, `conductor_color`, `cable`. An unresolved end is a problem
  `conductor-end` with the conductor's index and folio; the conductor stays listed.
- Potentials: union of terminals joined by conductors and by the single terminal of linked `next_report` /
  `previous_report` elements (a report pair joins its two potentials), numbered P1.. in first-terminal order.
- Position: column `floor(x / colsize) + 1` and row letter `A + floor(y / rowsize)`, written `<folio>-<row><col>`.
- Element label: the `label` information; an empty or absent label is null.

### Devices and cross-references

A device is a master element with its linked slaves, or a simple/terminal element on its own; label = the master's
(or element's) label. Problems (code, uuids): `slave-unlinked` (slave linked to no master), `link-not-reciprocal`,
`link-type` (a link not between master and slave or between a next/previous report pair), `slave-label` (a slave whose
non-empty label differs from its master's), `label-duplicate` (two devices with the same non-null label; terminals of one strip and unlinked slaves exempt),
`report-unlinked`.

### Model reconciliation

For each labelled device: the model object with `ref` equal to the label (any type) is `matched`; its
`attributes.qetUuid` equal to the device's master (or single element) UUID is `identity: recorded`, absent is
`unrecorded`, different is `differs` (a problem). Unmatched labels are `qetOnly`; model objects whose
`attributes.qetProject` equals the project path and whose ref no device carries are `modelOnly`. Operations: for each
matched object without recorded identity, `update-object` {attributes {qetUuid, qetProject}}; for each QET-only device,
`add-object` {type device, ref, name (definition name), attributes {qetUuid, qetProject}}. No relation, no other field.
Conductors and folios are not model entities: they stay in the project views and the check result.

### Templates and candidates (core `electrical/qet-templates.ts`)

Input: one assembly of a current motor_drives result (the tool refuses missing, invalid, foreign - producer not
motor-drives - and stale results) whose `method` is `dol`, `reversing` or `star-delta`, the motor object (its `ref`, else
M1) and optional title. Device tags come from the assembly (`Q1`, `KM1`, `KM2`, `KM3`, `F1`); `orderCode` goes to
`manufacturer_reference`. The overload relay F1 is drawn only when the assembly has an `overload-relay` device.
Template structure (self-authored element definitions under `embed://import/vera/`, written as `version="0.90"` with element and terminal
UUIDs - the structure QET has read since 0.7 - so QET 0.90 and 0.100 both open them):

- Folio 1 power circuit: supply X0 (L1 L2 L3), Q1 (1-2 3-4 5-6), the main contacts of each contactor as slaves of their
  coils, F1 power part (master, kind protection), the motor (U1 V1 W1, plus U2 V2 W2 for star-delta). Conductors follow
  the assembly's power connections phase by phase: `from` outputs 2/4/6 to `to` inputs 1/3/5; `motor:A,B,C` names the
  motor terminals of phases 1, 2, 3 and `F1:5,3,1` the relay inputs (reversing with an overload relay: KM2 swaps L1 and
  L3 at F1; without one: KM2 -> motor:W1,V1,U1). Star-delta: KM3's outputs go to U2 V2 W2, its inputs 1, 3, 5 are joined
  as the star point.
- Folio 2 control circuit: control supply X1 L and N (terminal elements of one strip), F1 95-96 (NC), S0 stop (NC), per coil a start button (S1, S2 for
  reversing) with the coil's 13-14 seal-in, the other coil's 21-22 NC for each electrical interlock pair, the coil A1-A2
  to N. Star-delta: S1 with KM1 13-14 feeds KM1 and the timer KT1; KT1 55-56 (delayOn NC) and KM2 21-22 feed KM3; KT1
  67-68 (delayOn NO) and KM3 21-22 feed KM2.
- Elements and conductors get fresh UUIDs; the project carries a `vera-template` project property `<method> 1`.
- Conductors carry no number (`num=""`); numbering is the engineer's in QET.

### Candidate validation (core `electrical/qet-check.ts`)

The written XML is read back with the reader above (problems refuse the candidate) and checked:

- `assembly-devices`: every assembly device tag except the mechanical interlock accessory is the label of exactly one
  device of the project.
- `connection:<from>/<to>` (power): for phases 1..3 the from-device output terminal and the to-device input (or listed
  motor) terminal are on one potential; the three phases on three different potentials; `supply` is X0.
- `star-point` (star-delta): KM3's terminals 1, 3, 5 on one potential.
- `interlock:electrical:<A>/<B>`: in the control graph (nodes = potentials, edges = two-terminal elements; coils are
  sinks), every simple path from X1 L to coil B's A1 passes an NC slave of master A, and vice versa when both are coils.
  `interlock:electrical:F1` (one check over every contactor coil): every path to each coil passes F1's 95-96.
- `interlock:sequence` (star-delta): every path to KM3 passes a delayOn NC linked to KT1; every path to KM2 passes a
  delayOn NO linked to KT1 and KM3's NC.
- `contact-links`: every slave linked to its master, reciprocal (the cross-reference problems above).
- `mechanical-interlock`: the stored motor_drives criterion `mechanical-interlock[:<code>]` verdict and note, never the
  drawing.

A candidate is prepared only when every check other than `mechanical-interlock` passes.

### Tools (core `electrical/qet-tool.ts`, gated on plugin `qelectrotech`)

- `qelectrotech` (read) {view project|devices|potentials|reconcile, path (workbench `.qet`), offset?}: project {path,
  sha256, bytes, version, title, folios [{order, title, elements, conductors}], definitions, elements, conductors,
  potentials, devices, problems <= 100}; devices <= 100 per page {label, definition name, members [{uuid, role, kind,
  state, folio, position, info}]}; potentials <= 200 per page {id, numbers, terminals [label:terminal@position]};
  reconcile {sha256, matched, qetOnly, modelOnly, problems, operations}. Files are read with PathGuard confinement.
- `qelectrotech_change` (write) one object {action, path, motorDrivesRun?, motor?, sha256?, title?, elements?} checked
  per action - candidate {motorDrivesRun, motor, path, title?} | edit {path, sha256, title?, elements 0..100 [{uuid, info}]}: candidate prepares a new file (before absent; an existing
  path is refused); edit splices the named `elementInformation` texts (inserting a missing one) and the root `title`
  attribute, refuses an unknown or repeated UUID, an information name outside label, comment, function, description, designation,
  manufacturer, manufacturer_reference, supplier, quantity, unity, plant, location, and a base sha256 that differs; both
  go through `commitChange` (diff, approval, write queue, before-hash recheck). The result returns {path, sha256, bytes,
  checks}.
- `qelectrotech_check` (write) {path, motorDrivesRun?, motor?}: one new result (producer `qelectrotech` / `check`,
  engine `vera-qet-check` 1.0.0) through `prepareResultChange` with criteria `project-read`, `labels`,
  `conductor-numbering`, `cross-references`, `device-list` and, with a run, the candidate checks; values `folios`,
  `elements`, `conductors`, `potentials`, `devices` (unit 1); conditions `qetFile`, `qetSha256`, `qetVersion`; sources
  `qet:<path>@sha256:<hex>` (and the motor_drives run); inputs the model project, every matched model object and, with a
  run, that result's inputs.

Numbering: `labels` passes when every master and simple element that draws a device (not a supply or report) has a
label and no `label-duplicate` exists; `conductor-numbering` is unknown when no conductor has a number, fails when a
potential has two numbers or two potentials share one, passes otherwise.

## Examples

- DOL with F1: folio 1 X0 -> Q1 -> KM1 -> F1 -> M1 (12 conductors), folio 2 X1:L - F1 95-96 - S0 - S1 || KM1 13-14 -
  KM1 A1-A2 - X1:N; checks pass; device list Q1, KM1, F1, M1, S0, S1, X0, X1.
- Reversing: removing KM2's 21-22 from KM1's branch (a conductor bridging it) fails `interlock:electrical:KM2/KM1`.
- `<!DOCTYPE project [<!ENTITY x SYSTEM "file:///etc/passwd">]><project>&x;</project>` is refused at line 1 for the
  document type declaration.

## Acceptance

CAD-01-A..C focused tests in `qet.test.ts`, `qet-templates.test.ts`, `qet-tool.test.ts` and the session gating test;
CAD-01-D with the QET load probes and the recorded visual check (open while screen access to QET is not given). Native Ubuntu is not covered (WSL2 only).
