# TASK-ea176ded - Offline Automotive Ethernet profiles for DoIP, SOME/IP and Service Discovery (#214)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-1610ba78, REQ-FUNC-56598fdc, REQ-REL-dd6f4b62, REQ-REL-1835b16c
parent:
branch: master
base: ce960075cec01b1b96bd0812da5bd43537f587ff
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

Problem: OBSERVED #401/#402 provide generic capture and traffic evidence; the typed operation has no Automotive Ethernet profile.
Desired outcome: STATED #214 requests offline DoIP, SOME/IP and Service Discovery with directional transport and exact, bounded PDU evidence.
Actors: STATED embedded engineers examining a saved capture and downstream interpretation by E2E, gateway correlation and supported FlexRay readers.
Primary scenario: STATED select a saved capture and profile, declare VLAN, addresses, ports or Decode As and get conversations and cited PDUs with coverage.
Examples: STATED segmented traffic. INFERRED a DoIP TCP reassembly and SOME/IP-TP completion cite their native contributor frames.
Counterexamples: STATED no live capture, active diagnostic clients, network configuration, secret extraction or vulnerability testing.
In scope: STATED #214 protocol metadata and explicit profile/version, upstream reassembly, exact references, encapsulation, capture drops, truncation, observation points and timestamp quality.
Out of scope: STATED downstream protocol implementations and acquisition belong to their own tickets.
Constraints: STATED shared master, candidate only, preserve unrelated untracked paths and #391 journal. OBSERVED base ce960075cec01b1b96bd0812da5bd43537f587ff before edits. STATED #401 bounds and #334 references apply.
Success signals: STATED independent fixtures and authorized offline samples reconcile protocol, transport and evidence on native Windows, with limits exercised and final native Ubuntu acceptance deferred by user ruling.
Evidence: OBSERVED Gitea #214, the #401/#402 plans, typed Wireshark service and Windows TShark 4.6.10 native field catalog.
Assumptions: INFERRED model evidence can follow the existing tool's payload-local policy and use locators and lengths for payload metadata.
Unknowns: UNKNOWN whether the available upstream protocol samples were captured from physical ECUs.
Decision-blocking questions: None.
Proposed behaviors: Apply the accepted work package and existing saved-capture contract.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| STATED profile selection and declared scope | REQ-FUNC-1610ba78 | Typed input and effective analysis |
| STATED native metadata, directional conversations and exact citations | REQ-FUNC-56598fdc | Ordered PDML, traffic facts and shared references |
| STATED coverage and limits | REQ-REL-dd6f4b62 | Scan facts and bounded pages |
| STATED unavailable dissection | REQ-REL-1835b16c | Typed errors at the native boundary |

## Design

**Approach**  
OBSERVED `readTrafficFacts` provides stable frame context and #402 endpoint helpers.
`analyzeAutomotive` will reuse those with a bounded PDML pass from `OfflineTshark`.
OBSERVED the ordered native tree retains PDU boundaries and SD entries even when several
occur in one frame. Both passes will use the same bounded prefix and native preferences.

**Interfaces and data**  
STATED REQ-FUNC-1610ba78: use the existing typed tool and saved source with profile-specific
port defaults, declared selectors and cursor identity. REQ-FUNC-56598fdc: project numeric
native fields, protocol occurrences and frame citations with transport and observation context.
Raw payload stays in the existing capture viewer. REQ-REL-dd6f4b62: report native reassembly,
capture limitations and row bounds. REQ-REL-1835b16c: classify native failure and size errors.

**Files and test seams**  
The shared contract and service add dispatch and provenance. Automotive modules select
scope, project the native tree and assemble paged evidence. Model output masks endpoints
while preserving citation identity. Plugin replay covers the public dispatch and citations.
Independent fixture generation and upstream samples exercise the real executable.

**Risks and open decisions**  
INFERRED native reassembly can combine sources outside the selected observation context.
Keep upstream contributor frames and mark mismatched or unknown observation context.
OBSERVED upstream sample captures are available. Physical hardware provenance is unknown.

**Requirement map**  
REQ-FUNC-1610ba78 uses input validation and saved selection. REQ-FUNC-56598fdc uses ordered
PDML and shared citations. REQ-REL-dd6f4b62 uses scan metadata and evidence page bounds.
REQ-REL-1835b16c uses typed native failure paths.

Diagrams: [diagram_TASK-ea176ded.md](diagram_TASK-ea176ded.md).

## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-25 build: red: pinned vitest run tests/plugins/wireshark-tshark.test.ts -t projects offline Automotive Ethernet exit 1; existing dispatch rejects the unimplemented operation (all four requirements); test-outputs/214/red.log
- 2026-11-25 build: Focused plugin file uncovered a pre-existing stale generic TShark skill-text assertion: at the recorded base the installed skill already uses typed commands. Updated the assertion in the touched plugin test; generic program/risk checks remain.
- 2026-11-25 build: green: pinned vitest run of the Wireshark plugin file, Automotive/native traffic boundary files and core/desktop Wireshark consumers exit 0, 20 passed and 2 existing mutually gated skips; test-outputs/214/windows-focused-final.log. Direct TShark 4.6.10 native fields and three authorized upstream samples in native-oracle.log.
- 2026-11-25 build: Focused import-boundaries tests exit 0 (17 passed); release-note validation exit 0. The readiness timestamp heuristic warns after the base lockfile change; npm ls --depth=0 exit 0 confirms the installed pinned tool and affected package versions. AEGIS advisory reports existing repository metadata warnings and layout/heuristic findings on fixture, test, package text, and changelog paths; zero errors.
- 2026-11-25 build: DEVIATION validate: native Ubuntu acceptance and complete suites deferred to user-started final verification per RULING-001. Native Windows evidence includes independent synthetic traffic and published SOME/IP protocol samples; no physical ECU provenance was available.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Round 1 review: both reviewers reproduced a complete TCP PDU hiding its pending suffix. Quality also reproduced address/port selectors silently omitting noninitial IP fragments. The implementer noted the new fixture generator belongs under tests/support per AGENTS.md. Correct these findings, then review both roles again.
- 2026-11-25 validate: returned to build - Correct independently confirmed TCP coverage and fragment scope omissions, and put the new fixture generator under tests/support
- 2026-11-25 build: red: focused Windows Automotive Ethernet replay exit 1 after adding the round 1 regression fixture; fully read two-frame capture incorrectly reports matchedInScope=1 and partial=false. Original proof is test-outputs/214/review-regression-red.log.
- 2026-11-25 build: green: Windows pinned vitest Automotive Ethernet replay and native boundary selections exit 0, 6 passed, including the new TCP suffix and unknown-port IP fragment regression, plus all three upstream samples; test-outputs/214/windows-review-focused.log and native-coverage-oracle.log. Fixture generator located under tests/support.
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: Round 2: specification approved. Quality verified both prior fixes and reproduced false-complete scoped coverage when native TCP reassembly spans different VLANs and completion is outside the selected context. Tighten contributor credit to compatible observation contexts and add regression.
- 2026-11-25 validate: returned to build - Correct native TCP contributor coverage across different observation contexts
- 2026-11-25 build: red: focused Windows Automotive Ethernet replay exit 1 with mixed-VLAN fixture; VLAN 42 input returns no rows and incorrectly reports partial=false. Test and native fields retained in test-outputs/214/mixed-vlan-red.log and native-mixed-vlan-oracle.log.
- 2026-11-25 build: green: pinned vitest Windows Automotive Ethernet replay and native boundary selections exit 0, 6 passed. VLAN-scoped TCP stays incomplete when native completion belongs to another observation context. See windows-mixed-vlan-focused.log and native-mixed-vlan-oracle.log.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Round 3: quality approved the TCP fix. Specification review reproduced the corresponding SOME/IP-TP issue: a fragment can retain a native forward link to a mixed-context completion while scoped coverage is falsely complete. Validate the forward relationship and complete contributor context explicitly.
- 2026-11-25 validate: returned to build - Check forward SOME/IP-TP completion context and extend the cross-VLAN regression
- 2026-11-25 build: red: focused Windows Automotive Ethernet replay exit 1 after adding the scoped SOME/IP-TP regression, with partial=false for a fragment on VLAN 42 pointing to completion on VLAN 43. Original logs mixed-tp-red.log and native-mixed-vlan-oracle.log.
- 2026-11-25 build: green: pinned Windows Automotive Ethernet replay and native boundary tests exit 0, 6 passed. Scoped SOME/IP-TP now preserves the native completion link and cites the corroborated completion, with partial coverage for mixed context. Original latest logs: windows-reassembly-focused.log and native-mixed-vlan-oracle.log.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Round 4: independent specification compliance and implementation quality reviewers approved the complete tracked and untracked candidate against ce960075cec01b1b96bd0812da5bd43537f587ff, including mixed TCP and SOME/IP-TP observation context and the original focused Windows evidence.
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-ea176ded --strict --run exit 0; lint, typecheck, i18n and help completed. AEGIS reported 0 errors and 63 advisory warnings from existing repository context and untracked files, layout patterns for package metadata, fixtures and changelog, and other unchanged traceability heuristics. Pinned release-note validation and import-boundary tests separately passed. Original proofs: aegis-strict.log, release-notes.log, import-boundaries.log, windows-reassembly-focused.log.
- 2026-11-25 validate: Handover: the report snapshot preceded ticking the completed validation checklist and its overall diff includes preserved pre-existing untracked files. The verified ticket ownership manifest lists exactly 40 paths in 05_Software/test-outputs/214/owned-files.txt. The index and task #391 journal match the recorded base; both pre-existing untracked paths remain. See handover-state.log.
- 2026-11-25 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-25 | decision=Defer native Ubuntu acceptance and complete suites to the user-started final verification | reason=Run ticket-focused native Windows checks now; WSL2, if used, is separate evidence | source=user | supersedes=none
- RULING-002 | date=2026-11-25 | decision=Hand over the validated unstaged candidate on master and authorize the coordinator to make the local commit | reason=The coordinator verifies and commits locally before closing Gitea #214; the implementation chat does not commit or publish | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ea176ded.md
changed: Delivered the unstaged, uncommitted #214 candidate on master for the coordinator
evidence: Native Windows focused tests and upstream samples passed; 17 import checks; release notes and AEGIS strict exit 0
issues: Physical ECU provenance unspecified; native Ubuntu and complete suites remain with user-started final verification
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-25)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-1610ba78 - Select offline Automotive Ethernet profiles
  - REQ-FUNC-56598fdc - Project native Automotive Ethernet PDU evidence
  - REQ-REL-dd6f4b62 - Report bounded Automotive Ethernet observation coverage
  - REQ-REL-1835b16c - Reject unavailable Automotive Ethernet dissection explicitly
- deviations: 1 recorded
  - validate: native Ubuntu acceptance and complete suites deferred to user-started final verification per RULING-001. Native Windows evidence includes independent synthetic traffic and published SOME/IP protocol samples; no physical ECU provenance was available.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base ce96007: 51 file(s) changed, 2332 line(s) added; 12 file(s) not content-scanned
- checks: errors=0 warnings=63 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
