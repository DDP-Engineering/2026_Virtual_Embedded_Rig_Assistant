<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-dea37fe2 - Configurable keyboard shortcuts

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-098273a3
parent:
branch: master
base: 1529117599e3d2a1a41348b756f74cd985cfc798
opened: 2026-10-29

## Done checklist (current stage)

- [x] frame, requirement and design agreed in carried autopilot
- [x] failing regression, then implementation
- [x] focused/native/visual checks and static proof
- [x] two independent reviews
- [x] uncommitted delivery

## Frame

Problem: STATED Settings/Keyboard shortcuts is a placeholder; user requests ChatGPT-like editable and deletable bindings and supplies a screenshot.
Desired outcome: searchable command rows with description, key chips, edit/delete/add, conflict feedback and defaults reset; persisted functional bindings.
Actors: VERA desktop user.
Primary scenario: Settings -> Keyboard shortcuts -> edit a binding -> press keys -> save -> execute after reload.
Examples: Ctrl+/ opens shortcut settings; replacing Ctrl+N disables that assignment; empty list disables a command.
Counterexamples: shortcut recording must not invoke app commands; dialog/IME/repeat and existing local editing shortcuts retain priority; readonly settings cannot change.
In scope: existing actions (new session/workbench, open workbench, settings, shortcuts, sidebar/right panel, find, focus message/model), schema validation, localized UI, affected tests.
Out of scope: new chat archive/delete/temporary-chat features, OS-wide hotkeys, custom command palette, number/tab switching, migrations, commit/push, historical journal changes.
Constraints: shared master; preceding candidate retained; no commits/push; AEGIS autopilot.
Success signals: add/edit/remove/reset persist, conflicts rejected, actual keyboard actions and modal isolation, responsive screenshot-inspired rows.
Evidence: OBSERVED settings.tsx placeholder, lib/shortcuts.ts fixed guards, App/Workspace hardcoded handlers; official ChatGPT commands/settings pages and attached screenshot.
Assumptions: settings are app-wide, bindings support Ctrl/Command with optional Alt/Shift; native edit/window/reload shortcuts are reserved.
Unknowns: no blocking unknowns.
Decision-blocking questions: none.
Proposed behaviors: editable aliases per command, explicit empty override disables; restore deletes override. Send/newline/Escape remain local documented controls.
Path and reason: full; new observable behavior and settings field; no dependency or migration. Existing master and no-commit instruction override generic branching/delivery defaults.

## Requirement coverage

REQ-UX-098273a3 -> shared keyboard schema, renderer matcher/context and shortcut settings; unit, browser and native regression.

## Design

Shared owns command IDs, defaults and validated overrides (bounded lists, reserved combinations and duplicate/conflict rejection). Optional keyboardShortcuts in app settings and strict patch replaces the whole override map through existing atomic SettingsService; absent key means defaults, empty array disables. Renderer context distributes confirmed preferences to App, Shell and Workspace. Match exact modifiers and suppress composing/repeated/handled/dialog/recording input. Bind handlers to existing actions; only prevent when applicable. Settings uses search field with keystroke mode, grouped command rows, key chips with pencil/trash, an inline focusable recorder with Save/Cancel and reset actions. No configuration written to workbench. Existing chat-local Enter/Shift+Enter/Escape behavior unchanged.

## Log

- 2026-10-29 frame/specify/design: user scope accepted in autopilot, including editable/deletable screenshot-style aliases. No commit/push. Full path, bounded current settings field and local controls retained.

- 2026-10-29 build: red shared settings regression failed on unsupported keyboardShortcuts patch; anchor recorded before product edits. Implemented validated persistent overrides, exact-modifier dispatch/context and screenshot-style search/edit/remove/add/reset UI. Focused units passed (62); browser workflow passed for conflicts/capture/remove/rebind/dispatch/reset/dialog isolation. Added readonly checks; native restart and final visual checks pending.

- 2026-10-29 validate/build: both reviews identified shifted digit/punctuation schema/matcher mismatch; spec also identified key-search toggle focus. Added red realistic shifted-symbol test, normalized physical digit/comma/slash positions (letters use layout key), added recorder invalid-key feedback and search-input focus with immediate-key regression. Native first-press readiness corrected to wait for loaded UI.

- 2026-10-29 validate: native restart passed (custom binding dispatch and deleted aliases persisted). Browser full interaction/readonly test passed after fixes. CUA actual VERA confirmed screenshot-style page, centered recorder, edit/Cancel/focus return and key-search capture. Windows injected events omit code for shifted symbols; measured !/empty-code and added standard shifted-symbol normalization with focused unit and successful native CUA Ctrl+Shift+1 verification. User settings unchanged during manual inspection.

- 2026-10-29 validate: final focused combined E2E passed 3/3 (keyboard UI, compiled native restart, existing workbench navigation). Focused shared/core/settings/workspace/shell/matcher tests total 63 passing including Windows shifted-symbol regression. Actual CUA confirmed Ctrl+/ opening, edit recorder CtrlShiftP/CtrlShift1, Escape cancellation and immediate key-search filtering without command execution. Both independent reviews round 2 approved; final formatting normalized CSS and test layout only.

- 2026-10-29 deliver: final strict --run exited 0; lint/typecheck/i18n passed. Advisory catalog has 33 inherited warnings (historical records/requirements and preceding validated uncommitted source outside this task); CSS specificity advisories reviewed against separate component classes and observed layouts. Both independent final verdicts approved round 4 after locale line-ending normalization. Valid proof reused for byte/format-only edits. Native VERA window 2689054 responds and is left on Keyboard shortcuts in development session 80498. No staging, commit or push; historical journals preserved. Agreed outcome is the validated local working tree, overriding default publication delivery.

## Rulings

## Handoff

current: done
status: ready
next: inspect running VERA on Keyboard shortcuts
must_read: .agentic/requirements/ux/REQ-UX-098273a3.toml
blockers: none

## Stage report

stage: deliver
result: completed
current: done
changed: persistent editable shortcut aliases and screenshot-style settings
evidence: 63 focused unit tests, 3 E2E, native CUA interaction
issues: inherited advisory warnings; zero errors
next: inspect running VERA on Keyboard shortcuts
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-10-29)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-098273a3 - Editable keyboard shortcuts
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 1529117: 74 file(s) changed, 3792 line(s) added
- checks: errors=0 warnings=33 notes=3
- checklist: 5/5 done
