# TASK-ef3f43a8 - HELP-05 Agent help tool

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-2a87401e, REQ-SEC-3cb78ea6, REQ-UX-a318156e, REQ-FUNC-4fa3e396
parent:
branch: master
base: a8b26c177dd05b9379e00eda890d4966ef559954
opened: 2026-11-15

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

Problem: The agent cannot answer questions about VERA itself from its help: no tool reads help, and the system prompt
does not mention it (STATED plan `00_Planning/plan/help.md` decision "The agent uses help through a read-only `help`
tool"; OBSERVED `core/src/tools/registry.ts` built-in tools, `core/src/agent/prompt.ts` rules).
Desired outcome: a read-only built-in `help` tool lists the topics (app pages and the help of plugins enabled in the
workbench) and reads an app page or an enabled plugin's page in the requested language (default the user's interface
language, English fallback); results carry a `help:` ref the agent cites, and a cited ref opens that page in the Help
view; the system prompt names the tool for questions about VERA (STATED plan HELP-05).
Actors: the agent in a desktop session; the user reading its answer.
Primary scenario: the user asks "How do I switch to Bypass?"; the agent calls `help {page: "permissions"}`, answers
from it and cites `[[help:permissions]]`; the user clicks the chip and Help opens at Permissions.
Examples: `help {}` → `{language, pages:[{page, title, ref:"help:index"}…], plugins:[{plugin:"serial-monitor", title,
ref:"help:plugin/serial-monitor"}]}`; `help {plugin:"esp32-efuse"}` when esp32-efuse is installed but not enabled in
the workbench → an error naming the plugin as not enabled.
Counterexamples: help never writes; it is not offered when the host composes no help (headless CLI); a `help:` ref
the session never received is an invalid citation like any other.
In scope: shared `help` tool name and ref kind, core tool and host port, session wiring (ToolContext, filter, prompt
rule), citation validation, desktop session host, renderer citation routing, Tools editor description (4 locales),
tests.
Out of scope: CLI help composition (no packaged help root for the CLI; INFERRED, recorded as a limit); page content.
Constraints: read-only tool class; core stays Electron-free (STATED project.md); on `master`.
Success signals: unit tests for list/read/fallback/disabled-plugin refusal, citation validity, the prompt rule, and the
renderer opening Help from a `help:` chip.
Evidence: OBSERVED `ToolContext` optional host ports (`parts`, `web`), the session tool filter per absent port,
`validateCitations` checks issued refs per kind, `WorkbenchService.loadPlugins(id)` returns enabled plugins with
folders.
Assumptions: the tool's default language is the interface language resolved like main's desktop-entry names
(INFERRED from HELP-01 `main/index.ts`).
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: arguments `{page?, plugin?, language?}`; neither page nor plugin lists topics.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new agent tool and citation kind |
| no new interface or data format | no | tool schema, `help:` refs |
| no new dependency | yes | none |
| an existing requirement already covers the behavior | no | new |
| no security or data-handling change | no | agent reads plugin packages |

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| `help` lists app pages and enabled plugins' help, reads a page in the requested or interface language with English fallback, each result with a `help:` ref | REQ-FUNC-2a87401e | `core/tools/help.ts` over `HelpHost` |
| a plugin not enabled in the workbench (or without help) is refused | REQ-SEC-3cb78ea6 | `HelpHost.plugins()` = enabled plugins |
| a cited `help:` ref the session received is a valid chip that opens the page in Help | REQ-UX-a318156e | `parseRef` kind `help`, `validateCitations`, renderer routing |
| the system prompt names the help tool for questions about VERA when the tool is offered | REQ-FUNC-4fa3e396 | `buildSystemPrompt({help})` |

## Design

**Approach.** A core `helpTool` (class `read`) uses a `HelpHost` port on the tool context: `app` (the `HelpLibrary`),
`language()` (the interface language) and `plugins()` (the workbench's enabled plugins with id, name and folder). Main
gives the desktop session host `help` (root and language); `DesktopSessions` builds the port with
`workbench.loadPlugins(id)`. The session drops the tool when the host has no help and passes `help: true` to the prompt
builder, which then adds one rule. Refs: shared `parseRef` gains kind `help` (`help:<page>` or `help:plugin/<id>`);
`validateCitations` accepts an issued `help:` ref as valid. The renderer's citation handler opens Help through
`HelpContext` for `help` refs instead of the document viewer.
Rejected: reusing `read_doc` (workbench documents only) or `load_skill` (skills are instructions, not user help).
**Interfaces and data.** Tool params `{page?: name, plugin?: id, language?: en|ro|de|fr}` (strict; not both page
and plugin). Results: list `{language, pages:[{page,title,language,ref}], plugins:[{plugin,title,language,ref}]}`;
read `{ref, title, language, text}`. Errors thrown with a message: unknown page, plugin not enabled, plugin without help.
**Files and test seams.** shared `tools.ts` (name), `refs.ts` (+ `refs.test.ts`); core `tools/help.ts`
(+ `tools/help.test.ts`), `tools/context.ts`, `tools/registry.ts`, `agent/citations.ts` (+ test), `agent/prompt.ts`
(+ `prompt.test.ts`), `sessions/service.ts`; desktop `main/sessions.ts`, `main/index.ts`; renderer
`components/session/transcript.tsx` or the workspace citation handler (+ test), `workbench-tools.tsx`, locales;
registry tests that list tool names.
**Risks.** Prompt snapshots change only when help is offered. Plugin reads go through `readPluginHelp` confinement.
**Requirement map.** REQ-FUNC-2a87401e tool; REQ-SEC-3cb78ea6 enabled-only host; REQ-UX-a318156e refs + renderer;
REQ-FUNC-4fa3e396 prompt.

## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: vitest refs.test, citations.test, prompt.test, tools/help.test exit 1 - no help ref kind, help citations invalid, no help prompt rule, no help tool (REQ-FUNC-2a87401e, REQ-SEC-3cb78ea6, REQ-UX-a318156e, REQ-FUNC-4fa3e396)
- 2026-11-15 build: green: vitest core sessions/tools/agent, shared, main sessions, renderer workbench-tools and transcript (71 files, 558 tests) exit 0; renderer help.test + transcript (44) exit 0; tsc -b exit 0; check:i18n exit 0 (all four requirements)
- 2026-11-15 build: DEVIATION design: no diagrams - one tool over a host port, the existing citation path
- 2026-11-15 build: scope: the headless CLI composes no help host, so the tool is desktop-only (no packaged help root for the CLI)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: DEVIATION build: no anchor was taken before the first implementation edit, so evolution cannot run; the reviewers read the diff against HEAD (3d9ef3d) instead
- 2026-11-15 validate: review round 1 spec changes_required - prompt rule present when the workbench disables the help tool; transcript help-citation routing untested; session wiring (tool drop, prompt flag, enabled plugins) untested; nit: help refs should count as issued only from help results. Quality approved.
- 2026-11-15 validate: returned to build - review round 1 spec findings
- 2026-11-15 build: fix round 1: prompt flag also requires the workbench not to disable help; help refs count only from help results; new tests sessions.test (help host, enabled plugins, prompt with/without/disabled), citations (help ref from another tool invalid), transcript-help (chip opens Help, not the viewer). The fixes were written with their tests in one step, not red first
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 2 approved (spec, quality); nits accepted: duplicated ref-collect loops in citations.ts, test reads private service host, I/O errors on app pages read as not found, pages over the 32k tool cap are truncated
- 2026-11-15 validate: final: aegis check --task TASK-ef3f43a8 --strict --run exit 0; lint, typecheck, i18n ok
- 2026-11-15 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ef3f43a8.md
changed:
evidence: aegis check --strict --run exit 0; focused vitest exit 0 (256)
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-2a87401e - List help topics and read app and enabled plugin help through the help tool
  - REQ-SEC-3cb78ea6 - Refuse help of plugins not enabled in the workbench
  - REQ-UX-a318156e - Open cited help pages in the Help view
  - REQ-FUNC-4fa3e396 - Name the help tool in the system prompt for questions about VERA
- deviations: 2 recorded
  - design: no diagrams - one tool over a host port, the existing citation path
  - build: no anchor was taken before the first implementation edit, so evolution cannot run; the reviewers read the diff against HEAD (3d9ef3d) instead
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base a8b26c1: 310 file(s) changed, 10256 line(s) added
- checks: errors=0 warnings=292 notes=39
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
