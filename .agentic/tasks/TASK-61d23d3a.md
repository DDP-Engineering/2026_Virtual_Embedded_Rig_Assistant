# TASK-61d23d3a - Wireshark traffic statistics and stream evidence (#402)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-610a4021, REQ-FUNC-610a4022, REQ-FUNC-610a4023, REQ-FUNC-610a4024, REQ-FUNC-610a4025, REQ-FUNC-610a4026, REQ-SEC-610a4027, REQ-REL-610a4028, REQ-REL-610a4029, REQ-FUNC-610a4011, REQ-SEC-610a4015, REQ-DATA-610a4016, REQ-FUNC-b89e6361
parent:
branch: master
base: d00a588b46072e5187f0b6be3a40850eb7083c49
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

Problem: STATED (#402) saved captures need statistics, transport observations and directional streams with supporting source frames.
Desired outcome: STATED (#402) deterministic bounded offline summaries and pages expose filter, window, observation point, reassembly, missing data and unavailable capabilities.
Actors: STATED (#402 and handoff) VERA sessions, local Wireshark users and later protocol profiles.
Primary scenario: STATED (#402) analyze a saved laboratory capture, use representative frames to investigate observed behavior and open the exact frame locally.
Examples: STATED (#402) retransmission, an incomplete stream, captured-length truncation and checksum evidence.
Counterexamples: STATED (handoff) traffic symptoms alone cannot establish root cause, and exact payload stays local.
In scope: STATED the operations and checks in 00_Planning/plan/402-wireshark-traffic-analysis.md.
Out of scope: STATED (handoff) live traffic, protocol profiles #214 and #233, capture comparison #333, other tickets and publication.
Constraints: STATED (handoff) shared master in autopilot. The coordinator alone commits and closes the ticket. Preserve the two unrelated untracked paths and journal #391. OBSERVED Git HEAD d00a588b46072e5187f0b6be3a40850eb7083c49 on master before edits.
Success signals: STATED (#402 and handoff) independently reconcile synthetic lab evidence with native Windows TShark, verify coverage and budgets, obtain both reviews and run strict AEGIS.
Evidence: OBSERVED the Gitea issue body and the typed offline service, masking and desktop citation seams from #401 and #334.
Assumptions: INFERRED (existing managed storage and #402 local-payload gate) the original verified saved capture is the exact local byte artifact.
Unknowns: UNKNOWN installed native field support until probed and native Ubuntu result until final verification.
Decision-blocking questions: None.
Proposed behaviors: None awaiting approval.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Summarize offline protocol stacks | REQ-FUNC-610a4021 | See Design |
| Summarize directional endpoints and conversations | REQ-FUNC-610a4022 | See Design |
| Measure interval traffic with coverage | REQ-FUNC-610a4023 | See Design |
| Report native expert and transport observations | REQ-FUNC-610a4024 | See Design |
| Measure supported response timing | REQ-FUNC-610a4025 | See Design |
| Follow a bounded transport stream | REQ-FUNC-610a4026 | See Design |
| Keep stream content in the verified local capture | REQ-SEC-610a4027 | See Design |
| Bind traffic pages to their evidence scope | REQ-REL-610a4028 | See Design |
| Report unsupported native traffic capabilities | REQ-REL-610a4029 | See Design |
| Preserve verified plugin, offline execution and capture identity | REQ-FUNC-610a4011, REQ-SEC-610a4015, REQ-DATA-610a4016 | Shared host and snapshot |
| Reopen issued evidence | REQ-FUNC-b89e6361 | Existing citation resolver |


## Design

### Approach

OBSERVED: `inspectWireshark` already authorizes the official plugin, snapshots input and bounds the
native process. Extend that dispatch with a typed traffic query and follow operation. A new
`traffic-native` adapter validates a fixed field export and native follow output.
New statistics, diagnostics and stream modules compute bounded projections from those facts.

### Interfaces and data

INFERRED (REQ-FUNC-610a4021–4026): use frame lengths for wire and captured counts,
half-open millisecond windows relative to the first timestamped capture frame, native stream IDs for TCP/UDP
and native DNS/HTTP timing fields. Duration comes from the native dissector.
Track file section/interface pairs, scoped and scanned frames, and separate capture, measurement
and page coverage. Expose the applied sequence analysis, reassembly and checksum settings.

INFERRED (REQ-REL-610a4028–4029): page ordered evidence by query hash and row offset.
Bound frame scan, native bytes, intervals and result size. Report missing fields, unsupported
types and unavailable or ambiguous stream/timing evidence explicitly.

### Files and test seams

Modify shared schemas, offline native and service dispatch, tool metadata, masking and citation
resolution. Add traffic aggregation and native parsing modules. The focused Wireshark plugin
suite compares synthetic captures with the independent native CLI and exercises session replay.

### Risks and open decisions

INFERRED (REQ-SEC-610a4027 and #401): native follow payload remains transient inside the local
adapter. Only lengths, gap sizes and typed evidence leave it. The original verified capture
keeps exact bytes for deliberate native viewing. Separate checksum and sequence observations
from causal conclusions. Native Ubuntu remains a final acceptance item.

### Requirement map

REQ-FUNC-610a4021–4023: statistical aggregators and native statistics references.
REQ-FUNC-610a4024–4025: fixed expert, TCP and protocol timing fields with native reference output.
REQ-FUNC-610a4026 and REQ-SEC-610a4027: native follow records, masking and original capture citations.
REQ-REL-610a4028–4029: bounded request, projection and page validation with negative tests.

Diagrams: [diagram_TASK-61d23d3a.md](diagram_TASK-61d23d3a.md)


## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-25 build: red: pinned vitest Wireshark plugin test with the native Windows TShark exited 1 because statistics and follow were unavailable (REQ-FUNC-610a4021 to 4023 and REQ-FUNC-610a4026). Original log 05_Software/test-outputs/402/01-red-windows.log.
- 2026-11-25 build: green: focused native Windows TShark 4.6.10 and Wireshark replay exited 0, 6 passed. The lab oracles cover hierarchy, endpoint and conversation directions, interval rates, expert and checksum evidence, timing, follow, paging and payload masking. Original log 05_Software/test-outputs/402/focused-windows-tshark.log.
- 2026-11-25 build: green: focused core, Desktop, citation and import boundary run exited 0, 30 passed. Original log 05_Software/test-outputs/402/focused-core-desktop-boundaries.log.
- 2026-11-25 build: DEVIATION build: The first native replay went red before implementation. Later detailed diagnostics, timing and hostile native output assertions were added after the integration existed. They passed against native Windows or focused fakes; no separate pre-implementation red is claimed for those assertions.
- 2026-11-25 build: Advisory build check found no errors. The original log distinguishes inherited warnings, the preserved unrelated untracked paths and fixture/test/release files classified by layout heuristics. The fixture generator and binary are jointly exercised by the native replay.
- 2026-11-25 build: completed; next validate (1 Done checklist item(s) left unticked)
- 2026-11-25 validate: Round 1 reviewed all 47 owned files in candidate-round-1.patch. Return findings: response paired outside scope is not reported from the request side; evidence loses native PCAPNG section; ambiguous epoch-zero marker was included in gap total; window time origin was misreported for untimed first frames.
- 2026-11-25 validate: returned to build - Correct response scope, section provenance, ambiguous gap counts and timestamp origin with focused regression evidence.
- 2026-11-25 build: red: round 2 native Windows replay exited 1 for the request-only scope regression. Windows native oracle recorded frames 1–3 with sections 1, 1, 2, interface 0 in each section and first timestamped frame 2. Original logs round-2-red.log and untimed-native-tshark.log.
- 2026-11-25 build: green: round 2 focused Windows native replay exit 0 (1 passed) and affected core/citation/Desktop tests exit 0 (12 passed). Original logs round-2-windows-tshark.log and round-2-core.log. Reuse unaffected round 1 checks.
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: Round 2 reviewed candidate-round-2.patch (48 owned files). Quality approved. Specification reproduced an additional native pseudo-gap ambiguity: TShark formats an untimed Simple Packet Block as timestamp zero in follow output. The previous ambiguity guard only handled an explicit epoch zero.
- 2026-11-25 validate: returned to build - Extend the TCP gap ambiguity guard to untimed source frames.
- 2026-11-25 build: red: round 3 focused unit exit 1 because an untimed marker-shaped record was counted as a gap. It passed after the ambiguity guard covered both null and zero timestamps (3 passed). Original logs round-3-red.log and round-3-core.log.
- 2026-11-25 build: green: round 3 affected native Windows replay exit 0 and focused native adapter/stream units exit 0 (1 and 3 passed). Original logs round-3-windows-tshark.log and round-3-core.log.
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: Both independent round 3 reviews approved the 48-path complete unstaged candidate against d00a588b46072e5187f0b6be3a40850eb7083c49. The reviewed patch SHA-256 is c5cacf018dc82bb935c133a040c8e4155031c30d2b0cbbc8735e2a40bd168524. Specification confirmed scope and the native collision correction; quality confirmed coverage, provenance, masking, gap precision and focused evidence.
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-61d23d3a --strict --run --full exit 0, strict: ok, 0 errors. Lint, typecheck, i18n and help passed. Release notes exited 0 separately. The 65 warnings are inherited record or context warnings, the checkout-wide content-scan cap, preserved unrelated files and layout/coverage heuristics for linked tests, fixtures and approved documentation locations. Both reviewers inspected the complete owned patch, including both binary fixtures. See aegis-strict-final.log and release-notes.log. Native Ubuntu and full suites are deferred under RULING-001.
- 2026-11-25 validate: Handover verification confirmed the exact 48 owned paths, reviewed product bytes, empty index, unchanged HEAD and preserved unrelated paths and #391 journal SHA-256. Original receipt: 05_Software/test-outputs/402/handover-integrity.log.
- 2026-11-25 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-25 | decision=Defer native Ubuntu acceptance and complete suites to final verification | reason=The user will start final verification separately and directed focused native Windows proof for this ticket. Any WSL2 evidence is distinct from native Ubuntu. | source=user | supersedes=none
- RULING-002 | date=2026-11-25 | decision=Prepare the unstaged and uncommitted candidate on shared master | reason=The user authorized the coordinator to verify the candidate, make the local commit and close Gitea #402. This implementation chat has no commit or publication instruction. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-61d23d3a.md
changed: 48 owned paths, unstaged on master
evidence: Native Windows, focused tests, strict AEGIS and two independent reviews passed.
issues: Native Ubuntu and complete suites deferred by user ruling.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-25)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-610a4021 - Summarize offline protocol stacks
  - REQ-FUNC-610a4022 - Summarize directional endpoints and conversations
  - REQ-FUNC-610a4023 - Measure interval traffic with coverage
  - REQ-FUNC-610a4024 - Report native expert and transport observations
  - REQ-FUNC-610a4025 - Measure supported response timing
  - REQ-FUNC-610a4026 - Follow a bounded transport stream
  - REQ-SEC-610a4027 - Keep stream content in the verified local capture
  - REQ-REL-610a4028 - Bind traffic pages to their evidence scope
  - REQ-REL-610a4029 - Report unsupported native traffic capabilities
  - REQ-FUNC-610a4011 - Gate capture operations on the official plugin
  - REQ-SEC-610a4015 - Constrain native offline analysis
  - REQ-DATA-610a4016 - Publish validated managed capture bytes
  - REQ-FUNC-b89e6361 - Open cited saved capture frames
- deviations: 1 recorded
  - build: The first native replay went red before implementation. Later detailed diagnostics, timing and hostile native output assertions were added after the integration existed. They passed against native Windows or focused fakes; no separate pre-implementation red is claimed for those assertions.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base d00a588: 59 file(s) changed, 2599 line(s) added; 11 file(s) not content-scanned
- checks: errors=0 warnings=65 notes=44
- checklist: 8/9 done; open: `report` appended
