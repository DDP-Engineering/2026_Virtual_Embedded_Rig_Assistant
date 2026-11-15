# REQ-DATA-a5673202 — Protection request, catalog conventions and the protection coordination result, format 1

## Behavior

The plugin `protection-coordination` (ecosystem `electrical`) brings the skill; VERA brings the engine and the
write tool `protection_coordination`. One run reads the electrical model (REQ-DATA-06c0bd54), ONE stored
`electrical-network` result (REQ-DATA-42ce122f) that is current against the model, ONE industrial catalog
(REQ-DATA-d7e27def) and the cable table the network result names, evaluates candidate fuses and breakers per circuit
and the requested coordination pairs, and prepares one new result file
`electrical-automation-results/<run-id>/result.json` (format 1 of the PWR-00 result contract). The model, the
catalog and every device are only read; nothing is configured.

The engine is "VERA LV protection 1" (`vera-lv-protection-1`). It is preliminary engineering support, not a
verified design and no conformity statement.

## Request (`protection_coordination` arguments)

```json
{"network": "20261115-101500-ab12", "catalog": "cat-lv-protection", "breakingCapacity": "Icu",
 "assumedInstantaneousTripTime": 0.1,
 "circuits": [{"circuit": "cir-l1", "protection": "prt-f2", "candidates": ["itm-a9f74216", "itm-c10g20"],
               "setting": 9, "disconnectionTime": 0.4, "rcd": "itm-...", "residualCurrentMax": 30}],
 "coordination": [{"kind": "selectivity", "upstream": "cir-f1", "upstreamItem": "itm-a9f74340",
                   "downstream": "cir-l1", "downstreamItem": "itm-a9f74216"}],
 "starters": [{"circuit": "cir-m1", "protection": "itm-c10g20", "contactor": "itm-lc1d09p7", "type": 2}]}
```

The request is a tool schema in every electrical session, so it is compact: numbers carry fixed units and bounds are
checked as refinements.

- `network`: a run ID (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`); the result must exist, be valid, come from
  `producer.plugin` `electrical-network` / operation `network`, and be current (no changed or removed input).
  Otherwise the run is refused: `The result <id> does not exist.` / `... is invalid: ...`, `The result <id> was not
  produced by electrical-network.`, `The network result <id> is stale (changed: ...; removed: ...): run
  electrical_network again.`
- `catalog`: a catalog ID; the file is read strictly (`readCatalogFile`, which also checks the ID form).
- `breakingCapacity`: `Icu` | `Ics` | `Icn` - the breaker capacity kind the normative profile requires.
- `assumedInstantaneousTripTime` (optional, s, 0 < t <= 1): stands in for a missing `magneticTripTimeMax`; recorded
  as an assumption and a condition.
- `circuits` 1..16, unique `circuit`; each `circuit` must be a circuit object of the model, `protection` (optional)
  a protection object that `protects` that circuit, `candidates` 1..8 unique catalog item IDs, at most 16 candidates
  over all circuits. `setting` (A, 0 < x <= 1e6) is the overload setting Ir for adjustable devices.
  `disconnectionTime` (s, 0 < t <= 60) is the required automatic disconnection time from the profile. `rcd` names a
  catalog item of category `residual-current-device`; `residualCurrentMax` (mA, 0 < x <= 1e4) the maximum rated
  residual operating current from the profile.
- `coordination` <= 16: `kind` `selectivity` | `cascading`; `upstream`/`upstreamItem` and
  `downstream`/`downstreamItem` name requested circuits and one of their candidates each; the upstream circuit must
  feed the downstream one (directly or through boards).
- `starters` <= 16: `circuit` a requested circuit, `protection` one of its candidates, `contactor` a catalog item,
  `type` 1 | 2.
- Strict: an unknown key, a circuit that is not a model circuit, an item that is not in the catalog, a protection
  object that does not protect the circuit, a coordination or starter item that is not a candidate of its circuit,
  or an upstream circuit that does not feed the downstream one throw before anything is prepared.

## Catalog conventions read by the engine

Product kind from the family `category`: `circuit-breaker`, `miniature-circuit-breaker`,
`motor-circuit-breaker` (breaker); `fuse-link` (fuse); `residual-current-device` (RCD, only for `rcd`). Any other
category: criterion `device-kind` not-evaluated and no further criterion for that candidate.

| Parameter / attribute | Unit | Meaning |
|---|---|---|
| `ratedVoltage` (condition `currentKind` AC) | V | Ue; must reach the circuit voltage |
| attribute `poles` | text | `3P`, `2P`, `1P+N`, ...: protected poles = leading number (breakers) |
| `ultimateBreakingCapacity` | A | Icu (IEC 60947-2), conditions `voltage`/`voltageMin`/`voltageMax` |
| `serviceBreakingCapacity`, `serviceBreakingCapacityRatio` | A, ratio | Ics directly, or ratio x Icu at the same voltage |
| `ratedBreakingCapacity` | A | Icn of an IEC 60898-1 breaker, or the rated breaking capacity of a fuse link |
| `ratedCurrent` | A | In of a fixed device |
| `settingCurrentMin`, `settingCurrentMax` | A | setting range of an adjustable device (then `setting` is required) |
| `conventionalTrippingCurrentRatio` | ratio | I2 / In (or I2 / Ir); the largest cited value counts |
| `magneticTripCurrent` or `magneticTripMultiple` | A or ratio x In | nominal instantaneous trip current Im |
| `magneticTripTolerance` | % | tolerance of Im; the band's upper edge is Im x (1 + tolerance) |
| `magneticTripTimeMax` | s | maximum operating time of the instantaneous release |
| `tripCurrentMax` (condition `tripTime` only) | A | band point: at or above this current the device operates within `tripTime`; a point with any other condition is not used |
| `letThroughEnergy` (conditions `prospectiveCurrentMax`, `voltage...`) | A²s | let-through I²t |
| attribute `rcdType`, `residualOperatingCurrent` | text, A | RCD type (AC, A, F, B) and IΔn |
| attribute `fuseClass` | text | `gG`, `aM`, ... for starter tables |

The generic `breakingCapacity` names no capacity kind and is never read. Values follow the catalog selection rules
(REQ-FUNC-742db7ea): only confirmed values whose conditions cover the requested ones count; the most conservative one
decides; absent, extracted or off-condition values are unknown with their reason.

Coordination tables read by `kind` (case-insensitive):

| kind | entry items | parameter | requested conditions |
|---|---|---|---|
| `selectivity` | [upstream, downstream] in this order | `selectivityLimit` (A) | `voltage` |
| `cascading` | [upstream, downstream] in this order | `enhancedBreakingCapacity` (A) | `voltage` |
| `fuse coordination type 1` / `type 2` | contactor | `fuseRating` (A, condition `fuseClass`) | `voltage`, `circuit` power, `prospectiveCurrent` |
| `breaker coordination type 1` / `type 2` | breaker, contactor | (entry = tested combination) | `voltage`, `circuit` power, `prospectiveCurrent` |

Model inputs: circuit `phases` (else 3 when it feeds a board, a busbar or a three-phase load, 1 when every fed load
is single-phase), the cable that `routes` the circuit, loads and motors the circuit feeds with attribute `rcdTypes`
(comma list of allowed RCD types stated by the equipment).

## Method (implemented)

Circuit voltage U: Un from the network result (`nominalVoltage`) for three-phase circuits, U0 = Un/sqrt(3) for
single-phase circuits. From the network result: `designCurrent` Ib and `ik3MaxStart`, `ik1MinEnd` of the circuit;
`currentCapacity` Iz and `crossSection` S of its cable; k of the cable table the result names (its sha256 prefix
must still match, else k is unknown).

Per candidate (criterion id `<name>:<orderCode>`, subject the circuit):

- `rated-voltage`: Ue >= U.
- `poles` (breakers): protected poles >= 3 for a three-phase circuit, >= 1 for a single-phase one (neutral switching
  is the profile's matter and not evaluated).
- `breaking-capacity`: breakers by the requested basis, fuses by `ratedBreakingCapacity`, covering `voltage` U,
  >= Ik3max at the circuit origin. A capacity of another kind never substitutes.
- `rated-current`: Ib <= In <= Iz (In = setting within the cited range for adjustable devices).
- `conventional-tripping`: I2 = ratio x In <= 1.45 Iz.
- `disconnection-time` (with `disconnectionTime` t): points = `tripCurrentMax` with `tripTime` <= t, plus the
  instantaneous upper edge Im x (1 + tolerance) when its operating time (cited or assumed) is <= t. Pass when
  Ik1min >= the lowest point; fail when a point is given at exactly t and Ik1min is below it; unknown otherwise.
  Without t: not-evaluated.
- `let-through-energy`: cited I²t covering `prospectiveCurrent` Ik3max and `voltage` U <= k²S².
- `selection`: pass when every criterion of the candidate passes, fail when one fails, unknown otherwise.

Per circuit: `rcd-type` (when the fed equipment states `rcdTypes` or `rcd` is named: pass when the RCD's
`rcdType` is in the list; fail when the RCD is missing or of another type; not-evaluated when the equipment states
none) and `rcd-sensitivity` (with `residualCurrentMax`: IΔn <= maximum; fail without an RCD).

Per pair: `selectivity:<up>/<down>` and `cascading:<up>/<down>` (subject the downstream circuit) from the
applicable table entry listing exactly [upstream, downstream] in that order (an entry for the reverse direction says
nothing): limit >= Ik3max at the downstream origin passes, below fails; no applicable table not-evaluated;
an extracted value or an unevaluated requested condition unknown. Per starter: `starter-type-<n>:<protection>/
<contactor>` (subject the circuit): fuse - the fuse's `fuseClass` equals the rating's `fuseClass` condition (a rating without one is unknown) and In <= `fuseRating`;
breaker - an applicable entry; the requested `prospectiveCurrent` Ik3max must be named by the table, else unknown.
Coordination is never derived from curves.

## Result written

`producer {plugin: "protection-coordination", operation: "protection", engine {name: "vera-lv-protection",
version: "1.0.0"}}`, `method {id: "vera-lv-protection-1", title, reference: "IEC 60364-4-41/-4-43 checks as
implemented; catalog <id> <version>; network run <id>"}`, `preliminary: true`, `catalog {id, version}`. `inputs`:
every input of the network result plus the protection objects, loads, motors and relations this run read.
`conditions`: `networkRun`, `catalog` (id, version, sha256 prefix), `breakingCapacityBasis`, `cableTable`,
`assumedInstantaneousTripTime`, `disconnectionTime<N>` (text: circuit and time). Intermediate values: per circuit
`voltage` V and `thermalWithstand` A²s; per candidate `breakingCapacity:<code>` kA, `ratedCurrent:<code>` A,
`conventionalTrippingCurrent:<code>` A, `disconnectionCurrent:<code>` A, `letThroughEnergy:<code>` A²s.
Status: `completed` when every criterion is pass or fail, `incomplete` otherwise; lists over 200 entries and inputs
over 1000 are cut with the status `incomplete` and a message; a result over 4 MiB is refused.
