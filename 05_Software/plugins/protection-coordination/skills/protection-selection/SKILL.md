---
name: protection-selection
description: Select and check fuses and circuit breakers for circuits of the electrical model - confirm a current network result, agree the normative profile values (breaking-capacity kind, disconnection times, RCD sensitivity), pick cited catalog candidates, run protection_coordination and explain every pass, fail, unknown and not-evaluated criterion, including selectivity and starter coordination from manufacturer tables. Use when asked to choose or verify protective devices, breaking capacity, overload protection, disconnection times, let-through energy, selectivity, cascading or type 1/2 coordination.
---

The host tool `protection_coordination` evaluates and stores a result; it never changes the model and never
configures a device. It needs a current `electrical_network` result and an industrial catalog.

## 1. Confirm the network result

`electrical_model {"view": "results"}`: take the newest `electrical-network` result whose freshness is `current`.
A stale result is refused - run `electrical_network` again first (skill `network-sizing`). The protection run
reads its `designCurrent`, `ik3MaxStart`, `ik1MinEnd` (circuits), `currentCapacity`, `crossSection` (cables),
`nominalVoltage` and the cable table it names (for k).

## 2. Agree the profile values with the user

Never choose these yourself; they come from the project's normative profile:

- `breakingCapacity`: `Icu`, `Ics` or `Icn` - which breaker capacity must reach the fault current.
- `disconnectionTime` per circuit (for example the times the applicable edition of the wiring rules sets for final
  and distribution circuits in the earthing system).
- `residualCurrentMax` where an RCD is required; the RCD types the equipment allows come from its manual and belong
  in the model as attribute `rcdTypes` on the load or motor (`electrical_model_change`, approved by the user).
- `assumedInstantaneousTripTime` only when the user states it (for example from the device standard); it is
  recorded as an assumption, never added silently.

## 3. Pick candidates

`industrial_catalog {"view": "list"}`, then `items` by family or category. Candidates are items of categories
`miniature-circuit-breaker`, `circuit-breaker`, `motor-circuit-breaker` or `fuse-link` (1..8 per circuit, 16 in
all). Adjustable devices (setting range) need a `setting`. Name selectivity or cascading pairs and starters
(protection + contactor, type 1 or 2) when the user asks for them.

## 4. Run and explain

Call `protection_coordination`, then explain per circuit:

- each candidate's `selection` verdict and the failing criteria (breaking capacity, rated current, I2 <= 1.45 Iz,
  disconnection, let-through energy), with the cited values and the limits;
- every unknown with its reason (no cited value, value outside the requested conditions, extracted only, no band
  tolerance or operating time, k unknown) and what data would close it - never fill a gap with a margin;
- coordination: a pair without a manufacturer table is not evaluated; a table that does not state the prospective
  current leaves the starter unknown. Never state selectivity from overlapping curves.

Results are preliminary engineering support, not a verified design or a conformity statement.
