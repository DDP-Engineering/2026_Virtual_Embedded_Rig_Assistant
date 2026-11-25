# TASK-78e7b9dd - Honor explicitly authorized Full Access for delegated tool execution (#405)

stage: done
type: change
interaction: autopilot
requirements: REQ-SEC-36900003, REQ-SEC-36900004, REQ-SEC-36900006, REQ-SEC-36900008, REQ-FUNC-2915b7b6
parent:
branch: master
base: d78443557ccc1b2c901e5858857ea878cb13a1ff
opened: 2026-11-25

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

Problem: A delegated child in Bypass still asks for approval of each shell command without a user-saved prefix, so an authorized Full Access delegation stops on routine commands (STATED, #405). With the setting off, a Bypass parent cannot delegate at all: the launch is denied with `bypass_launch` (OBSERVED, `service.ts` `checkDelegatedLaunch`).
Desired outcome: The "Allow Full Access for delegated tasks" setting decides the child's mode at launch: a Bypass parent's child starts in Bypass when it is on and in Auto-edit when it is off; afterwards the child's mode is its own. A child in Bypass follows the direct Bypass tool-execution policy (STATED, user 2026-11-25: "in functie de acea setare - prelua la fel - modul bypass - sau prelua modul auto-edit. Era ca o setare de siguranta"; design accepted "Yes, implement it").
Actors: The user; the parent agent session (delegation tools); the child session; the approval gate.
Primary scenario: The parent in Bypass with the setting on launches a child; the child runs `git status` with no saved prefix and it runs without an approval card.
Examples: Setting off, Bypass parent launches: the child is created in Auto-edit and a shell command without a saved prefix waits for user approval. Setting on: child in Bypass runs shell commands, declared programs and file changes like direct Bypass.
Counterexamples: Parent in Ask, Auto-edit or Read-only: the child copies that mode regardless of the setting. A blocked program, a plugin installation review and trial-plugin approvals still follow their own policies in Bypass (OBSERVED, `approvals.ts` byMode, `program-rules.ts` programPolicy).
In scope: Launch mode selection; removing the delegated command-grant rule; reporting the child's mode in the launch result; launch tool text; requirements REQ-SEC-36900003/4/6/8; Permissions and Chat and sessions help in en/ro/de/fr; Settings warning text; tests; CHANGELOG and release notes.
Out of scope: A separate remote-publication gate - none exists in VERA and the user chose direct Bypass behavior for a Bypass child (STATED, design accepted). Changing a child's mode when the setting is later turned off (STATED: existing children keep their mode).
Constraints: Branch master, the repository's default branch (developer's choice, STATED "pe acelasi branch"). Parent messages never approve pending requests. Mode changes and revocation (REQ-SEC-36900007) stay unchanged. Pre-release: no compatibility code.
Success signals: Focused core tests show: setting off -> Auto-edit child; setting on -> Bypass child running a no-prefix command without approval; Ask/Auto-edit parents copied; Auto-edit child still asks; leaving Bypass still cancels work; launch result reports the mode.
Evidence: `approvals.ts` policyOf/requireCommandGrant (OBSERVED); `service.ts:330` requireCommandGrant host, `checkDelegatedLaunch` (OBSERVED); `programs.test.ts` "requires independent shell authorization after a Full Access child launch" (OBSERVED); help `chat-and-sessions.md:73-77`, `permissions.md:60` (OBSERVED).
Assumptions: A child switched to Bypass by the user in its own chat (acknowledged, REQ-SEC-36900005) is equally authorized and also gets direct Bypass policy (INFERRED from the user's "the child's mode is its own" design).
Unknowns: The exact operation the originally observed delegated implementation stopped on was not captured (UNKNOWN, #405); the only delegated-specific gate in code is requireCommandGrant for run_command.
Decision-blocking questions: None remaining; both were settled by the user's design (see Rulings).
Proposed behaviors: Accepted as stated in Desired outcome.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Setting off downgrades | Bypass parent, setting off -> child created in Auto-edit | REQ-SEC-36900003 (revised) | delegation.test.ts launch with setting off | Mode chosen inside the launch transaction from the current parent row and live setting; `bypass_launch` denial removed |
| Other modes copied | Non-Bypass parent, or Bypass with setting on -> child copies parent mode | REQ-SEC-36900004 (revised) | delegation.test.ts Ask and Bypass launches | Same expression as above |
| Revocation keeps existing children | Setting turned off -> later launches Auto-edit, existing child modes unchanged | REQ-SEC-36900006 (revised) | delegation.test.ts toggles setting between launches | No change to session rows when the setting changes |
| Bypass child = direct Bypass | Delegated session in Bypass -> shell, programs, files decided by mode | REQ-SEC-36900008 (revised) | programs.test.ts no-prefix command, blocked and install boundaries | Remove `requireCommandGrant` from ApprovalGate and SessionService |
| Parent knows child mode | Launch result and retry report current child mode | REQ-FUNC-2915b7b6 (new) | delegation.test.ts launch and retry | `DelegatedLaunch.mode`, read from the child row |

## Design

Skipped: the change reuses the launch transaction and approval gate; decisions are in the coverage table.


## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: skipped; next build - design decisions recorded in coverage table
- 2026-11-25 build: red: npx vitest run src/sessions/programs.test.ts src/sessions/delegation.test.ts -t 'Full Access|Auto-edit|live profile' exit 1 - launch result has no mode, setting-off Bypass launch denied, no-prefix delegated command needs approval (REQ-SEC-36900003, REQ-SEC-36900004, REQ-SEC-36900006, REQ-SEC-36900008, REQ-FUNC-2915b7b6)
- 2026-11-25 build: green: npx vitest run src/sessions/programs.test.ts src/sessions/delegation.test.ts src/agent src/tools exit 1 only for pre-existing registry.test.ts wireshark_dumpcap sample gap (upstream #332, unrelated); 296 passed incl. new tests (REQ-SEC-36900003, REQ-SEC-36900004, REQ-SEC-36900006, REQ-SEC-36900008, REQ-FUNC-2915b7b6)
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: green: VERA_BUILD_ROOT=release_tmp/e2e-405 npm run test:e2e -- tests/e2e/session-delegation.spec.ts -g 'starts unauthorized children in Auto-edit' exit 0 (REQ-SEC-36900003, REQ-SEC-36900004, REQ-SEC-36900006, REQ-SEC-36900008)
- 2026-11-25 validate: review round 1: spec approved (minor: REQ-SEC-36900008 verification broader than delegated tests); quality changes_required: (1) demoted parent drives Bypass child, (2) setting off keeps existing Bypass children - both by design per RULING-001 and REQ-SEC-36900004/6, no change; (3) existing() NOT_FOUND unreachable since child FK is ON DELETE SET NULL and existing() rejects null child first
- 2026-11-25 validate: returned to build - review round 1: add device-write mode assertion for Bypass child; align REQ-SEC-36900008 verification
- 2026-11-25 build: green: npx vitest run src/sessions/programs.test.ts src/sessions/delegation.test.ts exit 0, 52 passed (REQ-SEC-36900008 device-write mode assertion)
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-78e7b9dd --strict --run exit 0; lint, typecheck, i18n, help ran; remaining warnings are pre-existing context-size (sessions.md 39 KB, already over) and other tasks' ticket-ref notes
- 2026-11-25 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-25 | decision=The delegated Full Access setting selects the child's mode at launch: Bypass parent -> Bypass child when on, Auto-edit child when off; other modes are copied; existing children keep their mode when the setting changes. | reason=User design 2026-11-25, a safety setting that downgrades instead of refusing | source=user | supersedes=none
- RULING-002 | date=2026-11-25 | decision=A delegated child in Bypass follows the direct Bypass tool-execution policy, including shell commands without saved prefixes and remote publication commands; independent policies (blocked, plugin install review, trial plugins) stay. | reason=User accepted the recommended design ('Yes, implement it') | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-78e7b9dd.md
changed: Review round 1 fixes: device-write mode assertion, REQ-SEC-36900008 verification aligned
evidence: check --task TASK-78e7b9dd --strict --run exit 0; vitest programs+delegation 52 passed; E2E session-delegation exit 0
issues: Pre-existing: registry.test.ts lacks wireshark_dumpcap sample (upstream #332); sessions.md over page_kb
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-25)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-SEC-36900003 - Start unapproved Full Access children in Auto-edit
  - REQ-SEC-36900004 - Copy child mode once
  - REQ-SEC-36900006 - Revoke Full Access launches
  - REQ-SEC-36900008 - Apply direct Bypass policy to delegated sessions
  - REQ-FUNC-2915b7b6 - Report the delegated child's mode
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base d784435: 38 file(s) changed, 346 line(s) added
- checks: errors=0 warnings=53 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
