# REQ-DATA-42ce122f — Cable tables and the radial LV network calculation, format 1

## Behavior

The plugin `electrical-network` (ecosystem `electrical`) brings the skill; VERA brings the engine and the
write tool `electrical_network`. One run reads the electrical model (REQ-DATA-06c0bd54) and one cable
table, computes the load balance per scenario, design currents, cable sections, voltage drop and fault
currents of one RADIAL LV network, and prepares one new result file
`electrical-automation-results/<run-id>/result.json` (format 1 of the PWR-00 result contract). The
model is never written. `electrical_model` view `report` renders any stored result as Markdown.

The engine is "VERA radial LV network 1" (`vera-radial-lv-1`). It is preliminary engineering support,
not a verified design and no conformity statement.

## Cable table file

`electrical-automation-tables/<id>.json`, file name = id. Strict: an unknown key is a problem. Units
are fixed by the format (no unit fields): cross-sections in mm², currents in A, temperatures in °C,
conductor resistance and reactance in Ω/km, `k` in A·s^0.5/mm².

```json
{
  "kind": "vera-cable-table", "format": 1, "id": "tbl-...", "title": "...", "version": "...",
  "source": {"title": "...", "publisher": "...", "revision": "...", "readAt": "2026-11-15",
             "uri": "https://...", "pages": "page 4, table 2", "license": "..."},
  "cable": {"designation": "NYY-J 0.6/1 kV", "material": "copper", "insulation": "PVC",
            "maxConductorTemperature": 70, "shortCircuitTemperature": 160, "k": 115},
  "conductors": [{"crossSection": 1.5, "resistance20": 12.1, "reactance": 0.115}],
  "methods": [{"id": "air", "title": "...", "referenceTemperature": 30, "note": "...",
               "ratings": [{"crossSection": 1.5, "loadedConductors": 3, "current": 19.5}]}],
  "temperatureFactors": [{"methods": ["air"], "points": [{"ambient": 30, "factor": 1.0}]}],
  "groupingFactors": [{"methods": ["air"], "points": [{"circuits": 1, "factor": 1.0}]}]
}
```

- `id` like a model ID; `title`, `version`, texts 1..200 characters without control characters;
  `source` needs `title`, `publisher`, `revision`, `readAt` (date `YYYY-MM-DD`), `uri` (http(s) without user
  information or credential-like parameters), `pages` (page or table) and `license` (the terms under which the
  values are used). `material` is `copper` or `aluminium`; `k` may be `null` (no withstand check).
- `conductors`: 1..40, unique ascending `crossSection` > 0, `resistance20` > 0, `reactance` > 0 or
  `null` (unknown). `methods`: 1..20 unique ids; ratings 1..200, each `crossSection` listed in
  `conductors`, `loadedConductors` 2 or 3, unique per (crossSection, loadedConductors), `current` > 0.
- `temperatureFactors` / `groupingFactors`: entries name existing methods; a method appears in at most
  one entry of each list; points 1..30 strictly ascending by `ambient` / `circuits` (integer >= 1),
  `factor` > 0.
- A factor is looked up at the next tabulated value at or above the input (conservative: never
  interpolated); an input above the last point is not covered (unknown).
- The core reads at most 50 files of 1 MiB, confined to the workbench (PathGuard). An invalid table
  refuses the run with its problems (`Invalid cable table:` lines, at most 20).

## Model inputs the engine reads

Names are property (quantity) or attribute (text) names on model objects; the units are any unit of
the dimension in the unit table.

| Object | Name | Meaning |
|---|---|---|
| source | attr `kind` | `transformer` or `supply` (LV supply point); any other kind: no fault currents |
| source | attr `system` | earthing `TN-S`, `TN-C`, `TN-C-S`, `TT`, `IT` |
| source | `ratedVoltage`, `phases` | LV line voltage (50..1000 V), phases must be 3 |
| transformer | `apparentPower`, `impedanceVoltage` (%), `loadLosses` (W) | SrT, ukr, PkrT |
| transformer | `primaryVoltage`, `networkShortCircuitPower`, `networkShortCircuitPowerMin` (VA) | UnQ, S''kQmax/min |
| transformer | `networkResistanceReactanceRatio` (1), attr `vectorGroup` | RQ/XQ (absent: 0.1); Dyn* for earth faults |
| supply | `shortCircuitCurrent`, `shortCircuitCurrentMin`, `resistanceReactanceRatio`, `earthFaultLoopImpedance` | Ik3 at the origin, R/X, Ze |
| circuit | `phases` (1 or 3), attr `phase` (`L1`/`L2`/`L3`) | single-phase circuits name their phase |
| cable (routes the circuit) | `length`, `crossSection`, `ambientTemperature`, `groupedCircuits`, `protectiveConductorCrossSection` | absent/null section: the engine proposes one |
| cable | attr `installationMethod` | a method id of the table |
| load | `power` or `apparentPower`, `powerFactor`, `demandFactor` | absent demand factor: 1 |
| motor | `ratedPower`, `efficiency`, `powerFactor` or `ratedCurrent`, `demandFactor` | input P = Pn / eta |
| protection (protects the circuit) | `ratedCurrent` | In: Iz must reach it |

A board, busbar or circuit feeds through `feeds`; a circuit's cable is the cable that `routes` it.
Board and busbar connections have no impedance. A circuit's phases default to 3 when it feeds a board.

## Request (`electrical_network` arguments)

```json
{"cableTable": "tbl-...", "source": "sup-...?", "voltageTolerance": 10,
 "scenarios": [{"id": "normal", "title": "Normal operation", "simultaneity": {"brd-main": 0.8},
                "loads": {"mot-p2": 0}}],
 "voltageDropLimit": {"value": 4, "unit": "%"}, "voltageDropLimitLighting": {"value": 3, "unit": "%"},
 "faultDuration": {"value": 0.1, "unit": "s"}}
```

- `scenarios` 1..8, ids `^[a-z][a-z0-9-]{0,31}$`; factors 0..1 (simultaneity) and 0..1 (load factor,
  0 switches a load off). `voltageTolerance` 6 or 10 (%) chooses cmax 1.05 or 1.10; cmin is 0.95.
- `faultDuration` is optional: without it the short-circuit withstand criterion is not evaluated.
- `assumedReactance` (Ω/km, 0 < x <= 1) is optional: it stands in for conductors whose table reactance is
  `null` and is recorded as an assumption; without it such conductors give an unknown voltage drop and fault
  impedance. Scenario titles are 1..160 characters without control characters.
- `source` names the source when the model has more than one; each run covers the tree of one source.

## Method (implemented)

- Load balance: per scenario, each load contributes P = P·u·f (u demand factor, f scenario load factor),
  Q = P·tan(phi); a board or busbar sums its feeds and applies its scenario simultaneity factor ks to the
  sum; currents are phasor sums per phase (balanced three-phase loads, single-phase loads on their phase
  at U0 = Un/sqrt(3)); the neutral current is the phasor sum of the phases. A final circuit's design
  current Ib is its load's current with the scenario load factor (no demand factor); a circuit feeding a
  board carries that board's current. Ib = the highest phase current; the governing scenario has the
  highest Ib.
- Voltage drop: three-phase sqrt(3)·Ib·(R cos phi + X sin phi)·100/Un, single-phase
  2·Ib·(R cos phi + X sin phi)·100/U0, R at the table's maximum conductor temperature
  (alpha 0.00393 copper, 0.00403 aluminium), summed from the origin of the installation (the source's
  LV terminals). Limit: `voltageDropLimitLighting` for lighting loads when given, else `voltageDropLimit`.
- Cable sizing, top-down from the source: Iz = Itable(method, S, loaded conductors 3 or 2) · k_theta · k_g;
  required Iz >= max(Ib, In); cumulative drop <= limit; with `faultDuration` t and `k`:
  S >= Ik3max(origin)·sqrt(t)/k. A given section is checked; otherwise the smallest table section that
  meets all criteria is proposed. The governing criterion is the one demanding the largest section.
- Fault currents: equivalent voltage source c·Un/sqrt(3) (IEC 60909-0:2016 principle), far from
  generator, no motor contribution, no fault impedance. Network feeder ZQ = cQ·Un²/S''kQ (cQ 1.1 max /
  1.0 min) with RQ/XQ; transformer ZT = ukr·Un²/(100 SrT), RT = PkrT·Un²/SrT², KT =
  0.95·cmax/(1 + 0.6 xT) applied for both max and min; cables R at 20 °C (max) and at the table's
  short-circuit temperature with alpha 0.004 (min). Ik3 = c·Un/(sqrt(3)|Z1|); ip = kappa·sqrt(2)·Ik3,
  kappa = 1.02 + 0.98·e^(-3R/X). Ik1 (TN systems with a Dyn transformer or a supply with Ze) =
  sqrt(3)·cmin·Un/|2 Z1 + Z0|, Z0T = Z1T, cable Z0 = Z_L + 3 Z_PE with X_PE = X_L; the PE section is
  the cable's `protectiveConductorCrossSection`, else the phase section (assumption recorded).
  Supply point: Z1 = c·Un/(sqrt(3)·Ik3 at origin) with its R/X; Ik1 source part = Ze.

## Result written

`producer {plugin: "electrical-network", operation: "network", engine {name: "vera-radial-lv",
version: "1.0.0"}}`, `method {id: "vera-radial-lv-1", title, reference: "IEC 60909-0:2016 (c, KT);
cable table <id> <version>"}`, `preliminary: true`, `catalog: null`. `inputs`: the project, the source,
every object of its tree, the cables, protections and relations read. `conditions`: `scenario<N>`
(text: id, title, factors), `cableTable` (id, version, sha256), `voltageTolerance`, `cMax`, `cMin`,
`earthing`, `faultDuration`, `voltageDropLimit` (and `voltageDropLimitLighting`).

Stable intermediate names (subject = entity ID; `:<scenario>` suffix per scenario):

| Subject | Names |
|---|---|
| source (transformer) | `transformerCorrectionFactor` 1 (KT) |
| board, busbar | `activePower:<s>` kW, `reactivePower:<s>` kvar, `apparentPower:<s>` kVA, `current:<s>` A, `phaseCurrentL1..L3:<s>` A, `neutralCurrent:<s>` A, `ik3Max` kA, `peakCurrent` kA |
| circuit | `designCurrent` A (governing), `designCurrent:<s>` A, `voltageDrop:<s>` % (cumulative at its end), `ik3MaxStart` kA, `peakCurrentStart` kA, `ik3MinEnd` kA, `ik1MinEnd` kA |
| cable | `crossSection` mm² (checked or proposed), `currentCapacity` A (corrected Iz), `tableCurrent` A, `temperatureFactor` 1, `groupingFactor` 1, `thermalMinimumSection` mm² |

Unknown values are `value: null`. Criteria per circuit: `current-capacity` (measured Iz, limit
max(Ib, In)), `voltage-drop` (measured worst cumulative %, limit), `short-circuit-withstand` (measured
section, limit thermal minimum), `cable-section` (pass when a section was checked or proposed, note
"proposed|checked <S> mm², governing <criterion>, scenario <s>"). A run-level criterion
`short-circuit` (subject the source) is `not-evaluated` when the source kind or data does not allow
fault currents; `short-circuit-minimum` (unknown) when the minimum fault level of the source is unknown;
`earth-fault` (not-evaluated) when line-to-earth faults cannot be computed (not TN, not Dyn, no Ze, or no
minimum data); `network-coverage` (not-evaluated) when network objects are fed from no source. A checked or
proposed `cable-section` is `unknown` when its current capacity or voltage drop is unknown and `fail` only when
every table cross-section was evaluated and none meets the criteria. Status: `completed` when every criterion is pass or fail, `incomplete` when one is
unknown or not-evaluated, `blocked` when no network can be built. Lists over 200 entries, and inputs over 1000, are cut with
the status `incomplete` and a message; a result over 4 MiB is refused.

## Refusals and not-evaluated cases

Blocked (no criteria evaluated): no source or several without `source`, the source not three-phase AC,
ratedVoltage outside 50..1000 V or unknown, a cable that `connects` two busbars or boards (tie, not
radial). An invalid or missing table refuses the call (nothing is prepared); a method the table lacks
makes that cable's criteria unknown. Not evaluated: source kind other than transformer/supply (fault currents, withstand), IT/TT
(Ik1), a circuit routed by no cable or by two or more (parallel), objects not reached from the source
(listed in messages). Unknown: any input a value needs is absent or `null`.

## Report (`electrical_model` view `report`, `runId`)

Markdown: title with producer and run, status, preliminary notice, freshness (stale lists changed and
removed inputs), method and reference, conditions, assumptions, sources, criteria grouped by subject
(with `ref` from the current model when it exists), intermediate values by subject, limits and messages.
At most 64 KiB; a longer report is cut with a note.

## Acceptance

PWR-02-A..D: the focused core tests pass on Windows and Linux (WSL2); the fault currents agree with
pandapower 3.1.2 within the tolerance stated in the test.
