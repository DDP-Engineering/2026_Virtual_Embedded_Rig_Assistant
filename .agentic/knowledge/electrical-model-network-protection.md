# Electrical network and protection engines

## Routing

Select for the radial LV network engine: `electrical_network`, cable tables
`electrical-automation-tables/<id>.json`, load balance, cable sizing, voltage drop, fault currents and the
`electrical_model` report view (spec .agentic/specs/REQ-DATA-42ce122f.md, core electrical/network.ts,
network-tool.ts, cable-table.ts, report.ts), and the LV protection engine: `protection_coordination`, breaking
capacity Icu/Ics/Icn, overload, disconnection bands, let-through energy, RCD, selectivity/cascading/starter tables
(spec .agentic/specs/REQ-DATA-a5673202.md, core electrical/protection.ts, protection-tool.ts, result-change.ts).
Start at 05_Software/src/libraries/core/src/electrical/ (network.ts, protection.ts). Tests:
core/src/electrical/{network,network-tool,cable-table,protection,protection-tool}.test.ts. The model, the
result contract and freshness, the industrial catalog and the tool gating belong to [electrical model](electrical-model.md); the engines that
build on these results belong to [drives, PFC and lighting engines](electrical-model-drives-pfc-lighting.md).

## Purpose and boundaries

Two first-party calculation engines over the electrical project model: the radial LV network engine with its
cable tables and the LV protection engine. Each engine is a pure function of the model, its input files and a
request; its write tool prepares one new result file on the shared write flow and never changes the model.

## Public interface

- Network engine (spec REQ-DATA-42ce122f): shared `cableTableSchema` (kind `vera-cable-table`, format 1, fixed
  units mm², A, °C, Ω/km), `cableTableDir` (`electrical-automation-tables`); core `checkCableTable`/
  `parseCableTable`, `readCableTableFile(root, id)` -> {table, stamp}, `temperatureFactor`/`groupingFactor`/
  `tableRating` (next tabulated point, never interpolated); pure `analyzeNetwork({model, table, request, runId,
  now, ...})` -> ElectricalResult with `networkRequestSchema` {cableTable, source?, voltageTolerance 6|10,
  scenarios 1..8 {id, title, simultaneity?, loads?}, voltageDropLimit, voltageDropLimitLighting?, faultDuration?,
  assumedReactance?}; stable intermediate names (`designCurrent`, `ik3MaxStart`, `ik3MinEnd`, `ik1MinEnd`,
  `crossSection`, `currentCapacity`, `activePower:<s>`, `ik3Max`, ...) and criteria `current-capacity`,
  `voltage-drop`, `short-circuit-withstand`, `cable-section`, `short-circuit`.
- Tool `electrical_network` (write): runs the engine and prepares one new
  `electrical-automation-results/<run-id>/result.json` (run ID `YYYYMMDD-HHMMSS-<4 hex>`, before = absent) through
  `commitChange`; apply returns {path, runId, sha256, bytes, status, criteria counts, report}. `electrical_model`
  view `report` {runId} returns {runId, freshness, changed?, removed?, report} from `renderResultReport`, for any
  plugin's result (64 KiB at most).
- Protection engine (spec REQ-DATA-a5673202): pure `analyzeProtection({model, network, catalog, catalogStamp, cable
  {k, text}, request, runId, now})` -> ElectricalResult with `protectionRequestSchema` {network run ID, catalog,
  breakingCapacity Icu|Ics|Icn, assumedInstantaneousTripTime? (s), circuits 1..16 {circuit, protection?, candidates
  1..8 (16 in all), setting? (A), disconnectionTime? (s), rcd?, residualCurrentMax? (mA)}, coordination? <=16 {kind
  selectivity|cascading, upstream, upstreamItem, downstream, downstreamItem}, starters? <=16 {circuit, protection,
  contactor, type 1|2}}; criteria `<name>:<orderCode>` (`device-kind`, `rated-voltage`, `poles`,
  `breaking-capacity`, `rated-current`, `conventional-tripping`, `disconnection-time`, `let-through-energy`,
  `selection`), `rcd-type`, `rcd-sensitivity`, `selectivity|cascading:<up>/<down>`, `starter-type-<n>:<p>/<c>`.
  Catalog values go through `selectItems` on a one-item catalog (coverage, conservative value, unconfirmed rules);
  band points through `findItems`; tables through `coordinationFor`.
- Tool `protection_coordination` (write): reads the model, the named network result (`readResultFile`; refuses a
  missing, invalid, foreign or stale one), the catalog and the cable table the network result names (k only when its
  sha256 prefix still matches) and prepares one new result through `prepareResultChange` (`result-change.ts`, shared
  with `electrical_network`: `newRun()`, checked result, one new file, report). The result copies the network
  result's inputs, so it goes stale with them.

## Invariants

- The network engine evaluates only a radial three-phase AC LV network (50..1000 V) from one transformer or
  supply point; a tie between busbars, another phase count, DC or an unknown voltage blocks the run; another
  source kind, TT/IT earth faults, a circuit with no or parallel cables are not evaluated; an absent or null input
  makes the value null and its criteria unknown (`cable-section` fails only when every table cross-section was
  evaluated and none fits; `earth-fault`, `short-circuit-minimum` and `network-coverage` criteria keep such runs
  incomplete); a cross-section is proposed only with installation method,
  ambient temperature and grouping covered by the table (REQ-REL-60a7e063, REQ-FUNC-bc6a2e50).
- Fault currents follow the equivalent voltage source with cmax 1.05/1.10, cmin 0.95, feeder cQ 1.1/1.0 and KT
  for max and min, as pandapower 3.1.2 does; results state the method, edition and simplifications
  (REQ-FUNC-6a025b48). `electrical_network` writes only a new result file, never the model (REQ-FUNC-f4654788).
- The protection engine reads only the capacity kind the request names (Icu `ultimateBreakingCapacity`, Ics
  `serviceBreakingCapacity` or ratio x Icu at the same conditions, Icn / fuse `ratedBreakingCapacity`) at the
  circuit voltage; the generic `breakingCapacity` is never read. Disconnection passes only when Ik1min reaches a
  cited band point at or below the required time (or the instantaneous band's upper edge with a cited or assumed
  operating time), fails only below a point at exactly that time, and is unknown otherwise; selectivity, cascading
  and starter coordination come only from an applicable table for the exact items (selectivity and cascading entries
  only in the order [upstream, downstream], the upstream circuit feeding the downstream one), an unevaluated requested
  condition is unknown, no table is not-evaluated; nothing is derived from curves (REQ-FUNC-b65fb9ee,
  REQ-FUNC-b9c2bc7d, REQ-FUNC-894dce2a, REQ-REL-8f88c502). `protection_coordination` refuses a stale network result
  and writes only a new result file (REQ-REL-62b1aee8, REQ-FUNC-4dcdce2d).

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Network engine, request, result names | electrical/network.ts, spec REQ-DATA-42ce122f | electrical/network.test.ts |
| Cable table format and lookups | shared cable-table.ts, electrical/cable-table.ts | electrical/cable-table.test.ts |
| Network tool, report view | electrical/network-tool.ts, report.ts, tools.ts | electrical/network-tool.test.ts |
| Protection engine, request, criteria | electrical/protection.ts, spec REQ-DATA-a5673202 | electrical/protection.test.ts |
| Protection tool, shared result write | electrical/protection-tool.ts, result-change.ts | electrical/protection-tool.test.ts, network-tool.test.ts |

## Key behaviors

- REQ-DATA-42ce122f — accept only a strictly valid format-1 cable table.
- REQ-FUNC-6a60acb5 — balance P, Q and S per scenario with simultaneity and phase loading.
- REQ-FUNC-f1d93773 — design currents and single- and three-phase voltage drop along the path.
- REQ-FUNC-bc6a2e50 — size or check cables with installation method, temperature and grouping.
- REQ-FUNC-6a025b48 — maximum and minimum fault currents with the implemented method shown.
- REQ-REL-60a7e063 — unsupported networks and missing data never pass.
- REQ-FUNC-f4654788 — store network results through an approved prepared change, model unchanged.
- REQ-FUNC-8b895a77 — render a stored result as a report with its freshness.
- REQ-TEST-e3eb9076 — independent references (hand calculations, pandapower 3.1.2) with preset tolerances.
- REQ-DATA-a5673202 — accept only a strictly valid protection request.
- REQ-FUNC-b65fb9ee — breaking capacity of the named kind at the circuit voltage against Ik3max.
- REQ-FUNC-f24b4131 — Ib <= In <= Iz and I2 <= 1.45 Iz with the cited ratio and setting range.
- REQ-FUNC-b9c2bc7d — automatic disconnection from cited band points against Ik1min.
- REQ-FUNC-884410b3 — let-through energy against k²S².
- REQ-FUNC-894dce2a — selectivity, cascading and starter coordination only from manufacturer tables.
- REQ-FUNC-870b4cdc — RCD type from the equipment, sensitivity from the profile.
- REQ-REL-8f88c502 — missing, extracted, off-condition or other-kind data never passes.
- REQ-REL-62b1aee8 — a missing, invalid, foreign or stale network result is refused.
- REQ-FUNC-4dcdce2d — protection results stored through an approved prepared change, stale with the network inputs.
- REQ-TEST-4ef52f14 — cited protection fixture and hand calculations.

## Files

- `05_Software/src/libraries/shared/src/cable-table.ts` — cable table format-1 schema, folder and limits.
- `05_Software/src/libraries/core/src/electrical/cable-table.ts` — table checks, confined reading, factor lookups.
- `05_Software/src/libraries/core/src/electrical/network.ts` — the radial LV network engine and its request schema.
- `05_Software/src/libraries/core/src/electrical/network-tool.ts` — the electrical_network write tool.
- `05_Software/src/libraries/core/src/electrical/report.ts` — Markdown report of a stored result.
- `05_Software/src/libraries/core/src/electrical/network.test.ts` — hand calculations, pandapower references, sizing, refusals.
- `05_Software/src/libraries/core/src/electrical/network-tool.test.ts` — prepared result, freshness, report view, plugin.
- `05_Software/src/libraries/core/src/electrical/cable-table.test.ts` — table format, lookups, the Nexans fixture.
- `05_Software/tests/fixtures/electrical-network/` — fictional network A, fictional test table, cited Nexans NYM-J table.
- `05_Software/tests/support/pandapower_network_check.py` — independent pandapower 3.1.2 fault-current references.
- `05_Software/src/libraries/core/src/electrical/protection.ts` — the LV protection engine and its request schema.
- `05_Software/src/libraries/core/src/electrical/protection-tool.ts` — the protection_coordination write tool.
- `05_Software/src/libraries/core/src/electrical/result-change.ts` — run IDs and the prepared write of a new result.
- `05_Software/src/libraries/core/src/electrical/protection.test.ts` — criteria with hand calculations, refusals, fixture.
- `05_Software/src/libraries/core/src/electrical/protection-tool.test.ts` — prepared result, stale refusal, k check, plugin.
- `05_Software/tests/fixtures/protection-coordination/cat-lv-protection.json` — cited iC60N, C10G, GV2ME14 and LC1D data.
