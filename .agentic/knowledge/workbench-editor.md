# Workbench creation page, editor and sidebar navigation

## Routing

Select for the New Workbench creation page, the workbench editor page and its sections, the workbench
overview, the sidebar's workbench and session groups with their order and session activity, and the
unsaved-edit guard.
Start under 05_Software/src/apps/desktop/src/renderer/components with workbench-create.tsx,
workbench-config-form.tsx and workbench-editor.tsx. Focused tests: renderer workspace.test.ts;
tests/e2e/workbench.spec.ts, workbench-navigation.spec.ts and mock.spec.ts.
[Workbench lifecycle](workbench.md) owns the configuration format, the service operations, the recents
registry and the documentation scan/preview; [Chat UI](chat-ui.md) owns the session list and what each
chat detail level shows; [skills](skills.md) and [plugins](plugins.md) own their own data;
[renderer foundation](renderer-foundation.md) owns the shell and layout.

## Purpose and boundaries

Renderer pages that create and edit a workbench, and the sidebar that lists workbenches with their
sessions. Both pages edit a draft in the shared WorkbenchConfigForm and write through validated IPC;
core validates and persists ([workbench](workbench.md)).

## Public interface

- The active workbench row has a keyboard-focusable index status control beside its name. Its
  tooltip shows the measured counts and opens Files, or the panel configuration when Files is hidden
  (REQ-UX-db99cdfe). The active id and folder select the row while the activation lease scopes updates.

- New/Open Workbench and Plugins are primary sidebar actions. The unselected canvas displays the Activity/VERA mark.
- New Workbench is a creation-only page (components/workbench-create.tsx) in the editor layout: a header with the name and Create workbench (top right) above the shared WorkbenchConfigForm (General, Instructions, Documents & RAG, Indexing, Agent and chat, Skills, Tools, Plugins) as a draft. General holds the folder (Choose folder, then its path; workbench.inspect fills an empty name with the folder name) and the name; the other sections stay locked until a new folder is chosen; detected documentation folders become the draft include patterns (defaults kept when none or when the scan fails); Documents (components/workbench-documents.tsx) lists detected and literal hand-added folders, previews with a 300 ms debounce and keeps scans uncached; skills are draft checkboxes written to skills.disabled; WorkbenchPlugins lists installed packages with initially empty draft plugins.enabled (existing editor values are retained); Create sends the draft in one workbench.create. A folder that is already a workbench disables Create and offers Open. The page stays mounted while hidden so a draft survives navigation and remounts after a successful create.
- Opening, recents, missing state and removal live only in the sidebar (entries carry data-missing). Sidebar groups have no search controls. The selected workbench overview stacks its model and permissions rows, Documents and index, and Sessions vertically. Label/value rows reserve space for labels while source paths wrap on the value side. The Documents and index heading has live progress and named exceptions aligned to its right through WorkbenchIndexDetails (REQ-UX-32477693); see [Docs](document-viewer-docs-panel.md). Loading failures are shown with retry rather than an empty-session claim. Registered workbenches are pinned first and expose collapsible active session groups. Their order is the stored recents order: opening keeps a listed workbench's place and new workbenches go first; Move up/Move down in the row menu, or Alt+Shift+ArrowUp/ArrowDown on a focused row, moves a workbench within its pinned group through workbench.recent move (shared moveRecentWorkbench). Non-archived sessions of the active workbench move the same way through session.move; their order lives in the user settings ([sessions](sessions.md)). Focus returns to the moved row by id.
- Session activity (components/workbench-activity.tsx, hooks/use-session-activity.ts): a workbench heading whose open workbench lists running or awaiting-approval top-level sessions in `session.activity` shows a `details.workbench-activity` control between the name and the row menu: a count with a spinner, or a shield once any of them awaits approval, whether the row is collapsed or the workbench is in the background (REQ-UX-18f96271). Entries match activity rows by folder, else by ID when no other entry has that folder (copies share IDs). The menu lists each session with Open, which selects it in the shown workbench or runs `workbench.open`, `benchChanged` and then selects it with a transcript-heading focus request (REQ-FUNC-1388cbcf), and Stop, which calls `session.stop` by session ID outside the sidebar operation guard and leaves the view (REQ-FUNC-e117c80b); either failure shows in the error line below the navigation (REQ-UX-58fdc5c6). It shares the sidebar menu scope: outside clicks close it and Escape returns focus to its summary; focus inside it moves to the workbench name when its last session ends (REQ-UX-4bb04608). The `session.activity` app event re-reads activity and `session.list` (REQ-UX-ec37f55b). While turns run, the Workbenches title shows `active/limit` from `useTurnCapacity`, `data-limit-reached` at the limit (REQ-UX-c2a9fe24). App's default session selection waits while the list refetches, so a session just opened in a background workbench is kept.
- The editor page (components/workbench-editor.tsx, in the main content area, not a dialog) uses the same WorkbenchConfigForm, saves current supported project fields, plugins.enabled selections and instructions, honors read-only state, and reports partial saves if settings were written but instructions failed. Escape (outside nested dialogs) and Cancel return to the overview and restore focus to the control that opened it (or the overview Edit). Explorer accepts registered, existing ordinary directories without changing the active workbench.
- Indexing offers both registered local embedding models. Saving a different model asks for confirmation with the current indexed document count. Cancellation dismisses the dialog and leaves the draft open. Main accepts confirmation for the current workbench ID, saved model and indexed count. The indexed count stays stable through the setting write and vector invalidation. The [ingester](knowledge-ingest.md) owns vector replacement and normal progress. Documents & RAG limits and retrieval defaults are stated in [workbench](workbench.md).
- The overview toolbar contains only Edit. Its editor page hosts WORKBENCH.md drafts under Instructions and the SkillsPanel (create left, paged list right) inline under Skills. Skill changes save independently and project Save preserves their current enabled/disabled choices. Close is available from the active workbench menu. Settings replaces primary New/Open/Plugins navigation with settings categories and Back to workbenches. Nested Skills dialogs are centered; their Escape returns to the editor page.
- WorkbenchEditor and WorkbenchConfigForm take an optional `request {section}`; a new request object shows that section (the Docs tab's Edit exclusions opens Documents & RAG, REQ-UX-597b7c82). Save/Cancel are in the editor header, before sections and filters; Save requires a writable, loaded, changed valid draft. Enabled plugin ids compare as sets for dirtiness without rewriting other ordered fields. Plugins uses the current workbench context and retains hidden selections while filtering and paging. The editor links an empty installed inventory to the unfiltered global catalog. Unresolved saved selections stay removable. Read-only presentation remains usable. Tool controls accompany installed provider cards and the shared electrical or automation block starts at the first matching installed package. Unavailable tools keep their stored workbench allowances (REQ-UX-e8ceb590). Global Plugins is an installation detour: the same editor owner stays hidden/inert, selected section and draft retained; returning through the same workbench resumes it. Only plugin presentation unmounts, restoring private filters with a fresh installed query on return. Actual workbench switches and other departures retain discard guards. Existing pending, partial-save and retry guards remain owner-controlled (REQ-UX-840fad9c, REQ-UX-e5d617d7).
- Edit/New workbench → Data & privacy stages Default/On/Off choices and shows the live app value in Default. Existing Save/Cancel/read-only ownership applies; enabling inheritance that disables Agent and model asks before changing the draft.
- Agent defaults reuse the shared permission enum including Bypass. The editor's PermissionPicker requires the same per-change explicit Bypass confirmation and permanent selection marking as the composer; cancelling confirmation preserves the prior draft mode. Project Save persists the default and editor Cancel discards that draft.
- The Agent section presents the complete saved command prefixes as a paged list fetched through workbench.commandPrefixes.list, with scrubbed labels and stable IDs. Save sends only explicit removal IDs alongside ordinary config fields; Cancel discards.
- The editor's Tools section lists the shared built-in catalog with en/ro/de/fr descriptions and enabled checkboxes. It shows `view_image` only when `providers.image.capability` confirms image support for the draft workbench model or its inherited application default (REQ-UX-6cfb7f2f). Draft selection writes the existing tools.disabled array on Save; Cancel discards it and read-only/loading/pending controls remain disabled (REQ-UX-0f1a32c4, REQ-FUNC-37261edc). Runtime permissions remain independent. `shared/src/tools.ts` defines the ordered catalog consumed by `core/src/tools/registry.ts` and `renderer/components/workbench-tools.tsx`. Tests: `tests/e2e/workbench-tools.spec.ts`, renderer workbench-tools.test.ts, registry and workbench service tests.
- New/Edit Workbench → Interface saves the per-workbench Files Git checkbox with the same draft. It defaults off and opens the [Files Git overlay](files-git-status.md) when the Files view is mounted.
- New/Edit Workbench → Agent and chat edits `chat.detail` (`verbose`, `normal`, `minimal`, default `normal`) as part of the same unsaved configuration draft and create/update payload. Cancel leaves the saved value unchanged; read-only workbenches disable editing. Tests: `workbench-chat.test.ts`, native chat-detail.spec.ts.

## Invariants

- A desktop notification click uses the same unsaved Workbench and Settings editor guard before
  opening the verified workbench and chat. A click waits for the current navigation operation to finish.
  A dismissed prompt or stale destination keeps the draft.

- Leaving through other navigation (sidebar open/edit/close/remove of the active workbench, New session, Settings, New, Plugins, Open) with unsaved edits asks for confirmation exactly once; edits remain unsaved until a save completes, and a save already sent when the engineer confirms leaving may still complete on disk while its result is ignored by the closed editor (REQ-UX-efb3e4fb).
- The editor is keyed by workbench id, so editing another workbench remounts it with that workbench's values.
- One core workbench is active; switching uses the session lifecycle. Session list/search/create requests carry expected workbench identity.
- The editor saves full WORKBENCH.md content explicitly and restores focus after Cancel/Escape/save. Each dialog loads fresh content before enabling input; drafts stay isolated from focus/reconnect refresh.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| New page/editor/locales | components/workbench-create.tsx, workbench-config-form.tsx, workbench-editor.tsx, App.tsx, locales | renderer workspace.test.ts, native workbench.spec.ts, browser mock.spec.ts |
| Sidebar groups, pinning, editor behavior | workbench-navigation.tsx, workbench-editor.tsx | `05_Software/tests/e2e/workbench-navigation.spec.ts`; core workbench tests (durable registry and ownership) |
| Tools section | shared/src/tools.ts, renderer/components/workbench-tools.tsx | tests/e2e/workbench-tools.spec.ts; workbench-tools.test.ts |
| Sidebar session activity, Open/Stop, capacity count | workbench-activity.tsx, workbench-navigation.tsx, hooks/use-session-activity.ts, App.tsx | renderer workbench-activity.test.ts; native tests/e2e/background-sessions.spec.ts |
| Chat detail selector | workbench-config-form.tsx | workbench-chat.test.ts; tests/e2e/chat-detail.spec.ts |
| Embedding model selection and confirmation | workbench-config-form.tsx, workbench-editor.tsx, embedding-switch-dialog.tsx | tests/e2e/embedding-models.spec.ts |

## Key behaviors

- REQ-UX-8622cdbe — create on New Workbench, open/reopen from the sidebar, translated warnings/errors.
- REQ-UX-1d6c940b — editor page instructions, size warning, read-only and focus.
- REQ-UX-2c674629 / REQ-UX-56c8cefc / REQ-UX-68353a4e / REQ-UX-7f289a2c — creation-only page, name default, existing-folder Open, draft sections.
- REQ-UX-efb3e4fb — confirmation before leaving the editor page with unsaved edits.
- REQ-UX-8d82a10a / REQ-UX-c44bc346 — at-least preview wording and the count guard warning in the Documents section.
- REQ-UX-5b390823 / REQ-UX-64605f7e / REQ-UX-b96730c7 / REQ-UX-b7002720 / REQ-UX-ff645484 — Documents checklist, creation preselection, Add folder, preview line and Advanced globs.
- REQ-UX-9e7529d5 — missing recent display and removal in the sidebar.
- REQ-FUNC-df70c1c8 / REQ-FUNC-2b3ff3a8 / REQ-UX-ab0d5e61 — move within the pinned group, open keeps place, row menu and keyboard.
- REQ-UX-18f96271 / REQ-FUNC-1388cbcf / REQ-FUNC-e117c80b / REQ-UX-58fdc5c6 / REQ-UX-ec37f55b / REQ-UX-c2a9fe24 / REQ-UX-4bb04608 — session activity in headings, Open, Stop, their errors, live refresh, capacity count, keyboard.

## Files

All paths below are relative to05_Software.

- src/apps/desktop/src/renderer/{App.tsx,components/workbench.tsx,components/workbench-create.tsx,components/workbench-config-form.tsx,components/workbench-editor.tsx,components/plugins.tsx,components/error-message.tsx,styles.css,locales/} — overview, creation page, shared form, editor page and translated states.
- src/apps/desktop/src/renderer/components/{workbench-documents,workbench-tools,workbench-navigation,workbench-activity}.tsx, hooks/use-session-activity.ts — Documents section, Tools section, sidebar navigation and its session activity.
- tests/e2e/{workbench,workbench-navigation,workbench-tools,chat-detail,command-prefixes,background-sessions}.spec.ts and mock.spec.ts — native and browser acceptance.
