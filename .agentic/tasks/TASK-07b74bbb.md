# TASK-07b74bbb - ADV-05 Advanced settings for the desktop

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-a16121c6, REQ-FUNC-ce542246, REQ-FUNC-4a030008, REQ-UX-052f5851, REQ-SEC-c1ba6fbf, REQ-UX-9ea9184f, REQ-DATA-96ef3dd6, REQ-FUNC-7509bd1e, REQ-FUNC-240f4e02, REQ-UX-996ae06e, REQ-FUNC-ef931b1f, REQ-UX-a4cf0527, REQ-UX-441b5a9d, REQ-UX-6a8a987d
parent:
branch: master
base: 776549140f145be0ce85904f0298b829564447bb
opened: 2026-11-21

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

Problem: STATED (00_Planning/advanced-settings.md, ADV-05) the desktop terminals, update and catalog
intervals, log retention, transcript rows and the default page size are fixed constants the user cannot
tune. OBSERVED: terminals.ts refuses a ninth terminal (8), keeps BUFFER 262144 characters and gives the
agent the last 12000 characters; terminal-tab.tsx fixes xterm scrollback 3000 and disables New at 8;
updates.ts checks every 6 h; catalog-checks.ts every 24 h; logger.ts keeps the 7 newest daily files;
transcript.tsx mounts INITIAL_ROWS 40 then CHUNK_ROWS 100; pager.tsx starts lists at 10 rows (sizes 10, 20, 50).
Desired outcome: STATED each of these is an application Advanced setting in Settings > Advanced, validated
by the shared registry, with its apply timing shown, and the desktop uses the resolved value.
Actors: the desktop user (Settings > Advanced); the agent (terminal_read); the desktop main process
(terminals, updates, catalog checks, logger); the renderer (terminal tab, transcript, lists).
Primary scenario: the user raises Terminals per workbench to 12 and saves; a ninth terminal opens. The user
sets Update check interval to 1 h; the next check runs an hour later, not six.
Examples: STATED ranges and defaults from the plan: terminals 1-16 (8, New); scrollback 64 Ki-4 Mi characters
(256 Ki) and 1000-50000 lines (3000), New; agent output 2000-64000 characters (12000), Live; update interval
1-168 h (6), Live; catalog interval 1-168 h (24), Live; log retention 1-90 days (7), Live; transcript rows
20-200 (40) and 50-500 (100), Reopen session; rows per page 10, 20 or 50 (10), Live.
Counterexamples: a Terminals per workbench of 4 does not close running terminals above four; it only
refuses new ones (New). A rows-per-page choice made in one list is not saved as the setting.
In scope: registry keys for the settings above at application scope; the main-process and renderer seams that
read them; the IPC and agent-read caps that must follow the new maximums; labels, tooltips and help in
en/ro/de/fr; requirements that fix the old values.
Out of scope: STATED (plan, Not exposed) command prompt ready 5000 ms, terminal poll 250/1000 ms,
IDLE_TIMEOUT_MS, follow threshold, jump highlight, plugin library page sizes 6/12/24; workbench or session
scopes for these settings (plan lists them under Application scope); SAVE-02.
Constraints: master branch, no task branch (user, 2026-11-21: work on master). Autopilot with no questions:
open decisions use my recommendation, recorded as technical rulings (user, 2026-11-21). Targeted tests only;
pre-release, no migration or compatibility code; UI style rules (no helper text, tooltip only).
Success signals: focused tests show each seam using the resolved value and its default when unset; the
Advanced panel lists the new fields with ranges and timing; help tables list them; typecheck, lint, i18n
and help checks pass.
Evidence: the OBSERVED seams above (terminals.ts:54/57-64/126/309/321-322, shared/terminals.ts:32,
ipc.ts:188, terminal-tab.tsx:49/265, updates.ts:63-85, catalog-checks.ts:2/25-29, logger.ts:52,
transcript.tsx:36-37/103/114, pager.tsx:4/10/38); the registry shared/src/advanced-settings.ts supports int
and switch kinds only.
Assumptions: INFERRED the logger is created before the settings service in main/index.ts, so its getter must
not read settings at construction; the first entry is written after module evaluation.
Unknowns: whether a 4 Mi character buffer is acceptable when the renderer polls the full terminal output
every 250 ms (terminal-tab.tsx:88-112); how a discrete 10/20/50 choice fits the int-only registry; which
timing label fits intervals, log retention and transcript rows (the Live tooltip says "next turn").
Decision-blocking questions: none left; the unknowns are decided by technical rulings under the standing
autopilot instruction.
Proposed behaviors: decided in RULING-001..004 (not user-accepted; technical under autopilot).

## Requirement coverage

| Behavior | Requirement | Kind |
|---|---|---|
| A terminal above the resolved Terminals per workbench is refused with BUSY; New is disabled; open ones stay | REQ-FUNC-7509bd1e | created |
| A running terminal keeps output up to its resolved Terminal buffer (read when it opens) | REQ-FUNC-240f4e02 | created |
| A terminal view keeps the resolved Terminal scrollback lines | REQ-UX-996ae06e | created |
| terminal_read returns the last resolved Terminal output for the agent characters, within the resolved Tool result size | REQ-FUNC-ef931b1f | created |
| Agent terminal reads stay consent-bound and bounded | REQ-SEC-c1ba6fbf | reused |
| Update checks run every resolved Update check interval; a save restarts the wait | REQ-FUNC-a16121c6 | revised |
| Catalog checks run every resolved Plugin catalog check interval; a save restarts the wait | REQ-FUNC-ce542246 | revised |
| Daily logs are retained up to the resolved Log retention | REQ-FUNC-4a030008 | revised |
| A transcript mounts the resolved first rows and later chunks | REQ-UX-a4cf0527 | created |
| Paged lists start at the resolved Rows per page | REQ-UX-441b5a9d | created |
| The pager stays shared and hidden for ten rows or fewer | REQ-UX-052f5851 | reused |
| An Advanced choice offers Inherit and its allowed values | REQ-UX-6a8a987d | created |
| A stored or saved choice outside its values is refused like an out-of-range value | REQ-DATA-96ef3dd6 | revised |
| The timing icon tooltip names when a change applies | REQ-UX-9ea9184f | reused |

## Design

**Approach.** Ten application keys join the shared registry (REQ-DATA-96ef3dd6): terminals (1-16, 8, new),
terminalBufferK (64-1024 Ki chars, 256, new; RULING-001), terminalScrollback (1000-50000 lines, 3000, new),
terminalAgentChars (2000-64000, 12000), updateInterval and catalogInterval (1-168 h, 6/24), logDays (1-90, 7),
transcriptRows (20-200, 40, new) and transcriptChunkRows (50-500, 100, new), and pageSize, a new `choice`
kind with options 10/20/50 (default 10; RULING-002). Main-process services take getters read when the value
is used, like ADV-03/04 (`appAdvanced` in main/index.ts). The renderer gets one module store
`hooks/app-advanced.ts` (set from the settings snapshot in usePreferences, read with useSyncExternalStore),
because pager, transcript and terminal components also render without a QueryClient in tests. Rejected:
passing values as props through every list (28 call sites) or reading React Query in each component.

**Interfaces and data.**
- Registry: `ChoiceSetting { kind: "choice"; options; default; scopes; applies }`; its value schema accepts an
  integer among the options only, so a patch of 15 is refused and a stored 15 is ignored (REQ-DATA-96ef3dd6,
  REQ-DATA-33a90ef2). `AdvancedValueOf` is number for choice.
- TerminalService host gains `limits?(): { terminals; bufferChars; agentChars }`: create refuses at
  `terminals` with BUSY (REQ-FUNC-7509bd1e), each entry stores `buffer` from `bufferChars` at create
  (REQ-FUNC-240f4e02), `recent()` keeps `agentChars` (REQ-FUNC-ef931b1f). Without limits the old values apply.
  `TerminalReader.publish(output, limit?)` caps with `limit`; terminal_read passes `toolLimit(ctx,
  "toolResultChars")` (RULING-004). readSchema, terminal.list and the snapshot schema follow the registry maxima.
- Updates `preferences()` may carry `intervalHours`; a change of only the interval restarts the timer
  without a check (REQ-FUNC-a16121c6). CatalogChecks `intervalMs: number | () => number` and
  `settingsChanged()` restarting the interval without a tick (REQ-FUNC-ce542246); index.ts calls it from the
  settings `changed` callback (settings load in whenReady, after module evaluation).
- `createLogger(directory, clock, keep?)`: prune when the day or the kept count changed; the getter is read
  inside the write queue, and while it throws (logger is built before the settings service) nothing is pruned.
- Renderer: terminal-tab reads terminalScrollback at mount (REQ-UX-996ae06e) and disables New at the resolved
  count; transcript reads the two row counts into a ref when the session changes (REQ-UX-a4cf0527);
  `usePaged(items, initialSize?)` uses picked ?? initialSize ?? resolved pageSize (REQ-UX-441b5a9d);
  AdvancedField renders a choice as a select with Inherit (REQ-UX-6a8a987d). Timing texts per RULING-003.

**Files and test seams.** shared advanced-settings(.test), ipc.ts, terminals.ts; desktop main terminals,
updates, catalog-checks, logger (+ tests), index.ts (inspection); core tools/terminal-read(.test);
renderer hooks/app-advanced.ts, use-preferences.ts, terminal-tab, transcript, pager, advanced-field,
workbench-capabilities, mocks/mockApi.ts (terminal cap) with terminal-tab.test, transcript-progressive.test,
pager.test, advanced-settings.test; locales en/ro/de/fr; help advanced-settings and the pages naming the old
values (six hours, once a day, seven files).

**Risks and open decisions.** Logger getter before settings load: no pruning until it resolves (review round 1). The renderer store is module
global: one window per app. No migration (pre-release). No open product decision; RULING-001..004 technical.

**Requirement map.** REQ-FUNC-7509bd1e, -240f4e02, -ef931b1f: TerminalService limits; REQ-SEC-c1ba6fbf: no
design impact (consent checks unchanged); REQ-UX-996ae06e: terminal-tab mount; REQ-FUNC-a16121c6: Updates;
REQ-FUNC-ce542246: CatalogChecks; REQ-FUNC-4a030008: logger; REQ-UX-a4cf0527: transcript; REQ-UX-441b5a9d and
REQ-UX-052f5851: pager (hide rule unchanged); REQ-UX-6a8a987d and REQ-DATA-96ef3dd6: choice kind;
REQ-UX-9ea9184f: timing texts.

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: frame recorded under autopilot (user 2026-11-21: finish ADV without questions); scope from 00_Planning/advanced-settings.md ADV-05; no decision-blocking question left, unknowns settled by RULING-001..004 (technical)
- 2026-11-21 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: design written under autopilot with structure, sequence and state diagrams in diagram_TASK-07b74bbb.md; no open product decision
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: npx vitest run shared/src/advanced-settings.test.ts -t Desktop settings exit 1 - the ten desktop keys and the choice kind are not registered (REQ-FUNC-7509bd1e REQ-FUNC-240f4e02 REQ-UX-996ae06e REQ-FUNC-ef931b1f REQ-FUNC-a16121c6 REQ-FUNC-ce542246 REQ-FUNC-4a030008 REQ-UX-a4cf0527 REQ-UX-441b5a9d REQ-DATA-96ef3dd6)
- 2026-11-21 build: red: npx vitest run renderer/components/advanced-settings.test.ts exit 1 - no Rows per page choice select, no labels for the desktop keys, Live tooltip still says next turn (REQ-UX-6a8a987d REQ-UX-9ea9184f)
- 2026-11-21 build: green: npx vitest run shared/src/advanced-settings.test.ts and renderer/components/advanced-settings.test.ts exit 0, 16 + 4 pass (REQ-UX-6a8a987d REQ-DATA-96ef3dd6 REQ-UX-9ea9184f; registry rows for the other keys)
- 2026-11-21 build: red: npx vitest run desktop main/terminals.test.ts and core tools/terminal-read.test.ts exit 1 - a third terminal opens at count 2, a 64 Ki buffer keeps 110000 characters, the agent tail stays 12000, publish gets no tool result size (REQ-FUNC-7509bd1e REQ-FUNC-240f4e02 REQ-FUNC-ef931b1f)
- 2026-11-21 build: red: npx vitest run desktop main updates, catalog-checks and logger tests exit 1 - the update timer keeps six hours, CatalogChecks has no settingsChanged, the logger keeps seven files after retention 3 (REQ-FUNC-a16121c6 REQ-FUNC-ce542246 REQ-FUNC-4a030008)
- 2026-11-21 build: green: npx vitest run desktop main terminals, terminal-command-dispatch, core terminal-read exit 0 (44 pass) and updates, catalog-checks, logger exit 0 (17 pass) (REQ-FUNC-7509bd1e REQ-FUNC-240f4e02 REQ-FUNC-ef931b1f REQ-FUNC-a16121c6 REQ-FUNC-ce542246 REQ-FUNC-4a030008); main/index.ts wires terminal limits, update and catalog intervals and log retention through appAdvanced
- 2026-11-21 build: red: npx vitest run renderer pager, terminal-tab and transcript-progressive tests exit 1 - lists stay at 10 rows with Rows per page 20, the view keeps scrollback 3000 with 10000 set, the transcript mounts 40 rows with 20 set (REQ-UX-441b5a9d REQ-UX-996ae06e REQ-FUNC-7509bd1e REQ-UX-a4cf0527); first run failed on the missing store module, so the store was added alone before this red
- 2026-11-21 build: green: npx vitest run renderer pager, terminal-tab, transcript-progressive, transcript-navigator exit 0 (48 pass); 14 pager and settings component files 94 pass; npm run typecheck exit 0 (REQ-UX-441b5a9d REQ-UX-996ae06e REQ-FUNC-7509bd1e REQ-UX-a4cf0527)
- 2026-11-21 build: green: npm run test:e2e -- tests/e2e/advanced-settings.spec.ts tests/e2e/terminal.spec.ts exit 0 (2 pass, native PTY included); help updated in en/ro/de/fr (Advanced table rows, timing column, Desktop paragraph, update/catalog/log mentions), check:help and check:i18n exit 0; lint exit 0 with the existing warnings only; requirements activated with linked tests
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: inspection REQ-FUNC-7509bd1e: shared/src/ipc.ts terminal.list max(advancedSettings.terminals.max) = 16 and main/terminals.ts readSchema leases and terminals max(advancedSettings.terminals.max); inspection REQ-FUNC-240f4e02: shared/src/terminals.ts snapshot output max(terminalBufferK.max * 1024) = 1048576; inspection REQ-FUNC-ce542246: main/index.ts enabled() still requires update mode not off and a catalog location, intervalMs reads appAdvanced catalogInterval, and the settings changed callback calls catalogChecks.settingsChanged(); all observed as required
- 2026-11-21 validate: knowledge pages terminals, updates, plugins-catalog, app-data, chat-ui and renderer-foundation brought in line; project and environment context need no change (no new command, path or environment fact); ADV-04 diagram label 500/100 corrected to 500/64 (record fix)
- 2026-11-21 validate: review round 1: spec and quality changes_required. Must-fix (both): a log entry written before settings load prunes with the fallback seven and deletes files a longer Log retention keeps. Quality low: the transcript test changes the chunk size after the first chunk, so it does not prove the read-on-show ref. Spec should-fix: help and tooltips say transcript rows load while scrolling (they load in idle chunks); specs REQ-DATA-4a030001, REQ-DATA-b40d3f9b and REQ-FUNC-a16121c6 still state seven, 24 h and six hours; REQ-DATA-96ef3dd6 verification lacks the choice case. Nits: ambiguous linked test name, test files missing from affected_paths, a stored choice outside its options shows a blank select, a saved Rows per page change keeps the current page, the transcript ref initializer runs on every render
- 2026-11-21 validate: returned to build - review round 1 findings: logger prunes before retention is readable; transcript test; help, spec and requirement text; four nits
- 2026-11-21 build: red: npx vitest run desktop main/logger.test.ts and renderer pager.test.ts exit 1 - a logger whose retention getter throws prunes to seven files; a saved Rows per page change keeps the list on page 3 (REQ-FUNC-4a030008 REQ-UX-052f5851 REQ-UX-441b5a9d). The strengthened transcript test (chunk size changed before the first chunk) and the stored-15 choice test pass at once: the ref already reads on show, and React selects the first option (Inherit) when no option matches, so nit 7 needs no code change
- 2026-11-21 build: round 1 fixes: logger prunes nothing while the retention getter throws and prunes with the resolved value from the first entry after it resolves; saved Rows per page changes return a list to page one; transcript counts resolved lazily once per shown session and the test changes the chunk size before the first chunk; help and transcript tooltips in en/ro/de/fr say older rows are added in the background; specs REQ-DATA-4a030001, REQ-DATA-b40d3f9b, REQ-FUNC-a16121c6 name the resolved values; REQ-DATA-96ef3dd6 verification adds the choice case; REQ-FUNC-4a030008 prose and verification cover the unreadable retention; Desktop registry test renamed so its link is unique; test files added to affected_paths. Nit 7 (stored choice outside options) needs no change: React selects the first option, Inherit, asserted by selectedIndex 0
- 2026-11-21 build: green: npx vitest run 21 focused files exit 0, 200 pass (all ADV-05 tests plus pager users, transcript render and navigator, mockApi, settings-save); npm run typecheck, lint, check:i18n, check:help exit 0 (REQ-FUNC-4a030008 REQ-UX-052f5851 REQ-UX-441b5a9d REQ-UX-a4cf0527 REQ-UX-6a8a987d)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 2: spec approved, quality approved; no candidate edit after the verdicts
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-07b74bbb --strict --run exit 0; lint, typecheck, i18n, help ok, test not in the run list (targeted-tests standing instruction; focused proof 21 files 200 pass and e2e advanced-settings + terminal logged above); 156 warnings are uncovered-source over the shared master working tree (ADV-01..04 and other writers) and outside-layout/secret-in-diff for untracked captures/*.pcapng outside this task; no ADV-05 file is uncovered
- 2026-11-21 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-21 | decision=Terminal buffer is 64-1024 Ki characters (default 256 Ki), not up to 4 Mi; Terminals per workbench 1-16, lowering it closes no running terminal | reason=the renderer polls the full masked buffer over IPC every 250 ms; 1 Mi bounds that work at four times today | source=technical | supersedes=none
- RULING-002 | date=2026-11-21 | decision=Rows per page is a new registry kind choice with options 10, 20 and 50 (default 10): a select with inherit; it is the size a list starts with, a size picked in one list stays for that list | reason=the plan offers three sizes, which an integer range cannot express; the pager offers the same three | source=technical | supersedes=none
- RULING-003 | date=2026-11-21 | decision=Timing tooltips: Live reads Applies right away, New reads Applies to the next terminal, worker, run or opened session; intervals and log retention are Live (a saved interval restarts its timer, retention applies at the next log entry); transcript rows are New (read when a session transcript is shown) | reason=the old Live text named the next turn, which does not fit timers, logs or lists; one timing set stays | source=technical | supersedes=none
- RULING-004 | date=2026-11-21 | decision=terminal_read output is capped with the resolved Tool result size instead of the fixed 32000, so an agent output above 32000 characters reaches the model when both are raised | reason=the agent output maximum 64000 exceeds the fixed cap, which would shrink it silently | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-07b74bbb.md
changed: 7 created, 4 revised, 3 reused
evidence: check --task TASK-07b74bbb --strict --run exit 0
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-a16121c6 - Discover updates from fixed generic feed
  - REQ-FUNC-ce542246 - Check the catalog for updates at start and every resolved catalog interval
  - REQ-FUNC-4a030008 - Retain the resolved number of daily structured log files
  - REQ-UX-052f5851 - Page long lists with a shared pager
  - REQ-SEC-c1ba6fbf - Per-terminal agent read consent
  - REQ-UX-9ea9184f - Edit an Advanced setting with inherit, reset and apply timing
  - REQ-DATA-96ef3dd6 - Store Advanced settings per application, workbench and session
  - REQ-FUNC-7509bd1e - Refuse a terminal above the resolved Terminals per workbench
  - REQ-FUNC-240f4e02 - Keep the resolved terminal buffer of each terminal
  - REQ-UX-996ae06e - Keep the resolved scrollback lines in a terminal view
  - REQ-FUNC-ef931b1f - Give the agent the resolved terminal output size
  - REQ-UX-a4cf0527 - Mount transcript rows in the resolved first and later counts
  - REQ-UX-441b5a9d - Start paged lists at the resolved Rows per page
  - REQ-UX-6a8a987d - Edit an Advanced choice with inherit and its options
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 7765491: 307 file(s) changed, 10544 line(s) added; 3 file(s) not content-scanned
- checks: errors=0 warnings=156 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
