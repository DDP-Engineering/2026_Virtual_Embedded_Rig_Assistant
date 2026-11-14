# TASK-e8f498de - ELEC-07 freerouting: local autorouting through DSN/SES with Freerouting 2.5.0 on a pinned Temurin 25 JRE (#99)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-2a80da7f, REQ-SEC-73847af9, REQ-FUNC-93285684, REQ-REL-140facf3, REQ-REL-558ec184, REQ-REL-fa70a38d, REQ-PLAT-e093fdbd
parent:
branch: feature/93-electronics-calc
base: 6c4b9e7c9618e8966cab3f11ed5b0e566a026bca
opened: 2026-11-13

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: VERA cannot autoroute a KiCad board (STATED, ticket #99 ELEC-07 "rutarea neturilor selectate"); kicad-layout
(ELEC-06) only adds explicit tracks and vias the agent computes itself (OBSERVED).
Desired outcome: a `freerouting` plugin routes a kicad-layout candidate locally with a pinned Freerouting 2.5.0 on a
pinned Temurin 25 JRE, offline, and hands the result to kicad-layout as an edit request, so ELEC-06's checks, DRC,
objectives and apply_candidate apply unchanged (STATED, user decisions 2026-11-13: jar + Temurin 25 JRE downloaded on
Install; DSN from KiCad's SWIG export, SES converted into kicad-layout operations).
Actors: the agent (runs the tools), the user (approves apply), KiCad 10 (DSN export, the candidate editor),
Freerouting (the router).
Primary scenario: kicad-layout-tool open --board B -> freerouting-tool route --run R -> kicad-layout-tool edit --run R
--request R/freerouting/NNN/request.json -> report/objectives -> apply_candidate (approval).
Examples: the kicad-layout fixture board with VIN/VOUT/GND/FB connections unrouted routes to zero unconnected items
after the edit (OBSERVED in the probe: Freerouting 0 unrouted on probe.dsn in 0.5 s).
Counterexamples: a net excluded by --nets stays unrouted; existing and locked copper is never moved (protected in
the DSN, and the edit only creates items).
In scope: plugin package (java = Temurin JRE download, freerouting = jar download as a `file` program, kicad-cli
find, freerouting-tool script); new manifest field `file: true` (a verified download that never runs); DSN export
from a copy of the saved candidate with KiCad's Python; existing copper marked protected; Freerouting headless with
no network (hosts file with only localhost) and its settings/logs in the work folder; finite budget (passes, seconds);
custom DRC rules (.kicad_dru) reported before routing and refused unless allowed; SES -> request.json (new tracks and
vias only, optional net filter); result.json/report.md; kicad-layout request limit raised for routed requests.
Out of scope: Freerouting cloud/API/MCP servers (ticket); several variants (ticket: optional); native Ubuntu runs
(no Ubuntu host here, as in ELEC-01..06); the full integrated acceptance project E07-G beyond reusing children's
evidence (user 2026-11-13: golden path only, no overengineering).
Constraints: no global Java assumed (ticket); no network from the router (E07-E); the source board is written only
by apply_candidate (ticket, ELEC-06); format 1, no compatibility code (memory).
Success signals: E07-A/C on the fixture with real KiCad 10.0.8 and Freerouting 2.5.0 (zero unconnected after the
edit); E07-B protected/locked copper unchanged and a custom rule refused before routing; E07-D an invalid SES or a
timeout leaves the candidate untouched and no java process; E07-E zero sockets (probe) and identified versions.
Evidence: probes D:/Temp/elec07-probe (jar CLI entry, hosts file, user.home), D:/Temp/freerouting-dl.
Assumptions: KiCad's DSN export carries net classes (widths, clearances, vias) (INFERRED from the probe DSN).
Unknowns: Linux KiCad python with pcbnew at /usr/bin/python3 (not testable here).
Decision-blocking questions: none (engine, route and scope decided by the user).
Proposed behaviors: see Design.
Path and reason: full - new behavior, new interface (plugin, manifest field), new downloads.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin |
| no new interface or data format | no | `file` field, request.json |
| no new dependency | no | Freerouting jar, Temurin JRE |
| an existing requirement already covers the behavior | no | |
| no security or data-handling change | no | downloads, offline guard |

## Requirement coverage

| Behavior | Requirement | Source | Verification |
|---|---|---|---|
| route a saved candidate into a kicad-layout request | REQ-FUNC-2a80da7f | ticket, RULING-001 | freerouting.test.ts routed + golden path |
| offline router, settings in the work folder | REQ-SEC-73847af9 | ticket E07-E | freerouting.test.ts routed (home), probe zero sockets |
| keep existing copper, --nets filter | REQ-FUNC-93285684 | ticket E07-B | DSN protect, request nets, golden path counts |
| custom DRC rules refused before routing | REQ-REL-140facf3 | ticket E07-B | freerouting.test.ts rules |
| failures leave the candidate, no request | REQ-REL-558ec184 | ticket E07-D | freerouting.test.ts budget, corrupt SES |
| not a run / changed candidate refused | REQ-REL-fa70a38d | ELEC-06 contract | freerouting.test.ts refusals |
| `file` program (jar) | REQ-PLAT-e093fdbd | RULING-001 (jar) | provisioning.test.ts, plugins.test.ts |

## Design

freerouting-tool (Python, no dependencies) reads the kicad-layout run folder, copies the candidate's board, project
and rules files, exports a DSN with KiCad's Python (scripts/export_dsn.py), protects the existing wiring
(freerouting_support/ses.py), runs Freerouting's CLI entry with the hosts file and user.home in the work folder
(cli.py), parses the SES (a small S-expression reader) into track and via operations and writes request.json,
result.json and report.md. kicad-layout-tool edit --request applies the request (no cross-plugin call: the agent
runs the printed `next` command). Platform: manifest `file: true` (shared schema, provisioning probe reads the
version from the file name, program-tools refuses running it); kicad-layout MAX_OPERATIONS 64 -> 1024. Diagram:
skipped (one linear pipeline; DEVIATION recorded).

## Log

- 2026-11-13 frame: journal opened
- 2026-11-13 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-13 specify: completed; next design - requirements and spec written (7 Done checklist item(s) left unticked)
- 2026-11-13 design: DEVIATION design: no diagram - one linear pipeline (route -> request -> kicad-layout edit), described in Design; costs a picture only.
- 2026-11-13 design: completed; next build - design recorded (6 Done checklist item(s) left unticked)
- 2026-11-13 build: green: VERA_TEST_KICAD_GUI=1 VERA_TEST_FREEROUTING_JAR VERA_TEST_JAVA vitest tests/integration/freerouting.test.ts tests/packaging/prepare-plugins.test.ts 7 passed (Freerouting 2.5.0, Temurin 25.0.5, KiCad 10.0.8, Windows 11; golden path 0 unconnected, newCount 0, objectives pass); provisioning/program-tools/shared plugins tests 85 passed; kicad-layout offline block 4 passed (1024-op limit); typecheck, lint exit 0. No pcbnew or java left.
- 2026-11-13 build: completed; next validate - build green (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: one combined golden-path review (RULING-002): approved, no blockers. Applied notes 1 (router env without APPDATA/LOCALAPPDATA/XDG_*, so settings stay in work/home outside VERA) and 2 (compact request.json); focused rerun freerouting.test.ts 5 passed, 1 skipped (GUI, passed in build). Accepted limits: doubled quotes in SES names, runId null in stdout on failure, work/board left after a failed export, no unit test for run_program refusing a file program, Linux /usr/bin/python3 untested, --allow-custom-rules real route not automated, native Ubuntu, E07-G beyond the children's evidence.
- 2026-11-13 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-13 | decision=Freerouting 2.5.0 jar (sha256 f6f51bb0...e3c7) on a pinned Eclipse Temurin 25.0.5+8 JRE (Windows zip, Linux tar.gz), both VERA downloads on Install; DSN exported with KiCad 10's Python (SWIG ExportSpecctraDSN) from a copy of the saved candidate; SES converted into kicad-layout track/via operations | reason=User choices 2026-11-13 after the native freerouting-cli proved broken (GraalVM serialization error on keepouts) | source=user | supersedes=none
- RULING-002 | date=2026-11-13 | decision=Golden path only: one review round where possible, focused tests, remaining edge cases accepted as known limits | reason=User 2026-11-13: reviews and fixes take too long, no overengineering, focused tests only, acceptable when the golden path is not blocked | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e8f498de.md
changed:
evidence:
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 1
