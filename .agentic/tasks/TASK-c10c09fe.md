# TASK-c10c09fe - DELEG-02 Add agent tools for delegated session launch and monitoring (#327)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-b9e2d67d, REQ-SEC-e66d1273, REQ-REL-479dab7f, REQ-FUNC-acf8735a, REQ-DATA-ff418cb1, REQ-REL-b1ff5bac, REQ-REL-d387e52f, REQ-FUNC-9a10ee1b
parent:
branch: ddp/epic-298
base: 93217a2f587007a58ead495952b29c43d18ed316
opened: 2026-11-19

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

Problem: STATED (#327) A parent agent needs to launch a delegated session and collect its result within its own turn. OBSERVED the #326 SessionService exposes host APIs with no model tool binding.
Desired outcome: STATED (#327, #325) A parent agent can launch independent inspection work and monitor or stop the tracked turn through workbench-scoped tools.
Actors: STATED (#325 and coordinator) The parent agent, child agent, user and trusted workbench session host.
Primary scenario: STATED (#327) A replay-backed parent launches a child, continues work, sees progress and uses the child's final reply.
Examples: INFERRED from #327 acceptance and the #326 replay infrastructure. Gate a replayed child while its parent reads a fixture, then allow it to finish during collection.
Counterexamples: STATED (#327 and coordinator) Unrelated callers cannot inspect or stop a child. Later user turns, raw errors and approval details stay outside the tool result.
In scope: STATED (#327) Launch, status, bounded wait, stop, model-facing schemas, core policy and masked progress or terminal result. STATED (coordinator) Check early completion, later child turns, deletion and restart.
Out of scope: STATED (coordinator) Desktop relationships and navigation (#328), Gitea writes, full suites, staging and commits by this chat.
Constraints: STATED (coordinator) Existing sibling checkout on ddp/epic-298 at 93217a2f587007a58ead495952b29c43d18ed316. Keep format 1. Use the #326 scoped APIs and bind identity and retry keys to the host/runtime.
Success signals: STATED (#327) Replay acceptance, wait cleanup on all exits, ownership of status and stop, durable transcript after stop and bounded masked output.
Evidence: OBSERVED tea issues 327 and 325 exit 0, Git verified a clean tree at the assigned base, SessionService.inspectDelegated includes durable initial-turn identity and a sequenced snapshot.
Assumptions: INFERRED from the existing program wait and tool contracts. Reuse the 0 to 30000 ms wait range and the existing agent result cap. Use fixed status and progress fields and a completed reply, with a user-approval status when applicable.
Unknowns: UNKNOWN Real provider tool selection outside deterministic replay.
Decision-blocking questions: None.
Proposed behaviors: INFERRED from #327 and coordinator constraints. Use the tool receipt's session ID for follow-up commands, return an approval state without request data, and bound stop to the admitted initial turn.

## Requirement coverage

| Requirement | Behavior | Design seam |
|---|---|---|
| REQ-FUNC-b9e2d67d | Launch delegated sessions from the parent turn | service.ts, delegated-sessions.ts, runtime.ts, registry.ts |
| REQ-SEC-e66d1273 | Bind delegation calls to workbench session authority | service.ts, delegated-sessions.ts, registry.ts, context.ts, tools.ts, service.ts |
| REQ-REL-479dab7f | Use invocation identity for delegated launch retries | service.ts, delegated-sessions.ts, runtime.ts, registry.ts, context.ts |
| REQ-FUNC-acf8735a | Report the tracked delegated turn outcome | delegation-monitor.ts, delegated-sessions.ts |
| REQ-DATA-ff418cb1 | Limit delegated results to masked initial-turn content | delegation-monitor.ts, delegated-sessions.ts, registry.ts |
| REQ-REL-b1ff5bac | Settle delegated waits without a replay gap | delegation-monitor.ts, hub.ts, delegated-sessions.ts |
| REQ-REL-d387e52f | Release bounded delegation waits on every exit | delegation-monitor.ts, hub.ts, delegated-sessions.ts |
| REQ-FUNC-9a10ee1b | Stop the tracked delegated turn without deleting history | service.ts, delegated-sessions.ts |

## Design

### Approach

- OBSERVED #326 SessionService owns workbench and parent-child authority; ReferenceRuntime has each tool call's ID and SessionService's turn events supply the host turn ID. Bind an optional narrow delegation host to the ordinary parent tool context. Register four built-ins and keep registry execution, permission checks and ordinary source order. REQ-FUNC-b9e2d67d, REQ-SEC-e66d1273, REQ-REL-479dab7f
- INFERRED from the known snapshot and turn formats. Project SessionService.inspectDelegated to the durable initial turn. Match replies by turn ID, use initial-turn tool count for progress and expose a pending approval status only for a linked initial-turn tool. Use subscribeDelegated from the snapshot sequence and re-read on an initial-turn terminal event or an approval event. REQ-FUNC-acf8735a, REQ-DATA-ff418cb1, REQ-REL-b1ff5bac

### Interfaces and data

- session_launch accepts instruction, optional modelRef and reasoning. SessionService hashes the runtime turn ID and tool call ID for the durable request key. Strict schemas reject extra fields. A launch returns sessionId and turnId after admission. REQ-FUNC-b9e2d67d, REQ-REL-479dab7f
- session_status, session_wait and session_stop address a child by sessionId. A result includes sessionId, turnId, status and toolSteps; completed may include reply. Terminal status distinguishes completed, stopped, error, limit and interrupted. Pending user approval yields awaiting_approval. Recheck live Agent masking at publication and apply it to the complete reply before the ordinary 32000-character serialized result cap. When a limit cuts unmasked text, keep visible registered credential strings whole for later masking. REQ-SEC-e66d1273, REQ-FUNC-acf8735a, REQ-DATA-ff418cb1
- Wait defaults to 10000 ms and accepts 0 through 30000 ms, adapting the existing program wait envelope. On timeout return the latest progress with timedOut, leaving the child active. On abort, observation failure or return, dispose timeout, abort callback and subscription, including synchronous replay delivery before the disposer is assigned. Resume uses stored turn identity and existing recovery events. REQ-REL-b1ff5bac, REQ-REL-d387e52f
- Stop only requests cancellation of the active initial turn, uses the existing stop path and returns whether the request applied. Reuse core's typed errors with fixed model-facing messages. REQ-SEC-e66d1273, REQ-FUNC-9a10ee1b

### Files and test seams

- Add tools/delegated-sessions.ts and sessions/delegation-monitor.ts. Bind through service.ts, registry.ts, context.ts and runtime.ts. Add names to the core tool catalog and workbench disabled-name validation without changing the Desktop tool picker. Harden replay cleanup in hub.ts. REQ-SEC-e66d1273, REQ-REL-b1ff5bac, REQ-REL-d387e52f
- Add a real SQLite and ReplayGateway parent/child acceptance test, registry schema checks and focused wait/projection race tests. The coverage table maps requirements to each implementation seam.

### Risks and open decisions

- OBSERVED an event may arrive synchronously while subscribeDelegated replays. Promise settlement and finally own cleanup after subscribe returns. Before stop, compare the live active turn ID with the durable link; a later user turn is outside agent control. No storage or version changes. No open product decisions. REQ-REL-b1ff5bac, REQ-REL-d387e52f, REQ-FUNC-9a10ee1b

### Requirement map

- The coverage table identifies implementation seams. The requirement records name their executable oracles.

Diagrams: [diagram_TASK-c10c09fe.md](diagram_TASK-c10c09fe.md)

## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: The user authorizes the coordinator to make the local validated ticket commit. This implementation chat hands back the candidate unstaged and uncommitted, with no remote writes.
- 2026-11-19 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-19 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-19 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-19 build: red: pinned npmw.py npx vitest run src/libraries/core/src/sessions/delegation-tools.test.ts exit 1 (5 tests): the parent has no launch/status/wait/stop definitions or replay launch result. Covers all eight requirement groups before implementation. Original receipt: 02_Tools/runtime/deleg-327-proof/windows-red.txt.
- 2026-11-19 build: green: pinned Windows npmw.py npx vitest run on ten affected files exited 0 (115 passed). The workbench disabled-tool catalog selector separately exited 0 (1 passed). All eight active requirements have linked executed tests. Original receipts under 02_Tools/runtime/deleg-327-proof.
- 2026-11-19 build: Windows release-note validation exited 0 (3 files); pinned typecheck emitted the candidate build for WSL2, exit 0. The new Sessions note shares the existing category entry to preserve the 10-item cap.
- 2026-11-19 build: Pinned WSL2 Ubuntu Linux x64 Node 24.21.0 native SQLite replay smoke exited 0. The parent consumed the gated child reply after independently reading a fixture and observing running status. It verified selected reasoning, child catalog confinement and subscriber disposal. Receipt: 02_Tools/runtime/deleg-327-proof/wsl-replay.txt.
- 2026-11-19 build: Reviewed evolution against 93217a2. Advisory check exited 0 with 0 errors. Warnings reflect legacy task/requirement records, mandatory release files outside configured globs and co-located test paths matched by the broad source glob. Tests are linked and passed.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Round 1 quality finding P2: if Agent masking turns on between full reply projection and tool publication, capping can cut a registered credential at the boundary and the subsequent scrub cannot recognize its fragment. Reproject the full reply at publication, and avoid splitting a registered credential in any bounded result that can be reprojected for dispatch.
- 2026-11-19 validate: returned to build - Round 1 quality P2: preserve live Agent masking before the cap for status and wait.
- 2026-11-19 build: red: round 1 status and wait live Agent masking tests exited 1. Both published CRED_S, the unrecognizable fragment of a synthetic registered credential cut by the result cap. Receipt round-1-mask-red.txt.
- 2026-11-19 build: green: round 2 pinned Windows affected Vitest exited 0 (76 tests across six files), including off-to-on Agent masking before status/wait publication and no partial credential in the earlier unmasked cap. Unchanged focused proof is retained for 118 total distinct Windows cases. Pinned typecheck exited 0 for the WSL2 build.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Round 2 evolution reviewed against 93217a2. Rebuilt native SQLite and ReplayGateway smoke passed again on Ubuntu WSL2, exit 0. The focused receipt covers the Linux runtime and native addon. It is a smoke test, not native Ubuntu milestone acceptance.
- 2026-11-19 validate: Round 2 strict command exited 0. It identified an avoidable session knowledge page size advisory. Kept the routing pointer in sessions.md and consolidated the model tools description in file-tools.md. Only these two knowledge records changed after the round 2 reviews. The original focused receipts cover unchanged source and tests.
- 2026-11-19 validate: final: python .agentic/aegis.py check --task TASK-c10c09fe --strict --run exit 0. Lint, typecheck, i18n and help passed. The 31 advisories cover older task and requirement metadata, mandatory release files outside AEGIS globs and co-located test paths also matched by the source glob. The linked tests were executed. Both independent round 3 reviews approved and the 30-file non-journal candidate matched its reviewed SHA-256 manifest. No open findings.
- 2026-11-19 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-c10c09fe.md
changed: DELEG-02 core launch/status/wait/stop with scoped initial-turn results, live masking and wait disposal. Candidate unstaged.
evidence: AEGIS strict run exit 0. 118 focused Windows cases, WSL2 native SQLite replay and release notes passed.
issues: No open review findings. Provider validation used replay. Linux coverage was a WSL2 smoke.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-19)

- stage: validate; type: feature; branch: ddp/epic-298
- requirements:
  - REQ-FUNC-b9e2d67d - Launch delegated sessions from the parent turn
  - REQ-SEC-e66d1273 - Bind delegation calls to workbench session authority
  - REQ-REL-479dab7f - Use invocation identity for delegated launch retries
  - REQ-FUNC-acf8735a - Report the tracked delegated turn outcome
  - REQ-DATA-ff418cb1 - Limit delegated results to masked initial-turn content
  - REQ-REL-b1ff5bac - Settle delegated waits without a replay gap
  - REQ-REL-d387e52f - Release bounded delegation waits on every exit
  - REQ-FUNC-9a10ee1b - Stop the tracked delegated turn without deleting history
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 93217a2: 31 file(s) changed, 1195 line(s) added
- checks: errors=0 warnings=31 notes=38
- checklist: 9/9 done
