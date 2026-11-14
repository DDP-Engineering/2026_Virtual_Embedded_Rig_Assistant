# TASK-789dcc82 - LAB-03 hil-testing: hardware-in-the-loop test orchestration and reports (#104)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-5f714098, REQ-FUNC-ebe1fc9f, REQ-SEC-2c37b88c, REQ-SEC-a96b34b5, REQ-SEC-14e51eb1, REQ-SEC-6bac4741, REQ-SEC-8e4ac170, REQ-FUNC-7ba90d50, REQ-FUNC-334a3066, REQ-FUNC-c8da1f45, REQ-FUNC-08e50f9f, REQ-FUNC-c961e72f, REQ-REL-bddb3f0a, REQ-REL-e44e0013, REQ-DATA-07b67f33, REQ-FUNC-1a55eab5, REQ-FUNC-6b178f3a, REQ-UX-c4be4a14, REQ-PLAT-759e6df8
parent:
branch: feature/101-embedded-lab
base: 12059de6f32bf1b495a60d93f949efa6c3ee10cf
opened: 2026-11-14

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: VERA can flash a board (probe-rs, esp32-esptool), talk to its UART (serial-monitor), reserve and drive bench
instruments (LAB-01 scpi-instruments) and judge captures (LAB-02 lab-validation), but only as separate agent calls,
each approved on its own. Nothing runs a finite, declared hardware-in-the-loop scenario across them with one view of
its total risk, its file dependencies, its reservations, its stop/cleanup and one report. OBSERVED: no plugin or core
module under `05_Software/` compiles a test plan; `run_program` approves one command line (`program-tools.ts`),
and its risk comes from the matching manifest rules only (`classifyCommand`).

Desired outcome (STATED, ticket LAB-03 #104, "Livrabile și proces"):
- A declarative plan, validated, with setup, board/revision, firmware/ELF and hash, instruments/wiring, limits,
  preconditions, steps, criteria, total budget and cleanup - not Python/Robot or shell in YAML.
- Initial steps: identify/reserve, setup check, flash/verify through a declared adapter, reset, authorized power
  configure/apply, bounded UART command, wait for an event with a timeout, capture, LAB-02 evaluation and cleanup.
  Finite repetitions; no unbounded loops or executable expressions.
- Preflight expands the plan into the effective operations, determines the highest risk and the transitive file
  dependencies, then prepares the approval; plan file, profiles, firmware and affected options are bound by hash at
  execution.
- The orchestrator uses reusable host APIs of the existing plugins; no second direct flash path bypassing approvals,
  device identification or process-tree stop.
- A reservation owned by the plan with authorized sub-operations: steps of the same run use the resource without
  deadlock, another session cannot take it; a serial port is not held open while the programmer needs it without an
  explicit handoff.
- States prepared, awaiting-approval, running, cleaning-up and a terminal result. Precondition failure, assertion fail,
  transport error and voluntary skip are distinct. Retry only for steps declared repeatable; flash/output/reset are
  never retried automatically to hide a failure.
- A chronological log with monotonic timestamps for local events, device times and correlation uncertainty, plus a
  JSON/JUnit/HTML report and links to captures.
- The active configuration and the cleanup steps are visible before execution; the firmware may actuate the board right
  after flash/reset, and that is part of the setup classification.
- Done criteria L03-A...L03-H (STATED, ticket).

Actors: the user (writes or approves the plan, owns the bench and the board), the agent (writes the plan with the skill,
checks it, runs it, reads the report), VERA core (compiler, approval, executor, leases, runner), the existing plugins
whose programs the steps run (probe-rs, esp32-esptool, serial-monitor, scpi-instruments, lab-validation), the board and
instruments. Later plans (NTL-03 networking, MFG-03 engineering expansion; STATED, coordinator brief) add adapters.

Primary scenario (INFERRED from the ticket's step list): the agent writes `hil/blinky.json` naming a NUCLEO board, its
ELF and SHA-256, the probe selector, the UART port and the scope alias; `hil check` shows the expanded operations and
the highest risk without touching hardware; `hil run` asks one approval that lists every operation, the setup's
firmware effect, the bound files and the cleanup; VERA reserves probe, port and scope for the plan, flashes and verifies
with probe-rs, starts a UART capture waiting for `READY`, resets, awaits the event, sends `ping` expecting `pong`,
captures CH1, evaluates it with lab-validate, runs the cleanup, releases, and writes the result, JUnit and HTML report.

Examples: a plan whose `ping` step expects `pong` but the firmware answers `pang` ends `fail` with that step failed
(L03-D); a plan naming scope alias `scope2` that the registry lacks is refused before any I/O (L03-A); the ELF rebuilt
after approval makes the run CONFLICT before the first step (L03-B).
Counterexamples: a step `{"use": "shell", ...}` or an unknown adapter is not run in any mode; `retries` on a flash step is
refused, not ignored; a plan whose every assertion was skipped never reports `pass`.

In scope: plugin `hil-testing` (manifest, helper for reports, skill, README), plan schema and adapter registrations,
compiler (`check`), executor (`run`) with plan-owned leases, states, budget, retries, repetitions, stop/timeout cleanup,
result JSON, monotonic event log, JUnit/HTML/Markdown report, approval binding (risk, files, resources, confirm word),
core/shared changes needed for that, docs in `00_Planning/`, focused tests.
Out of scope (STATED, ticket): any project test script, distributed board farms, regulated production testing, boards of
unknown setup; GDB, Zephyr and PlatformIO ("nu sunt necesare primei livrări"); Twister/PlatformIO adapters (later
children); NTL-03/MFG-03 adapters (coordinator brief: keep adapters as registrations, don't implement those).

Constraints: STATED (epic plan §2-5, coordinator brief): no MCP, no generic shell; formats stay at version 1, no
migrations; reuse LAB-01 leases/lifecycle and the LAB-02 verdict, never a second registry or engine; new controls do
not raise the background-process limit and pass no VERA secrets; results in `embedded-lab-results/<run-id>/`, never
`.vera/`; Windows x64 and native Ubuntu x64 targets; no driver installs; a mock never ticks a hardware criterion;
implementer hands back without a commit; no push. OBSERVED: the runner spawns without a shell, stdin closed, and kills
the process tree on stop (`runner.ts`); serial-monitor exits 4 when `--until` never matched (`serial_monitor.py`);
scpi and lab-validate accept `--results-dir` (`request.py`, `cli.py`).

Success signals: L03-A...L03-H as written in the ticket, each with real, offline-only or blocked evidence stated.

Evidence: OBSERVED `00_Planning/plan/embedded-lab-plugins.md` (LAB-01/02 as built), `00_Planning/plugins/architecture.md`
§3-4, `core/src/plugins/{program-tools,program-request,runner,leases,resource-registry}.ts`,
`core/src/agent/approvals.ts`, `shared/src/{plugins,program-rules,lab-resources}.ts`, the manifests of probe-rs,
esp32-esptool, serial-monitor, scpi-instruments, lab-validation, the LAB-01/LAB-02 hand-over notes.
Inventory OBSERVED by LAB-01 (2026-11-13): no instrument; COM ports are Bluetooth links. Board/probe presence for L03-C:
UNKNOWN until checked read-only.

Assumptions: INFERRED - plan approvals reuse the `run_program` approval path (risk matrix, trial override, typed
confirmation, CLI prompt, card) because a plan run is a call of the declared program `hil`; the expansion is shown as
the approval's notes.

Unknowns: a real board and probe on this machine (L03-C, L03-H live); native Ubuntu (L03-H); real probe-rs/esptool
binaries (not provisioned here; non-PyPI downloads need the user).

Decision-blocking questions: none. The coordinator's brief makes the session autonomous and asks for sensible
defaults recorded as rulings; the open hardware proofs stay blockers, not questions.

Proposed behaviors (accepted by ruling under the autonomous brief):
- P1 `hil check <plan>` compiles without any device I/O; `hil run <plan>` compiles, asks one approval and executes in
  core; risk = highest of every compiled operation and the declared firmware effect.
- P2 adapters are core registrations mapping a step `use` to a program of an enabled plugin; the program's own rules
  classify each operation, so an adapter never lowers a risk.
- P3 the plan run holds one lease set (registry aliases, serial ports, probe identities); its steps borrow it.
- P4 steps run sequentially; only adapters marked background-capable may run in the background, ended by an `await`
  step or before cleanup; overlapping resources between running steps are refused at compile time.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin, new plan operations |
| no new interface or data format | no | plan format, hil result format, manifest field |
| no new dependency | yes | Node/stdlib Python only |
| an existing requirement already covers the behavior | no | no plan requirement exists |
| no security or data-handling change | no | approval binding and lease ownership change |

## Requirement coverage

| Behavior | Requirement | Criterion |
|---|---|---|
| plan, expansion and result formats (spec) | REQ-DATA-5f714098 | L03-A, L03-H |
| `hil check` compiles without device I/O | REQ-FUNC-ebe1fc9f | L03-A |
| invalid/unknown plan refused before I/O | REQ-SEC-2c37b88c | L03-A |
| plan risk = highest compiled risk + firmware effect | REQ-SEC-a96b34b5 | L03-G |
| approval bound to plan, firmware, files, registry, plugins | REQ-SEC-14e51eb1 | L03-B |
| files re-checked before every operation | REQ-SEC-6bac4741 | L03-B |
| firmware hash mismatch refused | REQ-SEC-8e4ac170 | L03-B |
| plan-owned reservation, steps borrow, others BUSY | REQ-FUNC-7ba90d50 | L03-F |
| no interleaving inside a plan | REQ-FUNC-334a3066 | L03-F |
| attempt outcome mapping, setup -> blocked | REQ-FUNC-c8da1f45 | L03-D |
| status precedence, never pass unexecuted | REQ-FUNC-08e50f9f | L03-D |
| retries/repeat only for repeatable adapters | REQ-FUNC-c961e72f | ticket "Retry" |
| stop/timeout/budget cleanup and release | REQ-REL-bddb3f0a | L03-E |
| unconfirmed physical state -> unknown | REQ-REL-e44e0013 | L03-E |
| run folder, monotonic log, report | REQ-DATA-07b67f33 | L03-H |
| lab-validate evaluation step | REQ-FUNC-1a55eab5 | L03-C |
| await with timeout | REQ-FUNC-6b178f3a | ticket "așteptare eveniment" |
| expansion shown in approval | REQ-UX-c4be4a14 | L03-G |
| Windows x64 and native Ubuntu x64 | REQ-PLAT-759e6df8 | L03-H |


## Design

**Approach.** Core owns compilation and execution (RULING-001). `program-tools.prepare` sees a declared program with
`plan: hil` and first argument `check`/`run` and hands the call to `plugins/hil/`: `compile.ts` parses the plan
(`shared/src/hil-plan.ts`, zod, REQ-DATA-5f714098, REQ-SEC-2c37b88c), checks the firmware hash (REQ-SEC-8e4ac170), builds
each step through `adapters.ts` (RULING-002) and prepares each operation with the same `request()` path run_program uses
(rules, files, registry aliases) so no adapter chooses a risk (REQ-SEC-a96b34b5). `check` returns the expansion as the
run's output without spawning (REQ-FUNC-ebe1fc9f). `run` returns one ProgramChangeRequest (tool `run_program`) whose
risk/trial/confirm/notes/files/resources come from the expansion and whose extra `plan` field carries every operation's
request and the run id (REQ-UX-c4be4a14, REQ-SEC-14e51eb1). Apply re-compiles with the same run id, consumes, then
`executor.ts` runs the plan. Rejected: a Python orchestrator (a second spawn path, needs IPC to reach the runner) and a
new tool/approval variant (duplicates the mode matrix, card, CLI prompt and event schema).

**Interfaces and data.** Manifest: program field `plan: "hil"` (shared `plugins.ts`). ProgramChangeRequest gains optional
`plan` (core only; not in the approval event). Runner: `hold()` registers a process-less active run with a log, record,
lease claims and port keys (the plan run, a ProgramRun); `RunRequest.parent` lets a child skip BUSY against its parent;
`LeaseOwner.parent` lets `ResourceLeases.take` accept keys the parent holds (borrowed, never dropped)
(REQ-FUNC-7ba90d50). Executor state machine prepared -> awaiting-approval -> running -> cleaning-up -> done with statuses
of spec §6-7 (REQ-FUNC-c8da1f45, REQ-FUNC-08e50f9f, REQ-FUNC-c961e72f, REQ-FUNC-6b178f3a); `beforeSpawn` of each child
re-hashes plan, firmware and that operation's files (REQ-SEC-6bac4741). Stop/budget/step error -> stop children (runner
grace + declared cleanup) -> cleanup steps -> release (REQ-REL-bddb3f0a); physical aggregation and `markUnknown`
(REQ-REL-e44e0013). Result folder writer in `executor.ts` (REQ-DATA-07b67f33); evaluate writes the LAB-02 request
(REQ-FUNC-1a55eab5). Helper `hil report` renders HTML/MD/JUnit.

**Files and test seams.** shared: `hil-plan.ts` (+test), `plugins.ts`. core `plugins/hil/{adapters,compile,executor,
run}.ts` (+`hil.test.ts` with a scripted fake process host), `program-tools.ts`,
`program-request.ts`, `runner.ts`, `leases.ts` (+`runner-leases.test.ts` cases). Plugin `05_Software/plugins/hil-testing/`
(plugin.yaml, scripts/hil_tool.py + hil_report/, skill `hil-planning`, README), catalog/packs entries.
Integration `tests/integration/hil-testing.test.ts`: real runner + real serial-monitor (fake pyserial), scpi (fake
PyVISA) and lab-validate helpers, fake probe-rs script; packaging test count.

**Risks and open decisions.** Concurrency: two plans or a plan and a direct run contend only through the runner's
in-process check and the lease folder; a direct serial run in another VERA process is not leased (LAB-01 limit). The
approval card shows the expansion as notes (no UI change). Real board, real probe-rs/esptool and native Ubuntu are open.

**Requirement map.** REQ-DATA-5f714098 shared schema + spec; REQ-FUNC-ebe1fc9f compile/check; REQ-SEC-2c37b88c schema +
adapter params + prepare refusals; REQ-SEC-a96b34b5 max risk + firmwareEffect; REQ-SEC-14e51eb1 hashed `plan` + consume;
REQ-SEC-6bac4741 beforeSpawn; REQ-SEC-8e4ac170 compile; REQ-FUNC-7ba90d50 runner hold/parent + leases parent;
REQ-FUNC-334a3066 compile overlap check; REQ-FUNC-c8da1f45/08e50f9f/c961e72f/6b178f3a executor; REQ-REL-bddb3f0a and
REQ-REL-e44e0013 executor stop/cleanup/physical; REQ-DATA-07b67f33 executor result writer + hil report; REQ-FUNC-1a55eab5 evaluate;
REQ-UX-c4be4a14 notes; REQ-PLAT-759e6df8 no platform-specific code beyond the runner's.

Diagrams: [diagram_TASK-789dcc82.md](diagram_TASK-789dcc82.md)


## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: npx vitest run src/libraries/shared/src/hil-plan.test.ts exit 1 - plan schema and problem paths, manifest field plan missing (REQ-DATA-5f714098, REQ-SEC-2c37b88c)
- 2026-11-14 build: DEVIATION build: runner hold/parent and lease borrowing were written before their tests (no red line) - the tests were added right after and exercise BUSY across session, process and plan; cost: no observed red for REQ-FUNC-7ba90d50's platform part
- 2026-11-14 build: green: npx vitest run core/src/plugins/{runner-leases,leases,runner}.test.ts exit 0 (REQ-FUNC-7ba90d50 platform part)
- 2026-11-14 build: DEVIATION build: core hil compile/executor/run were written before hil.test.ts - observed red only on the first run (exit 1: approval CONFLICT surfaced as 'Program run failed.' and a fixture bug), then green; cost: most executor requirements have no observed red line
- 2026-11-14 build: red: npx vitest run core/src/plugins/hil/hil.test.ts exit 1 - CONFLICT after approval mapped to a generic error (REQ-SEC-14e51eb1)
- 2026-11-14 build: green: npx vitest run core/src/plugins/hil/hil.test.ts program-tools.test.ts program-resources.test.ts shared/src/hil-plan.test.ts exit 0, 58 tests (REQ-DATA-5f714098 REQ-FUNC-ebe1fc9f REQ-SEC-2c37b88c REQ-SEC-a96b34b5 REQ-SEC-14e51eb1 REQ-SEC-6bac4741 REQ-SEC-8e4ac170 REQ-FUNC-7ba90d50 REQ-FUNC-334a3066 REQ-FUNC-c8da1f45 REQ-FUNC-08e50f9f REQ-FUNC-c961e72f REQ-REL-bddb3f0a REQ-REL-e44e0013 REQ-FUNC-6b178f3a REQ-UX-c4be4a14)
- 2026-11-14 build: green: npx vitest run core/src/plugins shared/src/hil-plan.test.ts shared/src/lab-resources.test.ts tests/integration/hil-testing.test.ts tests/packaging/prepare-plugins.test.ts exit 0, 289 passed 3 skipped (all LAB-03 requirements; integration = real runner + real serial/scpi/lab-validate/hil helpers on fakes, probe-rs replay stand-in); npm run lint exit 0; npm run typecheck exit 0; npm run check:i18n exit 0
- 2026-11-14 build: neighbours: npx vitest run tests/integration/{serial-monitor,probe-rs,scpi-instruments,lab-validation}.test.ts src/apps/cli src/libraries/core/src/agent exit 1 - 213 passed, 1 failed: probe-rs.test.ts 'finds PATH before cargo...' (Provisioner find of ~/.cargo/bin returns undefined); provisioning.ts and the probe-rs package are untouched by this task, failure reproduces alone; not verified at base (no second checkout)
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: self-review: hold now refuses while any unfinished run (not only background) uses one of its serial ports; runner-leases.test.ts exit 0 (17 tests). Knowledge pages plugins.md and official-plugins.md, project.md and environment.md updated. Inventory 2026-11-14 read-only (Get-PnpDevice): no ST-Link, J-Link, CMSIS-DAP, CP210x, CH340, FTDI or ESP USB device attached
- 2026-11-14 validate: review round 1: spec changes_required (refused start in setup became blocked not error; cleanup refused after a firmware rebuild; probe keys not checked against direct runs; missing tests for exit 3/timeout/background stop/every adapter; t not strictly increasing; marker not shown seen by next claim; interrupted flash not counted as firmware start; stale comment/Design names); quality changes_required (blocker: invalid expect regex only fails at run time and a throw in cleanup leaves the hold unfinished; OS-dependent firmware-start; probe reservation; Stop before the hold exists; firmware path starting with '-'; blocked in a test step; report helper partial write on dangling link; artifacts read whole into memory)
- 2026-11-14 validate: returned to build - review round 1 findings
- 2026-11-14 build: round-1 fixes: compile refuses invalid expect (steps and cleanup) and a firmware path starting with '-'; executor: refused start is error in any phase, a test-step blocked is error, cleanup steps re-check only their own files, each cleanup step isolated, post-step phases always finish the hold, internal error no longer recorded as Stop, firmware counted started when the process exited or was killed, t strictly increasing, artifacts hashed as streams; runner: --probe values are probe keys checked against plan holds, a throwing hold stop callback never aborts other stops; run.ts honours an abort during hold creation; report helper uses lexists and writes all-or-nothing; tests added (every adapter, bin esptool, invalid expect, option-like firmware, exit 3, step timeout, stop during background step, probe BUSY, marker seen by next claim, interrupted irreversible flash, throwing stop callback); spec, README, architecture and Design names updated
- 2026-11-14 build: green: npx vitest run core/src/plugins shared/src/hil-plan.test.ts tests/integration/hil-testing.test.ts tests/packaging/prepare-plugins.test.ts - 285 passed then one timing-dependent assertion relaxed to the two spec-correct orderings; hil.test.ts rerun 3x exit 0 (18 tests); npm run lint exit 0; npm run typecheck exit 0; npm run check:i18n exit 0
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 2: spec approved, quality approved. DEVIATION validate: the spec reviewer's one remaining minor finding (REQ-FUNC-7ba90d50 and spec §6 overstated cross-process refusal of direct serial/probe runs) was fixed in requirement and spec wording after the approval without a third round - text only, aligned with README and architecture §3.7, no code or test change
- 2026-11-14 validate: manual: REQ-PLAT-759e6df8 native Ubuntu x64 not run (no native Ubuntu machine in this session); L03-C real board not run - read-only Get-PnpDevice found no probe or USB-serial board; both stay open blockers
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-789dcc82 --strict --run exit 0; ran lint, typecheck, i18n (all ok); strict ok; 55 warnings: journal-header/stale-paths/ticket-ref of other tasks (pre-existing) and uncovered-source for catalog.yaml, packs.yaml, shared index.ts/plugins.ts (registration lines tested by hil-plan.test.ts and hil-testing.test.ts but not listed in a requirement's affected_paths) and two test files - informational, accepted. Focused vitest proof from build stands (no source change since); pre-existing probe-rs.test.ts provisioning failure is out of scope
- 2026-11-14 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-14 | decision=HIL orchestration lives in core: run_program of the hil-testing program 'hil' with first argument check/run is compiled and executed by VERA (manifest program field plan: hil); each step runs the declared program of an enabled plugin through ProgramRunner; one run_program approval covers the expanded plan, its notes list every operation, the setup and the cleanup. | reason=Ticket: orchestrator uses host APIs, no second flash path, risk from the compiled plan not a rule; reusing the run_program approval keeps the mode matrix, trial override, typed confirmation and CLI/card. Decided under the coordinator's autonomous brief. | source=technical | supersedes=none
- RULING-002 | date=2026-11-14 | decision=Adapters are a TypeScript registry in core (registerHilAdapter); initial set probe-rs list/flash/verify/reset, esptool chip-id/flash/verify, serial capture/send, scpi identify/read/status/capture/configure/output/close, lab-validate compare, plus the core await step. Later plans add registrations, never a second executor. | reason=Coordinator brief: keep adapters as registrations; typed code needs no template language. | source=technical | supersedes=none
- RULING-003 | date=2026-11-14 | decision=Firmware is flashed only from the plan's declared firmware file (path + SHA-256); setup.firmwareEffect (device-read, device-write or irreversible) raises the plan risk when a step flashes or resets the board; the typed confirmation word of an irreversible plan is the plan id. | reason=Ticket: firmware identity by hash; its physical effect belongs to the setup classification (L03-G). | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-789dcc82.md
changed: hil-testing plugin, core plugins/hil, runner hold/parent/probe keys, leases parent, shared hil-plan, docs
evidence: aegis check --task TASK-789dcc82 --strict --run exit 0 (lint, typecheck, i18n ok); focused vitest core/src/plugins + shared hil-plan + integration hil-testing + packaging exit 0
issues: L03-C real board/probe not available; native Ubuntu x64 not run; real probe-rs/esptool not provisioned; pre-existing probe-rs.test.ts provisioning failure (untouched area)
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/101-embedded-lab
- requirements:
  - REQ-DATA-5f714098 - HIL plan, compiled operations and HIL test result formats
  - REQ-FUNC-ebe1fc9f - Compile a HIL plan without device I/O
  - REQ-SEC-2c37b88c - Refuse an invalid or unknown plan step before any I/O
  - REQ-SEC-a96b34b5 - Rate a HIL plan at its highest compiled risk
  - REQ-SEC-14e51eb1 - Bind a HIL plan approval to the plan, firmware and step files
  - REQ-SEC-6bac4741 - Re-check plan files before every operation
  - REQ-SEC-8e4ac170 - Refuse firmware whose hash differs from the plan
  - REQ-FUNC-7ba90d50 - Reserve a HIL plan's resources for the plan run
  - REQ-FUNC-334a3066 - Refuse interleaved use of a resource inside a plan
  - REQ-FUNC-c8da1f45 - Judge each HIL step by its program's outcome
  - REQ-FUNC-08e50f9f - Never report pass for an unexecuted or failed test
  - REQ-FUNC-c961e72f - Retry only declared repeatable HIL steps
  - REQ-REL-bddb3f0a - Clean up a HIL run after stop, timeout or budget
  - REQ-REL-e44e0013 - Report an unconfirmed physical state of a HIL run as unknown
  - REQ-DATA-07b67f33 - Write the HIL run evidence and report
  - REQ-FUNC-1a55eab5 - Evaluate a HIL capture with lab-validate
  - REQ-FUNC-6b178f3a - Wait for a HIL event with a timeout
  - REQ-UX-c4be4a14 - Show the expanded HIL plan in the approval
  - REQ-PLAT-759e6df8 - Run HIL plans on Windows x64 and native Ubuntu x64
- deviations: 3 recorded
  - build: runner hold/parent and lease borrowing were written before their tests (no red line) - the tests were added right after and exercise BUSY across session, process and plan; cost: no observed red for REQ-FUNC-7ba90d50's platform part
  - build: core hil compile/executor/run were written before hil.test.ts - observed red only on the first run (exit 1: approval CONFLICT surfaced as 'Program run failed.' and a fixture bug), then green; cost: most executor requirements have no observed red line
  - validate: the spec reviewer's one remaining minor finding (REQ-FUNC-7ba90d50 and spec §6 overstated cross-process refusal of direct serial/probe runs) was fixed in requirement and spec wording after the approval without a third round - text only, aligned with README and architecture §3.7, no code or test change
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 12059de: 52 file(s) changed, 5794 line(s) added
- checks: errors=0 warnings=55 notes=27
- checklist: 8/9 done; open: `report` appended
