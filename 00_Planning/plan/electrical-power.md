# PWR-00...PWR-06 (#126...#132) Electrical power and distribution - model, catalog, circuits, protection, motors, power quality and lighting

PURPOSE: the order and state of the seven packages that give VERA a common electrical project model
with provenance, an industrial catalog, and the first engineering plugins for low-voltage
distribution: network and cable sizing, protection coordination, motor starting and drives, reactive
power compensation and lighting.
SPEC: Gitea epic [#122](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/122) and its children #126...#132 hold the specification of each work
package (deliverables, Done criteria PWR-0x-A...D); the local copies are
`F:\ProjectsDDP\VERA_Electrical_Automation_Plugins_Plan.md` and
`F:\ProjectsDDP\VERA_Electrical_Automation_Plugins_Tickets\` (the tickets say `D:\ProjectsDDP`; the
files are on `F:`). This page records only order, state and what was built, so the two never diverge.
Where a ticket is wrong about the code, the code decides. The CAD, PLC and IND epics of the same plan
are not part of this page.
PROCESS: at the user's request (2026-11-15) every child is implemented with AEGIS, in order, on one
branch `feature/122-electrical-power` cut from `master` at a8b26c1, in the sibling worktree
`F:\2026_Virtual_Embedded_Rig_Assistant_pwr`. The implementer hands the candidate back without a
commit; the coordinator checks the evidence and makes one local commit per ticket. Nothing is pushed.
Each ticket runs only its focused tests; the complete suite runs once after PWR-06.
STATE: PWR-00 implemented 2026-11-15 (AEGIS TASK-bdafefcf), native Ubuntu open. PWR-01 implemented
2026-11-15 (AEGIS TASK-15cb5dad), native Ubuntu and licensed coordination tables open. PWR-02 implemented
2026-11-15 (AEGIS TASK-662ede41), native Ubuntu and licensed IEC cable tables open. PWR-03 implemented 2026-11-15
(AEGIS TASK-0184d2d1), native Ubuntu, public selectivity/type-2 tables with Iq and numeric tripping bands open.

## Order

| Order | Package | Issue | Result | Depends on | State |
|---|---|---|---|---|---|
| 1 | PWR-00 | [#126](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/126) | common project model: stable IDs, quantities with units, relations, provenance, stale results (product code, not a plugin) | - | implemented |
| 2 | PWR-01 | [#127](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/127) | `industrial-catalog`: manufacturer + order code + variant + accessories, conditioned parameters, documented selection | PWR-00 | implemented |
| 3 | PWR-02 | [#128](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/128) | `electrical-network`: load balance, cable sizing, voltage drop, short circuit on radial LV networks | PWR-00 | implemented |
| 4 | PWR-03 | [#129](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/129) | `protection-coordination`: breaker and fuse selection, breaking capacity, selectivity from manufacturer tables | PWR-01, PWR-02 | implemented |
| 5 | PWR-04 | [#130](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/130) | `motor-drives`: DOL, reversing, star-delta, softstarter or VFD choice and starter assembly | PWR-01, PWR-03 | planned |
| 6 | PWR-05 | [#131](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/131) | `power-quality-pfc`: P/Q/S and harmonic profiles, compensation need, capacitor bank steps | PWR-01, PWR-02 | planned |
| 7 | PWR-06 | [#132](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/132) | `lighting-design`: preliminary estimate, IES/LDT import, DIALux exchange and report check | PWR-00, PWR-01 | planned |

## Decisions for this epic (user, 2026-11-15)

- Reference data: the plugins ship their engines and a table/catalog file format. Fixtures are small
  and typed from public manufacturer datasheets, each value with its source, revision and page. No
  copyrighted IEC tables or vendor catalogs are copied into the repository. A Done criterion that
  needs licensed tables or data stays open and is listed under the open proofs.
- Tools: pinned PyPI packages (for example pandapower for short-circuit cross-checks) are installed
  in a scratch or uv environment, outside the repository. Linux runs use WSL2, which does not replace
  native Ubuntu evidence. DIALux evo is installed by the user for PWR-06-B.
- Reuse before new code: one unit engine, one catalog store and one resource system. Where
  `electronics-calc`, `parts-search` or the LAB lease registry already provide a piece, the PWR child
  reuses it and records that choice in its AEGIS task.
- Every stored format stays at version 1, with no migrations.

## PWR-00 #126 - common project model

- Model file `electrical-automation-model.json` at the workbench root (kind `vera-electrical-model`,
  format 1); results in `electrical-automation-results/<run-id>/result.json` (kind
  `vera-electrical-result`, format 1). Spec `.agentic/specs/REQ-DATA-06c0bd54.md`, knowledge
  `.agentic/knowledge/electrical-model.md`, plugin-author notes in `05_Software/plugins/CONTRIBUTING.md`.
- A result copies each model entity it read; freshness (current/stale/invalid) is derived on every
  listing, never stored. Helpers write only results, never the model.
- Tools `electrical_model` (read) and `electrical_model_change` (write through the prepared change and
  write queue) appear only while a loaded plugin has `ecosystem: electrical` or `automation`; PWR
  plugins must set it. The headless CLI does not offer them.
- One unit table in `core/src/electrical/units.ts` with electronics-calc spellings; new units go there.
- Catalog: results carry only `catalog: {id, version} | null`; PWR-01 defines the catalog item format
  with the model's quantity, unit and provenance shape (RULING-004, confirmed by the coordinator).
- Open: native Ubuntu (WSL2 only).

## PWR-01 #127 - industrial catalog

- Catalog files `electrical-automation-catalogs/<id>.json` (kind `vera-industrial-catalog`, format 1), spec
  `.agentic/specs/REQ-DATA-d7e27def.md`. Format and engine are product code next to the model (shared
  `industrial-catalog.ts`, core `electrical/catalog.ts`); the read tool `industrial_catalog` is offered with the
  electrical tools. Plugin `industrial-catalog` (ecosystem `electrical`, no program) brings the skill
  `industrial-selection`.
- Item: family manufacturer + `orderCode`, optional `variant` {base, label}, `accessories` (references to other
  items), `distributors` [{supplier, sku, capturedAt}]; parameters are the model's quantity plus `name`, a source
  {id, page, table} and `status` confirmed|extracted. Bounds in conditions are `xMin`/`xMax`.
- Selection: eligible/unknown (absent, conditions, unconfirmed)/eliminated, the most conservative confirmed value
  decides, order by outcome then order code; output stamped `catalog {id, version, sha256, path}`. Coordination
  entries apply only to their exact item set when the request names and satisfies every table condition.
- Reuse: parts-search keeps the live supplier search and keys; it stores no results, so there is no second store.
  Units: `toBaseUnit` and the new known properties are in `core/src/electrical/units.ts`.
- Fixture: Schneider Electric TeSys Deca LC1D contactors (LC1D09P7, LC1D09B7, LC1D12P7, LC1D18P7), TeSys GV2ME
  motor circuit breakers (GV2ME08/10/14) and LADN11, typed from se.com UK product pages read 2026-11-15, with RS
  stock numbers 394-9790 and 395-0239 as distributor SKUs; coordination = the per-product gG fuse ratings for
  types 1 and 2 published on those pages.
- Open: native Ubuntu (WSL2 only); licensed manufacturer coordination tables (for example GV2 + LC1D type 2) are
  not in the fixture.

## PWR-02 #128 - electrical network

- Engine `vera-radial-lv-1` in product code (core `electrical/network.ts`, pure), tool `electrical_network` (write:
  one new result file through the prepared change, never the model) and the generic report view `electrical_model`
  view `report`; spec `.agentic/specs/REQ-DATA-42ce122f.md`. Plugin `electrical-network` (ecosystem electrical, no
  program) brings the skill `network-sizing` and joins the Electrical power and distribution pack.
- Scope: one transformer or LV supply point, three-phase AC up to 1000 V, radial feeds, one cable per circuit;
  load balance per scenario (demand, load and simultaneity factors), phase and neutral currents, design currents,
  cable sections checked or proposed with the governing criterion, voltage drop, Ik3 max/peak, Ik3 min and Ik1 min
  (TN, Dyn) by the impedance method with the c factors and KT of IEC 60909-0:2016; ties, parallel cables, other
  sources and DC are blocked or not evaluated.
- Cable tables `electrical-automation-tables/<id>.json` (kind `vera-cable-table`, format 1) with one cited source;
  factors at the next tabulated point, never interpolated. Fixtures: a fictional test table and
  `tbl-nexans-nym-j.json`, typed from the public Nexans NYM-J page (read 2026-11-15; R20 and 30 °C ratings, no
  factors, reactance or k).
- References: hand calculations in the test and pandapower 3.1.2 IEC 60909 values (tolerance 1 %), recomputed by
  the opt-in test `VERA_PANDAPOWER_PYTHON` with `tests/support/pandapower_network_check.py`; pandapower is not a
  runtime dependency.
- Open: native Ubuntu (WSL2 only); licensed IEC 60364-5-52 tables and manufacturer correction factors are not in
  the fixtures.

## PWR-03 #129 - protection coordination

- Engine `vera-lv-protection-1` in product code (core `electrical/protection.ts`, pure), tool `protection_coordination`
  (write: one new result through the prepared change, shared with `electrical_network` in `result-change.ts`), spec
  `.agentic/specs/REQ-DATA-a5673202.md`. Plugin `protection-coordination` (ecosystem electrical, no program) brings the
  skill `protection-selection` and joins the Electrical power and distribution pack.
- Inputs: one CURRENT `electrical-network` result (stale, missing or foreign ones are refused; its inputs are copied,
  so the protection result goes stale with them), one catalog and the cable table the network result names (k).
- Per candidate and circuit: rated voltage, poles, breaking capacity of the kind the profile names (Icu, Ics or ratio
  x Icu, Icn; fuses by their rated breaking capacity) against Ik3max, Ib <= In <= Iz (setting for adjustable
  devices), I2 <= 1.45 Iz with a cited ratio, disconnection from cited band points or the instantaneous band with a
  cited or stated operating time against Ik1min, let-through energy against k²S², selection verdict; per circuit
  RCD type (equipment `rcdTypes`) and sensitivity; selectivity, cascading and type 1/2 starters only from the
  catalog's manufacturer tables for exact products and conditions, never from curves.
- Reuse: catalog `selectItems`/`findItems`/`coordinationFor`, PWR-02 stored values, generic report. The PWR-01 fixture
  parameter `breakingCapacity` is now `ultimateBreakingCapacity` (se.com labels it Icu).
- Fixture `tests/fixtures/protection-coordination/cat-lv-protection.json`: Acti9 iC60N (se.com UAE pages), Eaton
  Bussmann C10G gG (eaton.com UK pages), TeSys GV2ME14 and LC1D09P7/LC1D18P7 with their real gG fuse coordination
  tables, conventional ratios from Schneider's public Electrical Installation Guide, all read 2026-11-15.
- Open: native Ubuntu (WSL2 only); public manufacturer selectivity/cascading and type-2 breaker tables with the
  prospective current Iq, numeric instantaneous operating times, fuse time-current gates and I2t values (download- or
  licence-only), so those criteria stay unknown or not evaluated with the real fixture.
