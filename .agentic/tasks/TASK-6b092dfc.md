# TASK-6b092dfc - LAB-04 gdb-debug: supervised GDB debugging and symbol-aware fault diagnosis (#105)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-d7da2a71, REQ-FUNC-0c6807c8, REQ-SEC-e1493c9b, REQ-DATA-ea470ec1, REQ-SEC-ad412ce8, REQ-SEC-b50cb2e8, REQ-SEC-a7bab79f, REQ-SEC-593220cf, REQ-FUNC-74347f3b, REQ-REL-afd24ad4, REQ-FUNC-9ab9965c, REQ-SEC-7e237fa9, REQ-FUNC-e539c51f, REQ-FUNC-bf57be4d, REQ-SEC-00f3d2b9, REQ-REL-d5f06a9b, REQ-SEC-7f9bd395, REQ-FUNC-36c45a10, REQ-FUNC-ccbd4442, REQ-PLAT-8c2cdfb0
parent:
branch: feature/101-embedded-lab
base: 8c374f49eebd3f25246971e52432b4167323b58f
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

Problem: VERA can flash and reset a Cortex-M board (probe-rs, stm32-cubeprog), reserve bench resources (LAB-01) and run
HIL plans (LAB-03), but it cannot look inside a running or crashed target with symbols. OBSERVED: the probe-rs plugin
blocks `gdb`, `debug`, `serve` and `dap-server` (`plugins/probe-rs/plugin.yaml`); the runner spawns without a shell
and with stdin closed (`core/src/plugins/runner.ts`), so a GDB console cannot be offered by a manifest rule; no plugin
under `05_Software/plugins/` parses an ELF's debug information or decodes a Cortex-M fault; `lab/resources.json`
knows only the identity kind `visa` (`shared/src/lab-resources.ts`).

Desired outcome (STATED, ticket LAB-04 #105 "Livrabile și capabilități"):
- Detect GDB/OpenOCD versions and architecture support, a connection profile, the probe serial and the target identity;
  never attach to the first probe found, never assume the host GDB understands the MCU.
- Finite operations: offline ELF inspection, attach, halt, snapshot, core registers, backtrace, permitted variables and
  RAM, breakpoint, step/continue and detach, each with explicit state and risk; peripheral memory/registers with read
  side effects are not read by default.
- GDB/MI is an internal protocol of a finite helper; the public runner's closed stdin stays; GDB's pipes never become
  arbitrary agent input (batch-style snapshot with the same validation is allowed).
- The debug server is local, bound to the session and reserved resource, with an identified port/handle; unneeded
  services off; never exposed to the LAN; the GDB protocol is not assumed authenticated.
- Bounded duration/inactivity; cleanup on detach, Stop, timeout, app/workbench close and unplug; the halt/resume policy
  at exit is chosen from the setup and recorded; firmware that actuates is never resumed without that authorization.
- GDB script auto-load, `.gdbinit`, Python, shell, raw `monitor`, function calls and assignments in expressions are
  disabled/refused; OpenOCD configurations are verified profiles, never project Tcl.
- A snapshot correlates PC/SP, registers and stack with the effective ELF and firmware hash; missing source,
  optimisation and unavailable variables are reported; RTOS awareness only for a demonstrated RTOS/profile.
- Breakpoints and execution control have their own classification, not hidden under read; arbitrary memory writes,
  flash, option bytes and MMIO writes are excluded.
- Done criteria L04-A...L04-H (STATED, ticket).

Actors: the user (owns the bench, board and probe, declares the probe in `lab/resources.json`, approves live
operations), the agent (inspects ELFs, asks for snapshots/breakpoints, reads diagnoses), VERA core (rules, approvals,
leases, runner, Stop), the helper and the external GDB and OpenOCD it supervises, the target MCU.

Primary scenario (INFERRED from the ticket): firmware on a NUCLEO board hard-faults. The agent runs
`gdb-elf inspect build/app.elf` (offline: ARM Cortex-M, SHA-256, DWARF present, optimisation flags), then asks
`gdb-debug snapshot --probe stlink1 --elf build/app.elf --firmware-effect none --on-exit halted`; VERA shows the
approval (device-write: the core is halted), reserves the probe, the helper starts OpenOCD on 127.0.0.1 with the
profile's scripts and the probe's serial, starts GDB in MI mode without init files or auto-load, checks the ELF
against the target's flash, reads core and fault registers, the backtrace and the stacked exception frame, decodes
CFSR/HFSR into named causes mapped to symbols, leaves the core halted as requested, stops both processes, releases the
probe and writes `embedded-lab-results/<run-id>/result.json`.

Examples: an ELF built for RISC-V given to an ARM profile is refused before any process starts; a snapshot whose ELF
does not match the target's flash reports the raw PC/LR and `elf-mismatch` and no symbol-based diagnosis (L04-B);
`--read 'counter = 0'` or `--read 'reset()'` is refused before GDB starts (L04-D); an MI result arriving after its
command timed out is logged as stale, never matched to the next command (L04-E).
Counterexamples: `gdb-debug snapshot` without `--probe`, or with an alias whose registry entry has no serial, never
attaches to "the first probe"; a `--read` of a peripheral address (0x40000000...) is refused, not read; `probe-rs gdb`
stays blocked.

In scope: plugin `gdb-debug` (manifest, helper scripts, skill, README, profiles), the `probe` identity kind of
`lab/resources.json` with keys shared with probe-rs `--probe` selectors and HIL plans, an offline ELF/DWARF reader, a
GDB/MI parser and session, OpenOCD supervision, fault decoding, result format, catalog/pack entries, docs in
`00_Planning/`, focused tests with committed fixture ELFs and MI transcripts.
Out of scope (STATED, ticket and epic §4): raw GDB/monitor console, memory/flash/option-byte/MMIO writes, Python/Tcl
evaluation, a generic unblocking of probe-rs `gdb`/`debug`/`serve`/`dap-server`; RTOS task awareness without a
demonstrated RTOS (ticket). INFERRED out of scope: a HIL adapter for GDB steps (not in L04 criteria; LAB-03 notes
say later plans add adapters), J-Link/pyOCD backends (the ticket names OpenOCD as first backend).

Constraints: STATED (epic plan §2-5, coordinator brief): no MCP, no generic shell; formats stay at version 1, no
migrations; reuse LAB-01 leases/lifecycle and registry, never a second registry; results in
`embedded-lab-results/<run-id>/`, never `.vera/`; Windows x64 and native Ubuntu x64; no driver installs; a mock never
ticks a hardware criterion; non-PyPI downloads (GDB, OpenOCD, toolchains) need the user's approval; never flash or halt
a real board without approval; implementer hands back without a commit. OBSERVED: rule risk is the highest of all
matching rules (`plugins/ngspice/plugin.yaml` comment, `classifyCommand`); a program's `uses` siblings must all
resolve or the program does not run (`provisioning.ts` `resolve`); a claim that actuates gets the manifest's cleanup
run when the helper does not report `released` with `confirmed`/`unchanged` (spec REQ-DATA-f2cbfc23 §6); the binutils
plugin already pins xPack arm-none-eabi-gcc 15.2.1-1.1 downloads with SHA-256 (`plugins/binutils/plugin.yaml`).

Success signals: L04-A...L04-H as written in the ticket, each stated with real, offline-only or blocked evidence.

Evidence: OBSERVED ticket `F:\ProjectsDDP\VERA_Embedded_Lab_Plugins_Tickets\LAB-04.md`, epic plan §2-5,
`00_Planning/plan/embedded-lab-plugins.md` (LAB-01/02/03 as built), LAB-01/LAB-03 hand-over notes, spec
REQ-DATA-f2cbfc23 §6, `shared/src/{lab-resources,plugins}.ts`, `core/src/plugins/{runner,resource-registry,
provisioning}.ts`, manifests of probe-rs, binutils, ngspice, scpi-instruments, hil-testing. Machine inventory OBSERVED
2026-11-14 (read-only): no gdb, arm-none-eabi-gdb, gdb-multiarch, openocd, probe-rs, pyocd, JLink or qemu on PATH or in
the common folders (only STM32CubeProgrammer, no GDB server); Get-PnpDevice lists no ST-Link, J-Link, CMSIS-DAP or
other debug probe; uv 0.11.25 and Python 3.12.10 present.

Assumptions: INFERRED - each live operation is one finite session (start server, connect, act, apply the exit policy,
stop), so no GDB process outlives a run_program call; a halted core stays halted between calls, which lets
breakpoint/step follow a snapshot.

Unknowns: real GDB/OpenOCD behaviour on this machine (none installed); OpenOCD's own default on GDB detach (the helper
sets the gdb-detach event explicitly); a real board and probe (L04-B/C/E/F live); native Ubuntu (L04-H).

Decision-blocking questions: none. The coordinator's brief makes the session autonomous with recorded defaults; the
missing tools and hardware are blockers of their proofs, raised in the hand-over, not questions that change scope.

Proposed behaviors (accepted by ruling under the autonomous brief):
- P1 two programs: `gdb-elf` (offline, safe: `inspect`, `diagnose`) and `gdb-debug` (live: `tools`, `snapshot`,
  `break`, `step`, plus the cleanup `release`), so offline analysis works without GDB/OpenOCD installed.
- P2 every live call names a registry probe (`--probe <alias>`, kind `probe`, serial required), the ELF, the declared
  `--firmware-effect none|actuates` and `--on-exit halted|resume`; risk device-write, irreversible when the firmware
  actuates.
- P3 a helper drives GDB/MI with tokens through pipes it owns; only a fixed command set is sent, user values are
  validated identifiers/locations/addresses; OpenOCD is started from a package profile on 127.0.0.1 with telnet/Tcl
  off and hardware breakpoints.
- P4 the snapshot compares the ELF's read-only sections with the target flash (plain memory reads); a mismatch withholds symbol mapping.

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin and operations |
| no new interface or data format | no | registry kind `probe`, result format |
| no new dependency | no | external GDB and OpenOCD (user-installed or approved download) |
| an existing requirement already covers the behavior | no | no GDB requirement exists |
| no security or data-handling change | no | new device control, local debug server |

## Requirement coverage

| Behavior | Requirement | Criterion |
|---|---|---|
| operations, profiles, results (spec) | REQ-DATA-d7da2a71 | L04-A...H |
| offline ELF inspection | REQ-FUNC-0c6807c8 | L04-A |
| ELF outside workbench / wrong architecture refused | REQ-SEC-e1493c9b | L04-A, L04-D |
| registry kind probe with serial | REQ-DATA-ea470ec1 | L04-B, L04-G |
| probe reserved vs flash/HIL/debug; probe-rs blocks kept | REQ-SEC-ad412ce8 | L04-G |
| GDB without init files/auto-load/debuginfod | REQ-SEC-b50cb2e8 | L04-D |
| side-effect expressions and raw commands refused | REQ-SEC-a7bab79f | L04-D |
| OpenOCD from profiles, loopback only | REQ-SEC-593220cf | L04-F |
| MI token correlation, stale/async records | REQ-FUNC-74347f3b | L04-E |
| explicit state after timeout/disconnect/unexpected stop | REQ-REL-afd24ad4 | L04-E |
| snapshot with registers, backtrace, fault decode | REQ-FUNC-9ab9965c | L04-B |
| ELF mismatch withholds symbols; core mismatch blocked | REQ-SEC-7e237fa9 | L04-B |
| hardware breakpoint with timeout | REQ-FUNC-e539c51f | L04-C |
| bounded step | REQ-FUNC-bf57be4d | L04-C |
| risk by execution control and firmware effect | REQ-SEC-00f3d2b9 | L04-C, L04-G |
| exit policy and process cleanup on every end | REQ-REL-d5f06a9b | L04-F |
| permitted memory only | REQ-SEC-7f9bd395 | ticket "variabile și RAM permise" |
| tool versions and architecture support | REQ-FUNC-36c45a10 | ticket "Detectarea versiunilor" |
| offline re-diagnosis of a saved snapshot | REQ-FUNC-ccbd4442 | L04-B, L04-H (MI/diagnosis offline) |
| Windows x64 and native Ubuntu x64 | REQ-PLAT-8c2cdfb0 | L04-H |

## Design

**Approach.** A plugin package with two standard-library helpers sharing `scripts/gdb_support/` (RULING-001):
`gdb_elf.py` (offline) and `gdb_debug.py` (live). The live helper is the only process the runner starts; it owns
OpenOCD and GDB as its children and their pipes, so the runner's closed stdin and process-tree Stop stay as they are
(REQ-SEC-b50cb2e8, REQ-REL-d5f06a9b). One call = one finite session (spec §5): validate -> run folder -> OpenOCD on
127.0.0.1 -> GDB/MI -> identity and ELF match -> operation -> snapshot -> detach under OpenOCD's gdb-detach policy
event -> processes stopped. Platform change is limited to the registry kind `probe` in shared `lab-resources.ts`
(REQ-DATA-ea470ec1); leases, BUSY, stop/grace/cleanup are LAB-01/03 code reused through the manifest's
`resources {option: --probe, kinds: [probe], cleanup: [release]}` (REQ-SEC-ad412ce8). Rejected: a long-lived debug
service with IPC (a second control channel the runner does not supervise), a GDB console through the runner (stdin
closed, raw commands), a single `uses`-dependent program (offline inspection would need GDB installed).

**Interfaces and data.** CLI and documents in spec REQ-DATA-d7da2a71. Modules: `elf.py` (ELF32/64 headers, sections,
segments, symtab, notes, `.ARM.attributes`) and `dwarf.py` (CU headers and the first DIE's producer/language for
DWARF 2-5; unknown forms -> producer unknown, never a guess) for REQ-FUNC-0c6807c8/REQ-SEC-e1493c9b; `validate.py`
(variable/location/option syntax, REQ-SEC-a7bab79f); `profiles.py` (strict JSON profiles, REQ-SEC-593220cf);
`registry.py` (probe entries, approved hash); `mi.py` (pure MI parser) and `session.py` (process, reader thread,
tokens, timeouts, stale/untokened/async events, REQ-FUNC-74347f3b, REQ-REL-afd24ad4); `openocd.py` (command line,
readiness, detach marker); `faults.py` and `symbols.py` (REQ-FUNC-9ab9965c, REQ-SEC-7e237fa9, REQ-FUNC-ccbd4442);
`operations.py` (snapshot/break/step and the exit sequence, REQ-FUNC-e539c51f, REQ-FUNC-bf57be4d,
REQ-SEC-7f9bd395); `lifecycle.py` (VERA_RUN_CONTROL state/stop), `report.py`, `workspace.py` (byte-identical copy of
the electronics/lab path rules). Errors: refusal before any process -> exit 2 without folder; afterwards the result
carries status and problems, exit 3. Rules (REQ-SEC-00f3d2b9): highest-risk-wins patterns; direct GDB/OpenOCD
blocked. The LAB-01 scpi helper's registry reader skips `probe` entries (it refused any kind but `visa`).

**Files and test seams.** shared `lab-resources.ts` (+`lab-resources.test.ts`); core `runner-leases.test.ts` (probe
BUSY vs probe-rs selectors, HIL hold, second gdb run); plugin `05_Software/plugins/gdb-debug/` (plugin.yaml,
profiles, scripts, skill `debug-sessions`, README); scpi `registry.py`; catalog/packs; integration
`tests/integration/gdb-debug.test.ts` running both helpers on the toolchain Python against fixture ELFs and the
stand-ins `tests/fixtures/gdb-debug/{fake_gdb.py,fake_openocd.py}` (scripted MI transcripts, argument and command
logs, detach marker), plus one run through VERA's real runner and Stop; fixture firmware built once with zig cc from
PyPI (pinned, pre-approved) and checked with pyelftools (pinned, test oracle) - both opt-in, the committed ELFs are
the default inputs; packaging test count.

**Risks and open decisions.** No real GDB/OpenOCD/board here: the stand-ins prove the helper's protocol handling,
not GDB's or OpenOCD's real behaviour (real MI text of memory reads, OpenOCD's own detach default, the exact MI of a
real fault) - stays open for L04-B/C/E/F live and L04-H. The free-port pick can race another local program (OpenOCD
then fails to bind -> error, nothing exposed). Two probes of one VID:PID cannot be debugged concurrently
(RULING-002). A HIL adapter for GDB is not added.

**Requirement map.** REQ-DATA-d7da2a71 spec + all modules; REQ-FUNC-0c6807c8 elf/dwarf/cli_elf; REQ-SEC-e1493c9b
workspace + elf checks in cli_debug; REQ-DATA-ea470ec1 lab-resources.ts; REQ-SEC-ad412ce8 manifest resources +
runner reuse; REQ-SEC-b50cb2e8 session start; REQ-SEC-a7bab79f validate + fixed command builders; REQ-SEC-593220cf
openocd + profiles; REQ-FUNC-74347f3b mi/session; REQ-REL-afd24ad4 session + operations; REQ-FUNC-9ab9965c
operations/faults/symbols; REQ-SEC-7e237fa9 operations (flash read-back comparison, CPUID); REQ-FUNC-e539c51f and
REQ-FUNC-bf57be4d operations; REQ-SEC-00f3d2b9 plugin.yaml + required options; REQ-REL-d5f06a9b openocd detach event,
operations exit, lifecycle, release; REQ-SEC-7f9bd395 mem regions + read checks; REQ-FUNC-36c45a10 tools;
REQ-FUNC-ccbd4442 cli_elf diagnose; REQ-PLAT-8c2cdfb0 no platform-specific code beyond process termination.

Diagrams: [diagram_TASK-6b092dfc.md](diagram_TASK-6b092dfc.md)

## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: DEVIATION build: spec REQ-DATA-d7da2a71 section 5 and REQ-SEC-7e237fa9 changed from GDB compare-sections to a byte comparison of the ELF's read-only sections read back with -data-read-memory-bytes - OpenOCD answers GDB's qCRC by running a CRC routine in the target RAM work area (STM32 configs set -work-area-backup 0), which would overwrite firmware RAM; cost: up to 4 MiB of flash reads per session
- 2026-11-14 build: red: npx vitest run src/libraries/shared/src/lab-resources.test.ts exit 1 - registry refuses kind probe and has no probe keys (REQ-DATA-ea470ec1)
- 2026-11-14 build: green: npx vitest run src/libraries/shared/src/lab-resources.test.ts src/libraries/core/src/plugins/runner-leases.test.ts exit 0, 32 tests (REQ-DATA-ea470ec1; REQ-SEC-ad412ce8 platform part: the probe keys make the existing runner BUSY checks apply - no runner change, so its two new tests passed on first run)
- 2026-11-14 build: red: npx vitest run tests/integration/gdb-debug.test.ts exit 1 - 10 of 29 failed: scpi helper refuses a registry with a probe entry; integration dist still refuses kind probe (not rebuilt); test-side: --version probes logged before the session, wrong function count, a Windows find glob with parentheses; MI-timeout exit not confirmed (REQ-DATA-ea470ec1, REQ-SEC-593220cf, REQ-REL-d5f06a9b and the scpi coexistence)
- 2026-11-14 build: DEVIATION build: the gdb_support helper modules and stand-ins were written before tests/integration/gdb-debug.test.ts and internals.py - the observed red covered only the scpi coexistence, the stale dist (registry kind), the manifest glob and test-side errors; the Python checks passed on their first run. Cost: most helper requirements have no observed red line
- 2026-11-14 build: green: npm run typecheck exit 0 (rebuilds dist); npx vitest run tests/integration/gdb-debug.test.ts exit 0, 29 passed 1 skipped (all LAB-04 requirements against the GDB/OpenOCD stand-ins, internals.py, VERA runner Stop); opt-in VERA_GDB_ORACLE_PYTHON (pyelftools 0.32 from PyPI) exit 0 - gdb-elf facts equal pyelftools on fault-m4, fault-m4-v2, fault-m0, riscv (fixtures built with ziglang 0.13.0 from PyPI)
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: self-review: a GDB ^error on locals, backtrace, a variable or the stacked-frame read no longer turns the snapshot into error - each becomes a recorded limit or entry error (new test 'keeps a snapshot when GDB cannot list locals...'; gdb-debug.test.ts exit 0, 30 passed 1 skipped); .gitattributes marks *.elf binary; knowledge pages official-plugins.md and plugins.md, project.md and environment.md updated; spec section 6 brought in line with the built result documents
- 2026-11-14 validate: review round 1: spec changes_required (unchecked ELF match reports symbols with no limit/problem and no test; L04-G overstated - BUSY only for selector-named probe access; REQ-FUNC-ccbd4442 verification claims a committed snapshot and a mismatched diagnose test that do not exist; verification texts of REQ-SEC-a7bab79f/e1493c9b/7f9bd395/REQ-FUNC-0c6807c8 overstate tests; external reset not a scenario of its own; README limits omit no standalone continue and named-variable-only reads); quality changes_required (tracebacks on malformed ELF attributes/symbols, missing tool executables, control chars in ELF path, DW_FORM_indirect recursion, hand-edited diagnose input; --read with C++ operator[]/operator& can make GDB call target functions - add may-call-functions off and map RAM ro; OpenOCD cwd inside the run folder; same-model probes block each other undocumented/untested; exit sequence can exceed grace and command waits ignore Stop; GDB startup failure reported as disconnected; DW_LANG C++17 code; spec says PROGBITS only while NOTE is compared)
- 2026-11-14 validate: returned to build - review round 1 findings (spec and quality)
- 2026-11-14 build: round-1 fixes: GDB gets may-call-functions off and RAM mem regions read-only; ELF match counts compared bytes - partly compared all-equal is unchecked with an elf-unchecked problem and limit, nothing compared withholds names; ElfError from attributes/symbols/facts is a refusal before any folder; Popen OSError of GDB/OpenOCD is a gdb/openocd error with a result; Live.run records any other exception as internal after the exit sequence; DW_FORM_indirect chains refused iteratively; diagnose type-checks its input; OpenOCD runs in an empty temp folder outside the workbench; command waits honour Stop (Interrupted) while cleanup commands are not interruptible and the exit sequence is bounded to about 19 s; a GDB that fails before connecting is a gdb error with state unknown; DW_LANG 0x2A C++17/0x2B C++20; tests added (partial/zero comparison, missing executables, GDB dying at start, malformed attributes, diagnose of a mismatched run, same-model probe BUSY, Stop during a command, indirect chain); spec, README, architecture, plan as-built (L04-G partial, external reset indirect, no standalone continue, named-variable reads only), knowledge pages and requirement texts corrected
- 2026-11-14 build: green: npx vitest run tests/integration/gdb-debug.test.ts tests/integration/scpi-instruments.test.ts src/libraries/shared/src/lab-resources.test.ts src/libraries/core/src/plugins/runner-leases.test.ts tests/packaging/prepare-plugins.test.ts exit 0, 90 passed 2 skipped; opt-in pyelftools oracle exit 0; npm run lint exit 0; npm run typecheck exit 0; npm run check:i18n exit 0; ruff F/E9/B/PLE clean
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 2: spec changes_required (diagnose trusts a recorded unchecked match with compared 0, contradicting the live withholding; spec §6 elf block lacks compared; README/skill/as-built describe only matched/mismatched; REQ-REL-d5f06a9b and REQ-SEC-593220cf verification omit tested behaviour); quality approved with minors (same diagnose gap; a Stop during a short command abandons GDB instead of letting it finish; create_folder OSError under a file path is a traceback; spec timings 5 s/19 s differ from code 3 s/about 28 s)
- 2026-11-14 validate: returned to build - review round 2 findings
- 2026-11-14 build: round-2 fixes: diagnose attributes an unchecked match only with a recorded compared > 0 (limit otherwise); --results-dir that cannot be created is a refusal; a stop request gives a pending command one more second before abandoning it; spec §5/§6 (compared field, 3 s marker, about 28 s bound), README, skill, as-built and REQ-FUNC-ccbd4442/REQ-REL-d5f06a9b/REQ-SEC-593220cf texts and links aligned; tests added (diagnose of a compared-0 run, results dir below a file, stop lets a short command finish)
- 2026-11-14 build: green: npx vitest run tests/integration/gdb-debug.test.ts src/libraries/core/src/plugins/runner-leases.test.ts exit 0, 54 passed 1 skipped; npm run lint exit 0; npm run typecheck exit 0; ruff clean
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 3: spec approved, quality approved. DEVIATION validate: the reviewers' remaining minor points were settled in spec text after the approvals without a fourth round - event kind stopped listed, the stop paragraph reworded (a pending command gets one more second, then is abandoned), the small margin of 1 s + about 28 s inside the 30 s grace stated, and the quality minor (a stop arriving during the snapshot's own reads lets them finish, the result is that snapshot, status may be pass) documented as current behaviour instead of changed - text only, no code or test change; cost: that last behaviour stays a known limit
- 2026-11-14 validate: manual: REQ-PLAT-8c2cdfb0 native Ubuntu x64 and every live criterion (L04-B/C/E/F with a real board, L04-H with real GDB/OpenOCD) not run - this machine has no GDB, OpenOCD, probe-rs, pyOCD, J-Link or QEMU (read-only PATH/folder check) and Get-PnpDevice lists no debug probe (2026-11-14); no GDB/OpenOCD download was made (needs the user's approval); these stay open blockers, the profiles stay unverified
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-6b092dfc --strict --run exit 0; ran lint, typecheck, i18n (all ok); strict ok; 72 warnings: journal-header/stale-paths/ticket-ref/no-linked-tests of other tasks (pre-existing), uncovered-source for catalog.yaml, packs.yaml, the two changed test files and the gdb-debug fixtures (registration lines and test inputs exercised by gdb-debug.test.ts, not product source), secret-in-diff on the four fixture ELFs (binary; their only long strings are the public clang 18.1.6 zig-bootstrap version text) - informational, accepted. Focused vitest proof from build round 3 stands (only spec text changed since); pre-existing plugins-ipc.test.ts catalog-view failure is out of scope
- 2026-11-14 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-14 done: Real tools (approved download 2026-11-14, SHA-256 verified, scratch folder): xPack arm-none-eabi-gcc 15.2.1-1.1 (GDB 16.3.90, bae6a3d1...93ea) and xPack OpenOCD 0.12.0-7 (6bfd3c97...0052). gdb-debug tools ok; real OpenOCD without a probe accepts every -c command and stops at 'open failed' (error/openocd, physical unchanged); real GDB against the stand-in's new RSP target runs snapshot, break (function, file:line, address), not-hit interrupt, instruction steps and a mismatch with no write packet.
- 2026-11-14 done: DEVIATION validate: fixes after done from the real-tool run - GDB 16 prints its target only for --configuration (cli_debug _gdb_target; the stand-in mirrored the old text) and the stand-in fault pc 0x08000116 lay in padding (now 0x08000114, lines from real GDB) - accepted as bug fixes found by the new evidence, no new review round; opt-in tests VERA_GDB_REAL_GDB / VERA_GDB_REAL_OPENOCD added, vitest 40 passed with both set.

## Rulings

- RULING-001 | date=2026-11-14 | decision=Split the plugin into gdb-elf (offline: inspect, diagnose; safe; standard-library ELF/DWARF reader) and gdb-debug (live: tools, snapshot, break, step, cleanup release; uses arm-none-eabi-gdb and openocd programs of the plugin). Each live call is one finite supervised session: OpenOCD from a package profile on 127.0.0.1 (telnet/Tcl off), GDB in MI mode without init files/auto-load driven through helper-owned pipes with a fixed command set, then the declared exit policy, then both processes stopped. | reason=Ticket: finite operations, MI internal, no console, server local; a uses sibling must resolve before a program runs, so offline inspection must not depend on GDB. Decided under the coordinator's autonomous brief. | source=technical | supersedes=none
- RULING-002 | date=2026-11-14 | decision=Probe identity: new lab/resources.json kind probe {alias, resource VID:PID:SERIAL (serial required), profile}; keys probe:<vid>:<pid>:<serial> and probe:<vid>:<pid> lower-cased, so probe-rs --probe selectors and HIL plan probes on the same probe are BUSY. Risk: gdb-debug snapshot/break/step device-write, irreversible with --firmware-effect actuates; --on-exit halted or resume required and recorded; the cleanup run release never touches the target and reports the physical state unknown. | reason=Ticket L04-G and lifecycle; the runner already keys --probe values as probe:<selector>; reconnecting in a cleanup would halt the core (unauthorized state change). Conservative: two probes of the same VID:PID cannot be debugged concurrently. | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-6b092dfc.md
changed: gdb-debug plugin (gdb-elf, gdb-debug, profiles, skill, README), shared lab-resources kind probe, scpi registry skips probe entries, catalog/pack, .gitattributes *.elf, fixtures and tests, spec/requirements, planning and knowledge docs
evidence: aegis check --task TASK-6b092dfc --strict --run exit 0 (lint, typecheck, i18n ok); focused vitest gdb-debug + runner-leases exit 0 (54 passed); earlier 5-file set exit 0 (90 passed); pyelftools oracle exit 0
issues: no real GDB/OpenOCD/probe/board here: L04-B/C/E/F live and L04-H (Windows real tools, native Ubuntu) open, profiles unverified; L04-G partial (BUSY only for selector-named probe access); pre-existing plugins-ipc.test.ts failure
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/101-embedded-lab
- requirements:
  - REQ-DATA-d7da2a71 - Define the gdb-debug operations, profiles and result formats
  - REQ-FUNC-0c6807c8 - Inspect a firmware ELF offline
  - REQ-SEC-e1493c9b - Refuse an ELF that is outside the workbench or does not suit the profile
  - REQ-DATA-ea470ec1 - Declare a debug probe in the bench registry by its serial
  - REQ-SEC-ad412ce8 - Reserve the debug probe against flash, HIL and other debug runs
  - REQ-SEC-b50cb2e8 - Start GDB without init files, auto-load or network lookups
  - REQ-SEC-a7bab79f - Refuse side-effect expressions and raw debugger commands
  - REQ-SEC-593220cf - Run OpenOCD only from package profiles on the loopback interface
  - REQ-FUNC-74347f3b - Match each GDB/MI result to its own command
  - REQ-REL-afd24ad4 - Keep the target state explicit after a timeout, disconnect or unexpected stop
  - REQ-FUNC-9ab9965c - Snapshot registers, backtrace and fault state with symbols
  - REQ-SEC-7e237fa9 - Withhold symbol diagnosis when the ELF does not match the target
  - REQ-FUNC-e539c51f - Run to a hardware breakpoint within a bounded time
  - REQ-FUNC-bf57be4d - Step the halted core a bounded number of times
  - REQ-SEC-00f3d2b9 - Rate debug operations by execution control and firmware effect
  - REQ-REL-d5f06a9b - Apply the declared exit policy and stop GDB and OpenOCD on every end
  - REQ-SEC-7f9bd395 - Read only permitted target memory
  - REQ-FUNC-36c45a10 - Report the debug tools and their architecture support
  - REQ-FUNC-ccbd4442 - Re-diagnose a saved snapshot offline
  - REQ-PLAT-8c2cdfb0 - Run gdb-debug on Windows x64 and native Ubuntu x64
- deviations: 3 recorded
  - build: spec REQ-DATA-d7da2a71 section 5 and REQ-SEC-7e237fa9 changed from GDB compare-sections to a byte comparison of the ELF's read-only sections read back with -data-read-memory-bytes - OpenOCD answers GDB's qCRC by running a CRC routine in the target RAM work area (STM32 configs set -work-area-backup 0), which would overwrite firmware RAM; cost: up to 4 MiB of flash reads per session
  - build: the gdb_support helper modules and stand-ins were written before tests/integration/gdb-debug.test.ts and internals.py - the observed red covered only the scpi coexistence, the stale dist (registry kind), the manifest glob and test-side errors; the Python checks passed on their first run. Cost: most helper requirements have no observed red line
  - validate: the reviewers' remaining minor points were settled in spec text after the approvals without a fourth round - event kind stopped listed, the stop paragraph reworded (a pending command gets one more second, then is abandoned), the small margin of 1 s + about 28 s inside the 30 s grace stated, and the quality minor (a stop arriving during the snapshot's own reads lets them finish, the result is that snapshot, status may be pass) documented as current behaviour instead of changed - text only, no code or test change; cost: that last behaviour stays a known limit
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 8c374f4: 78 file(s) changed, 6867 line(s) added; 4 file(s) not content-scanned
- checks: errors=0 warnings=72 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
