# TASK-e937e9e6 - PLG-02 #263 Pre-install card with summary, type and warnings

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-c4afc07b, REQ-DATA-9cdaa766, REQ-UX-d431b9b2, REQ-UX-9ae801f5, REQ-UX-41f26472
parent:
branch: feature/261-plugin-management
base: 81f3b1e892c95e26a90ba2dc98f3ed1dbe0a018a
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

Problem: STATED (ticket #263 "Problem"): the catalog card shows the full description (up to 1024 characters, often a paragraph); there is no short description, and platform or risk problems appear only in the review dialog. OBSERVED: `CatalogItem` in `renderer/components/plugin-catalog.tsx` renders `plugin.description`; `pluginManifestSchema` (shared `plugins.ts`) has no `summary`; `catalogEntrySchema` (shared `plugin-catalog.ts`) carries no rule risk.
Desired outcome: STATED: manifest field `summary` (required, 1-160 characters) in `format: 1`, filled for all official plugins and carried by the catalog index; the catalog card shows name, version with the PLG-01 badge, type (tier badge and ecosystem) and the summary; two warnings only when they apply - the user's platform is not in `platforms`, and the highest rule risk is `device-write` or `irreversible`; the review dialog keeps the full description, programs, sources and rules.
Actors: STATED: the desktop user browsing the Plugins library before installing; the plugin author writing `plugin.yaml`.
Primary scenario: on Windows the user sees the `esp32-efuse` card with its one-line summary and an irreversible-risk warning, and the Linux-only plugin (if any) with a platform warning; `git` shows neither.
Examples: STATED (PLG-02-A): a manifest without `summary`, or with 161 characters, is invalid. INFERRED: a plugin whose rules are all `safe`/`device-read` shows no risk warning; a plugin listing `[windows-x64, linux-x64]` on windows-x64 shows no platform warning; `ltspice` (`[windows-x64]`) on linux-x64 shows the platform warning.
Counterexamples: INFERRED: a `blocked` rule never runs, so it does not raise the risk warning (premise: `blocked` refuses the command; the ticket names only device-write and irreversible).
In scope: STATED: shared manifest schema; index entry; core `catalog-source.ts`; renderer card; en/ro/de texts; 37 official summaries; fixtures updated in place. INFERRED: the index entry also carries the highest rule risk, because the card is built from the index entry and has no rules (premise: OBSERVED `catalogEntrySchema`); `pluginPlatform` moves to shared so the renderer can map `app.info` platform/arch.
Out of scope: STATED: compatibility or migration code; a format bump; changing the review dialog content (it stays); installed-plugin cards (the ticket names the catalog card).
Constraints: STATED: pre-release, `format: 1` edited in place; Windows and Linux; simple; targeted tests only; LF line endings.
Success signals: PLG-02-A..D; `vera catalog check --source plugins` passes; focused shared/core/renderer tests, lint, typecheck and i18n pass.
Evidence: OBSERVED: `pluginPlatform(platform, arch)` in core `provisioning.ts`; renderer reads `api.getAppInfo()` (`platform`, `arch`) under query key `app.info`; `pluginRiskSchema` order safe < device-read < device-write < irreversible < blocked; the create-plugin skill embeds a format-1 example manifest.
Assumptions: INFERRED: when the host platform is unknown (app info not loaded, or an unsupported host), no platform warning shows - the warning needs a known platform to compare.
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: index entry field `risk` = highest non-blocked rule risk, `safe` without rules; card warnings as `role="note"` lines under the summary. Accepted under autopilot.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new card content and warnings |
| no new interface or data format | no | new manifest and index fields |
| no new dependency | yes | none added |
| an existing requirement already covers the behavior | no | none covers summary or card warnings |
| no security or data-handling change | yes | display only; risk rules unchanged |

## Requirement coverage

| Behavior | Requirement | New/revised |
|---|---|---|
| manifest `summary` required, 1-160 characters; official plugins pass | REQ-DATA-c4afc07b | new |
| index entry carries `summary` and highest non-blocked rule `risk` | REQ-DATA-9cdaa766 | new (spec REQ-DATA-b40d3f9b section 4 revised) |
| card: name, version + badge, tier, ecosystem, summary; review keeps description | REQ-UX-d431b9b2 | new |
| platform warning only when the known host platform is not listed | REQ-UX-9ae801f5 | new |
| risk warning only for device-write or irreversible | REQ-UX-41f26472 | new |

## Design

**Approach.** The manifest gains a required `summary` beside `description` (REQ-DATA-c4afc07b); the 37 official
manifests and every fixture are edited in place (pre-release, no format bump). The catalog card is built from the
index entry, which has no rules, so `vera catalog build` derives one `risk` per entry with a shared
`pluginHighestRisk(rules)` and writes it with `summary` (REQ-DATA-9cdaa766). `CatalogItem` replaces the description
with the summary and adds two warning lines (REQ-UX-d431b9b2, REQ-UX-9ae801f5, REQ-UX-41f26472). The review dialog
is untouched. Rejected: shipping the rules in the index (large, and the card needs one value).

**Interfaces and data.** Shared `plugins.ts`: `summary: z.string().trim().min(1).max(160)`;
`pluginHighestRisk(rules): Exclude<PluginRisk, "blocked">` (blocked rules never run, so they are ignored; `safe`
without rules); `pluginPlatform(platform, arch)` moves here from core `provisioning.ts` (core re-exports it, so CLI,
main and tests keep their import). Shared `plugin-catalog.ts`: entry `summary: manifest.summary`,
`risk: pluginRiskSchema.exclude(["blocked"])`, both required. Renderer: `Plugins` reads `app.info` (same query key
as App) and passes `platform?: PluginPlatform` to `CatalogItem`; an unknown or unsupported host gives no platform
warning. Warnings: `<p role="note" data-catalog-warning="platform|risk">`. Texts `plugins.catalog.platformWarning`
({{platforms}}), `plugins.catalog.riskWarning.device-write`, `plugins.catalog.riskWarning.irreversible` in en/ro/de.

**Files and test seams.** shared `plugins.ts` + `plugins.test.ts` (summary limits, highest risk); shared
`plugin-catalog.ts` + `plugin-catalog.test.ts` (entry requires summary/risk); core `catalog-source.ts` +
`catalog-source.test.ts` (built entry); core `provisioning.ts` (re-export); renderer `plugin-catalog.tsx`,
`plugins.tsx`, locales, `plugin-catalog.test.ts` (card content, both warnings and their absence); create-plugin
skill example and `plugins/CONTRIBUTING.md` gain `summary`; 37 `plugin.yaml`; test fixtures and renderer mocks.

**Risks and open decisions.** Remote catalogs without `summary`/`risk` become invalid (pre-release: accepted, the
bundled catalog is rebuilt by `prepare:plugins`).

**Requirement map.** REQ-DATA-c4afc07b: schema field + official summaries. REQ-DATA-9cdaa766: `pluginHighestRisk`
in build. REQ-UX-d431b9b2: card layout. REQ-UX-9ae801f5: `platform` prop from `app.info`. REQ-UX-41f26472: risk line.


## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: vitest run shared plugins/plugin-catalog + core catalog-source exit 1 - summary is an unknown manifest key, pluginHighestRisk missing, entry has no summary/risk (REQ-DATA-c4afc07b, REQ-DATA-9cdaa766)
- 2026-11-15 build: green: vitest run shared plugins.test/plugin-catalog.test + core catalog-source.test exit 0, 24 passed; 37 official summaries written (REQ-DATA-c4afc07b, REQ-DATA-9cdaa766)
- 2026-11-15 build: red: vitest run renderer plugin-catalog.test.ts exit 1 - 4 failed: no platform/risk warning on the card, app.info never read (REQ-UX-d431b9b2, REQ-UX-9ae801f5, REQ-UX-41f26472)
- 2026-11-15 build: green: vitest run renderer plugin-catalog.test.ts exit 0, 19 passed (REQ-UX-d431b9b2, REQ-UX-9ae801f5, REQ-UX-41f26472)
- 2026-11-15 build: green: npm run vera -- catalog check --source plugins exit 0 (37 official summaries valid); lint exit 0 (0 errors), typecheck exit 0, check:i18n exit 0; unit vitest shared/core plugins+skills/renderer plugin*/main plugin-list-host/cli src exit 0, 64 files 631 passed (REQ-DATA-c4afc07b, REQ-DATA-9cdaa766, REQ-UX-d431b9b2, REQ-UX-9ae801f5, REQ-UX-41f26472)
- 2026-11-15 build: review round 1: spec approved, quality approved. Accepted limits: the listed/unknown-platform absence test may assert before app.info resolves (the en/ro/de test proves absence after the platform is known for linux-x64-listed cards); all-blocked plugins report risk safe by design; remote catalogs without summary/risk are invalid (pre-release). Spec note fixed: plugin-catalog.test.ts linked to REQ-DATA-9cdaa766.
- 2026-11-15 build: green: vitest integration plugin-builder, provisioning, cli, gdb-debug, hil-testing, kicad-layout, platformio, renode, scpi-instruments, zephyr, can, esp32-efuse + packaging prepare-plugins: 12 files passed, 164 passed/72 skipped; cli.test.ts 3 failed = the known pre-existing failures (9-plugin count, CLI index exit 1), reconfirmed with a fresh CLI bundle
- 2026-11-15 build: final: python .agentic/aegis.py check --task TASK-e937e9e6 --strict --run exit 0; lint ok, typecheck ok, i18n ok; strict ok. Remaining: uncovered-source warnings for fixtures, tests, locales, styles and mocks updated in place (advisory, not behaviors of their own); pre-existing cli.test.ts x3 out of scope
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e937e9e6.md
changed: manifest summary (37 official), index summary+risk, catalog card summary + platform/risk warnings, en/ro/de, fixtures, specs, knowledge
evidence: check --task TASK-e937e9e6 --strict --run exit 0
issues: cli.test.ts 3 pre-existing failures (out of scope)
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-15)

- stage: build; type: feature; path: full; branch: feature/261-plugin-management
- requirements:
  - REQ-DATA-c4afc07b - Require a one-line plugin summary in the manifest
  - REQ-DATA-9cdaa766 - Carry the summary and the highest rule risk in the catalog index
  - REQ-UX-d431b9b2 - Show name, version, type and summary on the catalog card
  - REQ-UX-9ae801f5 - Warn on the catalog card when the platform is not supported
  - REQ-UX-41f26472 - Warn on the catalog card when a rule can write to or permanently change a device
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 81f3b1e: 86 file(s) changed, 576 line(s) added
- checks: errors=0 warnings=76 notes=27
- checklist: 0/6 done; open: each automated increment has a red line before its implementation and a green line after; each manual one a logged observation; anchor recorded before implementation; evolution reviewed after; focused tests green, with the command and its scope logged; `affected_paths`, `linked_tests` and `status = "active"` current on every requirement, or `retired` with its reason; affected docstrings, usage examples and setup instructions updated; `check` clean, or each remaining warning explained in the Log
