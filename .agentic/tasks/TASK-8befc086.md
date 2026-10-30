# TASK-8befc086 - Select workbench tools through a described checkbox catalog

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-UX-0f1a32c4, REQ-FUNC-37261edc
parent:
branch: master
base: aada110a4d01b5c6f7e56ef4bfd4eee85201d505
opened: 2026-10-30

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

Problem: STATED: Tools requires manually typing disabled tool names instead of selecting available tools.
Desired outcome: STATED: show each available tool with a short description and an enable/disable checkbox.
Actors: STATED: workbench users.
Primary scenario: STATED: edit workbench, select Tools, toggle tools, save and reopen.
Examples: OBSERVED: read/list/glob/grep/write/edit/artifact_save/todo/search_docs/read_doc/load_skill are the eleven current built-ins in ToolRegistry.
Counterexamples: OBSERVED: Cancel does not save the editor draft; the existing read-only/pending fieldset disables mutation.
In scope: STATED: replace manual tool entry. INFERRED: one shared built-in catalog consumed by runtime and UI, localized descriptions, existing save semantics and focused visual/browser/native tests.
Out of scope: INFERRED from request: plugin execution/discovery and new tool implementations.
Constraints: OBSERVED: shared master checkout, base aada110a4d01b5c6f7e56ef4bfd4eee85201d505. Root AGENTS.md authorizes one local commit; no push. Preserve historical journals, baseline three-file ChatGPT correction and optional-companions.md. Keep .vera/workbench.yaml tools.disabled contract and read-only/permission guards.
Success signals: INFERRED: UI lists exactly the runtime built-ins; descriptions translate; checked means enabled; save/reopen/restart retain selections; Cancel and read-only preserve saved state.
Evidence: OBSERVED: workbench-editor.tsx uses toolText textarea; ToolRegistry constructor owns default definition list; shared WorkbenchConfig tools.disabled already persists exclusions.
Assumptions: INFERRED: currently available tools are built-ins, since Plugins is explicitly not implemented.
Unknowns: UNKNOWN: future plugin catalog; outside current behavior.
Decision-blocking questions: None; current contracts answer state/save semantics.
Proposed behaviors: None beyond accepted outcome.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | Described checkbox list |
| no new interface/data format | no | Shared built-in catalog export; no persisted format change |
| no new dependency | yes | Existing React/shared/i18n |
| existing requirement covers behavior | no | Explicit checkbox/catalog request |
| no security/data-handling change | yes | Existing config mutation and runtime permissions |

Full path; repository autopilot configuration applies.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| Localized available-tool names/descriptions | REQ-UX-0f1a32c4 | Shared ordered built-in names plus localized UI descriptions | Registry parity and browser catalog checks |
| Enabled checkbox persistence | REQ-FUNC-37261edc | Existing tools.disabled array in editor draft | Browser save/cancel and native restart/config checks |

## Design

### Approach
REQ-UX-0f1a32c4: export one ordered BuiltinToolName catalog from shared. Core maps its existing definitions through this catalog; renderer iterates the same names with short typed en/ro/de descriptions. No core imports in renderer and no new IPC channel.
REQ-FUNC-37261edc: replace toolText with config.tools.disabled as draft source of truth. Checked means absent from disabled; toggle only the selected name. Existing Save writes the array; Cancel discards draft. Existing fieldset controls read-only/loading/pending behavior. Preserve other current disabled names when toggling a known tool.
### Interfaces and data
Shared builtinToolNames readonly tuple and BuiltinToolName type; core builtin definitions map typed by that tuple. WorkbenchService uses the canonical built-in catalog when validating disabled names without an injected host catalog, so valid selections do not produce UNKNOWN_NAME. Existing workbench config schema, patch, permissions and skill settings remain authoritative.
### Files and test seams
shared tools.ts/index.ts; core tools/registry.ts and parity test; renderer workbench-tools.tsx/workbench-editor.tsx, styles.css and locales. Update existing browser workbench-navigation assertions and add focused native tool persistence acceptance.
### Risks and open decisions
Avoid a second renderer list diverging from execution: registry parity test and typed description map enforce the shared catalog. Keep checkbox intrinsic width despite existing full-width editor input CSS. No migration, dependency or plugin work.
### Requirement map
REQ-UX-0f1a32c4: canonical names and described native checkboxes. REQ-FUNC-37261edc: array-backed draft and unchanged save/permission lifecycle.
Diagrams: [diagram_TASK-8befc086.md](diagram_TASK-8befc086.md)

## Log

- 2026-10-30 frame: journal opened
- 2026-10-30 frame: Shared master base aada110; local ticket commit authorized by root AGENTS.md. Preserve baseline endpoint fix and historical journals. Scope uses current built-ins, not new plugin execution.
- 2026-10-30 frame: completed; next specify - User requested checkbox tool editor; autopilot (7 Done checklist item(s) left unticked)
- 2026-10-30 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-30 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-30 build: red: npm exec playwright -- test tests/e2e/workbench-navigation.spec.ts exit 1; Tools renders zero checkboxes instead of eleven (REQ-UX-0f1a32c4 and REQ-FUNC-37261edc).
- 2026-10-30 build: green: browser workbench-navigation exit 0; registry + workbench-tools units exit 0 (6 tests). Scope extension within workbench ownership: service default tool warning catalog is empty, falsely marking disabled built-ins unknown. Red focused service test exit 1 reproduces grep/read warnings; use the same canonical built-in catalog for validation.
- 2026-10-30 build: green: renderer/core registry units 6 passed; workbench service 32 passed, with one pre-existing 5s timeout during concurrent build rerun alone with 20s test timeout and passed (33 service cases covered). Browser workbench navigation and native save/YAML/restart/cancel/en-ro-de acceptance passed after instrumented build. Native Romanian screenshot inspected: correctly sized checkboxes and descriptions, internal scrolling with fixed Save/Cancel. Added minimum-window bounds assertion; final native rerun pending.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: Final focused native rerun including minimum-window bounds passed: npm exec playwright -- test tests/e2e/workbench-tools.spec.ts exit 0 (1 test, 12.4s). Earlier browser navigation pass remains valid; 39 unit cases covered. Read-only review agents tools_spec_review and tools_quality_review approve with no findings. Native Romanian screenshot visually confirms checkbox alignment, short descriptions and fixed modal footer.
- 2026-10-30 validate: final: python -X utf8 .agentic/aegis.py check --task TASK-8befc086 --strict --run exit 0; lint, typecheck and i18n passed; errors=0, 27 advisory warnings are 24 pre-existing historical metadata warnings plus 3 earlier endpoint-fix paths outside this task. All requested behavior verified; no Linux-native run on this Windows UI change. Owned temporary screenshot deletion was rejected automatically without a specific reason and was not retried; file remains in TEMP, outside repository. Normal development VERA restarted and responding.
- 2026-10-30 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-8befc086.md
changed: Tools: canonical built-in list, localized descriptions and enabled checkboxes
evidence: 39 unit cases, 2 E2E scenarios, native visual/restart/minimum-window checks; lint/typecheck/i18n/strict passed
issues: 27 pre-existing advisory warnings; owned TEMP screenshot cleanup denied automatically
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-10-30)

- stage: validate; type: change; path: full; branch: master
- requirements:
  - REQ-UX-0f1a32c4 - Show the built-in tool catalog in the workbench editor
  - REQ-FUNC-37261edc - Save workbench tool availability from checkboxes
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base aada110: 28 file(s) changed, 823 line(s) added
- checks: errors=0 warnings=27 notes=3
- checklist: 6/9 done; open: final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
