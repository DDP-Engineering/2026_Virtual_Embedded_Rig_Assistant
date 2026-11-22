# TASK-ba5d7e4c - Release smoke: automated Windows egress proof with pktmon (#371)

stage: done
type: feature
interaction: autopilot
requirements: REQ-TEST-f84d343e, REQ-TEST-b111844b, REQ-TEST-803bb75d
parent:
branch: feature/370-371-release
base: 41c7baf01da77c10961c1aa8f0a17b4e45d65035
opened: 2026-11-21

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

Problem: On Windows the release smoke's network egress proof is manual (Sandbox + pktmon + hand-written evidence JSON); without `--windows-evidence` the smoke reports it pending and exits 2 (STATED Gitea #371; OBSERVED `smoke-report.mjs` windowsEvidence, `smoke-package.mjs` egressStatus, `06_SoftwareDocu/release-package-smoke.md`).
Desired outcome: On an elevated Windows shell, `npm run smoke:package -- --artifact <installer>` captures each scripted launch with pktmon, rejects destinations outside the run's allow-list (the Linux oracle: none offline, exact loopback server port scripted), writes the evidence JSON and keeps the raw capture; without elevation the proof stays pending with a clear message and the exit code is unchanged (STATED #371 Done when).
Actors: release maintainer running the smoke on Windows.
Primary scenario: elevated shell -> each launch runs inside `pktmon start --capture --trace --provider Microsoft-Windows-Kernel-Network ...`; after exit `pktmon stop`, `pktmon etl2txt` (raw text) and `tracerpt -of XML` (socket events with PID, saddr/sport, daddr/dport); events of the VERA process tree are compared with the allow-list; the smoke writes `windows-evidence.json` bound to the artifact and capture SHA-256.
Examples: scripted run with the fake model endpoint on 127.0.0.1:<port>: only loopback events with that port -> PASS. A VERA process connecting to 93.184.215.14:443 -> FAIL naming `93.184.215.14:443` and the PID.
Counterexamples: traffic of processes outside VERA's tree in the same window is not VERA's egress (STATED #371 limits: host-wide capture must be told apart by PID).
In scope: steps 1-3 and 5 of #371 (capture around the scripted launches, parser, evidence JSON, docs). 
Out of scope: step 4 (Windows Sandbox automation) is optional in #371 and Sandbox is unavailable on this workstation (STATED #371 limits; OBSERVED release-package-smoke.md Smart App Control/Hyper-V note); clean-machine/VC++ checks stay deferred (OBSERVED doc).
Constraints: pktmon needs elevation (OBSERVED `pktmon status` -> Access is denied, exit 5 in this non-elevated shell); PowerShell here is Constrained Language mode (OBSERVED); no backward-compat code (memory rule).
Success signals: unit tests of the event parser and egress oracle with a recorded sample; harness test that a non-elevated Windows run stays pending with unchanged exit code; an elevated end-to-end run producing PASS and a planted outside connection producing FAIL.
Evidence: #371 body; smoke-*.mjs read; proc-sniffer (github.com/xiao77mwq/proc-sniffer, proc_sniffer.py) uses exactly this pktmon + Kernel-Network + tracerpt approach and reads EventData `PID`, `saddr`, `sport`, `daddr`, `dport` (OBSERVED via fetched source).
Assumptions: Kernel-Network events cover loopback sockets and carry the sending PID (INFERRED from proc-sniffer's PID matching; not seen here). pktmon accepts several `--provider` options so Kernel-Process start events can give the process tree (INFERRED from pktmon docs).
Unknowns: exact tracerpt XML rendering of these events on this Windows build (no recorded sample: no elevation here); whether failed TCP connects produce a Kernel-Network event with the destination.
Decision-blocking questions: Can the user record a real pktmon sample in an elevated PowerShell (and later run the smoke elevated)? Without it the parser rests on an unverified format and Done-when 1, 2 and 4 cannot be shown here.
Proposed behaviors: (not accepted) attribute events by the VERA process tree from Kernel-Process start events rooted at the launched PID; treat every Kernel-Network event of that tree whose endpoints are not the allowed loopback pair as a forbidden destination; evidence `networking: "Enabled"` with `method: "pktmon-host"` accepted by windowsEvidence alongside the manual Sandbox form.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| elevated Windows run collects each launch's events and rejects destinations the tree sends to outside the allow-list; empty or unconvertible capture fails | REQ-TEST-803bb75d (new) | smoke-windows.mjs capture + parseKernelEvents + checkWindowsEgress, wired in launchObserved |
| report binds automated or manual Windows status; non-elevated stays pending with the elevation reason; evidence JSON accepted by --windows-evidence | REQ-TEST-b111844b (revised) | windowsEvidence accepts method pktmon, smoke-package writes windows-evidence.json and windows-capture.json |
| Linux strace oracle | REQ-TEST-f84d343e | no design impact (unchanged; shares exactLoopback and the result shape) |

## Design

**Approach.** Per launch on an elevated Windows host (`pktmon status` not exit 5): `pktmon start --trace --provider Microsoft-Windows-Kernel-Network --provider Microsoft-Windows-Kernel-Process --keywords 0x10 --file-name <label>.pktmon.etl` before the launch (events only, RULING-002); after its exit the harness makes one sentinel loopback connection from its own process, then `pktmon stop`, `pktmon etl2txt` (raw text kept) and `tracerpt -of XML -y` (parsed). The recorded sample (OBSERVED) shows Kernel-Network events with EventData `PID`, `saddr`, `sport`, `daddr`, `dport` (space-padded decimals) and Kernel-Process start events (ID 1) with `ProcessID`, `ParentProcessID`. The launched PID plus its descendants is VERA's tree; every destination the tree sends to (daddr:dport of its outbound events) must be the allowed exact loopback address and port (none offline), otherwise it is a forbidden destination naming address, port and PID; connections the tree accepted from loopback clients (Playwright's inspector and DevTools) and received UDP are inbound and not judged, as with strace (REQ-TEST-803bb75d). Rejected: etl2txt text (its socket lines are localized sentences), packet-only parsing (no PID), a Sandbox run (unavailable here, optional in #371).

**Interfaces and data.** `pktmonUnavailable(run)` -> reason or undefined; `startCapture/stopCapture(paths, run)`; `parseKernelEvents(xml)` -> `{ processes, network }`; `checkWindowsEgress(xml, rootPid, allowed, sentinel)` -> `{ status, calls, destinations, errors, allowed }` like `checkEgress`; errors also for a missing root start event, a missing sentinel event (monitor evidence absent) and tree events without addresses. `windowsEvidence(proof, sha, reason)` accepts `networking: "Disabled"` (manual Sandbox) or `method: "pktmon"` with `networking: "Enabled"`; the pending reason names the elevation need. The automated evidence (`windows-evidence.json`) has artifactSHA256, status, method, networking, operator, observedAt, observations and capture = `windows-capture.json` (each launch's ETL/text/XML identity and egress result) with its SHA-256 (REQ-TEST-b111844b).

**Files and test seams.** new `tests/packaging/smoke/smoke-windows.mjs`; `smoke-runtime.mjs` (launchObserved capture), `smoke-package.mjs` (decision, evidence), `smoke-report.mjs` (windowsEvidence); fixture `tests/fixtures/pktmon/kernel-events.xml` (recorded, anonymized); tests in a new `tests/packaging/windows-egress.test.ts`. Docs: `06_SoftwareDocu/release-package-smoke.md`, `00_Planning/Delivery.md`.

**Risks and open decisions.** No IPv6 sample: IPv6 loopback is `::1` by assumption. A TCP connect that never opens may log no addressed event, so a refused attempt can go unseen; DNS lookups run in the DNS Client service outside the tree (both documented). pktmon is host-global: a capture already running makes start fail with its message. The elevated end-to-end smoke run is the user's step on this workstation.

**Requirement map.** REQ-TEST-803bb75d: capture, parser, oracle, wiring. REQ-TEST-b111844b: evidence JSON, windowsEvidence, pending reason. REQ-TEST-f84d343e: no design impact.

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: OBSERVED: pktmon start help (no elevation needed) - --provider repeats, --keywords applies to the corresponding provider; pktmon status without elevation -> Access is denied (exit 5). Recorder prepared at D:\Temp\vera-pktmon-sample\record.ps1
- 2026-11-21 frame: completed; next specify - scope recorded (autopilot); elevation question answered by the user (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: vitest tests/packaging/windows-egress.test.ts exit 1 - smoke-windows.mjs missing (REQ-TEST-803bb75d, REQ-TEST-b111844b)
- 2026-11-21 build: green: vitest tests/packaging/windows-egress.test.ts tests/packaging/package-smoke.test.ts exit 0 (19 passed) over the recorded capture (REQ-TEST-803bb75d, REQ-TEST-b111844b)
- 2026-11-21 build: observed: non-elevated smoke on VERA-0.2.0-win-x64.zip records manual.windows pending with the elevation reason; the run itself fails at the first launch because 0.2.0 rejects the settings this branch's harness seeds (exit 1 without detail) - the smoke needs an artifact of the same source
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 1: both changes_required - Playwright inspector/CDP connections accepted by the root would fail every launch (count only connections the tree opens); full-packet capture makes the XML ~10 MB/s (trace providers only); evidence written before the last capture stops; failed-launch path can leave pktmon running; DNS lookups by the DNS Client service are outside the tree (document); conversion-failure test; stale spec lines
- 2026-11-21 validate: returned to build - review round 1 findings
- 2026-11-21 build: green: round-1 fixes - vitest windows-egress + package-smoke exit 0 (20 passed); accepted-connection case fails under the old oracle
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 2: spec approved, quality approved with two low findings, fixed: accepted connections count as inbound only with both ends loopback (LAN accept judged, tested); failure evidence written only when the run threw. vitest windows-egress + package-smoke exit 0 (20 passed)
- 2026-11-21 validate: final: aegis check --task TASK-ba5d7e4c --strict --run exit 1; lint, check:i18n, check:help exit 0; typecheck exit 2 only in untouched files (worktree node_modules links @vera/* to the main checkout), 0 errors in tests/packaging and smoke files (tsc -b output filtered); focused vitest windows-egress + package-smoke 20 passed
- 2026-11-21 validate: DEVIATION validate: no elevated end-to-end smoke run - needs a package built from this branch and an administrator shell; the oracle is proven on a real recorded capture (planted outside connection named with its PID) and the non-elevated pending reason was observed live
- 2026-11-21 validate: DEVIATION validate: typecheck of the strict proof cannot pass in this worktree - covered by tsc filtered to the changed files (0 errors)
- 2026-11-21 validate: completed; next done
- 2026-11-21 done: observed: non-elevated smoke:package on this branch's VERA-0.2.0-win-x64.zip (built with 68500628) - all four runs PASS, egress pending with the elevation reason, exit 2

## Rulings

- RULING-001 | date=2026-11-21 | decision=The user records a real pktmon sample in an elevated PowerShell (D:\Temp\vera-pktmon-sample\record.ps1); the parser and oracle are built on it | reason=User answer 2026-11-21: I'll run it now | source=user | supersedes=none
- RULING-002 | date=2026-11-21 | decision=Capture only the Kernel-Network and Kernel-Process event providers (pktmon start --trace), no packet capture and no pktmon filter change | reason=The oracle reads socket events only; full packets make the XML ~10 MB per second on a busy host (unreadable after about a minute) and put other applications' payloads into the evidence. Deviates from #371's --capture --pkt-size 0. | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ba5d7e4c.md
changed: smoke-windows.mjs (pktmon event capture, tracerpt parser, outbound tree oracle, evidence); runtime/package wiring; windowsEvidence automated form; recorded fixture; docs, spec, knowledge
evidence: vitest windows-egress + package-smoke exit 0 (20 passed); review round 4 approved/approved; check --strict --run: lint/i18n/help exit 0, typecheck exit 2 only in untouched files
issues: elevated end-to-end smoke not run (needs a package of this branch and an admin shell); Sandbox automation (optional step 4) not built
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: feature/370-371-release
- requirements:
  - REQ-TEST-f84d343e - Reject unexpected process-tree network destinations
  - REQ-TEST-b111844b - Bind smoke and upgrade-proof outcomes to immutable artifacts
  - REQ-TEST-803bb75d - Reject unexpected Windows network destinations with pktmon
- deviations: 2 recorded
  - validate: no elevated end-to-end smoke run - needs a package built from this branch and an administrator shell; the oracle is proven on a real recorded capture (planted outside connection named with its PID) and the non-elevated pending reason was observed live
  - validate: typecheck of the strict proof cannot pass in this worktree - covered by tsc filtered to the changed files (0 errors)
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 41c7baf: 13 file(s) changed, 2305 line(s) added
- checks: errors=0 warnings=28 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
