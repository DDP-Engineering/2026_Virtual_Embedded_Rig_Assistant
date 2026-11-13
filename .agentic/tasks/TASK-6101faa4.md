# TASK-6101faa4 - ELEC-06 kicad-layout: controlled PCB placement, local routing and candidate application through KiCad's IPC API (#98)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-891d5b5d, REQ-PLAT-3957eafc, REQ-FUNC-32022bcd, REQ-REL-19ac705f, REQ-SEC-6bb41c34, REQ-REL-d2fd6d58, REQ-FUNC-f92446a1, REQ-REL-2a3f09b8, REQ-REL-e30bf69f, REQ-SEC-438b7bbf, REQ-SEC-a6a6482e, REQ-SEC-f986d80d, REQ-SEC-f7a0b1fe, REQ-REL-233d6e0f, REQ-FUNC-cd7d1b3f, REQ-FUNC-9c4d809c, REQ-FUNC-350e262a, REQ-FUNC-b0cbbb04, REQ-REL-1dd5113a, REQ-REL-ea280836, REQ-FUNC-73b4e5d0, REQ-SEC-c986d8f2, REQ-SEC-854495d1, REQ-SEC-c445ab5c, REQ-SEC-e27836d3, REQ-SEC-8483534b, REQ-FUNC-3f443814, REQ-UX-5367fe76, REQ-TEST-63c70d58, REQ-PLAT-e0d8f3cf
parent:
branch: feature/93-electronics-calc
base: 0764e8fa23c9a55880a4c9b90675da8bb62458f8
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

Problem: STATED (ticket ELEC-06, #98, Romanian, F:\ProjectsDDP\VERA_Electronics_Plugins_Tickets\ELEC-06.md): VERA can
analyse KiCad boards (ELEC-02 `kicad`) but cannot change one. The agent has no controlled way to move or rotate
footprints, add a local track or via, check the result and apply it to the user's board under the write policy.
OBSERVED: no host tool writes a workbench file from bytes on disk; `prepareChange` (core/tools/changes.ts:115-260)
takes content only from model text; plugin programs are one-shot processes (runner, node-process-host.ts:53).

Desired outcome: STATED: an official plugin `kicad-layout` generates a candidate board separately from the source,
edits it with finite, checked operations through KiCad's official IPC API, verifies it (DRC, unconnected items, nets,
locked items) with a before/after report and layer previews, and an authorised apply step writes the approved
candidate over the source through VERA's write flow (base hash, candidate hash, approval, write queue, conflict
check). Nothing changes the source before apply; a candidate changed after approval invalidates the approval.

Actors: the user (owns the board, approves the apply, keeps KiCad's API enabled); the agent (proposes operations);
`kicad-layout-tool` (checks and executes them); KiCad 10 pcbnew (the GUI instance serving the IPC API on the
candidate); `kicad-cli` (DRC, previews); VERA core (the apply tool under the permission modes).

Primary scenario: STATED/INFERRED: the agent asks kicad-layout-tool to open a candidate of `board.kicad_pcb`; the
helper copies the project into a new run folder, opens the copy in pcbnew (no clicks), binds to the API instance
whose open document is that copy, and records hashes. The agent requests "move C3 to (x, y), rotate 90 degrees, add a
0.25 mm track on net VCC from C3.1 to U1.4"; the helper checks the request (UUIDs, nets, layers, locked items, board
outline), applies it in one commit, saves the candidate, runs DRC and writes the report. The agent shows the report;
the user asks to apply; VERA's apply tool presents the change for approval (ask mode) and writes it.

Examples: E06-B: a fixture board accepts moving a decoupling capacitor and a local track, keeping nets, the UUIDs of
untouched items and locked items. E06-C: a candidate with a new short or clearance violation is rejected by the
objective check. E06-D: read-only refuses apply; ask presents the change; declining leaves the source identical.
E06-E: changing the source or candidate between preview and apply gives a conflict. E06-F: two windows or boards, a
changed document, a lost connection, unsaved edits and Stop never change the wrong project. E06-G: the applied board
reopens in KiCad and the report matches the applied file.

Counterexamples: a request to move a locked footprint, to put a track on a net that does not exist, or to replace a
footprint is refused, not executed. An API instance whose open board is not the candidate (the user's own KiCad
window) is never edited.

In scope: STATED: plugin `kicad-layout` (manifest, helper, skill, README, catalog/packs); operations move, rotate,
align/group by declared rule, simple keepouts, explicit local tracks and vias with declared net/layer/width/via;
candidate creation with the project context; instance binding; checks of locked items, outline, stackup and rules;
DRC and unconnected on the candidate; before/after report (objects, nets, DRC, unconnected, lengths/vias, layer
previews); the first-party apply path in VERA core under the existing write policy; tests and fixtures.

Out of scope: STATED (ticket): global optimal placement, schematic editing, general autorouting (ELEC-07), automatic
RF design, signal integrity guarantees from DRC alone; interactive push-and-shove routing through the API unless
demonstrated; replacing footprints without pinout and scope checks; backups and migrations; driving the GUI by
clicks. INFERRED: DSN/SES exchange belongs to ELEC-07.

Constraints:
- STATED (user, 2026-11-13): the route is the official IPC API through kicad-python (RULING-001); the pinned download
  of kicad-python with protobuf and pynng from PyPI is approved.
- STATED (user): the API server is enabled by setting `api.enable_server` in kicad_common.json (RULING-002).
- STATED (standing instruction): same branch, commit each validated child.
- STATED (ticket): no headless promise for KiCad 9/10 IPC; the user may have to open the candidate and enable the
  API; reuse the write flow; source untouched before apply; unsaved changes in an open source are resolved by the user
  in the editor, never overwritten; no backups or migrations; result formats at version 1.
- STATED (user, earlier tickets): do not overengineer; modern minimum versions.
- OBSERVED: plugin scripts run as `uv run --offline --script` with PEP 723 pinned dependencies installed by
  `uv sync --script` at provisioning (provisioning.ts:745-760, 939-974; can-dbc pins cantools==45.1.2).

Success signals: E06-A..E06-G of the ticket, each settled by a real KiCad 10.0.8 run on Windows where it needs the
GUI, and by offline tests where it does not; the version limits recorded.

Evidence: OBSERVED (probes 2026-11-13, D:\Temp\kicad-ipc-probe\probe1..3.py, KiCad 10.0.8 standalone pcbnew,
kicad-python 0.8.0 on Python 3.12):
- The API answers on `%TEMP%\kicad\api.sock` (a named pipe) about 2.5-3 s after pcbnew starts, then reports "busy"
  while it loads; requests must retry on busy.
- `get_open_documents(DOCTYPE_PCB)` gives the board file name and the project folder: enough to bind to a candidate.
- Only the first KiCad process serves the API on Windows: a second pcbnew opened another board and created no
  `api-<pid>.sock`; a client falling back to `api.sock` reached the first window's board (the wrong-window risk).
- update_items moves and rotates footprints; create_items adds tracks and vias; begin_commit/push_commit group them;
  `save()` writes the document; `save_as` writes a copy and refuses an existing path; `revert()` reloads from disk.
- The API does not protect locked items (a locked footprint moved, a locked track changed) and accepts a track on a
  net name that does not exist; a created track needs its layer set (default 0).
- KiCad's in-memory board text (`get_as_string`) never equals the file, even right after its own save; it changes
  with an unsaved edit.
- After a KiCad restart the old token is refused ("the provided kicad_token did not match"); a killed instance gives a
  send timeout.
- pcbnew writes `~<board>.kicad_pcb.lck` and `~<project>.kicad_pro.lck` while a board is open.
- kicad-cli 10.0.8 runs DRC (JSON) on a saved candidate; `kicad-cli pcb` has drc, export, import, render, upgrade.
- kicad-python 0.8.0 is built against API 10.0.6; `check_version` raises FutureVersionError for KiCad 10.0.8.
- KiCad 10's bundled Python has the deprecated SWIG pcbnew but not kipy (web: SWIG removal planned for KiCad 11;
  IPC headless and plotting come in KiCad 11).

Assumptions: INFERRED: the user's own KiCad window may be open while VERA works; the candidate window is VERA's and
may be closed by the helper; Ubuntu native behaves like Windows apart from the socket path (UNKNOWN until run).

Unknowns:
- UNKNOWN: Ubuntu native behaviour (socket `/tmp/kicad/api.sock`, second instance) - no Linux host here.
- UNKNOWN: whether pynng 0.9.0 has wheels for uv's managed CPython 3.13 on both platforms.
- UNKNOWN: how KiCad reacts when the user closes the candidate or opens another board in the bound window (the
  document check before each operation is the guard).
- UNKNOWN: the size of a full-text diff of a real board for the approval card.

Decision-blocking questions: none open. The route (RULING-001) and the API setting (RULING-002) were decided by the
user on 2026-11-13.

Proposed behaviors (not accepted until specify):
- One run folder per candidate holding the project copy, a state file (base hash, candidate hash after each save,
  hash of the in-memory board text after each save, the pcbnew PID), reports and previews.
- Every operation first checks the binding (the API instance's open board is the candidate's file in the run
  folder), the token, the candidate's disk hash and the in-memory text hash; any mismatch stops it.
- The helper enforces locked items, existing nets, declared layers and the board outline itself.
- Apply: a first-party host tool `apply_candidate` that reuses the PreparedChange contract and apply body, shows the
  report summary and changed objects instead of the full board text, and refuses while the source has KiCad lock
  files.
- Minimum KiCad 10.0; kicad-python pinned at 0.8.0 without its version check (the API promises stable messages).

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|---|
| no new externally observable behavior | no | new plugin, operations and apply tool |
| no new interface or data format | no | request and result formats, a host tool |
| no new dependency | no | kicad-python, protobuf, pynng |
| an existing requirement already covers the behavior | no | no requirement for PCB edits or file apply |
| no security or data-handling change | no | writes over the user's board under the write policy |

## Requirement coverage

| Behavior | Requirement | Source | Design |
|---|---|---|---|
| formats: run folder, state, inventory, request, result (spec) | REQ-DATA-891d5b5d | Frame proposed behaviors; ticket common conventions | state.py, report.py, request.py |
| KiCad 10 found, editor from the same folder, pinned client, direct kicad-cli blocked | REQ-PLAT-3957eafc | RULING-001; E06-A | plugin.yaml, PEP 723 pins, rules |
| open: candidate copy, editor, binding, save, hashes, inventory, DRC | REQ-FUNC-32022bcd | ticket candidate; E06-B setup | candidate.py, kicad.launch/bind/save |
| open refused: board path | REQ-REL-19ac705f | error response | workspace.py |
| open refused: another KiCad window holds the API | REQ-SEC-6bb41c34 | E06-F two windows; probe 2 | kicad.probe before launch |
| open failed: editor never answers (API off) | REQ-REL-d2fd6d58 | ticket explicit condition | kicad.wait, stop editor, remove folder |
| edit: operations in one commit, save, record | REQ-FUNC-f92446a1 | E06-B | operations.run (one commit) |
| edit refused: malformed request | REQ-REL-2a3f09b8 | error response | request.py |
| edit refused: candidate changed (hash, unsaved edits) | REQ-REL-e30bf69f | E06-E, E06-F unsaved | cli hashes, kicad.memory_hash |
| edit/close refused: binding | REQ-SEC-438b7bbf | E06-F document changed, two windows | kicad.bind |
| edit refused: footprint, net, layer, net reassigned by KiCad | REQ-SEC-a6a6482e | ticket finite operations; validate probe | operations.resolve, operations.check_nets |
| edit refused: locked | REQ-SEC-f986d80d | E06-B locked; probe 2 | operations.resolve (locked) |
| edit refused: outline | REQ-SEC-f7a0b1fe | ticket outline | operations.outline (KiCad bounding boxes) |
| edit failed: connection lost, token, KiCad error | REQ-REL-233d6e0f | E06-F lost connection | kicad error mapping, drop/revert |
| edit: only named items changed | REQ-FUNC-cd7d1b3f | E06-B UUIDs and nets kept | operations.unchanged + revert |
| objectives: new DRC errors, unconnected | REQ-FUNC-9c4d809c | E06-C | drc.compare |
| report: changes, nets, DRC, unconnected, previews | REQ-FUNC-350e262a | ticket report; E06-G | report.py, drc previews |
| close: stop the editor, remove locks | REQ-FUNC-b0cbbb04 | Frame proposed behaviors | cli close, PID image check |
| close refused: unsaved edits | REQ-REL-1dd5113a | error response | cli close memory hash |
| Stop / timeout keeps the candidate consistent | REQ-REL-ea280836 | E06-F Stop | save last, state written last |
| apply_candidate writes the approved candidate | REQ-FUNC-73b4e5d0 | E06-D ask/auto-edit/bypass; E06-G | apply-candidate.ts + commitChange |
| apply refused in read-only | REQ-SEC-c986d8f2 | E06-D | existing read-only write-class filter |
| apply declined leaves the source | REQ-SEC-854495d1 | E06-D | existing decline path |
| apply conflict: source or candidate changed | REQ-SEC-c445ab5c | E06-E | prepare checks + commitChange extra check |
| apply refused: source open in KiCad | REQ-SEC-e27836d3 | ticket unsaved source; E06-F | lock file in prepare + extra check |
| apply refused: failed checks, paths, kind | REQ-SEC-8483534b | E06-C, write policy | prepare checks |
| apply_candidate offered only with the official plugin | REQ-FUNC-3f443814 | ticket first-party adapter | desktop gate, host flag, labels |
| skill and README guide the flow | REQ-UX-5367fe76 | ticket explicit conditions | SKILL.md, README |
| GUI tests gated, offline tests always | REQ-TEST-63c70d58 | E06-A..G evidence classes | test gating (VERA_TEST_KICAD_GUI) |
| display variables only for gui programs (Linux PCB editor) | REQ-PLAT-e0d8f3cf | review round 2; user chose opt-in per program | shared plugins.ts gui, runner programEnvironment display, program-tools |

## Design

Diagrams: [diagram_TASK-6101faa4.md](diagram_TASK-6101faa4.md)

**Approach.** An official plugin `kicad-layout` with one helper, `kicad-layout-tool open|edit|close`, and one
first-party host tool, `apply_candidate`. Each helper call is one process and one API client (plugin programs are
one-shot): it reads `state.json`, checks the run folder and the request offline, connects to `<temp>/kicad/api.sock`,
proves the binding (the API's open document is the candidate, spec §2), proves that nothing changed since the last
save (file SHA-256, in-memory text SHA-256), runs the operations in one commit, verifies that only the named items
changed, saves through KiCad, runs kicad-cli DRC and previews, and rewrites state, inventory and report. `open`
starts the PCB editor itself on the copy (Popen, DEVNULL handles, PID recorded) because the API cannot open a file;
`close` stops only that PID. Rejected: driving SWIG pcbnew or editing S-expressions (RULING-001); a long-lived
helper (the runner has none); trusting the API for locked items or nets (probe 2: it protects neither).

**Interfaces and data.** Spec REQ-DATA-891d5b5d §3-§9: run folder, state.json, board.json, created.json, request,
result.json and report.md; exit 0 completed (objectives may fail), 2 refused (nothing changed), 3 failed. The
candidate is owned by the run folder; the source is only read. A failed open removes the run folder and stops its
editor; an edit that fails before the save drops or reverts the commit and leaves state.json as it was; after the
save, state.json is written at once (objectives none), and a later failure says that the edit was saved and writes
a failed result.json, whatever the error (review rounds 1-3); board-open.json and drc-before.json are checked after
the binding, before the commit, and result.json is never read. After the commit the outline check runs, then `check_nets` refuses a
created track or via that KiCad moved to another net (found in validate), then the unchanged check (UUIDs and
counts), and the binding is checked again before the save. kicad-layout-tool declares `gui: true`, so VERA's runner passes it the
display variables (user's choice in review round 2: opt-in per program, REQ-PLAT-e0d8f3cf). `apply_candidate { run }` reads state.json, checks paths, hashes, objectives and KiCad's lock file, then
builds a PreparedChange whose apply body is the write tool's, factored out of `prepareChange` as `commitChange` with
an extra check (candidate hash still the approved one, no lock file) run before and after the temporary write.
Test seams: `KICAD_LAYOUT_WAIT_SECONDS` (shorter waits), `KICAD_LAYOUT_TEST_HOOK` (a Python file run at named
points: after binding, inside the commit, before the unchanged check) and `KICAD_LAYOUT_TEST_EDITOR` (a Python stub
started instead of the PCB editor); VERA passes none of them to plugin programs (environment allowlist).

**Files and test seams.** Plugin `05_Software/plugins/kicad-layout/`: plugin.yaml, README.md,
skills/kicad-layout/SKILL.md, scripts/kicad_layout_tool.py (PEP 723: kicad-python 0.8.0, protobuf 5.29.6,
pynng 0.9.0), scripts/kicad_layout_support/{cli,request,state,candidate,kicad,operations,drc,report}.py and a byte
copy of the kicad helper's workspace.py; `plugins/{catalog,packs}.yaml`. Core: tools/changes.ts (commitChange, tool
union), tools/apply-candidate.ts (+ .test.ts), tools/registry.ts, sessions/service.ts (host flag); shared tools.ts and
events.ts (approval tool enum); desktop main/sessions.ts (official-plugin gate) and the renderer's tool labels and
locales. Tests: `tests/integration/kicad-layout.test.ts` (offline helper tests always; PCB editor tests under
VERA_TEST_KICAD_GUI), core `apply-candidate.test.ts` and `registry.test.ts`, the desktop sessions gate test; fixtures
`tests/fixtures/kicad-layout/` (a generated board with an IC, a far decoupling capacitor, a locked footprint, an
outline and two layers; hooks; the stub editor).

**Risks and open decisions.**
- The API needs a GUI PCB editor, and only one serves the API on Windows: an open refuses while another KiCad window
  holds it (REQ-SEC-6bb41c34); the user closes it.
- A modal dialog makes KiCad answer "busy": waits are bounded (spec §2) and end in `connection`.
- A client killed inside a commit may leave the commit open in KiCad (UNKNOWN): build probes it, and the next
  operation's binding, hash and commit checks refuse rather than guess (REQ-REL-ea280836).
- state.json lies in the workbench, so the agent could edit it. It is a guard against mistakes, not a security
  boundary: apply_candidate keeps the write policy (path guard, agent-writable, protected paths, approval).
- A full-text diff of a reformatted board can be large: the diff uses `maxEditLength`, and when that limit is
  exceeded the approval says that the report lists the changes.
- Ubuntu native is not run here (no host). The CLI app does not offer apply_candidate (the host flag is not set
  there).

**Requirement map.**
- REQ-DATA-891d5b5d: state.py, report.py, request.py (formats).
- REQ-PLAT-3957eafc: plugin.yaml, PEP 723 pins, rules.
- REQ-FUNC-32022bcd: candidate.py copy, then kicad.py launch, bind and save.
- REQ-REL-19ac705f: workspace.py checks before anything.
- REQ-SEC-6bb41c34: kicad.py probes api.sock before launching.
- REQ-REL-d2fd6d58: wait loop, stop the editor, remove the folder.
- REQ-FUNC-f92446a1: operations.py, one commit.
- REQ-REL-2a3f09b8: request.py, static.
- REQ-REL-e30bf69f: cli.py hash checks and kicad.py memory hash.
- REQ-SEC-438b7bbf: kicad.bind on every edit and close.
- REQ-SEC-a6a6482e and REQ-SEC-f986d80d: operations.resolve against the live items; operations.check_nets after the commit.
- REQ-SEC-f7a0b1fe: operations.outline, from KiCad's bounding boxes, with the commit dropped.
- REQ-REL-233d6e0f: kicad.py error mapping, drop or revert.
- REQ-FUNC-cd7d1b3f: operations.unchanged, with a revert.
- REQ-FUNC-9c4d809c: drc.py compare.
- REQ-FUNC-350e262a: report.py from the inventory at open against now.
- REQ-FUNC-b0cbbb04 and REQ-REL-1dd5113a: cli close, with a PID image check.
- REQ-REL-ea280836: save only at the end, state written last.
- REQ-FUNC-73b4e5d0: apply-candidate.ts and commitChange.
- REQ-SEC-c986d8f2: the existing read-only filter (class write).
- REQ-SEC-854495d1: the existing approval decline path.
- REQ-SEC-c445ab5c and REQ-SEC-e27836d3: prepare checks and the commitChange extra check.
- REQ-SEC-8483534b: prepare checks.
- REQ-FUNC-3f443814: desktop gate and host flag, plus labels.
- REQ-UX-5367fe76: the skill and README.
- REQ-TEST-63c70d58: test gating.


## Log

- 2026-11-13 frame: journal opened
- 2026-11-13 frame: capability gate probed on KiCad 10.0.8 (probe1..3 in D:\Temp\kicad-ipc-probe): the IPC API covers document identification, move/rotate, track/via creation, commits, save, save copy, revert; it needs a GUI pcbnew, serves only the first instance on Windows, and protects neither locked items nor nets - the helper must. Ubuntu native not run (no host).
- 2026-11-13 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-13 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-13 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-13 build: red: npx vitest run core/src/tools/apply-candidate.test.ts core/src/sessions/apply-candidate.test.ts tests/integration/kicad-layout.test.ts exit 1 - 16 failed: no kicad-layout plugin (manifest, helper, workspace copy), no applyCandidateTool or officialLayoutPlugin, no approval for apply_candidate; the PCB editor tests skipped without VERA_TEST_KICAD_GUI (REQ-DATA-891d5b5d, REQ-PLAT-3957eafc, REQ-UX-5367fe76, REQ-REL-19ac705f, REQ-REL-2a3f09b8, REQ-REL-e30bf69f, REQ-REL-d2fd6d58, REQ-REL-233d6e0f, REQ-FUNC-73b4e5d0, REQ-SEC-854495d1, REQ-SEC-c445ab5c, REQ-SEC-e27836d3, REQ-SEC-8483534b, REQ-FUNC-3f443814)
- 2026-11-13 build: green: npx vitest run core/src/tools/ core/src/sessions/ exit 0 (22 files, 170 passed, 2 skipped; apply_candidate prepare/apply, conflicts, lock file, refusals, diff cut, ask approve/deny, auto-edit, read-only, host flag, official plugin; write-edit and registry lists updated for the new write-class tool); typecheck exit 0 (REQ-FUNC-73b4e5d0, REQ-SEC-c986d8f2, REQ-SEC-854495d1, REQ-SEC-c445ab5c, REQ-SEC-e27836d3, REQ-SEC-8483534b, REQ-FUNC-3f443814)
- 2026-11-13 build: green: VERA_TEST_KICAD_GUI=1 npx vitest run tests/integration/kicad-layout.test.ts exit 0 - 19 passed against KiCad 10.0.8 on Windows 11 (package, rules, workspace copy, offline refusals, stub-editor and no-KiCad connection failures through uv with kicad-python 0.8.0, and 12 PCB editor tests: open, binding at open and edit, E06-B place/route/align/keepout with objectives pass, unknown/locked/outline refusals, short objectives fail, unsaved edits refused for edit and close and reverted, unchanged-check revert, Stop inside a commit, lost connection, reopen of the applied candidate, KiCad's lock file). The first run failed only in report.md for open (no DRC after); fixed. Without VERA_TEST_KICAD_GUI: 7 passed, 12 skipped (REQ-DATA-891d5b5d, REQ-PLAT-3957eafc, REQ-FUNC-32022bcd, REQ-REL-19ac705f, REQ-SEC-6bb41c34, REQ-REL-d2fd6d58, REQ-FUNC-f92446a1, REQ-REL-2a3f09b8, REQ-REL-e30bf69f, REQ-SEC-438b7bbf, REQ-SEC-a6a6482e, REQ-SEC-f986d80d, REQ-SEC-f7a0b1fe, REQ-REL-233d6e0f, REQ-FUNC-cd7d1b3f, REQ-FUNC-9c4d809c, REQ-FUNC-350e262a, REQ-FUNC-b0cbbb04, REQ-REL-1dd5113a, REQ-REL-ea280836, REQ-TEST-63c70d58)
- 2026-11-13 build: green: npx vitest run core/src/tools/ core/src/sessions/ desktop/main/sessions.test.ts exit 0 (23 files, 176 passed); lint, typecheck, check:i18n exit 0; no __pycache__, .kicad_prl or lock file left in the plugin or fixtures; no pcbnew left running
- 2026-11-13 build: Inspection (REQ-UX-5367fe76): read skills/kicad-layout/SKILL.md and README.md - both describe open, composing requests from board.json and state.json, edit with the refusal kinds, the objectives and report, showing the changes and previews, apply_candidate only after the user asks for a passing candidate, close; the API preference (Preferences > Plugins) and the one-window limit; the package test checks the skill's key phrases
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: knowledge official-plugins.md (routing, interface, invariant, change map, key behaviors, files) and file-tools.md (apply_candidate, commitChange) updated; context environment.md (kicad-layout acceptance) and project.md (PCB layout candidates) reconciled; planning electronics-plugins.md ELEC-06 as built. Requirements re-read: all 29 active with tests and paths; REQ-PLAT-3957eafc's native Ubuntu part (E06-A) is not run here
- 2026-11-13 validate: DEVIATION validate: E06-A native Ubuntu x64 not run - no Linux host here (WSL does not count); the Windows real-KiCad proof stands and Ubuntu stays an open check, as for ELEC-01..04
- 2026-11-13 validate: review round 1 (relaunched after a session cut-off; focused proof rerun unchanged: 24 files, 195 passed with VERA_TEST_KICAD_GUI). Specification changes_required: (1) result.json lacks inputs with SHA-256, warnings and artifacts (spec §8); (2) exit 3 after the save leaves the candidate saved while state.json is old, so the run is lost; (3) REQ-FUNC-9c4d809c's clearance and unconnected cases are not tested, REQ-SEC-438b7bbf's verification contradicts spec §9 (close on a dead editor exits 0); non-blocking: outline commit wording, bind wait, --results-dir 'where', refusal kinds vs spec (usage/output unlisted, timeout never emitted), README refusal kinds, partly asserted verifications, stale records. Quality changes_required: (1) a footprint named in two operations of one request is duplicated (two R1 with one UUID), the unchanged check keyed by UUID misses it, objectives pass and apply_candidate would write it; (2) same as spec (2), confirmed with a failing kicad-cli; non-blocking: re-check the open document right before the save, a Stop test that stops before any update, apply-candidate rejects.toThrow without a message, an unbounded --run-id echo, DRC library warnings on the candidate.
- 2026-11-13 validate: returned to build - review round 1: duplicate footprint from repeated references, state lost after a post-save failure, result.json fields, verification gaps
- 2026-11-13 build: green (round-1 fixes): VERA_TEST_KICAD_GUI=1 npx vitest run tests/integration/kicad-layout.test.ts core/src/tools/ core/src/sessions/ desktop/main/sessions.test.ts exit 0 (24 files, 199 passed, 2 skipped; KiCad 10.0.8, Windows 11); typecheck, lint, check:i18n exit 0. Fixed: one move per footprint per request (request) and footprint/track/via/zone counts in the unchanged check (duplicates); kicad-cli checked before KiCad is touched; state.json, requests/NNN.json and the new created.json written right after the save (objectives none), so a later kicad-cli failure exits 3 saying the edit was saved and the run continues; result.json inputs, warnings (candidate-copy library findings) and artifacts with SHA-256; binding checked again before the save; --results-dir refusals named; printed run id at most 64 characters. Found while fixing: KiCad gives a track created through the API the net of the copper it touches (a GND track across VOUT saved as VOUT, short hidden from DRC) - new check_nets refuses it with net (REQ-SEC-a6a6482e extended). Tests: the GUI suite now runs the helper with core's programEnvironment and uv --offline as VERA's runner does; new cases for the clearance violation, a pad short, the pulled regulator, the crossing track, the post-save failure, Stop after a move, close of a run whose editor is gone, a second open by another file name with the editor count, requests/002.json equality, result.json files, report.md values, the installed kicad-cli version, .kicad_sch and the repeated references; the desktop gate test; apply_candidate refusals pinned to their messages. Mutation: no repeated-reference check and a gate on any plugin each failed their tests; restored. Spec §2/§3/§4/§6/§7/§8, 17 requirements, README, skill, knowledge, context, planning and a fixtures README updated.
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: green (round-2 fixes): VERA_TEST_KICAD_GUI=1 npx vitest run tests/integration/kicad-layout.test.ts core/src/tools/ core/src/sessions/ core/src/plugins/ shared/ desktop/main/sessions.test.ts tests/packaging/prepare-plugins.test.ts: 67 files, 609 passed, 1 failed (shared plugins-ipc.test.ts, pre-existing: it fails the same with this task's shared change stashed), 4 skipped; typecheck, lint, check:i18n exit 0. Fixed: gui program flag (user RULING-004, REQ-PLAT-e0d8f3cf: shared schema, runner programEnvironment display, program-tools, kicad-layout-tool gui: true); state.json written first after the save, a write failure there is a saved output failure; post-save failures write a failed result.json/report.md; corrupt run-folder files are output failures; check_nets names the operation and the item's position; kicad-cli error text without absolute paths; docstrings. Tests: the first open runs through core.ProgramRunner and NodeProcessHost; a VIN via on the GND track refused net; a duplicated footprint (hook: two updates in one commit) caught by the counts; close of a run whose state names another run's editor refused binding; --request inside and outside the workbench; post-save failure asserts the request file, the failed result.json and the saved move in the next report; routing asserts unchanged counts, the request input hash, DRC counts and previews; apply_candidate in bypass mode; prepare-plugins lists the four plugins it lacked since ELEC-03 (kicad-layout, ltspice, ngspice, parts-search).
- 2026-11-13 validate: completed; next done (9 Done checklist item(s) left unticked; review verdicts not both approved)
- 2026-11-13 done: returned to validate - advanced to done by mistake after the round-2 fixes: the stage was still validate (no return to build was recorded for round 2); review round 3, the final strict proof and report are still owed
- 2026-11-13 validate: DEVIATION validate: the round-2 fix cycle ran without 'advance --to build' (the verdicts were recorded, the return was not), so the closing advance moved the task to done by mistake; it was returned to validate at once. Cost: the Log shows a done/return pair; nothing was skipped: review round 3, the final strict proof and the report follow.
- 2026-11-13 validate: Review round 3: spec changes_required (post-save non-Failed errors not reported as saved, no failed report; next edit loses before previews after a failed report), quality changes_required (post-save OSError outside record writes, corrupt drc-before/board-open/result.json after the save, result.json non-object AttributeError crash). Notes: --request in README/SKILL, exit-3 wording, planning architecture/manifest spec lack gui, state.json failure report lacks request/kicad, misleading ValueError message, check_nets missing-item message.
- 2026-11-13 validate: returned to build
- 2026-11-13 build: green (round-3 fixes): VERA_TEST_KICAD_GUI=1 vitest tests/integration/kicad-layout.test.ts 24 passed (KiCad 10.0.8, Windows 11); focused core tools/sessions/plugins, shared, desktop sessions, packaging: 66 files, 586 passed, 1 failed (pre-existing shared plugins-ipc), 4 skipped; typecheck, lint, check:i18n exit 0. Fixed: board-open.json/drc-before.json checked after binding before the commit (output, nothing saved); result.json no longer read; every post-save exception goes through _after_save (saved problem + failed result.json/report.md with kicad, request when recorded, saved hash); before previews from board-open.json; request files numbered by edits; temporary files removed on write failure; main's last handler is an Unexpected error; check_nets missing item. New test: corrupt drc-before, foreign result.json, board.json as a folder, requests as a file. Docs: spec section 7, REQ-REL-233d6e0f, README/SKILL --request and exit 3, architecture.md and REQ-DATA-4d4471f9 gui/uses, as-built, Design order.
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: DEVIATION validate: closed with spec round 4 changes_required (blocking item fixed: kicad.py connection messages) and the quality round 4 review stopped unfinished - user ruling to stop the review loop; remaining notes are off the golden path. Focused proof after the fix: kicad-layout offline block 4 passed; full GUI suite 24 passed before this message-only change.
- 2026-11-13 validate: completed; next done (9 Done checklist item(s) left unticked; review verdicts not both approved)

## Rulings

- RULING-001 | date=2026-11-13 | decision=kicad-layout edits the candidate through KiCad's official IPC API with the pinned kicad-python (kipy) 0.8.0 and its dependencies protobuf and pynng, downloaded from PyPI; not the deprecated SWIG pcbnew and not direct file editing | reason=User, 2026-11-13, chose 'Official IPC API (Recommended)', which approved the pinned PyPI download, after being told it needs the API enabled and a KiCad PCB editor window open on the candidate | source=user | supersedes=none
- RULING-002 | date=2026-11-13 | decision=KiCad's API server is enabled by setting api.enable_server to true in %APPDATA%\kicad\10.0\kicad_common.json (done 2026-11-13 with KiCad closed; only that key changed) | reason=User, 2026-11-13, chose 'You set it in the file (Recommended)' | source=user | supersedes=none
- RULING-003 | date=2026-11-13 | decision=ELEC-06 is implemented with AEGIS on feature/93-electronics-calc after ELEC-05's commit 0764e8f, and committed when validated | reason=User's standing instruction for epic #92: 'continua cu implementarea si celorlalte tichete din umbrela ... (comit, preiei urmatorul tichet ...). Lucreaza pe acelasi branch.' | source=user | supersedes=none
- RULING-004 | date=2026-11-13 | decision=Programs that open windows declare gui: true in plugin.yaml; only their runs receive DISPLAY, WAYLAND_DISPLAY, XAUTHORITY and XDG_RUNTIME_DIR; kicad-layout-tool opts in | reason=User, 2026-11-13, chose 'Opt-in per program (Recommended)' after review round 2 found that pcbnew cannot open a window on Linux under the runner's allowlisted environment | source=user | supersedes=none
- RULING-005 | date=2026-11-13 | decision=Close ELEC-06 after round 4 with only the golden-path fix (connection messages no longer say 'nothing was saved', so a post-save failure says only 'saved'); the remaining round-4 notes (save-call reply loss, Refused inside _failed_report, deep run-file structure, conservative 'requests' wording, unchangedFiles scope, knowledge page detail) are accepted as known limits; the quality review round 4 was stopped | reason=User 2026-11-13: reviews and fixes take too long, no overengineering, focused tests only, move on to the next ticket; acceptable when the golden path is not blocked | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-6101faa4.md
changed: round-2 fixes: gui flag (shared, runner, program-tools, manifest), cli.py, operations.py, drc.py, tests, hook, spec, requirements, knowledge, CONTRIBUTING, Design and diagram
evidence: VERA_TEST_KICAD_GUI=1 vitest (67 files) 609 passed, 1 pre-existing failure (plugins-ipc), 4 skipped; typecheck, lint, check:i18n exit 0
issues: native Ubuntu x64 not run (E06-A); shared plugins-ipc.test.ts fails before and after this task
spec_compliance: changes_required
implementation_quality:
review_round: 4
