# TASK-a5a839c7 - LAB-01 scpi-instruments: SCPI instruments, resource leases and supervised cleanup (#102)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-f2cbfc23, REQ-FUNC-0542cc94, REQ-UX-73dd7a9b, REQ-FUNC-a5770245, REQ-FUNC-e4ca09ad, REQ-REL-52212fce, REQ-FUNC-3bf3d5bc, REQ-REL-3817f2fd, REQ-FUNC-d4b72e6b, REQ-SEC-371cdb26, REQ-DATA-4451f705, REQ-SEC-f9f009d9, REQ-SEC-8737759e, REQ-SEC-9524d2c9, REQ-FUNC-b1ab08fd, REQ-FUNC-712a3679, REQ-REL-4f6d4a31, REQ-FUNC-f682af02, REQ-FUNC-a8dcf154, REQ-DATA-b3e2930f, REQ-PLAT-fae260c3, REQ-TEST-2d32cd86, REQ-SEC-80fa1675
parent:
branch: feature/101-embedded-lab
base: d3764caffa8e042cc78fa85d62a57403fdeb6e2d
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

Problem: VERA cannot talk to bench instruments over SCPI with identity, permissions and a verified lifecycle.
STATED (ticket LAB-01, #102): a plugin `scpi-instruments` with finite operations through PyVISA (`discover-configured`,
`identify`, `capabilities`, `read`, `capture`, `configure`, `output`, `status`, `close`), validated instrument profiles,
a host resource/lease registry with aliases and BUSY, and a cleanup supervisor integrated with Stop, timeout, session or
workbench close and disconnect. OBSERVED (`runner.ts`): the runner kills the process tree on Stop/timeout and guards only
serial ports named by background runs, in one process; nothing reserves a VISA/USB/TCP instrument, nothing coordinates the
desktop app with the CLI, and nothing cleans up a physical output after a kill. OBSERVED (read-only inventory 2026-11-13,
`Get-PnpDevice`): this machine has no USBTMC/VISA instrument and no vendor VISA; COM3/4/7/8 are Bluetooth serial links.

Desired outcome:
- An official plugin `scpi-instruments` (program `scpi`, PEP 723 script, pinned PyVISA + pyvisa-py) whose operations act
  only through validated profile data shipped in the package: identity check (`*IDN?` manufacturer/model/firmware and an
  optional declared serial) before any configure/output, channel and value limits, terminators, timeouts and cleanup
  steps with readback; an unknown or mismatching instrument gets identification only.
- Instruments are declared by the user in one workbench registry `lab/resources.json` (format 1; alias, identity kind as
  data, VISA resource, optional serial, profile, bench limits); discovery lists declared resources and local VISA
  enumeration, never a LAN scan.
- The host derives normalized identity keys from the declared resource before approval, shows the reserved instrument
  and the registry hash in the existing approval, and reserves the keys for the run in a lease registry shared by the
  desktop app and the CLI on the same machine (BUSY before any I/O); serial-port names held by serial runs and ASRL
  instruments share keys.
- Stop, timeout, session/workbench close and helper crash of an actuating run end with the authorized cleanup: a stop
  request the helper honours, then a separate finite cleanup run of the same program, then readback; the physical state
  is reported `confirmed` or `unknown`, an unknown state is remembered and blocks configure/output until a close confirms.
- Results are format 1 documents in `embedded-lab-results/<run-id>/` with raw data kept for recalculation (scalar and
  waveform with preamble, scale, endianness and timebase), statuses pass/fail/incomplete/blocked/error, distinct
  diagnostics for truncated transfer, VISA timeout, absent instrument, missing driver/backend and reconnection.

Actors: the user (declares instruments, approves operations), the agent (runs `scpi`), VERA's runner and approval gate,
the desktop app and the CLI, the instrument.

Primary scenario: the user declares `scope` (Rigol DS1000Z over TCPIP) and `psu` (Rigol DP800 over USB) in
`lab/resources.json`; the agent identifies both, captures CH1 of the scope (device-read), and powers the DUT through
`scpi output --instrument psu --channel CH1 --voltage 3.3 --current 0.2 --hold 60` in the background (irreversible,
typed confirmation); a second session asking for `psu` gets BUSY; Stop turns the output off and readback confirms it.

Examples: STATED Done criteria L01-A...L01-H (ticket). L01-D: two sessions or two aliases of one instrument give BUSY.
L01-E: Stop/timeout/crash run the authorized cleanup; readback confirms or the result is unknown, never a false pass.

Counterexamples: STATED - no raw SCPI, no "any VISA instrument", no driver installs, no general LAN scan, no guaranteed
physical stop after complete host loss. A `?` in a command does not prove it has no effect.

In scope: STATED - the package (manifest, README, skills, helper, profiles), pinned PyVISA/backend, first classes
DMM/scope/PSU, profile validation, scalar/waveform import/export with binary-block parsing, local/declared discovery,
the host lease registry in desktop and CLI with aliases and BUSY, its documented/tested interaction with serial/sigrok,
the cleanup supervisor and physical state confirmed/unknown, approval display, catalog/pack. INFERRED - the manifest
extension (`resources` on a program) and the shared registry file are the seam later plans (NIC, endpoint, lab host)
extend with further identity kinds; only kind `visa` is implemented.

Out of scope: STATED (ticket) raw SCPI, every VISA instrument, automatic driver installation, LAN scan, physical stop
guarantee after host loss; later identity kinds (task brief). Shared lease modes (compatible roles) stay a data seam
(INFERRED from the networking plan), not implemented.

Constraints: STATED (task brief) no download/install without approval - PyVISA/pyvisa-py are not on this machine
(OBSERVED `python -c "import pyvisa"` fails), so tests use offline fixtures until approved; no command to a real
instrument without approval; never commit/push; formats stay version 1; modern minimum versions; reuse ELEC
conventions. STATED (plan section 4) new controls do not raise the background limit and pass no secrets; helper IPC is
local, session-owned and finite. Branch `feature/101-embedded-lab` (not the default branch).

Success signals: L01-C/D/F/H covered by offline and real-process tests (fake PyVISA, real runner, real lock files, real
process kill and cleanup run); L01-A/B/E covered offline; L01-G Windows offline evidence; real-instrument, real-PyVISA
and native-Ubuntu proofs reported as open blockers, never ticked with a mock.

Evidence: ticket LAB-01.md and plan sections 2-5 (STATED); runner.ts, program-tools.ts, program-request.ts, plugins.ts,
program-rules.ts, approval-card.tsx, the sigrok/can-python/ngspice packages (OBSERVED); PyPI release lists via web
search: PyVISA 1.16.2 (2026-02-27), pyvisa-py 0.8.1 (OBSERVED, secondary sources).

Assumptions: the vendor programming guides behind the first three profiles (Keysight 34460A/34461A DMM, Rigol DS1000Z
scope, Rigol DP800 PSU) are recalled correctly - INFERRED, unverified until hardware.

Unknowns: which instruments the user has (no inventory possible here); whether pyvisa-py 0.8.1 runs on CPython 3.13 from
uv; native Ubuntu behaviour; USBTMC access needs libusb/WinUSB set up by the user.

Decision-blocking questions: none for the implementation; the PyPI download for real-PyVISA evidence and any command to
a real instrument wait for the user's approval and are reported as blockers.

Proposed behaviors: those under Desired outcome, refined into requirements in specify.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin, BUSY, cleanup |
| no new interface or data format | no | manifest `resources`, `lab/resources.json`, result format |
| no new dependency | no | PyVISA, pyvisa-py |
| an existing requirement already covers the behavior | no | none for leases or cleanup |
| no security or data-handling change | no | physical actuation, approvals |

## Requirement coverage

| Behavior | Requirement | Status |
|---|---|---|
| Declare bench resources in one workbench registry file | REQ-DATA-f2cbfc23 | new |
| Normalize VISA resource names to identity keys | REQ-FUNC-0542cc94 | new |
| Show the reserved resources in the program approval | REQ-UX-73dd7a9b | new |
| Refuse a second holder of a resource in one process | REQ-FUNC-a5770245 | new |
| Share resource leases between VERA processes | REQ-FUNC-e4ca09ad | new |
| Recover leases left by a lost process | REQ-REL-52212fce | new |
| Ask a supervised program to stop before killing it | REQ-FUNC-3bf3d5bc | new |
| Run the authorized cleanup after an interrupted actuation | REQ-REL-3817f2fd | new |
| Report the physical state of a supervised run | REQ-FUNC-d4b72e6b | new |
| Block actuation while the physical state is unknown | REQ-SEC-371cdb26 | new |
| Publish the scpi-instruments plugin package | REQ-DATA-4451f705 | new |
| Classify each scpi operation by its effect | REQ-SEC-f9f009d9 | new |
| Act only on an instrument that matches its declared profile | REQ-SEC-8737759e | new |
| Refuse values beyond the profile and bench limits | REQ-SEC-9524d2c9 | new |
| Read scalar values with units | REQ-FUNC-b1ab08fd | new |
| Capture and decode a waveform with its preamble | REQ-FUNC-712a3679 | new |
| Diagnose transfer and connection failures distinctly | REQ-REL-4f6d4a31 | new |
| Power an output for a bounded hold and switch it off | REQ-FUNC-f682af02 | new |
| Discover only declared and local resources | REQ-FUNC-a8dcf154 | new |
| Write format 1 instrument results in a new run folder | REQ-DATA-b3e2930f | new |
| Run scpi-instruments on Windows x64 and native Ubuntu x64 | REQ-PLAT-fae260c3 | new |
| Prove PyVISA access through a real backend before calling a transport verified | REQ-TEST-2d32cd86 | new |
| Act only on the approved bench registry | REQ-SEC-80fa1675 | new (review round 1) |

## Design

**Approach.** Two halves joined by a small manifest extension. Host (TypeScript): shared `lab-resources.ts` holds the
registry schema and VISA key normalization (REQ-DATA-f2cbfc23, REQ-FUNC-0542cc94); the manifest program field
`resources` (option, kinds, grace, cleanup, cleanupTimeout) marks a program whose calls claim registry aliases; core
`program-tools.ts` reads `lab/resources.json` through the PathGuard, resolves the alias, puts `{alias, kind, resource,
keys}` and the registry hash into the frozen request and approval (REQ-UX-73dd7a9b), and passes a `lease` (claims,
grace, composed cleanup invocation) to the runner. Core `leases.ts` (new) is the one lease registry: per-user folder,
one lease file per key created by temp file + exclusive hard link, stale detection by pid, unknown-state markers
(REQ-FUNC-e4ca09ad, REQ-REL-52212fce). `runner.ts` checks in-process holders and serial ports, then the lease files,
before the log or spawn (REQ-FUNC-a5770245); a supervised Stop writes `<control>/stop`, kills after grace
(REQ-FUNC-3bf3d5bc); after exit it reads the helper's `state.json` and runs the declared cleanup once
(REQ-REL-3817f2fd), reports and records the physical state (REQ-FUNC-d4b72e6b). Desktop main and the CLI compose one
`ResourceLeases` on `leaseRoot()` (REQ-PLAT-fae260c3). Plugin (Python): PEP 723 `scripts/scpi_tool.py` with support
package `scpi_support/` (cli, request, profiles, session, classes, waveform, lifecycle, report, errors, workspace
byte copy); profiles are JSON slots whose effects are fixed in code (REQ-SEC-f9f009d9, REQ-SEC-8737759e).
Rejected: a helper-side lock (cannot see the desktop/CLI split and dies with the process); a generic profile command DSL
with declared effects (a changed profile could relabel an output command as a read); unbounded `output on` (VERA never
leaves an output energized outside a supervised run, so `output` always has `--hold`).

**Interfaces and data.** Registry and keys: spec REQ-DATA-f2cbfc23 sections 1-2. `RunRequest.lease {claims[{kind,
alias, resource, keys, actuates}], graceMs, cleanup {args, timeoutMs}}`; `RunResult.physical/cleanup`; runner option
`leases`; a lease without a `leases` option is DENIED. BUSY params `{resource, handle}` or `{resource, holder}` with
messages in `programError`. Env: `VERA_RUN_CONTROL`, `VERA_RESOURCE_STATE`, `VERA_CLEANUP_OF`, `SCPI_REGISTRY`
(manifest env). Helper CLI, profiles and result: spec REQ-DATA-b3e2930f. Failures: invalid registry/alias -> Error
before approval; lease folder unusable -> DENIED; cleanup timeout -> killed, `unknown`; lease release errors are
swallowed (a later claim treats the lease as stale once this process exits).

**Files and test seams.** shared: `lab-resources.ts` (+test), `plugins.ts` (`resources` field, +plugins.test),
`program-rules.ts` (approval `resources`, `registry`), `index.ts`. core: `plugins/leases.ts` (+leases.test with temp
folders and injected pid probe), `runner.ts` (+runner.test with the fake host), `program-request.ts`,
`program-tools.ts` (+program-tools.test), `index.ts`. apps: desktop `main/index.ts`, `approval-card.tsx` (+test),
locales en/ro/de `approval.resources`; CLI `run.ts`, `approval-prompt.ts` (+test). Plugin
`05_Software/plugins/scpi-instruments/` (plugin.yaml, README, skills `bench-instruments`, `instrument-profiles`,
profiles, scripts); catalog.yaml/packs.yaml. Tests: `tests/integration/scpi-instruments.test.ts` with fixtures
`tests/fixtures/scpi-instruments/` (fake PyVISA package with simulated DP832/DS1104Z/34461A, a state file shared by
processes and a command transcript; a lease-holder Node script for the cross-process case); the opt-in real-PyVISA
test against a local SCPI socket server (`VERA_SCPI_UV`, needs the download approval).

**Risks and open decisions.** Physical safety: every profile is `unverified` (written from programming guides) until a
real instrument run; real-instrument proofs and native Ubuntu stay open (RULING-001). PID reuse can keep a stale lease
BUSY until that pid exits (safe side). Host loss leaves the instrument as it was; the next claim reports `unknown`.
The helper is trusted to report `confirmed` truthfully (reviewed, hash-bound plugin code). Sigrok runs reserve only the
serial ports they name (whole argument, `--x=value` or `conn=` in a driver spec); its TCP/USB connections are not
leased (documented).

**Requirement map.** REQ-DATA-f2cbfc23 shared schema + program-tools read; REQ-FUNC-0542cc94 shared keys;
REQ-UX-73dd7a9b request/approval/card/CLI prompt; REQ-FUNC-a5770245 runner in-process check; REQ-FUNC-e4ca09ad
leases.ts + app composition; REQ-REL-52212fce leases stale path; REQ-FUNC-3bf3d5bc runner stop request;
REQ-REL-3817f2fd runner cleanup run; REQ-FUNC-d4b72e6b runner physical state + markers; REQ-SEC-371cdb26 helper
lifecycle; REQ-DATA-4451f705 package/catalog/packs; REQ-SEC-f9f009d9 rules + helper first argument; REQ-SEC-8737759e
profiles/session identity; REQ-SEC-9524d2c9 request limits; REQ-FUNC-b1ab08fd classes read; REQ-FUNC-712a3679
waveform + decode; REQ-REL-4f6d4a31 session/errors; REQ-FUNC-f682af02 classes output; REQ-FUNC-a8dcf154 cli
discover; REQ-DATA-b3e2930f report/workspace; REQ-PLAT-fae260c3 leaseRoot + Ubuntu run owed; REQ-TEST-2d32cd86
opt-in test + README matrix.

## Log

- 2026-11-13 frame: journal opened
- 2026-11-13 frame: Read-only inventory 2026-11-13 (Get-PnpDevice): no USBTMC/VISA instrument, no vendor VISA, only Bluetooth serial COM3/4/7/8; real-instrument proofs of L01-A/B/E/G are blocked on hardware
- 2026-11-13 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-13 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-13 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-13 build: red: npx vitest run shared/src/lab-resources.test.ts exit 1 - lab-resources module, manifest resources field and approval resources missing (REQ-DATA-f2cbfc23, REQ-FUNC-0542cc94, REQ-UX-73dd7a9b)
- 2026-11-13 build: green: npx vitest run shared lab-resources/plugins/program-approval-schema/program-rules tests exit 0, 102 tests (REQ-DATA-f2cbfc23, REQ-FUNC-0542cc94)
- 2026-11-13 build: red: npx vitest run core/src/plugins/leases.test.ts exit 1 - ResourceLeases module missing (REQ-FUNC-e4ca09ad, REQ-REL-52212fce, REQ-PLAT-fae260c3)
- 2026-11-13 build: green: npx vitest run core/src/plugins/leases.test.ts exit 0, 7 passed 1 Linux-only skipped (REQ-FUNC-e4ca09ad, REQ-REL-52212fce, REQ-PLAT-fae260c3)
- 2026-11-13 build: red: npx vitest run core/src/plugins/runner-leases.test.ts exit 1, 10 failed - no lease option, no stop request, no cleanup run, no physical state, no sigrok conn= ports (REQ-FUNC-a5770245, REQ-FUNC-3bf3d5bc, REQ-REL-3817f2fd, REQ-FUNC-d4b72e6b)
- 2026-11-13 build: green: npx vitest run core runner-leases.test.ts runner.test.ts exit 0, 53 tests (REQ-FUNC-a5770245, REQ-FUNC-e4ca09ad, REQ-FUNC-3bf3d5bc, REQ-REL-3817f2fd, REQ-FUNC-d4b72e6b)
- 2026-11-13 build: red: npx vitest run program-resources.test.ts exit 1, 5 failed - no registry read, no request resources, no lease composition (REQ-DATA-f2cbfc23, REQ-UX-73dd7a9b, REQ-REL-3817f2fd); approval-card.test.ts + approval-prompt.test.ts exit 1 - resources not shown (REQ-UX-73dd7a9b)
- 2026-11-13 build: green: npx vitest run core/src/plugins/ (17 files, 251 passed) + approval-card/approval-prompt (9 passed) exit 0; npm run typecheck exit 0 (REQ-DATA-f2cbfc23, REQ-UX-73dd7a9b, REQ-FUNC-e4ca09ad)
- 2026-11-13 build: DEVIATION build: the scpi helper and its fake PyVISA were written before tests/integration/scpi-instruments.test.ts, so its first run (17 failed: a fixture newline bug, then expectations) is not a clean red for each helper requirement - accepted: every helper requirement has an executed assertion now; costs strict test-first evidence for the helper rows
- 2026-11-13 build: green: npx vitest run tests/integration/scpi-instruments.test.ts exit 0, 22 passed 1 opt-in skipped (REQ-DATA-4451f705, REQ-SEC-f9f009d9, REQ-SEC-8737759e, REQ-SEC-9524d2c9, REQ-FUNC-b1ab08fd, REQ-FUNC-712a3679, REQ-REL-4f6d4a31, REQ-FUNC-f682af02, REQ-FUNC-a8dcf154, REQ-DATA-b3e2930f, REQ-SEC-371cdb26, REQ-FUNC-3bf3d5bc, REQ-REL-3817f2fd, REQ-FUNC-d4b72e6b, REQ-FUNC-e4ca09ad, REQ-REL-52212fce)
- 2026-11-13 build: Pre-existing failure found: tests/packaging/prepare-plugins.test.ts listed 16 official plugins while parts-search, ngspice and ltspice (ELEC-03..05) already made 19; updated the list with those and scpi-instruments - npx vitest run tests/packaging/prepare-plugins.test.ts now exit 0
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: DEVIATION validate: review found that pyvisa-py's list_resources asks every transport (TCPIP broadcasts VXI-11 discovery) before filtering, so --list-local could scan the LAN; corrected in place instead of returning to build - local.py enumerates serial ports (pyserial) and USBTMC devices (pyusb) only, GPIB listing dropped; REQ-FUNC-a8dcf154 prose, spec, README, skill and test updated - the scope intent (no network scan) is unchanged
- 2026-11-13 validate: Manual (REQ-TEST-2d32cd86): with the user's PyPI approval relayed by the coordinator ('Da, PyPI e ok'), VERA_SCPI_UV=uv 0.11.25 and VERA_SCPI_PYTHON_SEED (local uv CPython 3.13.14 copied into the test runtime, so only PyPI was reached): npx vitest run tests/integration/scpi-instruments.test.ts -t 'installs the pinned' exit 0 - VERA's Provisioner installed PyVISA 1.16.2 + pyvisa-py 0.8.1 (+pyserial 3.5, pyusb 1.3.1); output --hold 2 (physical confirmed), identify, read and capture (1200-byte block containing 0x0A read intact) over real pyvisa-py TCPIP SOCKET to local simulated servers. Proves the library path only, no instrument.
- 2026-11-13 validate: review round 1: spec changes_required (README overclaims cross-process serial exclusion; read values lack raw/channel; DMM range checked after opening; cleanup rereads an editable registry; refusals leave no result folder vs requirement; spec drift; opt-in test lacked read/capture (since extended); no supervised-timeout test); quality changes_required (BLOCKING decode trusts raw file and channel names from preamble json - reads/writes outside cwd; registry not pinned to the approved hash for main and cleanup runs; hold drifts past --hold and the rule timeout). Notes taken: unexpected-reply/internal codes, profile validator gaps, maxPoints cap, meter/scope close semantics, program_output physical, plugin description caveat, plan L01-H/L01-B claims, sample/sha assertions. Accepted as notes: stale-lease takeover microsecond race, PID reuse keeps BUSY, leftover control folders after host loss, slow quit, keys do not link DNS/by-id spellings.
- 2026-11-13 validate: returned to build - review round 1 findings: decode path confinement, registry hash pinning, hold deadline, read fields, DMM range pre-check, timeout test, docs/spec drift
- 2026-11-13 build: red: npx vitest run runner-leases.test.ts + scpi-instruments.test.ts exit 1, 5 failed - decode trusts preamble paths, registry not pinned, read values lack raw/channel, DMM range not refused before opening, background read lacks physical (REQ-SEC-9524d2c9, REQ-DATA-b3e2930f, REQ-FUNC-b1ab08fd, REQ-FUNC-d4b72e6b, REQ-DATA-f2cbfc23); the timeout test passed at once (shared Stop path, REQ-FUNC-3bf3d5bc)
- 2026-11-13 build: green: npx vitest run (26 files incl. scpi-instruments with VERA_SCPI_UV real PyVISA, core plugins/, shared lab-resources, approval tests, prepare-plugins, sessions/programs, program-approvals, serial-monitor, sigrok) exit 0, 377 passed 4 skipped; npm run typecheck/lint/check:i18n exit 0 (round 1 fixes: decode confinement, REQ-SEC-80fa1675 registry pin, clock-based hold, read raw/channel, DMM range pre-check, timeout test, program_output physical, unexpected-reply/internal codes, profile validator, maxPoints cap, docs/spec drift)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review round 2: quality approved (notes: maxPoints checked only after the whole block is read; decode accepts raw files up to 64 MiB under a safe rule; stop message counts samples as seconds); spec changes_required (REQ-SEC-80fa1675 verification claims the cleanup run carries VERA_REGISTRY_SHA256 but no test asserts it; notes: oversized block reported as truncated-transfer, skill says confirmed only after readback for every class)
- 2026-11-13 validate: returned to build - round 2: assert VERA_REGISTRY_SHA256 on the cleanup run; fold in the round-2 notes (block size before transfer, decode cap, stop message, skill wording)
- 2026-11-13 build: red: npx vitest run program-resources.test.ts scpi-instruments.test.ts exit 1, 2 failed - oversized announced block not refused before transfer, decode accepts raw files beyond the profile's points (REQ-REL-4f6d4a31, REQ-FUNC-712a3679); the new cleanup VERA_REGISTRY_SHA256 assertion passed at once (REQ-SEC-80fa1675, assertion was missing, behaviour present)
- 2026-11-13 build: green: npx vitest run 26 focused files incl. VERA_SCPI_UV real PyVISA exit 0 (377 passed, 4 skipped); typecheck/lint/check:i18n exit 0 (round 2: cleanup VERA_REGISTRY_SHA256 asserted; announced block over maxPoints refused before transfer as limit; decode capped at the profile's maxPoints x width; stop message in seconds; skill wording)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review round 3: spec approved, quality approved (remaining notes, accepted: decode sizes its cap from the profile width but decodes with the recorded width - memory stays bounded; stale-lease takeover microsecond race; PID reuse keeps BUSY; leftover control folders after host loss; approval card shows arguments and registry hash, not profile limits - limits are enforced by the helper)
- 2026-11-13 validate: final: python .agentic/aegis.py check --task TASK-a5a839c7 --strict --run exit 0, strict ok; ran lint ok, typecheck ok, i18n ok (focused tests run separately per verification policy: 26 files 377 passed incl. VERA_SCPI_UV real PyVISA, after the last code edit); warnings=70 errors=0 - 22 uncovered-source for this diff are test files/fixtures under the layout's source globs, index re-exports, de/ro locales and shared plugins.ts not listed in affected_paths (traceability heuristic, no behaviour untested); the rest pre-exist on older records
- 2026-11-13 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-13 | decision=LAB-01 runs under AEGIS on branch feature/101-embedded-lab; the implementer hands back an uncommitted candidate; downloads (PyPI pyvisa/pyvisa-py) and commands to real instruments need the user's approval, offline fixtures until then | reason=task brief from the coordinator relaying the user's 2026-11-13 instructions | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a5a839c7.md
changed: shared lab-resources + manifest resources + approval payload; core ResourceLeases, resource-registry, runner supervision, program-tools claims; desktop/CLI composition and approval display; plugin scpi-instruments (helper, 3 profiles, 2 skills, README); catalog/packs; tests and fixtures; specs, knowledge, context, architecture §3.5, plan page
evidence: aegis check --task TASK-a5a839c7 --strict --run exit 0 (lint/typecheck/i18n ok); 26 focused test files exit 0, 377 passed incl. opt-in real PyVISA 1.16.2/pyvisa-py 0.8.1; reviews round 3 spec approved, quality approved
issues: Open: L01-A/B/E/G against real instruments (none on this machine; profiles unverified); native Ubuntu x64 run (REQ-PLAT-fae260c3); vendor VISA (ivi) backend; L01-H workbench activation/disable not exercised for this plugin; importing an instrument's own export file not implemented; serial-port exclusion vs instrument leases holds within one VERA process only
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-13)

- stage: validate; type: feature; path: full; branch: feature/101-embedded-lab
- requirements:
  - REQ-DATA-f2cbfc23 - Declare bench resources in one workbench registry file
  - REQ-FUNC-0542cc94 - Normalize VISA resource names to identity keys
  - REQ-UX-73dd7a9b - Show the reserved resources in the program approval
  - REQ-FUNC-a5770245 - Refuse a second holder of a resource in one process
  - REQ-FUNC-e4ca09ad - Share resource leases between VERA processes
  - REQ-REL-52212fce - Recover leases left by a lost process
  - REQ-FUNC-3bf3d5bc - Ask a supervised program to stop before killing it
  - REQ-REL-3817f2fd - Run the authorized cleanup after an interrupted actuation
  - REQ-FUNC-d4b72e6b - Report the physical state of a supervised run
  - REQ-SEC-371cdb26 - Block actuation while the physical state is unknown
  - REQ-DATA-4451f705 - Publish the scpi-instruments plugin package
  - REQ-SEC-f9f009d9 - Classify each scpi operation by its effect
  - REQ-SEC-8737759e - Act only on an instrument that matches its declared profile
  - REQ-SEC-9524d2c9 - Refuse values beyond the profile and bench limits
  - REQ-FUNC-b1ab08fd - Read scalar values with units
  - REQ-FUNC-712a3679 - Capture and decode a waveform with its preamble
  - REQ-REL-4f6d4a31 - Diagnose transfer and connection failures distinctly
  - REQ-FUNC-f682af02 - Power an output for a bounded hold and switch it off
  - REQ-FUNC-a8dcf154 - Discover only declared and local resources
  - REQ-DATA-b3e2930f - Write format 1 instrument results in a new run folder
  - REQ-PLAT-fae260c3 - Run scpi-instruments on Windows x64 and native Ubuntu x64
  - REQ-TEST-2d32cd86 - Prove PyVISA access through a real backend before calling a transport verified
  - REQ-SEC-80fa1675 - Act only on the approved bench registry
- deviations: 2 recorded
  - build: the scpi helper and its fake PyVISA were written before tests/integration/scpi-instruments.test.ts, so its first run (17 failed: a fixture newline bug, then expectations) is not a clean red for each helper requirement - accepted: every helper requirement has an executed assertion now; costs strict test-first evidence for the helper rows
  - validate: review found that pyvisa-py's list_resources asks every transport (TCPIP broadcasts VXI-11 discovery) before filtering, so --list-local could scan the LAN; corrected in place instead of returning to build - local.py enumerates serial ports (pyserial) and USBTMC devices (pyusb) only, GPIB listing dropped; REQ-FUNC-a8dcf154 prose, spec, README, skill and test updated - the scope intent (no network scan) is unchanged
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base d3764ca: 92 file(s) changed, 7224 line(s) added
- checks: errors=0 warnings=70 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
