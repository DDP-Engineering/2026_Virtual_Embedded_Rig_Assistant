# TASK-6ca805fc - Wireshark Dumpcap bounded local capture (#332)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-05a80354, REQ-SEC-d4a52a4c, REQ-PLAT-818d0210, REQ-SEC-b3e2a49f, REQ-REL-2cf31772, REQ-DATA-f244eef4, REQ-FUNC-bb9e10e7, REQ-SEC-493d564f
parent:
branch: master
base: b16d027a81e2d8ff109e938988276677557f8440
opened: 2026-11-25

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

Problem: STATED #332 calls for managed acquisition of local capture evidence.
Desired outcome: STATED an optional official Dumpcap plugin acquires bounded short or rolling PCAPNG and hands retained evidence to ordinary Wireshark analysis.
Actors: STATED session owner and approving operator, VERA host, installed Dumpcap and saved-capture workbench analysis.
Primary scenario: STATED discover an available local interface, explicitly select it and approve a bounded capture, query status or Stop, then analyze a retained segment.
Examples: STATED capture synthetic UDP on an isolated lab loopback with a UDP filter and finite duration/bytes.
Counterexamples: STATED remote capture, extcap, arbitrary interface arguments and traffic transmission by VERA are excluded.
In scope: STATED discovery and diagnostics, approval and process ownership, short and rolling capture, Stop/status/expiry, retained segment verification, manifest timestamps, limits, version and available counters.
Out of scope: STATED #403 adapters and media, driver installation, other tickets, publication.
Constraints: STATED autopilot on shared master, no stage/commit/push; #391 and existing untracked paths are reserved. Ubuntu native and full suites are deferred to final verification. Windows live requires Npcap or an explicit deferral.
Success signals: STATED readable captures and manifests, exact shared references, bounded storage, retention, owned Stop and distinct startup, unavailable-interface and permission diagnostics.
Evidence: OBSERVED Gitea #332, package 332-wireshark-dumpcap.md, official capture and runner knowledge, and master HEAD b16d027a81e2d8ff109e938988276677557f8440.
Assumptions: INFERRED stable host option limits and failure codes can be chosen within the scoped bounded implementation; current saved-capture storage remains authoritative.
Unknowns: UNKNOWN native Windows live acceptance without Npcap. The coordinator is handling the deferral decision; development can continue independently.
Decision-blocking questions: None for implementation. Windows live proof can block validate under the explicit instruction.
Proposed behaviors: Reuse the exact program approval, session workbench lifecycle and verified format-1 capture references. Make undisclosed counters and incomplete last segments explicit.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| STATED Discovery | REQ-FUNC-05a80354 | Discovery | Use the Windows and Linux interface probes and provider fixture to check installed versions, explicit loopback, and rejection of pseudo and external sources. |
| STATED Approval | REQ-SEC-d4a52a4c | Approval | Drive the actual approval gate in automatic and ordinary modes; verify refusal, approval digest binding and no acquisition before approval. |
| STATED Diagnostics | REQ-PLAT-818d0210 | Diagnostics | Exercise simulated missing program, driver, permission, interface, syntax and startup errors; verify the native Windows prerequisite diagnostic. |
| STATED Ownership | REQ-SEC-b3e2a49f | Ownership | Start a stand-in capture and check foreign status and Stop leave its process alive; stop the owner and observe the matching process end. |
| STATED Bounds | REQ-REL-2cf31772 | Bounds | Assert compiled native and runner limits at their boundaries and observe deadline and volume expiry with stand-ins and bounded loopback proof. |
| STATED Finalization | REQ-DATA-f244eef4 | Finalization | Feed completed and partial ring files; verify retention, omission of unfinalized files, measured and unknown loss, exact digests and reopening through saved-capture analysis. |
| STATED Lifecycle | REQ-FUNC-bb9e10e7 | Lifecycle | Check running, stopped, expired and failed states and idempotent terminal Stop with runner stand-ins. |
| STATED Input boundary | REQ-SEC-493d564f | Input boundary | Submit a missing, aggregate or remote interface and unsafe or invalid filter, then assert acquisition never starts. |

## Design

**Approach**

- REQ-FUNC-05a80354 / REQ-SEC-493d564f: find-only official plugin with raw Dumpcap blocked. The typed tool intersects Linux interface discovery with the current kernel network device list and accepts only Npcap local device names on Windows. Every selection is rechecked before starting.
- REQ-SEC-d4a52a4c: the existing program approval displays and binds the interface, BPF filter and effective limits, with an explicit-user flag enforced even in automatic modes. Perform native filter compilation after approval. Propagate the turn signal through foreground capture and allow a rolling capture to stay live under its owning session.
- REQ-REL-2cf31772: use native time/size/packet stops and a runner backstop. For rolling, set per-file size/time/packet rotation, finite total files from conservative cumulative byte accounting, and a native ring with a spare slot for the active segment. Use a fixed snapshot length and reserve space for its last packet and file metadata.
- REQ-DATA-f244eef4: use Dumpcap close receipts with strict PCAPNG indexing and exact format-1 references. Keep most recent finalized segments and declare dropped, overwritten and potentially partial data. Publish the manifest and files together through existing managed capture storage.
- REQ-DATA-f244eef4: the last attempted member requires a clean native exit because terminal close can write a receipt even on failure. Earlier receipts remain valid when a successor was attempted and could not open.
- REQ-DATA-f244eef4 / REQ-REL-2cf31772: reserve managed file slots and bytes on the shared write queue before the capture starts, including one manifest slot. Ordinary publishers honor that reservation until the live run settles.
- REQ-SEC-493d564f / REQ-PLAT-818d0210: the runner verifies a private profile directory inside managed storage, and native compilation needs BPF stdout as well as a successful exit. Known input failures and unavailable drop statistics stay explicit even when Dumpcap exits zero.

**Interfaces and data**

- REQ-FUNC-bb9e10e7 / REQ-SEC-b3e2a49f: `wireshark_dumpcap_start` is a prepared program tool. `wireshark_dumpcap` discovers, checks status and stops by opaque capture ID. `LiveCaptureSessions` scopes every handle to its owning session and waits on lifecycle shutdown. Runs can also stop the owned child.
- REQ-PLAT-818d0210: return a fixed error taxonomy for startup, missing tool or driver, permission, disappeared interface and compile or process failure. Do not surface arbitrary native diagnostics in the model result.

**Files and test seams**

- `wireshark-live.ts` holds schemas and budget constants. `live-native.ts`, `live-session.ts` and `live-evidence.ts` cover the native command boundary, lifecycle and publication respectively. The typed tools connect to SessionService, CLI and Desktop.
- Provider/runner fixtures cover the requirements. Native isolated loopback and Windows prerequisite probes are independent of the stand-ins.

**Risks and open decisions**

- Native Windows live proof awaits Npcap or a coordinator ruling. On a force-stop the last segment is incomplete unless the native process cleanly exits and finalization is verifiable. Linux WSL2 proof does not replace native Ubuntu acceptance.

**Requirement map**

- The design entries above name every requirement. The requirement coverage table identifies each affected test seam.

Diagrams: [diagram_TASK-6ca805fc.md](diagram_TASK-6ca805fc.md).

## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify
- 2026-11-25 specify: completed; next design
- 2026-11-25 design: completed; next build
- 2026-11-25 build: red: vitest run src/libraries/shared/src/tools.test.ts exit 1 - provider tools absent (REQ-FUNC-05a80354)
- 2026-11-25 build: Windows native 4.6.10 --version exit 0 and -D -M exit 2: missing Npcap (wpcap.dll); original reports in test-outputs/332.
- 2026-11-25 build: The coordinator confirmed operator-installed Npcap is now available. Windows native inventory lists the loopback device; live Windows verification remains deferred by RULING-003.
- 2026-11-25 build: red: focused Windows run exposed foreign Stop escaping its structured response. The WSL2 run exposed unparsed native friendly-label drop counters; both were corrected.
- 2026-11-25 build: green: Windows Vitest focused 7 files, 89 passed, 1 live case deferred; separate #401 Windows native TShark replay and pack pair 2 passed; Windows SessionService replay focused 10 passed.
- 2026-11-25 build: WSL2 proof: isolated loopback, unprivileged mapped UID 1000, real Dumpcap/TShark 4.2.2; saved short and two retained rolling PCAPNGs, matching managed references and UDP query oracle.
- 2026-11-25 build: DEVIATION build: the full failure matrix followed the shared provider test-first increment - retained evidence includes the provider red and the subsequent focused and real-tool regressions.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Focused Windows final run 92 passed and 1 Windows live deferred; real offline #401 Windows selected pack and replay tests 2 passed. WSL2 run exit 0, native short 27 packets and rolling 54 packets with two retained segments, two rotated out, and measured zero drops. Original logs, manifest and synthetic PCAPNGs retained.
- 2026-11-25 validate: DEVIATION validate: native Windows and Ubuntu live acceptance and the complete suites move to final verification under RULING-001 and RULING-003. Native Windows discovery passes, and WSL2 is separate evidence.
- 2026-11-25 validate: Review round 1: require positive filter compilation and private cwd; recognize native exit-0 failures and unavailable stats; retain verified close receipts across failed rotation; distinguish ambiguous native expiry and reserve managed capacity before capture.
- 2026-11-25 validate: returned to build - Correct the recorded independent review findings and regression coverage
- 2026-11-25 build: red: focused review regressions exit 1, 8 failures for acquisition cwd, exit-0 filter failure/permission/link state, exhausted capacity, rolling successor failure, native failure/loss and ambiguous expiry.
- 2026-11-25 build: green: round-1 review fixes passed targeted Windows Vitest, 153 passed and 1 Windows live case deferred. Added explicit regression proof for eight red cases plus runner and shared quota boundaries.
- 2026-11-25 build: WSL2 focused rerun after review corrections: real Dumpcap/TShark 4.2.2 short capture, rolling two retained segments and Stop, measured zero drops; hashes and exact managed references verified by the offline query.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Review round 2: quality approved. Specification requires distinguishing the last current member on a native output/close error from earlier positively finalized receipts and classifying recognized interface detachment.
- 2026-11-25 validate: returned to build - Correct the last attempted segment on failed native close and exercise the adverse case
- 2026-11-25 build: red: focused round-2 regression exits 1 because a structurally valid prefix of a failed terminal close was published as finalized.
- 2026-11-25 build: green: round-3 Windows focused live-session.test.ts exit 0, 21 passed. WSL2 native loopback rerun exit 0 after the terminal close change; short and rolling files were reopened with TShark.
- 2026-11-25 build: Scoped advisory shows 0 errors and no uncovered source. Layout exceptions are the required changelog/release notes and preserved pre-existing bundled-plugin archives; global historical warnings remain outside this ticket.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Round 3 independent specification and implementation quality approved the entire unstaged 61-path candidate against b16d027a81e2d8ff109e938988276677557f8440.
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-6ca805fc --strict --run exit 0; lint, typecheck, i18n and help passed. Release-notes check exit 0 separately. Advisory baseline and required layout warnings remain; no ticket source coverage gap. Native Windows and Ubuntu live acceptance and full suites are deferred per RULING-001 and RULING-003.
- 2026-11-25 validate: Handover inspection: 61 owned paths against exact recorded HEAD, empty index, preserved journal #391 hash and both pre-existing untracked paths. Original WSL2 short/rolling PCAPNG byte counts and SHA-256 match their manifests.
- 2026-11-25 validate: The delivery report is a pre-close snapshot. The final checklist is complete. Its wider diff includes 11 unrelated pre-existing untracked paths, excluded from owned-files.txt. The environment context now crosses the advisory size threshold with the opt-in proof controls.
- 2026-11-25 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-25 | decision=Native Ubuntu acceptance and full suites are owned by final verification | reason=The user will start final verification separately; WSL2 is distinct evidence | source=user | supersedes=none
- RULING-002 | date=2026-11-25 | decision=Implement #332 only in autopilot on shared master and hand back unstaged and uncommitted | reason=The coordinator alone is authorized to verify and make the local ticket commit and handle Gitea | source=user | supersedes=none
- RULING-003 | date=2026-11-25 | decision=Defer native Windows live capture acceptance to final verification | reason=The user asked the coordinator to move the live proof; the installed native Dumpcap reports missing Npcap and the driver stays untouched | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-6ca805fc.md
changed: 61 owned paths, optional Dumpcap plugin and bounded local capture
evidence: AEGIS strict --run exit 0, both reviews approved in round 3, focused Windows and real WSL2 evidence passed
issues: Native Windows and Ubuntu live acceptance and full suites deferred to final verification by user ruling
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-25)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-05a80354 - Discover installed Dumpcap and local observation points
  - REQ-SEC-d4a52a4c - Require explicit approval for bounded live capture
  - REQ-PLAT-818d0210 - Distinguish live capture prerequisites and native failures
  - REQ-SEC-b3e2a49f - Confine live capture to its owning session
  - REQ-REL-2cf31772 - Bound live capture duration and cumulative volume
  - REQ-DATA-f244eef4 - Publish retained finalized captures with loss provenance
  - REQ-FUNC-bb9e10e7 - Expose live capture status and owned Stop
  - REQ-SEC-493d564f - Reject unavailable interfaces and invalid capture filters
- deviations: 2 recorded
  - build: the full failure matrix followed the shared provider test-first increment - retained evidence includes the provider red and the subsequent focused and real-tool regressions.
  - validate: native Windows and Ubuntu live acceptance and the complete suites move to final verification under RULING-001 and RULING-003. Native Windows discovery passes, and WSL2 is separate evidence.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base b16d027: 72 file(s) changed, 2925 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=53 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
