# TASK-39da0f51 - LAB-05 power-profiler: power, energy and charge profiling tied to firmware (#106)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-dd3e4fe1, REQ-DATA-f13cc264, REQ-SEC-71e25799, REQ-FUNC-72b39f27, REQ-FUNC-cd01d9d7, REQ-FUNC-3f8d4501, REQ-SEC-f040d125, REQ-FUNC-a3c452bc, REQ-REL-a711fe43, REQ-REL-6447ba8f, REQ-FUNC-cd1e687f, REQ-FUNC-4995f945, REQ-REL-d02aa9e4, REQ-FUNC-02cea0ef, REQ-FUNC-b22a6d3f, REQ-SEC-cf1a9ecb, REQ-FUNC-3ca637cb, REQ-FUNC-9d7b62ea, REQ-REL-a2fa28e4, REQ-FUNC-f22a86bb, REQ-FUNC-93ac5faa, REQ-FUNC-cdc1b00a, REQ-FUNC-eda5feb3, REQ-FUNC-068ff296, REQ-PLAT-cd7e4f2c
parent:
branch: feature/101-embedded-lab
base: b3667c2f54a642b7f400330d6ce2b06584a10df0
opened: 2026-11-14

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

Problem: VERA can reserve bench instruments (LAB-01), validate measurements (LAB-02), run HIL plans (LAB-03) and debug
firmware (LAB-04), but it cannot measure a board's current, power and energy, nor tie them to the firmware that ran.
OBSERVED: no plugin under `05_Software/plugins/` talks to a power analyzer; `lab/resources.json` knows the kinds `visa`
and `probe` only (`shared/src/lab-resources.ts`); LAB-02 has no integral metric and no units C or J
(`lab_validation/metrics.py`, `units.py`); the HIL compiler binds a lab-validate source only to an earlier
`scpi.capture` step (`core/src/plugins/hil/compile.ts`, `executor.ts`).

Desired outcome (STATED, ticket LAB-05 #106 "Livrabile și analiză" and coordinator brief):
- Plugin `power-profiler` with helper and skills for identify, configure-acquisition, capture, inspect, measure-energy,
  segment and report; a measurement profile with serial, range, sample rate, connection and the meter's limits.
- Current/voltage acquisition, relevant raw data and a normalized export; range configuration and the load the
  measurement adds (burden) are described; a readback does not prove the measured circuit was not disturbed.
- Metrics: mean/min/max current, energy = integral v(t) i(t) dt, charge = integral i(t) dt, time in states, energy per
  event; sign, offset, missing intervals and auto-ranging handled explicitly; gaps and overflow never become zero.
- Segmentation by digital markers or timestamps with provenance, or by measured firmware events; never precise
  synchronisation from the PC-side arrival time of a UART log.
- A/B comparison with an equivalent setup, identified firmware A and B and repeated intervals; captures and criteria
  evaluated with LAB-02 without a second numeric engine (energy/charge integrals LAB-02 lacks may be added there).
- Battery-life estimate from the usage profile, available capacity/energy, voltage conversion, efficiency and
  quiescent consumption when known; reports assumptions and an interval; never mixes charge and energy or mAh at
  different voltages; refuses precision the data does not support.
- Optional HIL integration: start/stop capture (and markers) as steps, with the meter and the powered board leased;
  functions that would power or physically reconfigure the DUT are separate and authorized, never called captures.
- Provisioning checks native packages and USB access; never changes drivers or udev; buys or books nothing.
- Backend Joulescope JS220 through the official `pyjoulescope_driver` (PyPI), version pinned (STATED brief).
- Done criteria L05-A...L05-H (STATED, ticket).

Actors: the user (owns the bench, meter, DUT and battery data, declares the meter in `lab/resources.json`, approves
live operations, wires DUT GPIOs to the meter's inputs), the agent (plans acquisitions, asks for captures, analyses),
VERA core (rules, approvals, leases, runner, Stop, HIL executor), the helper and `pyjoulescope_driver`, the JS220, the
DUT running a firmware build.

Primary scenario (INFERRED from the ticket): a sensor node sleeps and wakes every second. The user wires a firmware
GPIO to the JS220 GPI0 and declares the meter as `js1`. The agent runs `power-profile capture --meter js1 --duration
20 --rate 100000 --markers 0 --firmware build/app.elf --condition supply=3.3V`; VERA shows the approval (device-write:
range and rate are configured), reserves the meter, the helper opens the JS220 without applying defaults, refuses when
its current path is off, applies the acquisition, streams current/voltage/power/GPI0 on the meter's sample clock,
records gaps from sample-id skips, restores the previous settings, reads them back and writes
`embedded-lab-results/<run-id>/`. Then `power-analyze segment --capture <run> --markers 0 --event high` gives per-wake
energy and sleep/active times with the sync method `meter GPI0`, and `power-analyze battery` estimates the life from
those numbers and a declared battery.

Examples: a fixture capture with a 0.5 ms gap yields energy `null` with `coveredEnergy` and the gap time, status
incomplete - never the integral with the gap as zero; a timestamp file whose clock is `host-receive` is refused for
segmentation; a battery given only in mAh feeding a 3.3 V rail through a buck converter with unknown efficiency is
refused, not estimated; A/B runs with different supply voltages are classified `setup-difference`, not a firmware gain.
Counterexamples: a capture without `--meter`, or with an alias whose entry is not a power monitor, never opens "the
first Joulescope"; a JS220 whose current path is off is not switched on by a capture.

In scope: plugin `power-profiler` (manifest, live helper on `pyjoulescope_driver`, offline stdlib analyzer, profile
`joulescope-js220`, skills, README); `lab/resources.json` kind for the meter (shared `lab-resources.ts`); LAB-02 units
C/J, an `integral` metric and a `power-capture` importer; HIL adapters `power.identify`/`power.capture` and binding a
lab-validate source to any capture-producing step; scpi registry coexistence; catalog/pack; docs in `00_Planning/` and
knowledge; focused tests with offline numeric fixtures, a fake driver and an opt-in real-driver test.
Out of scope (STATED, ticket): PPK2, Otii and other models ("extensii ulterioare"); buying or booking equipment;
changing drivers or udev. INFERRED out of scope: a DUT power-path control operation (the ticket says such functions are
separate and authorized; none is needed by L05-A...H, so the first delivery has none and the capture never changes the
current path); JS220 general-purpose outputs as host-driven markers (would actuate an output; DUT-driven GPI markers
cover L05-C); JLS file recording (pyjls is a separate package; CSV is the shared export rule).

Constraints: STATED (epic plan §2-5, coordinator brief): no MCP, no generic shell; formats stay version 1, no
migrations; reuse the LAB-01 lease registry and lifecycle, never a second registry; the LAB-02 engine, never a second
verdict engine; LAB-03 adapters, never a second executor; copy, never import across installed plugin folders; results
in `embedded-lab-results/<run-id>/`, never `.vera/`; Windows x64 and native Ubuntu x64; no driver/WinUSB/udev changes,
no vendor installers, no non-PyPI tool, no configuration or output command to a real instrument without asking; mocks
never tick criteria; implementer hands back uncommitted in `_lab`. OBSERVED: the runner runs a cleanup only for claims
of device-write/irreversible requests (spec REQ-DATA-f2cbfc23 §6) and gives it `VERA_CLEANUP_OF`, not the interrupted
run's control folder; LAB-02 `mean` divides by the time with data (`metrics.py`), its `missingData: exclude` would turn
an integral over a gap into a zero contribution; the vendor's own `jsdrv measure` returns energy 0.0 when interrupted
(`pyjoulescope_driver/entry_points/measure.py` 2.5.5) - the behaviour L05-B forbids.

Success signals: L05-A...L05-H as written in the ticket, each stated with real, offline-only or blocked evidence.

Evidence: OBSERVED ticket `F:\ProjectsDDP\VERA_Embedded_Lab_Plugins_Tickets\LAB-05.md`, `00-Umbrella.md`,
`00_Planning/plan/embedded-lab-plugins.md` (LAB-01...04 as built), LAB-01...04 hand-over notes, specs REQ-DATA-f2cbfc23,
REQ-DATA-53797d16, REQ-DATA-5f714098, REQ-DATA-d7da2a71; code `shared/src/lab-resources.ts`,
`core/src/plugins/{resource-registry,runner}.ts`, `core/src/plugins/hil/{adapters,compile,executor}.ts`,
`plugins/lab-validation/scripts/lab_validation/{series,metrics,importers}.py`, manifests of gdb-debug, scpi-instruments,
lab-validation. OBSERVED 2026-11-14: PyPI `pyjoulescope_driver` 2.5.5 (uploaded 2026-10-27; 2.5.6 is 5 days old),
requires Python ~=3.12, numpy>=2.1,<3, psutil, requests, pywin32 on Windows; installed in a scratch uv venv (CPython
3.12): `Driver()` opens in 0.03 s, `device_paths()` == [], `find_one_device()` raises DeviceFilterError "No device found";
device paths are `u/js220/<serial>`; data topics `s/i/!data`, `s/v/!data`, `s/p/!data`, `s/i/range/!data`,
`s/gpi/{0..3,7}/!data` deliver `{data, sample_id, sample_rate, decimate_factor, utc}`; the C driver logs sample-id
skips; `open(path, mode)` takes `defaults` or `restore`; the JS220 range mode `off` opens the current path; it links
WINUSB.DLL on Windows. Machine: no Joulescope attached (Get-PnpDevice per the LAB-01 inventory; COM3/4/7/8 Bluetooth).

Assumptions: INFERRED - the JS220 keeps its settings after the host closes it, so the capture restores what it
changed; the meter's GPI inputs are sampled on the same clock as current (the driver delivers them with sample ids
of the same counter), which makes them a precise marker source.

Unknowns: the JS220's real behaviour (no meter here): readback values and spellings of `s/i/range/mode`/`select` and
`h/fs`, whether NaN samples appear in the current stream, what the device does with the current path on USB loss;
native Ubuntu (udev access); a real reference load and a real sleep/wake firmware (L05-A, L05-C live).

Decision-blocking questions: none. The coordinator's brief makes the session autonomous with recorded defaults; the
missing meter is the blocker of L05-A/C/H live proofs, raised in the hand-over, not a scope question.

Proposed behaviors (accepted by ruling under the autonomous brief):
- P1 two programs: `power-profile` (live: `tools`, `identify`, `capture`, cleanup `release`; PEP 723 with
  `pyjoulescope_driver==2.5.5`) and `power-analyze` (offline, standard library: `acquisition`, `import`, `inspect`,
  `measure-energy`, `segment`, `compare`, `battery`, `report`), so analysis works without the driver.
- P2 registry kind `power-monitor` `{alias, resource: "u/js220/<serial>", profile}` keyed `power-monitor:js220:<serial>`.
- P3 the capture opens the meter with `restore`, refuses a current path that is off, applies rate/range/signals,
  restores and reads back; risk device-write (range and rate change the burden); cleanup `release` returns the meter
  to auto-ranging, reads it back, reports `confirmed` or `unknown`.
- P4 the analyzer reuses LAB-02's `series.py` and LAB-04's `elf.py` as byte-identical copies; energy/charge over a
  window with a gap is `null` with covered values; overflow makes the value incomplete.
- P5 LAB-02 gets units C/J, metric `integral` (unknown over a gap) and importer `power-capture`; `power-analyze compare`
  classifies setup vs firmware differences and writes a LAB-02 request whose source conditions carry the setup, so
  LAB-02 decides the criteria.
- P6 HIL adapters `power.identify` and `power.capture` (background), and the capture-step binding generalized.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin and operations |
| no new interface or data format | no | registry kind, capture/result formats, LAB-02 metric/importer, HIL adapters |
| no new dependency | no | `pyjoulescope_driver` from PyPI |
| an existing requirement already covers the behavior | no | no power-measurement requirement exists |
| no security or data-handling change | no | new device control through USB |

## Requirement coverage

| Behavior | Requirement | Criterion |
|---|---|---|
| operations, profile, capture folder, results (spec) | REQ-DATA-dd3e4fe1 | L05-A...H |
| registry kind power-monitor | REQ-DATA-f13cc264 | L05-F |
| meter reserved; wrong alias refused before I/O | REQ-SEC-71e25799 | L05-F |
| identify the meter | REQ-FUNC-72b39f27 | ticket "profil de măsurare" |
| driver and USB prerequisites, no driver change | REQ-FUNC-cd01d9d7 | ticket "provisioning", L05-H |
| configure-acquisition checked offline | REQ-FUNC-3f8d4501 | ticket "configure-acquisition" |
| current path never switched | REQ-SEC-f040d125 | ticket "funcții care alimentează DUT separate" |
| capture on the meter clock | REQ-FUNC-a3c452bc | L05-A, L05-C |
| gaps and overflow recorded, never zero | REQ-REL-a711fe43 | L05-B |
| explicit end state, no active capture | REQ-REL-6447ba8f | L05-F |
| firmware build identity | REQ-FUNC-cd1e687f | L05-C, L05-D |
| mean/min/max, energy, charge | REQ-FUNC-4995f945 | L05-A, L05-B |
| energy/charge withheld over gaps/overflow | REQ-REL-d02aa9e4 | L05-B |
| sign, offset, auto-ranging | REQ-FUNC-02cea0ef | ticket "semn, offset, auto-ranging" |
| events, states, sync method | REQ-FUNC-b22a6d3f | L05-C |
| non-meter timestamps refused | REQ-SEC-cf1a9ecb | ticket "fără sincronizare din UART" |
| A/B with build identity and setup classification | REQ-FUNC-3ca637cb | L05-D |
| battery interval and assumptions | REQ-FUNC-9d7b62ea | L05-E |
| battery refusals | REQ-REL-a2fa28e4 | L05-E |
| import of an export file (non-uniform) | REQ-FUNC-f22a86bb | L05-B |
| report | REQ-FUNC-93ac5faa | ticket "report" |
| lab-validate integral, C/J | REQ-FUNC-cdc1b00a | L05-B, L05-G |
| lab-validate power-capture importer | REQ-FUNC-eda5feb3 | L05-G |
| HIL steps power.identify/power.capture | REQ-FUNC-068ff296 | L05-G, ticket "integrare HIL" |
| Windows x64 and native Ubuntu x64 | REQ-PLAT-cd7e4f2c | L05-H |

## Design

**Approach.** A plugin package with two helpers sharing `scripts/power_support/` (RULING-001): `power_profile.py`
(live, PEP 723 `pyjoulescope_driver==2.5.5`, Python >= 3.12) and `power_analyze.py` (offline, standard library). The
live helper is the only process the runner starts; it imports the driver inside the operation, opens the meter
`restore`, applies only the allowed topics, streams into compact `array` buffers, restores and reads back, then
writes the capture folder (REQ-SEC-f040d125, REQ-FUNC-a3c452bc, REQ-REL-6447ba8f). Leases, BUSY, stop/grace and the
cleanup run are LAB-01 runner code reused through the manifest's `resources {option: --meter, kinds:
[power-monitor], cleanup: [release]}`; the only platform change is the registry kind `power-monitor`
(REQ-DATA-f13cc264, REQ-SEC-71e25799). Numbers come from one engine: `power_support/series.py` is a byte-identical
copy of LAB-02's, and verdicts stay in LAB-02 (new `integral` metric and `power-capture` importer there,
REQ-FUNC-cdc1b00a, REQ-FUNC-eda5feb3); power-analyze only measures and classifies. HIL gets two adapters and a
`captures` flag replacing the hard-coded `scpi.capture` check (REQ-FUNC-068ff296). Rejected: one program for both
(offline analysis would need the driver installed); JLS files (extra package pyjls, not CSV); a second verdict engine
for A/B (the generated LAB-02 request carries the setup as source conditions instead, so differing setups become
incomplete criteria, REQ-FUNC-3ca637cb); host-driven GPO markers (actuate an output).

**Interfaces and data.** CLI, profile, capture folder, results and exit codes in spec REQ-DATA-dd3e4fe1. Modules:
`errors.py` (Refused/Blocked with codes), `registry.py`, `profiles.py`, `acquisition.py` (shared by capture and the
offline check), `firmware.py` + `elf.py` copy (REQ-FUNC-cd1e687f), `lifecycle.py` (VERA_RUN_CONTROL), `usb.py`
(read-only prerequisite checks, REQ-FUNC-cd01d9d7), `meter.py` (driver wrapper: open restore, metadata names,
allowed-topic publish, readback, restore), `capture.py` (stream assembly: sample-id gaps, NaN, packed GPI, overflow,
REQ-REL-a711fe43), `capfile.py` (write/read capture folders with hashes), `importer.py` (CSV import,
REQ-FUNC-f22a86bb), `measure.py` (REQ-FUNC-4995f945, REQ-REL-d02aa9e4, REQ-FUNC-02cea0ef), `segment.py`
(REQ-FUNC-b22a6d3f, REQ-SEC-cf1a9ecb), `compare.py`, `battery.py` (REQ-FUNC-9d7b62ea, REQ-REL-a2fa28e4), `report.py`
(REQ-FUNC-93ac5faa), `cli_profile.py`, `cli_analyze.py`, `workspace.py` copy. Errors: refusal before any device or
folder -> exit 2 without folder; blocked live runs write their result (exit 2); afterwards status incomplete (3) or
error (4). Physical state `pending` from the first publish until the readback.

**Files and test seams.** shared `lab-resources.ts` (+`lab-resources.test.ts`); core `hil/adapters.ts`,
`compile.ts`, `executor.ts` (+`hil.test.ts`); lab-validation `metrics.py`, `units.py`, `importers.py` (tests in
`tests/integration/power-profiler.test.ts` next to the power fixtures); scpi `registry.py` (OTHER_KINDS); plugin
`05_Software/plugins/power-profiler/` (plugin.yaml, profile, scripts, skills `power-measurement` and
`energy-analysis`, README); catalog/packs; `tests/integration/power-profiler.test.ts` runs both helpers on the test
Python against `tests/fixtures/power-profiler/fake-driver/pyjoulescope_driver` (scripted JS220: devices, settings,
metadata, streamed waveforms with skips/NaN/overflow/removal, publish log) and closed-form CSV fixtures (uniform,
non-uniform, gap, overflow, sleep/wake, A/B, battery examples), plus one run through VERA's real runner with Stop;
opt-in `VERA_POWER_REAL_DRIVER` = a Python with the real pyjoulescope_driver 2.5.5 (tools --list, identify ->
device-missing); packaging plugin count.

**Risks and open decisions.** No JS220 here: the fake driver proves the helper's handling, not the device's real
option spellings, NaN behaviour or USB-loss state (spec values from the 2.5.5 binary's topic list; profile stays
`unverified`; L05-A/C/H live open). Restoring settings after a capture can briefly change the burden again. A
decimated `v x i` differs from the meter's full-rate power; the result names the energy source. Cleanup `release`
cannot know the pre-capture settings (the runner gives no access to the interrupted run's control folder), so it
returns the meter to auto-ranging, the device default.

**Requirement map.** REQ-DATA-dd3e4fe1 spec + all modules; REQ-DATA-f13cc264 lab-resources.ts + scpi OTHER_KINDS +
registry.py; REQ-SEC-71e25799 manifest resources + registry.py; REQ-FUNC-72b39f27 cli_profile identify + meter;
REQ-FUNC-cd01d9d7 usb.py + tools; REQ-FUNC-3f8d4501 acquisition.py; REQ-SEC-f040d125 meter.py allow-list;
REQ-FUNC-a3c452bc capture.py + capfile.py; REQ-REL-a711fe43 capture.py; REQ-REL-6447ba8f capture/meter/lifecycle +
release; REQ-FUNC-cd1e687f firmware.py; REQ-FUNC-4995f945, REQ-REL-d02aa9e4, REQ-FUNC-02cea0ef measure.py;
REQ-FUNC-b22a6d3f, REQ-SEC-cf1a9ecb segment.py; REQ-FUNC-3ca637cb compare.py; REQ-FUNC-9d7b62ea, REQ-REL-a2fa28e4
battery.py; REQ-FUNC-f22a86bb importer.py; REQ-FUNC-93ac5faa report.py; REQ-FUNC-cdc1b00a lab-validation
metrics/units; REQ-FUNC-eda5feb3 lab-validation importers; REQ-FUNC-068ff296 hil adapters/compile/executor;
REQ-PLAT-cd7e4f2c no platform-specific code beyond usb.py.

Diagrams: [diagram_TASK-39da0f51.md](diagram_TASK-39da0f51.md)


## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: npx vitest run src/libraries/shared/src/lab-resources.test.ts exit 1 - registry refuses kind power-monitor and has no meter key (REQ-DATA-f13cc264)
- 2026-11-14 build: red: npx vitest run src/libraries/core/src/plugins/hil/hil.test.ts -t 'power-profiler steps' exit 1 - unknown step kinds power.identify/power.capture, lab-validate source binding hard-coded to scpi.capture (REQ-FUNC-068ff296)
- 2026-11-14 build: green: npx vitest run src/libraries/core/src/plugins/hil/hil.test.ts exit 0, 21 passed (REQ-FUNC-068ff296; adapter flag captures replaces the scpi.capture special case)
- 2026-11-14 build: green: npx vitest run src/libraries/shared/src/lab-resources.test.ts exit 0, 15 passed (REQ-DATA-f13cc264); scpi registry OTHER_KINDS += power-monitor
- 2026-11-14 build: DEVIATION build: the power_support modules, the lab-validation integral metric and power-capture importer and the fake driver were written before tests/integration/power-profiler.test.ts - the observed red covered only the registry kind (lab-resources.test.ts) and the HIL adapters (hil.test.ts); the first integration run had 7 failures, all but one test-side (absolute fake sample indices vs the capture's first common sample, metadata-mapped values, float rate, a request without criteria) plus one code fix (a clean window is no longer incomplete because the capture has a gap elsewhere). Cost: most helper requirements have no observed red line
- 2026-11-14 build: green: npm run typecheck exit 0 (rebuilds dist); npx vitest run tests/integration/power-profiler.test.ts exit 0, 35 passed 2 skipped (all LAB-05 helper requirements against the fake driver and closed-form fixtures, VERA runner Stop/BUSY, lab-validate import/integral); VERA_POWER_REAL_PYTHON=<scratch uv venv, pyjoulescope_driver 2.5.5 from PyPI, CPython 3.12> exit 0, 2 passed: tools --list version 2.5.5, devices [], WinUSB present; identify/capture blocked device-missing, physical unchanged
- 2026-11-14 build: green: npx vitest run tests/packaging/prepare-plugins.test.ts src/libraries/shared/src/lab-resources.test.ts tests/integration/scpi-instruments.test.ts tests/integration/lab-validation.test.ts exit 0, 73 passed 2 skipped; npm run lint exit 0; npm run check:i18n exit 0; ruff F/E9/B/PLE (B905 ignored as in lab-validation) clean
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 1: spec changes_required (A/B setup taken from requested acquisition, not readback - two captures differing only in voltage range classify firmware-change; inspect and the unknown-field profile refusal untested; L05-F timeout/stall untested but claimed; spec drift: s/v/range/mode not listed, s/stats/ctrl listed, stalled/deadline status, cleaning phase, run-id format, identify model mismatch, release with path off, import time zero; several verification texts overstate tests); quality changes_required (BLOCKER: without option metadata a raw mode 0 is not seen as off - capture switches the current path on and restore publishes 0, physical confirmed; capture stops when current is complete while other channels may lag, power-only holes unflagged; non-Problem exceptions leave no result.json; segment O(events x samples); one failed signal-off skips the restore; lab-validate 64 MiB vs 128 MiB capture limit; compare joins an unconfined capture path; fixed 2 s stall at 1-2 Hz; hidden marker edge drops an event uncounted; HIL markers duplicates; report folder left on refusal)
- 2026-11-14 validate: returned to build - review round 1 findings (spec and quality)
- 2026-11-14 build: round-1 fixes: the current path is on only for a named auto/manual readback - an unnamed raw value is blocked (current-path-unknown) in capture and release, mode writes by name only; the capture drains until every signal holds the target, flags m for power-only holes and reports per-channel missing counts (channel-missing -> incomplete); unexpected exceptions become code internal with result.json and the meter restored; restore writes each topic on its own; phase cleaning; stall limit max(2 s, 10/rate); segment lookups by bisect/prefix sums; a hidden marker edge counts the open event partial; lab-validate power-capture CSV limit 128 MiB; compare confines the capture path; HIL markers unique; report reads every capture before its folder; A/B setup from settings.applied. Tests added (unnamed mode, power-only NaN, malformed message, stall, runner timeout, voltage-range readback setup-difference, event over a gap, inspect, unknown-field profile, mean power, time per range, report of measure+segment); spec sections 2,5,6,7,9 and 9 requirement texts/verifications aligned
- 2026-11-14 build: green: npx vitest run tests/integration/power-profiler.test.ts src/libraries/core/src/plugins/hil/hil.test.ts src/libraries/shared/src/lab-resources.test.ts tests/integration/lab-validation.test.ts tests/integration/scpi-instruments.test.ts tests/packaging/prepare-plugins.test.ts exit 0, 137 passed 4 skipped; VERA_POWER_REAL_PYTHON exit 0 (2 passed); npm run typecheck exit 0; npm run lint exit 0; ruff clean
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 2: spec approved, quality approved. DEVIATION validate: the reviewers' remaining minors were settled after the approvals without a third round - spec section 5 now lists s/v/range/mode among the queried topics and REQ-REL-6447ba8f's verification names the stall, malformed-message and runner-timeout tests (text only); the quality minors (report keeps every parsed capture in memory, ~0.1 GB per 1e6 rows; an event whose begin edge is hidden by a missing marker is dropped without a partial count) are documented in spec section 7 as known limits instead of changed - cost: those two behaviours remain
- 2026-11-14 validate: manual: REQ-PLAT-cd7e4f2c and the live criteria L05-A (reference load), L05-C live (sleep/wake board) and L05-H live (Windows and native Ubuntu x64 with a JS220) not run - no Joulescope is attached (LAB-01 inventory, Get-PnpDevice); the real pyjoulescope_driver 2.5.5 from PyPI ran in a scratch uv venv on Windows (import, enumeration, no device, identify/capture blocked device-missing); provisioning through VERA's own uv was not run; profile joulescope-js220 stays unverified
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-39da0f51 --strict --run exit 0; ran lint, typecheck, i18n (all ok); strict ok; 60 warnings: journal-header/stale-paths/ticket-ref/no-linked-tests of other tasks (pre-existing), uncovered-source for the two changed test files and the power-profiler fixtures (test inputs exercised by power-profiler.test.ts, not product source) - informational, accepted. Focused vitest proof from build round 2 stands (6 files, 137 passed, 4 skipped; real-driver opt-in 2 passed); only spec/requirement text changed since
- 2026-11-14 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-14 | decision=Split power-profiler into power-profile (live JS220 through pyjoulescope_driver==2.5.5: tools, identify, capture, cleanup release) and power-analyze (offline standard library: acquisition, import, inspect, measure-energy, segment, compare, battery, report). Registry kind power-monitor {alias, resource u/js220/<serial>, profile}. A capture opens the meter with restore, never switches the current path, applies rate/range/signals, restores and reads back (device-write); release returns the meter to auto-ranging. LAB-02 gains units C/J, metric integral (unknown over a gap) and importer power-capture, and judges A/B criteria; HIL gains power.identify/power.capture. Shared numeric and ELF code are byte-identical copies of LAB-02 series.py and LAB-04 elf.py. | reason=Ticket L05 deliverables and the brief (reuse LAB-01..04, no second engine/registry/executor, pinned PyPI driver 2.5.5 older than two weeks); decided under the coordinator's autonomous brief. | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-39da0f51.md
changed: power-profiler plugin; lab-resources kind power-monitor; lab-validation integral, power-capture, C/J; HIL power.identify/power.capture + captures flag; scpi OTHER_KINDS; catalog/pack; fixtures and tests; spec, requirements, knowledge, context, architecture 3.9, plan as-built
evidence: aegis check --task TASK-39da0f51 --strict --run exit 0 (lint, typecheck, i18n ok); focused vitest 6 files exit 0 (137 passed); real pyjoulescope_driver 2.5.5 opt-in exit 0 (2 passed)
issues: no JS220: L05-A, L05-C live, L05-H live (Windows + native Ubuntu) open; profile unverified; VERA-uv provisioning not run; known limits: hidden begin edge uncounted, report memory
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/101-embedded-lab
- requirements:
  - REQ-DATA-dd3e4fe1 - Define the power-profiler operations, profile, capture and result formats
  - REQ-DATA-f13cc264 - Declare a power monitor in the bench registry by its device path
  - REQ-SEC-71e25799 - Reserve the power monitor for live power-profiler runs
  - REQ-FUNC-72b39f27 - Identify the declared power monitor
  - REQ-FUNC-cd01d9d7 - Report the power driver and the USB access prerequisites
  - REQ-FUNC-3f8d4501 - Check an acquisition plan offline against the meter profile
  - REQ-SEC-f040d125 - Never switch the DUT current path in a capture
  - REQ-FUNC-a3c452bc - Capture current, voltage, power, range and markers on the meter clock
  - REQ-REL-a711fe43 - Record missing samples and overflow explicitly in a capture
  - REQ-REL-6447ba8f - Leave no active capture and an explicit physical state on every end
  - REQ-FUNC-cd1e687f - Identify the firmware build of a capture
  - REQ-FUNC-4995f945 - Measure current, power, energy and charge over a window
  - REQ-REL-d02aa9e4 - Withhold energy and charge over gaps and overflow
  - REQ-FUNC-02cea0ef - Apply declared sign and offset and report auto-ranging
  - REQ-FUNC-b22a6d3f - Segment a capture into events and states with the sync method
  - REQ-SEC-cf1a9ecb - Refuse timestamps that are not on the meter clock
  - REQ-FUNC-3ca637cb - Compare two firmware builds on an equivalent setup
  - REQ-FUNC-9d7b62ea - Estimate battery life as an interval with its assumptions
  - REQ-REL-a2fa28e4 - Refuse battery estimates the data cannot support
  - REQ-FUNC-f22a86bb - Import a power export file as a normalized capture
  - REQ-FUNC-93ac5faa - Report power runs in Markdown and HTML
  - REQ-FUNC-cdc1b00a - Integrate a signal in lab-validate
  - REQ-FUNC-eda5feb3 - Import power-profiler captures into lab-validate
  - REQ-FUNC-068ff296 - Run power captures as HIL steps
  - REQ-PLAT-cd7e4f2c - Run power-profiler on Windows x64 and native Ubuntu x64
- deviations: 2 recorded
  - build: the power_support modules, the lab-validation integral metric and power-capture importer and the fake driver were written before tests/integration/power-profiler.test.ts - the observed red covered only the registry kind (lab-resources.test.ts) and the HIL adapters (hil.test.ts); the first integration run had 7 failures, all but one test-side (absolute fake sample indices vs the capture's first common sample, metadata-mapped values, float rate, a request without criteria) plus one code fix (a clean window is no longer incomplete because the capture has a gap elsewhere). Cost: most helper requirements have no observed red line
  - validate: the reviewers' remaining minors were settled after the approvals without a third round - spec section 5 now lists s/v/range/mode among the queried topics and REQ-REL-6447ba8f's verification names the stall, malformed-message and runner-timeout tests (text only); the quality minors (report keeps every parsed capture in memory, ~0.1 GB per 1e6 rows; an event whose begin edge is hidden by a missing marker is dropped without a partial count) are documented in spec section 7 as known limits instead of changed - cost: those two behaviours remain
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base b3667c2: 88 file(s) changed, 15772 line(s) added
- checks: errors=0 warnings=60 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
