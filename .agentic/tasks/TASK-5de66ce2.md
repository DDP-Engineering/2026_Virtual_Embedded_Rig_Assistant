# TASK-5de66ce2 - ADV-03 Advanced settings for tools, programs and web

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-f6f79cd2, REQ-FUNC-150dcb0b, REQ-FUNC-f041ba07, REQ-FUNC-0df8e905, REQ-FUNC-820e2701, REQ-FUNC-da830c44, REQ-FUNC-5eacaf9f, REQ-FUNC-b1a2db33, REQ-FUNC-9455436f, REQ-FUNC-5e129df5, REQ-FUNC-8a1eea8b, REQ-FUNC-17f34e4b, REQ-FUNC-dfe84577, REQ-FUNC-dd50ebed, REQ-FUNC-ddcd96b8, REQ-FUNC-1e7d6449, REQ-FUNC-e1d2f670, REQ-FUNC-ae2806b9, REQ-FUNC-19554499, REQ-FUNC-902313e0, REQ-DATA-96ef3dd6, REQ-DATA-33a90ef2, REQ-UX-9ea9184f, REQ-UX-504e0d6d
parent:
branch: master
base: 1f21304d4532c47445d06f8fa49fbe4e211c7c9d
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

Problem: The tool, program and web limits are fixed in code: the tool result size (32000 characters, cut
twice: tools/registry.ts capToolResult and agent/runtime.ts:542), the read window (2000 lines, 30000
characters in read-window.ts), grep results and per-file size (500, 5 MiB), glob results (500), the worker
deadline (10 s, node-host.ts), web search results and read size (5, 12000), the web request timeout (30 s,
web/http.ts and exa.ts, never configured), the download size and time limit (100 MiB bound into the approval
as a schema literal, 120 s), background programs per session (4), run logs kept and log size (200, 64 MiB),
and the program and shell timeout ceilings (600 s). OBSERVED in the files named, mapped this session.
Desired outcome: The ADV-03 rows of 00_Planning/advanced-settings.md are Advanced settings with the plan's
ranges, defaults and apply timing, resolved like ADV-01/02 and changing the behavior their row names.
STATED (user: "Do this task here: ADV-03 Tools, programs and web settings"; plan ADV-03 package and tables).
Actors: the engineer in the desktop app or the CLI; the agent's tools; the session service; the program
runner and the worker pool; the web provider and downloads.
Primary scenario: The engineer raises Tool result size to 64000 and the read window to 6000 lines; the next
read of a long file returns up to 6000 lines and a result up to 64000 characters reaches the model uncut.
Examples:
- Download size 500 MiB: the next web_download approval shows 500 MiB and a 300 MiB SDK archive downloads.
- Workbench Program timeout ceiling 1800 s: a 20-minute build through run_program is not cut at 10 minutes.
- Background programs per session 8: a fifth and sixth background monitor start instead of BUSY.
- Web request timeout 90 s: a slow search provider answers after 60 s instead of failing.
Counterexamples:
- A plugin rule or program timeout still wins over the ceiling for that program (plugin manifests already
  allow 1-3600 s, plugins.ts:281/348); the ceiling only replaces the built-in 600 s.
- A download approved under one size limit keeps that bound value; a later change does not alter it.
- Zip, PDF page, catalog and plugin package limits, MAX_MESSAGE_IMAGES and security caps stay fixed (plan
  "Not exposed").
In scope: application settings - toolResultChars (8000-128000, 32000), readLines (500-10000, 2000),
readChars (10000-120000, 30000), grepResults (50-2000, 500), grepFileMB (1-50, 5), globResults (100-5000,
500), workerDeadline (5-120 s, 10, applies New), webSearchResults (1-8, 5), webReadChars (1000-16000,
12000), webTimeout (5-120 s, 30), downloadMB (10-1000, 100), downloadTimeout (30-1800 s, 120),
backgroundPrograms (1-16, 4, applies New), runLogsKept (20-2000, 200), runLogMB (8-1024, 64); workbench
settings with an application value they override - programTimeout (60-3600 s, 600) and commandTimeout
(60-3600 s, 600). Labels, tooltips, help rows en/ro/de/fr, requirements, knowledge pages.
Out of scope: ADV-04 documents (the PDF extractor base deadline web/downloads.ts:38 is ADV-04 "Document
extraction time limit") and ADV-05 desktop (terminal_read output and terminal limits, plan row "Terminal
output for the agent"); parse_log and decode_register keep their own 32000 tool-specific bounds (no plan
row); glob examined 5000 and list 5000 (no plan row); the HTTP response size caps (no plan row); CLI flags
for these keys (none is a session setting).
Constraints: on master (the repository's default branch; the user asked for master); pre-release, no
migrations or compatibility code (user rule), so the stored download approval schema may change from a
literal to the setting's range; targeted tests only (user); invalid stored values fall back to the default.
Success signals: each setting changes the behavior named in its row; tool descriptions no longer state a
fixed number that the setting can change; settings appear only with Show advanced settings on; help lists
them.
Evidence: plan tables (application rows Tool result size .. Run logs; workbench rows Program and Shell
timeout ceilings); seam map this session: registry.ts:97/191, runtime.ts:542, read.ts:16/24,
read-window.ts:42/68, grep.ts:11/17, grep-worker.ts:52/55/83, glob.ts:7/12/21, node-host.ts:41/77-95,
web/provider.ts:89/104, web/http.ts:17, exa.ts:116/191/194, downloads.ts:6/21/36, download-transfer.ts:9/83,
web/downloads.ts:85/89-96/214, web-download.ts:46, program-tools.ts:97/126-135/470-477/543-553,
command-tools.ts:18/33/62/117, runner.ts:950-957/1060-1066/1135.
Assumptions: STATED - program and command ceilings get an application value too, which the workbench overrides
(RULING-001 of this task, user, 2026-11-21); INFERRED - sizes
in MiB and times in seconds as integers, like ADV-02; INFERRED - glob examined stays 5000, which is the
largest allowed returned count.
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: (not accepted until specify)
- read lines, grep results, web search results and web read size: the setting is the default when the model
  gives no value and the ceiling for a value it gives; tool schemas accept up to the setting's maximum.
- Tool result size also sets the runtime's final cut, so a raised size reaches the model.
- The download approval binds the resolved size; the transfer enforces the approved size; the download
  time limit bounds the transfer and the save, not the PDF extraction.
- Tool descriptions drop fixed numbers that a setting changes (grep 10 s / 500, glob 500, run_command 600).

## Requirement coverage

| Behavior | Requirement | Source |
|---|---|---|
| Tool result size, registry and runtime cut | REQ-FUNC-f6f79cd2 (new) | plan app row; Frame proposed behavior |
| Read window lines, default and ceiling | REQ-FUNC-150dcb0b (new) | plan app row; proposed behavior |
| Read output size | REQ-FUNC-f041ba07 (new) | plan app row |
| Grep results, default and ceiling | REQ-FUNC-0df8e905 (new) | plan app row; proposed behavior |
| Grep file size | REQ-FUNC-820e2701 (new) | plan app row |
| Glob results | REQ-FUNC-da830c44 (new) | plan app row |
| Worker deadline (New) | REQ-FUNC-5eacaf9f (new) | plan app row |
| Web search results, default and ceiling | REQ-FUNC-b1a2db33 (new) | plan app row; proposed behavior |
| Web read size, default and ceiling | REQ-FUNC-9455436f (new) | plan app row; proposed behavior |
| Web request timeout | REQ-FUNC-5e129df5 (new) | plan app row |
| Download size bound into the approval | REQ-FUNC-8a1eea8b (new) | plan app row ("The approval still shows the bound value") |
| Download over the approved size refused (error) | REQ-FUNC-17f34e4b (new) | proposed behavior; failure case |
| Download time limit | REQ-FUNC-dfe84577 (new) | plan app row; proposed behavior |
| Background programs per session (BUSY) | REQ-FUNC-dd50ebed (new) | plan app row |
| Run logs kept | REQ-FUNC-ddcd96b8 (new) | plan app row |
| Run log size | REQ-FUNC-1e7d6449 (new) | plan app row |
| Program timeout ceiling | REQ-FUNC-e1d2f670 (new) | plan workbench row; counterexample (plugin timeouts win) |
| Shell command timeout ceiling | REQ-FUNC-ae2806b9 (new) | plan workbench row |
| Tool descriptions without changeable numbers | REQ-FUNC-19554499 (new) | success signal; proposed behavior |
| Precedence, storage, invalid values, field, help | REQ-FUNC-902313e0, REQ-DATA-96ef3dd6, REQ-DATA-33a90ef2, REQ-UX-9ea9184f, REQ-UX-504e0d6d (reused) | ADV-01 framework |


## Design

**Approach.** Seventeen registry entries (ADV-01 `int` kind; `applies: "new"` for workerDeadline and
backgroundPrograms) and two delivery paths. Per-call tool limits read a new `ToolContext.advanced(key)`
getter the session service sets each turn to its own `resolveAdvanced`, like `ctx.permissionMode`; a
`toolLimit(ctx, key)` helper falls back to the registry default for hosts and tests without a service.
App-wide services (worker pool, program runner, web provider) are shared across sessions and their rows are
application scope, so their hosts take a getter that desktop main and CLI run fill from the application
values, as ADV-02 did for headerWait. Rejected: per-session runner and pool instances (state is app-wide).

**Interfaces and data.**
- Tool results (REQ-FUNC-f6f79cd2): `capToolResult(value, protected, limit = 32000)`; registry `capResult`
  and the service's program apply pass `toolLimit(ctx, "toolResultChars")`; `RuntimeInit.maxToolResultChars`
  replaces the 32000 final cut in runtime.ts.
- read (REQ-FUNC-150dcb0b, -f041ba07): schema limit max 10000; lines = min(limit ?? setting, setting);
  `readWindow(..., { maxChars })` default 30000, source-byte window max(256 KiB, 4 x maxChars); citations and
  viewer keep the defaults.
- grep (REQ-FUNC-0df8e905, -820e2701): schema maxResults max 2000, clamped like read; `WorkerTask.maxFileBytes`
  (the worker re-parses strict args, so the size travels beside them), default 5 MiB. glob
  (REQ-FUNC-da830c44): returned = setting, examined stays 5000 (the setting's maximum).
- Worker pool (REQ-FUNC-5eacaf9f): `WorkerHostOptions.deadlineMs` may be a getter; `pump` reads it once per
  task as it starts, so a running task keeps its deadline; `deadlineMs` stays a readable property.
- Web (REQ-FUNC-b1a2db33, -9455436f): web.ts reads the raw limit/maxCharacters before the schema default,
  clamps to the setting and passes an explicit value. Timeout (REQ-FUNC-5e129df5): ConfiguredWebProvider host
  `timeoutMs?()`, passed to vendor constructors and to `create(provider, key, { timeoutMs })`.
- Downloads (REQ-FUNC-8a1eea8b, -17f34e4b, -dfe84577): `DOWNLOAD_MAX_BYTES` becomes the 1000 MiB ceiling; the
  approval schema's `maxBytes` becomes a range 10-1000 MiB; prepare binds `downloadMB` x 1 MiB; apply passes the
  approved maxBytes and the resolved deadline to `WebDownloads.save`, which passes both to the transfer port
  and uses the deadline for the save signal; the desktop transfer forwards the budget. Over size: the existing
  "Download exceeds the size limit." error, nothing saved.
- Runner (REQ-FUNC-dd50ebed, -ddcd96b8, -1e7d6449): `ProgramRunnerOptions.limits?()` refreshed into the shared
  settings object at each start, hold and prune.
- Timeouts (REQ-FUNC-e1d2f670, -ae2806b9): `programTimeout(..., ceiling)` and `timeoutCap(..., ceiling)` with
  rule ?? program ?? ceiling; run_program and HIL use `toolLimit(ctx, "programTimeout")`; run_command binds
  min(requested, `commandTimeout`) at prepare (part of the approval hash, as today).
- Descriptions (REQ-FUNC-19554499): grep, glob, parse_log and run_command name the limit, not a number.

**Files and test seams.** shared advanced-settings.ts(+test), downloads.ts(+test); core tools context.ts,
registry.ts, read.ts, read-window.ts, grep.ts, grep-worker.ts, glob.ts, web.ts, web-download.ts, parse-log.ts;
ports.ts; workers/node-host.ts; web configured-provider.ts, downloads.ts, download-transfer.ts; plugins
runner.ts, program-tools.ts, command-tools.ts; agent runtime.ts/types.ts; sessions/service.ts. Desktop main
index.ts, web-access.ts, download-transfer.ts; CLI run.ts, worker-pool.ts. Renderer advanced-field.tsx labels,
locales, help x4. Tests beside each file (registry, read, grep, discovery, node-host, web tools,
configured-provider, downloads, runner, program-tools, command tools) plus one service test that a session's
ctx resolves the application values.

**Risks and open decisions.** Stored `approval.requested` events with 100 MiB still validate under the range
(pre-release, no migration). A tool result size below the read output size makes the registry halve read
output (documented in help). The approval card and CLI prompt must show the bound value, not the constant.

**Requirement map.** Each new ID maps to the bullet naming it; REQ-FUNC-902313e0, REQ-DATA-96ef3dd6,
REQ-DATA-33a90ef2, REQ-UX-9ea9184f and REQ-UX-504e0d6d have no design impact beyond new registry rows.

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: scope recorded on autopilot from the accepted ADV plan and the seam map; program and command ceilings take an application value too, inferred from RULING-001 of TASK-76ca8aa6
- 2026-11-21 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: note written (ToolContext.advanced for per-call tool limits, host getters for the app-wide pool, runner and web provider, download size bound into the approval and enforced by the transfer); diagram_TASK-5de66ce2.md structure and sequence drawn, state not drawn
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: vitest shared advanced-settings.test.ts -t Tool-program-web exit 1 - the 17 ADV-03 keys are not registered. green: 13 pass after the registry entries (int helper takes an apply timing; workerDeadline and backgroundPrograms New) (REQ-FUNC-f6f79cd2 REQ-FUNC-150dcb0b REQ-FUNC-f041ba07 REQ-FUNC-0df8e905 REQ-FUNC-820e2701 REQ-FUNC-da830c44 REQ-FUNC-5eacaf9f REQ-FUNC-b1a2db33 REQ-FUNC-9455436f REQ-FUNC-5e129df5 REQ-FUNC-8a1eea8b REQ-FUNC-dfe84577 REQ-FUNC-dd50ebed REQ-FUNC-ddcd96b8 REQ-FUNC-1e7d6449 REQ-FUNC-e1d2f670 REQ-FUNC-ae2806b9)
- 2026-11-21 build: red: vitest core sessions/tool-limits.test.ts exit 1 - toolResultChars 8000 still delivers a 25650-character read result, and raised toolResultChars/readChars still stop at 30409 (read cap and the 32000 cuts are fixed) (REQ-FUNC-f6f79cd2 REQ-FUNC-f041ba07)
- 2026-11-21 build: green: vitest core sessions/tool-limits, tools/read, tools/registry 22 pass after ToolContext.advanced + toolLimit, capToolResult limit, RuntimeInit.maxToolResultChars, readWindow maxChars and read lines default/ceiling (schema max 10000; registry test now refuses 10001). read.test.ts lines/chars case written with the code; the session test was red first (REQ-FUNC-f6f79cd2 REQ-FUNC-150dcb0b REQ-FUNC-f041ba07)
- 2026-11-21 build: red: vitest core tools/grep.test.ts -t Grep-results exit 1 - 80 matches returned with grepResults 50; tools/discovery.test.ts -t Glob-results exit 1 - 150 paths with globResults 100. green: grep + node-host 17 pass and discovery 4 pass after grep default/ceiling (schema max 2000), WorkerTask.maxFileBytes, glob returned = setting (REQ-FUNC-0df8e905 REQ-FUNC-820e2701 REQ-FUNC-da830c44)
- 2026-11-21 build: red: vitest core workers/node-host.test.ts -t Worker-deadline exit 1 - the pool refuses a deadline getter (Invalid worker host limits). green: node-host 9 pass after WorkerHostOptions.deadlineMs getter read once as each task starts (constructor validates fixed values only, so a host may build the pool before its settings); desktop index.ts appAdvanced helper and CLI run.ts pass the application workerDeadline (REQ-FUNC-5eacaf9f)
- 2026-11-21 build: red: vitest core tools/web-limits.test.ts exit 1 - web_search sends 5/8/2 and web_read 12000/16000/2000 instead of the session setting, and ConfiguredWebProvider creates clients without a timeout. green: web-limits + core web 93 pass after web tools take the raw value bounded by the setting, ConfiguredWebProvider host timeoutMs passed to vendor constructors and create(provider, key, options) (existing create assertions extended with the options argument); desktop web-access.ts and CLI run.ts pass the application webTimeout (REQ-FUNC-b1a2db33 REQ-FUNC-9455436f REQ-FUNC-5e129df5)
- 2026-11-21 build: red: vitest core sessions/downloads.test.ts -t Download-size exit 1 - the approval binds 100 MiB with downloadMB 500; web/downloads.test.ts -t approved-size/time-limit exit 1 - a 12 MiB response over a 10 MiB budget is saved and a stalled transfer ignores the budget deadline. green: 5 files 73 pass after DOWNLOAD_MAX_BYTES = 1000 MiB ceiling, approval maxBytes range 10-1000 MiB, prepare binds downloadMB, apply passes the approved size and the downloadTimeout to WebDownloads.save (DownloadBudget), save bounds the signal and the size check by it and forwards both to the transfer port; transferFile defaults to the settings defaults with the settings maxima as ceilings; desktop download transfer forwards the budget. shared downloads.test.ts stored-record ceiling now 1000 MiB + 1 (REQ-FUNC-8a1eea8b REQ-FUNC-17f34e4b REQ-FUNC-dfe84577)
- 2026-11-21 build: red: vitest core plugins/runner.test.ts -t host-limits exit 1 - a third background run starts with a host limit of 2. green: runner + runner-leases 79 pass after ProgramRunnerOptions.limits refreshed into the shared settings at each start, hold and prune (valid positive integers only); desktop index.ts and CLI run.ts pass the application backgroundPrograms, runLogsKept and runLogMB (REQ-FUNC-dd50ebed REQ-FUNC-ddcd96b8 REQ-FUNC-1e7d6449)
- 2026-11-21 build: red: vitest core plugins/program-tools.test.ts and command-tools.test.ts -t ceiling exit 1 - 600 s cap regardless of the resolved ceilings. green: 5 files 119 pass after programTimeout(ceiling) and timeoutCap(current, ceiling) with rule ?? program ?? ceiling, run_program and HIL use the session programTimeout, run_command binds min(requested, commandTimeout) at prepare (REQ-FUNC-e1d2f670 REQ-FUNC-ae2806b9). Descriptions of read, grep, glob, parse_log and run_command name the configured limit; registry.test.ts description test written after the wording change, it fails on any of the old numbers (REQ-FUNC-19554499)
- 2026-11-21 build: green: targeted vitest 29 files 438 pass (shared advanced-settings, downloads; core sessions tool-limits, downloads, advanced, service, tools read, registry, grep, discovery, web-limits, parse-log, web/*, node-host, runner, runner-leases, program-tools, command-tools, program-approvals, runtime; desktop web-access, renderer advanced-settings, workbench-advanced, session-advanced; cli run-args) after updating desktop web-access create assertions for the timeout argument; npm run test:e2e -- advanced-settings.spec.ts 1 pass (downloadMB default shown); typecheck exit 0; lint exit 0 (all 119 changed and untracked files clean); check:i18n and check:help exit 0 (REQ-UX-9ea9184f REQ-UX-504e0d6d)
- 2026-11-21 build: evolution reviewed: 63 paths; every source and test path is a seam the design names. Outside the task and not touched by this session: 00_Planning/{Agent,Delivery,Interface,Overview,Plugins,System,Workbench}.md added and README.md modified between 08:48 and 09:02 local time by another writer, and the earlier deletion of 00_Planning/code-review-2026-11-17-98946c0b.md; all left as found. check --task errors=0; remaining warnings are the layout heuristics explained in TASK-76ca8aa6 (help pages outside doc globs, colocated tests counted as source)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 1: quality approved (minor: download deadline also bounds PDF extraction; runtime final cut read at turn start - consistent with the next-turn timing; 1000 MiB held in memory, open() base64 of very large PDFs; a throwing deadline getter is unguarded). spec changes_required: (1) web_search/web_read raised settings never apply when the model gives no value - the registry passes schema-defaulted args (5, 12000) to the tool, and web-limits.test.ts bypassed the registry; (2) glob at 5000 does not mark truncated when more than 5000 files match; minor: PDF extraction under the download deadline, verification clauses asserted less than written, linked tests without tags, desktop create seam type; question answered by the user (below)
- 2026-11-21 validate: returned to build - spec review round 1: web defaults through the registry, glob truncated at the examined cap, PDF extraction outside the download deadline, verification accuracy
- 2026-11-21 build: red: vitest core tools/web-limits.test.ts registry case exit 1 - raised webSearchResults 8 still sends 5 through the registry (schema default); discovery.test.ts exit 1 - globResults 5000 with more files not truncated. green after: web tools take their own params without defaults (provider schemas unchanged) and clamp to the setting; glob marks truncated at the examined cap; download time limit bounds the transfer only (RULING technical below), PDF extraction keeps its deadline; node-host deadline getter guarded against a throw; desktop create seam typed with options; added assertions (truncation marker, read truncated + schema 10000, grep truncated, 20 MiB budget saves a 12 MiB response, run_program-level ceiling 1800 s); tags on web-access.test.ts and download-transfer.test.ts; verification texts of REQ-FUNC-5e129df5, -17f34e4b, -dfe84577 match the tests. Focused: vitest 17 files 229 pass, typecheck, lint, i18n, help exit 0 (REQ-FUNC-b1a2db33 REQ-FUNC-9455436f REQ-FUNC-da830c44 REQ-FUNC-dfe84577 REQ-FUNC-e1d2f670 REQ-FUNC-17f34e4b REQ-FUNC-5e129df5)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 2: spec approved, quality approved. Accepted notes: the local write after a download has no timeout now (cancellable by session lifetime and web access revocation; the time limit is transfer-only by RULING-002); runtime cut literal 32000 duplicates the default; a tree of exactly 5000 matches reports truncated (conservative)
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-5de66ce2 --strict --run exit 0; ran lint ok, typecheck ok, i18n ok, help ok (test not in the run list by policy; targeted vitest 29 files and the advanced-settings e2e logged above, round 1 fixes 17 files 229 pass). Remaining warnings: layout heuristics (help pages outside doc globs, colocated tests counted as source) and repository notes on other requirements; none limits this candidate. Deviations: read lines/chars, description and some download/ceiling assertions were written with or after the code (logged per increment)
- 2026-11-21 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-21 | decision=Program timeout ceiling and Shell command timeout ceiling are application and workbench settings; the workbench value overrides the application one | reason=plan lists them in the workbench table only; the user chose to keep the application level too, as in RULING-001 of TASK-76ca8aa6 (spec review round 1 question) | source=user | supersedes=none
- RULING-002 | date=2026-11-21 | decision=The Download time limit bounds the transfer; PDF text extraction keeps its own deadline | reason=both reviewers read the Frame that way; ADV-04 owns the extraction time limit; the user asked to decide open points with my recommendation | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-5de66ce2.md
changed: 19 created, 5 reused
evidence: check --task TASK-5de66ce2 --strict --run exit 0
issues: none
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-f6f79cd2 - Cut tool results at the resolved Tool result size
  - REQ-FUNC-150dcb0b - Read up to the resolved read window lines
  - REQ-FUNC-f041ba07 - Bound read output at the resolved read output size
  - REQ-FUNC-0df8e905 - Return up to the resolved grep results
  - REQ-FUNC-820e2701 - Skip files above the resolved grep file size
  - REQ-FUNC-da830c44 - Return up to the resolved glob results
  - REQ-FUNC-5eacaf9f - End worker tasks at the resolved worker deadline
  - REQ-FUNC-b1a2db33 - Return up to the resolved web search results
  - REQ-FUNC-9455436f - Read web pages up to the resolved web read size
  - REQ-FUNC-5e129df5 - End web provider requests at the resolved web request timeout
  - REQ-FUNC-8a1eea8b - Bind the resolved download size into the download approval
  - REQ-FUNC-17f34e4b - Refuse a download above its approved size
  - REQ-FUNC-dfe84577 - End downloads at the resolved download time limit
  - REQ-FUNC-dd50ebed - Admit background programs up to the resolved count per session
  - REQ-FUNC-ddcd96b8 - Keep the resolved number of run logs
  - REQ-FUNC-1e7d6449 - Cap a run log at the resolved log size
  - REQ-FUNC-e1d2f670 - Cap program timeouts at the resolved program timeout ceiling
  - REQ-FUNC-ae2806b9 - Cap shell commands at the resolved shell command timeout ceiling
  - REQ-FUNC-19554499 - Describe tools without numbers that settings change
  - REQ-FUNC-902313e0 - Resolve Advanced settings by scope precedence
  - REQ-DATA-96ef3dd6 - Store Advanced settings per application, workbench and session
  - REQ-DATA-33a90ef2 - Ignore invalid stored Advanced values
  - REQ-UX-9ea9184f - Edit an Advanced setting with inherit, reset and apply timing
  - REQ-UX-504e0d6d - Document Advanced settings in help
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 1f21304: 305 file(s) changed, 9883 line(s) added
- checks: errors=0 warnings=103 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
