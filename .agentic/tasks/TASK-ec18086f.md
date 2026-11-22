# TASK-ec18086f - Providers page: connected provider cards with selectable models

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-ccf2e8cb, REQ-FUNC-701b5178, REQ-FUNC-9e37b9f0, REQ-UX-fe31a037, REQ-UX-2f454a64, REQ-UX-263ddff4, REQ-UX-734fc12d, REQ-UX-12e9f97f, REQ-UX-69c26603
parent:
branch: master
base: 11abb3f7583961085ccfe0741c440f20c57d43aa
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

Problem: STATED (user, 2026-11-21) - Settings > Providers has too much text (empty-state line, Add connection,
Search providers, separate Provider field); the user wants one provider dropdown, connect, then the provider's model
list with checkboxes to choose which models are available in VERA; several providers at once, each connected one
listed as a card with its accessible models. OBSERVED (code map, this session) - a connection stores one active
`model` (LM Studio also its discovered profiles); nothing stores which models are enabled; the composer picker
(`renderer/components/model-catalog.ts`) offers every model of every configured provider; `providers.models {id}`
already lists a provider's models (chatgpt, openai, presets, LM Studio, generic custom).
Desired outcome: STATED - Providers page: add a provider from one dropdown, connect it, see it as a card with its
models as checkboxes; ticked models are the ones VERA offers; several providers side by side.
Actors: Desktop user; renderer Providers page and composer model picker; main provider settings; core catalogs.
Primary scenario: Add provider -> enter what it needs (key or URL) -> test/connect -> card shows its models ->
tick some -> Save -> the chat model picker lists only ticked models (plus the session's current model).
Examples: none supplied beyond the screenshot; ChatGPT subscription signed in shows its models as a card too.
Counterexamples: CLI `--provider/--model` and delegated sessions with an explicit `modelRef` are not limited.
In scope: Providers page layout, add flow, provider cards, per-provider enabled-model lists (settings, format 1, no
migration), composer picker and workbench default model list filtering, locales, help, tests.
Out of scope: INFERRED - new provider types or catalogs, CLI behavior, gateway resolution order.
Constraints: STATED - uniform Settings style (Cancel/Save top right, no helper texts, actions left, lists right,
pager on long lists); master; no attribution; targeted tests. OBSERVED - settings schema strict, version 1.
Success signals: the page shows cards per connected provider with checkbox lists; the picker offers only ticked models.
Evidence: OBSERVED - code map of shared providers.ts, provider-settings.ts, core llm/providers.ts, model-catalog.ts,
providers.tsx and editors; knowledge providers.md and llm-gateway.md.
Assumptions: INFERRED - catalogs can be large (OpenRouter-like presets list hundreds of models).
Unknowns: none blocking.
Decision-blocking questions: answered 2026-11-21 (RULING-001 default ticks, RULING-002 dialog).
Proposed behaviors: (not accepted) absent list = all models offered (existing connections unchanged); page header
Cancel/Save saves model ticks; add/edit connection in a dialog with its own Cancel/Save.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| Ticked model IDs stored per provider; no list offers all | REQ-DATA-ccf2e8cb | `enabledModels` on openai, chatgpt and custom settings; one batch IPC |
| Picker and workbench default list offer ticked models, plus the current one | REQ-FUNC-701b5178 | filter in `useModelCatalog` |
| New connection ticks only its chosen model (RULING-001) | REQ-FUNC-9e37b9f0 | main `save` without id sets `[model]` |
| Cards with model ticks, header Cancel/Save, add/edit dialog (RULING-002) | REQ-UX-fe31a037 | providers.tsx rework |
| Save failure keeps the draft and shows the error | existing REQ-UX-032aab57 | shared Settings save policy |


## Design

**Approach.** Store ticks as `enabledModels` (unique, whitespace-free IDs, at most 10000, like `imageModels`) on
`providers.openai`, on each `providers.custom[]` entry (presets included) and on a new optional `providers.chatgpt`
section (REQ-DATA-ccf2e8cb; settings format 1, no migration). An absent list offers the whole catalog. A new IPC
channel `providers.models.enable {providers:[{id, models: string[]|null}]}` writes every changed list in one
queued settings update, so the page header Save is one atomic write (REQ-UX-fe31a037); `null` removes a list.
`ProviderSettings.save` gives a new custom connection `[model]`, and a first OpenAI model `[model]`; an edit keeps
the list and appends a changed active model (REQ-FUNC-9e37b9f0, RULING-001). `useModelCatalog` filters each
provider's catalog by its list and keeps the session's current model (REQ-FUNC-701b5178). Providers page: header
title with Add provider, Cancel and Save; a grid of cards (ChatGPT when signed in, OpenAI when configured, each
connection) with name, provider label, Edit, Test and Remove and the catalog from `providers.models {id}` as
checkboxes, filtered and paged above ten models; Add/Edit opens a dialog holding the provider dropdown (no search
field) and the existing editors with their Test and Cancel/Save, plus ChatGPT sign-in (RULING-002). Rejected:
reusing `providers.save` for ticks (needs the full config and credential handling for each card).

**Interfaces and data.** Shared: `enabledModels` in `configFields`, `openaiSettingsSchema`, new
`chatgptSettingsSchema`, `providerListSchema` (openai/chatgpt/custom), `providerModelsEnableSchema`; errors INVALID
(bad list), NOT_FOUND (unknown id). Main: `ProviderSettings.enableModels`; index.ts route; browser mock. Renderer:
providers.tsx, new provider-card.tsx and provider-dialog.tsx, model-catalog.ts, locales en/ro/de/fr, help.

**Files and test seams.** main provider-settings.test.ts (save defaults, enableModels, restart); renderer
model-catalog filter test; providers page test (cards, ticks, Save/Cancel, dialog); e2e providers.spec /
providers-layout.spec / lmstudio.spec / chatgpt.spec updated to the dialog.

**Risks and open decisions.** Catalog calls per card run on page open (existing `providers.models` caching and
timeouts apply); a failed catalog shows its error on the card and keeps the stored ticks. Existing users see no
change until they tick (absent list).

**Requirement map.** REQ-DATA-ccf2e8cb -> schema + enableModels; REQ-FUNC-701b5178 -> useModelCatalog;
REQ-FUNC-9e37b9f0 -> save defaults; REQ-UX-fe31a037 -> page, cards, dialog.

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: vitest provider-settings.test.ts (2 new) exit 1 - no enabledModels on save, no enableModels method (REQ-FUNC-9e37b9f0, REQ-DATA-ccf2e8cb)
- 2026-11-21 build: green: vitest provider-settings.test.ts mockApi.test.ts exit 0 (38); typecheck exit 0 (REQ-DATA-ccf2e8cb, REQ-FUNC-9e37b9f0)
- 2026-11-21 build: green: vitest model-catalog.test.ts workspace.test.ts exit 0 (55) (REQ-FUNC-701b5178); Tools pager tests adjusted to ten rows
- 2026-11-21 build: green: vitest providers.test.ts exit 0 (cards, ticks, header Save/Cancel, dialog without search) (REQ-UX-fe31a037); lint, typecheck, check:i18n exit 0; help en/ro/de/fr providers.md + getting-started.md updated, check:help exit 0
- 2026-11-21 build: red (expected): e2e providers-layout.spec.ts 3 failed on removed groups/search and duplicate Test buttons behind the modal dialog; provider e2e specs being adapted
- 2026-11-21 build: green: e2e providers-layout, providers, lmstudio, provider-test, chatgpt, mock, web-access, privacy-settings, advanced-settings, dictation-composer exit 0 (31 passed); picker specs session-reasoning, composer-images, chat-ui, session-recovery, session-delegation, background-sessions exit 0 after ticking org/plain in session-reasoning; Providers now renders only while selected (a hidden page duplicated the header Save)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 1: both changes_required - (1) edit narrows a list-less connection and re-ticks an unticked active model (RULING-001); (2) card catalogs not refreshed after save/remove; (3) enableModels lacks secret check and INTERNAL mapping; (4) picker refetches every catalog on tick save, separate cache; (5) error shown twice; (6) dialog focus return and Escape during save; (7) ChatGPT ticks kept after sign-out; (8) tests missing for >10 filter/pager, restart, 10000 limit, picker hiding; (9) older requirements still describe search/groups; (10) knowledge/help wording
- 2026-11-21 validate: returned to build - review round 1 findings
- 2026-11-21 build: DEVIATION specify: REQ-UX-2f454a64 (preset search) retired and REQ-UX-263ddff4/734fc12d/12e9f97f/69c26603 reworded to the Provider dropdown and cards - the user asked for one dropdown without search (TASK-ec18086f)
- 2026-11-21 build: DEVIATION design: build has provider-models.tsx and an inline ProviderDialog in providers.tsx instead of provider-card.tsx/provider-dialog.tsx - same responsibilities, fewer files
- 2026-11-21 build: green (round 1 fixes): vitest provider-settings, providers, model-catalog, workspace, mockApi exit 0 (98): list-less edit stays absent, same-model edit keeps an untick, OpenAI re-save keeps ticks, restart persistence, 10001 refused, picker hides an unticked model, >10 filter and pager; enableModels checks stored keys and maps write failures; card catalogs invalidated after save/remove; picker filters cached catalogs; single error place; dialog focus return and busy Escape; ChatGPT ticks dropped on sign-out; typecheck, lint, i18n, help exit 0
- 2026-11-21 build: green: e2e providers-layout, providers, lmstudio, chatgpt, provider-test, mock, session-reasoning, composer-images, chat-ui exit 0 (23 passed) after round 1 fixes
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 2: spec approved, quality approved. Wording fixes applied after review without re-review (spec reviewer: no re-review needed): REQ-UX-263ddff4 title, providers.md dropdown wording, enableModels in the method list, Files section. Accepted low findings (not fixed): a second Escape during a save can close the dialog; focus falls to the body after Remove from the edit dialog; a previous page error shows in a newly opened dialog; save/remove refetches every card catalog; a card's unsaved ticks can drop a model newly added by an edit; no unit test for the stored-key refusal, Escape-while-busy, focus return, sign-out tick drop or catalog invalidation
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-ec18086f --strict --run exit 0; ran lint, typecheck, i18n, help (tests not in [check] run; focused vitest 98 and e2e 23 logged); warnings are other journals and untracked files, none limiting this candidate
- 2026-11-21 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-21 | decision=A newly connected provider offers only the model chosen while connecting; its card ticks more. Connections saved before this change (no list) keep offering all their models until their ticks change. A subscription signed in without a chosen model offers all its models. | reason=User choice 2026-11-21: keep the chat picker short for large catalogs | source=user | supersedes=none
- RULING-002 | date=2026-11-21 | decision=Adding or editing a provider connection happens in a dialog with the provider dropdown, its fields, Test and Cancel/Save; the page shows connected provider cards with model ticks under the page header Cancel/Save. | reason=User choice 2026-11-21 | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ec18086f.md
changed: enabledModels per provider and providers.models.enable; save defaults (RULING-001); filtered model choices; Providers cards, ticks, add/edit dialog (RULING-002); tests, requirements, knowledge, help
evidence: check --strict --run exit 0; vitest 98 pass; e2e providers/picker 23 pass; reviews round 2 approved/approved
issues: accepted low findings: second Escape during save, focus after Remove in dialog, stale page error in a new dialog, all card catalogs refetched on save, unsaved ticks vs a model added by edit; Windows only, no Ubuntu run
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-DATA-ccf2e8cb - Store the models offered from each provider
  - REQ-FUNC-701b5178 - Offer only ticked provider models in model choices
  - REQ-FUNC-9e37b9f0 - Offer only the chosen model from a newly connected provider
  - REQ-UX-fe31a037 - Show connected providers as cards with model ticks
  - REQ-UX-2f454a64 - Search the provider preset selector
  - REQ-UX-263ddff4 - Show providers as cards with presets and aligned actions
  - REQ-UX-734fc12d - Offer DeepSeek Moonshot AI and Kimi For Coding in Providers
  - REQ-UX-12e9f97f - Expose both QwenCloud plans in Providers
  - REQ-UX-69c26603 - Offer international API and plan choices in Providers
- deviations: 2 recorded
  - specify: REQ-UX-2f454a64 (preset search) retired and REQ-UX-263ddff4/734fc12d/12e9f97f/69c26603 reworded to the Provider dropdown and cards - the user asked for one dropdown without search (TASK-ec18086f)
  - design: build has provider-models.tsx and an inline ProviderDialog in providers.tsx instead of provider-card.tsx/provider-dialog.tsx - same responsibilities, fewer files
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 11abb3f: 66 file(s) changed, 2556 line(s) added
- checks: errors=0 warnings=59 notes=42
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
