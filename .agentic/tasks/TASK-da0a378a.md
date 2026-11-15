# TASK-da0a378a - HELP-03 Help view and button

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-a388f93c, REQ-UX-3de89feb, REQ-UX-2eb10026, REQ-UX-d753f9fb, REQ-UX-d87fc848, REQ-UX-5e8e2eba
parent:
branch: master
base: 351211ed6102f538ec2abc3267bcb505d067443d
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

Problem: Users have no way to open help: the top bar has an About button (ⓘ, `data-action="show-about"`) that opens
Settings → About, and no view renders help pages (STATED plan `00_Planning/plan/help.md` HELP-03; OBSERVED
`renderer/components/shell.tsx` show-about button, `App.tsx` view flags).
Desired outcome: a ? Help button in the same place opens a Help view with the page list and the selected page rendered
by the existing Markdown renderer in the interface language (English fallback via `help.read`); links between help
pages open that page; F1 opens the page of the current screen; About stays reachable as Settings → About (STATED plan
HELP-03 and decision "About stays as the Settings → About page").
Actors: any VERA user.
Primary scenario: the user clicks ? in the top bar; Help shows `index` with the page list on the right; clicking
"Permissions" in the list or a `[Permissions](permissions.md)` link in the page shows that page.
Examples: F1 on Settings → Providers opens `providers`; F1 in a session chat opens `chat-and-sessions`; F1 on the
Plugins page opens `plugins`; F1 on Home with no workbench opens `getting-started`.
Counterexamples: F1 while a dialog is open or a shortcut is being recorded does nothing (existing shortcut blocking);
an external `https:` link in a page keeps the existing confirmed external-open flow; Help adds no helper text.
In scope: shell button, App help state and F1, `components/help.tsx`, Markdown internal-link hook, CSS, en/ro/de/fr
keys, unit and browser E2E tests, the shell spec and knowledge lines that name the About button.
Out of scope: plugin help in the view (HELP-04), agent citations into Help (HELP-05), page content (HELP-06).
Constraints: UI rules (STATED coordinator): lists on the right, no helper texts, no layout-shifting labels, green primary.
Opening Help is a detour like Plugins: an unsaved workbench editor draft stays (INFERRED from the existing Plugins
detour comment in `App.tsx`). On `master`.
Success signals: browser E2E: ? opens Help in each interface language, links work, F1 opens the screen's page,
Settings → About still shows the version and licenses (STATED plan Verification).
Evidence: OBSERVED no test references `show-about`; `Markdown` renders `a` through `ExternalSourceLink`; keyboard
shortcuts accept only `Mod+` bindings, so F1 is a fixed key outside the editable registry.
Assumptions: the screen-to-page mapping below (INFERRED from the plan's page topics).
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: F1 mapping (Settings sections: providers → providers, shortcuts → shortcuts, the rest →
settings; Plugins → plugins; workbench overview, New Workbench and the editor → workbenches; chat → chat-and-sessions;
Home → getting-started; Help → index).
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new view, button, key |
| no new interface or data format | yes | uses HELP-02 channels |
| no new dependency | yes | lucide icon set already used |
| an existing requirement already covers the behavior | no | REQ-UX-d87fc848 names the About button |
| no security or data-handling change | yes | read-only display |

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| ? Help in the top bar beside the right-panel toggle opens Help at `index` | REQ-UX-a388f93c; REQ-UX-d87fc848 (revised) | `Shell` `showHelp`, `App` `help` state |
| Help lists pages on the right and renders the selected page in the interface language, English fallback | REQ-UX-3de89feb | `HelpView` |
| an internal `page.md` link opens that page in Help | REQ-UX-2eb10026 | `Markdown` `link` prop |
| F1 opens the current screen's page | REQ-UX-d753f9fb | `screenHelpPage`, `App` F1 listener |
| About remains in Settings → About | REQ-UX-5e8e2eba (revised) | unchanged Settings section |

## Design

**Approach.** Help is a detour view like Plugins: `App` keeps `help?: {page}`; `showHelp(page)` sets it and clears
settings/plugins/chat, every path that leaves Plugins also leaves Help, and hidden views (workbench editor, New
Workbench) stay mounted so drafts survive. `HelpView` queries `help.list` and `help.read` with the resolved
interface language and renders the page with the session `Markdown` component, whose new optional `link(href)` hook
returns a click handler for `name.md` links. The page list is a `nav` on the right (UI rule). F1 is a fixed key:
an `App` listener ignores modified or blocked events (`globalShortcutBlocked`) and opens `screenHelpPage(screen)`.
Rejected: a modal dialog (blocks the screen it explains); adding F1 to the editable registry (registry is `Mod+` only).
**Interfaces and data.** `Shell` prop `showHelp` replaces `showAbout`; button `data-action="show-help"`,
`CircleQuestionMark` icon, label `help.open`. `HelpView({page, open})`; `screenHelpPage({...flags, section})` → page
name. New keys `help.open`, `help.title`, `help.pages`; `about.open` is removed. Errors from `help.read` show through
`ErrorMessage`; the list stays usable.
**Files and test seams.** `renderer/components/shell.tsx`, `App.tsx`, `components/help.tsx` (+ `help.test.ts`
component test with the mock API), `components/session/markdown.tsx`, `lib/help-pages.ts` (+ unit test),
`styles.css`, locales; E2E `tests/e2e/help.spec.ts` (browser mock).
**Risks.** F1 inside Electron: the default menu has no F1 accelerator (OBSERVED no Help menu).
**Requirement map.** REQ-UX-a388f93c shell+App; REQ-UX-3de89feb HelpView; REQ-UX-2eb10026 Markdown link hook;
REQ-UX-d753f9fb screenHelpPage + listener; REQ-UX-d87fc848 and REQ-UX-5e8e2eba revised prose only.

## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: vitest lib/help-pages.test.ts components/help.test.ts exit 1 - screenHelpPage and HelpView absent (REQ-UX-d753f9fb, REQ-UX-3de89feb, REQ-UX-2eb10026)
- 2026-11-15 build: green: vitest lib/help-pages.test.ts components/help.test.ts exit 0; tsc -b exit 0; lint exit 0; check:i18n exit 0 (REQ-UX-d753f9fb, REQ-UX-3de89feb, REQ-UX-2eb10026)
- 2026-11-15 build: green: VERA_TEST=1 npm run test:e2e -- tests/e2e/help.spec.ts exit 0, 2 passed (REQ-UX-a388f93c, REQ-UX-3de89feb, REQ-UX-d753f9fb, REQ-UX-5e8e2eba)
- 2026-11-15 build: DEVIATION design: no diagrams - one view and one key listener in the existing App state; the design note carries it
- 2026-11-15 build: DEVIATION build: internal-link following is proven by the component test only; the E2E checks it once HELP-06 supplies linked pages
- 2026-11-15 build: evolution: lists untracked content pages under 05_Software/help and plugins/*/help written in parallel for HELP-06/08; they are not part of this candidate or its commit
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 1 approved; nits accepted as limits: Help narrow-layout rule uses the viewport (container-type unused), F1 inside Help returns to index, leaving a session for Help or Settings drops an unsent composer draft as Plugins already does, no tests for leaving Help through the sidebar or anchor links; REQ-UX-2eb10026 browser E2E link check follows with HELP-06 content; affected_paths of the revised UX requirements gained fr.json/App.tsx
- 2026-11-15 validate: final: aegis check --task TASK-da0a378a --strict --run exit 0 (second run; the first failed lint on the HELP-07 test file sharing the working tree, formatted under HELP-07); lint, typecheck, i18n ok; warnings are untracked content files and pre-existing journal headers
- 2026-11-15 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-da0a378a.md
changed:
evidence: aegis check --strict --run exit 0; vitest help tests and e2e help.spec exit 0
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-a388f93c - Open Help from the top-bar Help button
  - REQ-UX-3de89feb - Show the help page list and the selected page
  - REQ-UX-2eb10026 - Follow links between help pages
  - REQ-UX-d753f9fb - Open the help page of the current screen with F1
  - REQ-UX-d87fc848 - Unify desktop chrome into a compact title bar
  - REQ-UX-5e8e2eba - Keep application information in About
- deviations: 2 recorded
  - design: no diagrams - one view and one key listener in the existing App state; the design note carries it
  - build: internal-link following is proven by the component test only; the E2E checks it once HELP-06 supplies linked pages
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 351211e: 78 file(s) changed, 2862 line(s) added
- checks: errors=0 warnings=74 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
