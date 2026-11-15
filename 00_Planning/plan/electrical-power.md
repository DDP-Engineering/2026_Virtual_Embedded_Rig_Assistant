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
STATE: planned; no package implemented yet.

## Order

| Order | Package | Issue | Result | Depends on | State |
|---|---|---|---|---|---|
| 1 | PWR-00 | [#126](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/126) | common project model: stable IDs, quantities with units, relations, provenance, stale results (product code, not a plugin) | - | planned |
| 2 | PWR-01 | [#127](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/127) | `industrial-catalog`: manufacturer + order code + variant + accessories, conditioned parameters, documented selection | PWR-00 | planned |
| 3 | PWR-02 | [#128](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/128) | `electrical-network`: load balance, cable sizing, voltage drop, short circuit on radial LV networks | PWR-00 | planned |
| 4 | PWR-03 | [#129](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/129) | `protection-coordination`: breaker and fuse selection, breaking capacity, selectivity from manufacturer tables | PWR-01, PWR-02 | planned |
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
