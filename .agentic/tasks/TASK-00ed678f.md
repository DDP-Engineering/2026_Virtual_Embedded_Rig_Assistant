# TASK-00ed678f - Support multi-turn delegated sessions and user-authorized modes (#369)

stage: done
type: feature
interaction: autopilot
requirements: REQ-SEC-36900008, REQ-FUNC-36900001, REQ-FUNC-36900002, REQ-SEC-36900001, REQ-FUNC-36900003, REQ-REL-36900001, REQ-REL-36900002, REQ-FUNC-36900004, REQ-SEC-36900002, REQ-SEC-36900003, REQ-SEC-36900004, REQ-SEC-36900005, REQ-SEC-36900006, REQ-SEC-36900007, REQ-FUNC-acf8735a, REQ-FUNC-9a10ee1b, REQ-DATA-ff418cb1, REQ-SEC-9d1e28e5, REQ-UX-01f905ce, REQ-UX-9335be50, REQ-UX-93738350, REQ-UX-b2f2c1dc, REQ-SEC-1f5f2586, REQ-REL-b1ff5bac, REQ-REL-75fa183f, REQ-REL-716213c5, REQ-FUNC-e02ca123
parent:
branch: ddp/epic-338
base: 0624e9916d713de754a5bd0daf1cfbef265e0e3e
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

Problem: OBSERVED: SessionService stores one initial delegation and its tooling monitors that turn only. The child is fixed to inspection tools; Desktop locks its mode.
Desired outcome: STATED (#369): an owning parent can direct and monitor successive turns within one child conversation; the user can authorize independent edit modes and eligible Full Access child launches.
Actors: STATED: owning parent agent, same-workbench child agent, Desktop user, and host authority.
Primary scenario: STATED: coordinate sequential tickets in the shared checkout with one implementation child active at a time and validate each handover before dispatch.
Examples: STATED: send three follow-ups to a child, configure a supported reasoning level, queue a correction while eligible, then monitor its exact acknowledged turn after reopen. One authorized Full Access parent launches two sequential children that edit local files and run permitted checks.
Counterexamples: STATED: unrelated or nested control, steering around pending approval, fake approval prose, unauthorized Full Access launch and automatic changes to existing children after a parent change or revocation.
In scope: STATED: both phases in this journal; core/session storage, agent tools, IPC and Desktop controls; persisted replay, recovery and focused validation.
Out of scope: STATED: remote publication, external providers and unrelated workflows; full suites, official plugin suite and physical microphone; migrations or branch, stage, commit or Gitea writes by the implementer.
Constraints: STATED: recorded sibling worktree/base, one implementation writer, format 1, bounded workbench admission, existing masking and host policy, four UI languages. Coordinator alone makes the authorized local commit after verifying the handover.
Success signals: STATED: exact request and turn IDs through retry and reopen, ordinary pending approvals, independent user-confirmed mode switches, revocation and reauthorization, and both sequential children complete local edit/check replay without additional approvals.
Evidence: OBSERVED: tea issue 369 and related 325–328 and 359; 00_Planning/Agent.md at the sibling base; SessionService, ToolRegistry, storage, Desktop session IPC and delegation tests.
Assumptions: INFERRED: ordinary chat steering acknowledges its admission turn and retains pending messages for normal next-turn delivery if that turn stops, as defined in Agent.md. Exact monitoring follows the requested acknowledged turn.
Unknowns: Related issue #359 is closed in Gitea, but its app-wide admission code is absent from the recorded sibling base. Integrate that independent functionality through its owning workstream.
Decision-blocking questions: None.
Proposed behaviors: None pending.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Start owned child follow-ups | REQ-FUNC-36900001 | Atomic staged admission |
| Queue owned child follow-ups | REQ-FUNC-36900002 | Ordinary steering |
| Keep parent instructions distinct from user decisions | REQ-SEC-36900001 | Host-authored provenance |
| Configure the next child turn | REQ-FUNC-36900003 | Atomic settings and revision |
| Retry child control mutations safely | REQ-REL-36900001 | Durable mutation receipts |
| Refuse stale child settings | REQ-REL-36900002 | Settings compare and recheck |
| Refuse ineligible child mutations | REQ-FUNC-36900004 | Recheck ownership, lifecycle and approvals |
| Authorize new Full Access children | REQ-SEC-36900002 | Parent-scoped user control |
| Deny unapproved Full Access launch | REQ-SEC-36900003 | Commit-time launch authorization |
| Copy child mode once | REQ-SEC-36900004 | Independent persisted mode |
| Confirm switching an individual session to Full Access | REQ-SEC-36900005 | User-only mode acknowledgement |
| Revoke Full Access launches | REQ-SEC-36900006 | Admission-only revocation |
| Revoke active Bypass authority on mode exit | REQ-SEC-36900007 | Live trusted policy and revocation epoch |
| Exact turn lookup | REQ-FUNC-acf8735a | Exact turn lookup |
| Exact active turn check | REQ-FUNC-9a10ee1b | Exact active turn check |
| Existing masked publication | REQ-DATA-ff418cb1 | Existing masked publication |
| Local canonical catalog and live policy | REQ-SEC-9d1e28e5 | Local canonical catalog and live policy |
| Latest Desktop turn completion | REQ-UX-01f905ce | Latest Desktop turn completion |
| Latest Desktop turn progress | REQ-UX-9335be50 | Latest Desktop turn progress |
| Latest Desktop turn failure | REQ-UX-93738350 | Latest Desktop turn failure |
| Latest Desktop turn stop or interruption | REQ-UX-b2f2c1dc | Latest Desktop turn stop or interruption |
| Require separate delegated shell authorization | REQ-SEC-36900008 | Existing user command grants and exact approval gate |
| Current same-workbench owner proof | REQ-SEC-1f5f2586 | Current same-workbench owner proof |
| Sequenced wait scoped to exact turn | REQ-REL-b1ff5bac | Sequenced wait scoped to exact turn |
| Existing recovery with durable follow-up provenance | REQ-REL-75fa183f | Existing recovery with durable follow-up provenance |
| Indexed latest-turn lookup for Desktop | REQ-REL-716213c5 | Indexed latest-turn lookup for Desktop |
| Existing workbench delegation cap | REQ-FUNC-e02ca123 | Bound three simultaneous child turns to one workbench |

## Design

### Approach
- OBSERVED: SessionService stages initial runtime events before publication, and the runtime already replays durable pending steering. Reuse both for launch and follow-ups (REQ-FUNC-36900001, REQ-FUNC-36900002, REQ-REL-75fa183f).
- STATED: The owner controls the child and addresses exact turns. Default omitted turn IDs to the initial turn; Desktop shows the latest child turn ID and state. Use indexed event queries for the list and normal event replay on explicitly requested inspection (REQ-SEC-1f5f2586, REQ-FUNC-acf8735a, REQ-FUNC-9a10ee1b, REQ-REL-b1ff5bac, REQ-REL-716213c5).
- STATED: The parent instruction is distinct from human approval. Carry host-authored parent ID on user/queued events and model request text and show the source in Desktop. Authority stays in host callbacks (REQ-SEC-36900001).
- STATED: The user independently controls the session mode and the parent's launch authorization. The child gets its own mode at admission and uses the canonical local tool catalog with normal host rules (REQ-SEC-9d1e28e5, REQ-SEC-36900002–REQ-SEC-36900007).

### Interfaces and data
- INFERRED: Add session_send and session_configure. Durable per-parent receipts key successful child mutations by invocation identity and a hash of operation, target and arguments. Save receipts, queued messages, staged turns or model/reasoning updates in the same SQLite transaction. Duplicate acknowledgement survives reopen; signed authority is absent from model arguments (REQ-REL-36900001).
- INFERRED: Use the last settings event's revision as a compare token; verify it after cancellable model preparation and accept an optional revision on send for configure-then-send. Apply a validated concrete model and reasoning together while idle (REQ-FUNC-36900003, REQ-REL-36900002, REQ-FUNC-36900004).
- OBSERVED: Bypass paths, prepared edits, commands and programs already bind to a session-owned abort signal and approval rules. Key launch authorization to the parent session in the workbench DB. Reuse an explicit confirmed action in the trusted Desktop renderer and strict IPC. Consult the live parent mode and grant inside the transaction. Refuse new Bypass launch if the grant is missing. Revocation does not alter existing sessions (REQ-SEC-36900002–REQ-SEC-36900007).

### Files and test seams
- Delegation schemas, tools, repository, SessionService and turn monitor own admission, receipts, provenance and read/stop. Shared event schemas and the runtime carry provenance through ordinary queued delivery. ToolRegistry binds only canonical child tools and never nested delegation.
- Desktop IPC, permission picker, parent authorization control and transcript links exercise the actual acknowledgement and state. Core replay tests cover race, reopen and policy; native Desktop replay uses local fixtures only.
- Use narrow partial indexes for turn and settings queries; retain the original bounded and masked result publication (REQ-DATA-ff418cb1).

### Risks and open decisions
- STATED: Stored schema stays at version 1. New workbench objects require recreation of the earlier pre-release DB as documented in CHANGELOG. Preserve shutdown cancellation, the existing workbench admission limit and normal approval routing.
- INFERRED: A queued message acknowledgement identifies the active turn at admission. If interrupted, standard steering carries the pending message to the next turn. Exact Stop cannot cancel a newer turn from an older acknowledgement.
- STATED: Full Access permission covers existing permitted local operations and does not grant remote publication authority. Coordinator verifies the handover before the next dispatch; workbench-wide concurrency stays bounded.

### Requirement map

A workbench's user-saved literal command prefixes authorize automatic delegated shell execution in Bypass. The normal exact user approval otherwise applies (REQ-SEC-36900008). Mode copy grants file scope without changing shell authority. Delegated settings remain stable while a child turn is active.
The coverage table maps each requirement to its design decision. Core delegation, tool and monitor tests prove phase 1. Core policy, IPC and native Desktop replay prove phase 2 and latest-turn presentation.

Diagrams: [diagram_TASK-00ed678f.md](diagram_TASK-00ed678f.md)

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: completed; next specify
- 2026-11-21 specify: completed; next design
- 2026-11-21 design: completed; next build
- 2026-11-21 build: red: pinned Vitest delegation.test.ts filtered to successive follow-ups and next-turn settings, exit 1 for missing sendDelegated and configureDelegated; original receipt windows-phase1-red.log.
- 2026-11-21 build: red: pinned Vitest delegation.test.ts filtered to independent mode copy and normal pending editing approvals, exit 1 for fixed read-only mode; original receipt windows-phase2-red.log.
- 2026-11-21 build: red: Native replay exposed premature wait completion on automatic approval; focused delegation-monitor test reproduced awaiting_approval instead of completed, exit 1 (windows-autoapproval-red.log). First native attempt was a setup-only missing-module failure; the sibling dependency junction resolved it.
- 2026-11-21 build: green: Windows pinned Vitest focused core, shared, IPC, preload and renderer files exit 0, 169 tests (windows-focused.log); WSL2 seven affected files exit 0, 106 tests (wsl-focused.log); follow-up automatic-approval regression and native checks ran separately.
- 2026-11-21 build: DEVIATION validate: Related #359 is closed in Gitea but absent from base 0624e991; retain three simultaneous child turns per workbench and keep global/cross-workbench implementation out of this candidate.
- 2026-11-21 build: green: native Windows Electron session-delegation.spec.ts exit 0, both tests. The second verified explicit confirmation, three same-child follow-ups with reasoning changes, sequential local edits and Git checks without further user approvals, independent modes, and denied launch after revocation.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: returned to build - Independent reviews found stale reasoning at admission, unvalidated default-reasoning models, unrestricted delegated shell auto-approval, rolled-back program state, a Stop alias, and an ambiguous sender label.
- 2026-11-21 build: red: independent-review regressions failed as expected on live reasoning overwrite, invalid default model acceptance, and automatic approval of an ungranted child shell command (windows-review-red.log).
- 2026-11-21 build: red: four selected Windows CLI integration regressions exited 1; original CLI stdout shows tool schemas expanded past the existing Replay input budget (CONTEXT_LIMIT). Keep the budget and compact the model-facing catalog.
- 2026-11-21 build: CLI scope: compact descriptions restored five checks. Two Bypass replays still exceeded the budget by 478–790 tokens, so the catalog now uses its existing shared Bypass system-prompt guidance without duplicating it on every tool.
- 2026-11-21 build: green: all three review regressions now pass. Windows and WSL2 six focused core files each passed 95 tests; native Windows scenarios passed 2/2 with the separate local command grant and Desktop reauthorization. Import-boundary tests passed 17/17.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Final strict attempt exited 1: lint/typecheck/help passed; static i18n extraction rejected two conditional translation arguments. Original strict receipt retained.
- 2026-11-21 validate: returned to build - Use literal calls for both branches at the static translation extraction sites.
- 2026-11-21 build: green: pinned check:i18n and check:release-notes both exited 0 after literal-key extraction fixes and clarifying the per-workbench obsolete database cleanup in Unreleased.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: DEVIATION validate: Automatic approval review rejected Windows proof directory removal as blocked by policy, including bounded entry-by-entry cleanup. Detached the canonical dependency junction and archived original receipts. Removed the owned WSL2 scratch. The ignored Windows proof directory remains.
- 2026-11-21 validate: Verification: two Windows native scenarios passed and the implementation replay passed again on the final catalog; the last two literal translation changes preserve the exercised UI behavior. Windows and WSL2 focused tests passed. Seven selected CLI cases passed across the compact catalog and Bypass reruns; a supplemental catalog-generation case timed out in the exploratory run and was outside ticket scope. Import boundaries 17/17 and release-note check exited 0.
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-00ed678f --strict --run exited 0. Lint, TypeScript, i18n and help passed. The 55 advisory warnings include existing journal/size advisories and check-layout/trace heuristics for changed docs and linked tests; zero errors and zero promoted warnings. Full test command omitted by verification policy.
- 2026-11-21 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-21 | decision=Implement both phases in the existing sibling worktree and hand back the unstaged candidate | reason=The coordinator authorizes one local commit after handover and owns that commit and any issue closure; implementation must preserve base 0624e9916d713de754a5bd0daf1cfbef265e0e3e. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-00ed678f.md
changed: Restored static translation extraction and clarified the Unreleased database recreation line
evidence: Strict AEGIS exited 0, focused Windows and WSL2, native Electron, seven CLI replay cases, import boundaries and release notes passed; both reviews approved (round 3).
issues: App-wide admission #359 is absent from the base. Automatic approval review blocked deletion of the ignored Windows proof directory.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-SEC-36900008 - Authorize delegated shell commands separately
  - REQ-FUNC-36900001 - Start owned child follow-ups
  - REQ-FUNC-36900002 - Queue owned child follow-ups
  - REQ-SEC-36900001 - Keep parent instructions distinct from user decisions
  - REQ-FUNC-36900003 - Configure the next child turn
  - REQ-REL-36900001 - Retry child control mutations safely
  - REQ-REL-36900002 - Refuse stale child settings
  - REQ-FUNC-36900004 - Refuse ineligible child mutations
  - REQ-SEC-36900002 - Authorize new Full Access children
  - REQ-SEC-36900003 - Deny unapproved Full Access launch
  - REQ-SEC-36900004 - Copy child mode once
  - REQ-SEC-36900005 - Confirm switching an individual session to Full Access
  - REQ-SEC-36900006 - Revoke Full Access launches
  - REQ-SEC-36900007 - Revoke active Bypass authority on mode exit
  - REQ-FUNC-acf8735a - Report the tracked delegated turn outcome
  - REQ-FUNC-9a10ee1b - Stop the tracked delegated turn without deleting history
  - REQ-DATA-ff418cb1 - Limit delegated results to masked exact-turn content
  - REQ-SEC-9d1e28e5 - Enforce delegated child tool authority
  - REQ-UX-01f905ce - Show delegated turn completion
  - REQ-UX-9335be50 - Display delegated turn progress
  - REQ-UX-93738350 - Show delegated turn failure
  - REQ-UX-b2f2c1dc - Show delegated turn stop and interruption
  - REQ-SEC-1f5f2586 - Scope delegated controls to the owning parent
  - REQ-REL-b1ff5bac - Settle delegated waits without a replay gap
  - REQ-REL-75fa183f - Recover interrupted delegated turns
  - REQ-REL-716213c5 - Recover Desktop delegation links and outcomes
  - REQ-FUNC-e02ca123 - Bound concurrent delegated turns
- deviations: 2 recorded
  - validate: Related #359 is closed in Gitea but absent from base 0624e991; retain three simultaneous child turns per workbench and keep global/cross-workbench implementation out of this candidate.
  - validate: Automatic approval review rejected Windows proof directory removal as blocked by policy, including bounded entry-by-entry cleanup. Detached the canonical dependency junction and archived original receipts. Removed the owned WSL2 scratch. The ignored Windows proof directory remains.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 0624e99: 84 file(s) changed, 1922 line(s) added
- checks: errors=0 warnings=55 notes=42
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
