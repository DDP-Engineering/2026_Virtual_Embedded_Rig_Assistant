# Electrical project model

## Routing

Select for the electrical project model, `electrical-automation-model.json`, `electrical-automation-results/`,
`electrical_model`, `electrical_model_change`, quantities with units and basis, entity IDs versus visible
references (M1, QF1), relation rules, result freshness/stale results, explicit-mapping imports and the
`electricalModel` host flag. Start at 05_Software/src/libraries/core/src/electrical/ (model.ts, tools.ts) and
shared/src/electrical-model.ts, with spec .agentic/specs/REQ-DATA-06c0bd54.md. Tests: core/src/electrical/*.test.ts,
core/src/sessions/electrical-model.test.ts, desktop main/sessions.test.ts. The write flow itself
(commitChange, WriteQueue) belongs to [file tools](file-tools.md); plugin packages and their helpers belong to
[plugins](plugins.md) and [official plugins](official-plugins.md).

## Purpose and boundaries

First-party foundation of the electrical and automation plugins (PWR, CAD, PLC, IND): one project model per
workbench, its units, its relation graph, provenance and the result contract, with no calculation engine. The
workbench owns the model file; VERA reads it strictly and writes it only through `electrical_model_change`, a
prepared change on the shared write flow. Plugin helpers read the model and write results into their own run
folders; VERA derives result freshness from the results' input snapshots and stores no second copy.

## Public interface

- Shared (`electrical-model.ts`): zod schemas `electricalModelSchema` (kind `vera-electrical-model`, format 1) and
  `electricalResultSchema` (kind `vera-electrical-result`, format 1), the fixed paths `electricalModelPath`,
  `electricalResultsDir`, `electricalResultFile`, the object/relation/basis/status/verdict lists,
  `electricalIdPrefixes` and `electricalLimits`.
- Core pure services: `checkModel`/`parseModel` (problems `{path, message}`, at most 20, thrown as
  `Invalid <label>:` lines), `serializeModel` (canonical bytes), `canonicalJson`/`entityHash`, `modelEntities`,
  `modelIssues` (`unfed`, `unprotected`), `relationRules`; `unitDimensions`, `knownProperties`, `unitProblem`;
  `applyOperations` with `electricalOperationSchema`; `checkResult`, `resultFreshness`.
- Access port: `readModelFile(root)` and `listResults(root, model)`, both confined to the workbench with
  PathGuard (8 MiB model, 4 MiB result, 100 newest run folders).
- Tool `electrical_model` (read) {view summary|objects|relations|results, type?, ids? <=100, offset?}: summary
  {exists, path, sha256, project, sources, objects, counts, relations, issues <=100}; objects <=100 per page with
  each object's `sha256`; relations <=200 per page touching `ids`; results with freshness current/stale (changed,
  removed) or invalid (problem). A missing model gives `{exists: false}`.
- Tool `electrical_model_change` (write) {operations 1..200: set-project, add-source, remove-source, add-object,
  update-object, remove-object, add-relation, remove-relation, import {path, mapping}}: the whole new model is
  validated, serialized canonically and prepared as a FileChangeRequest (tool `electrical_model_change`, path,
  before/after SHA-256, diff cut to 2000 lines); applying is `commitChange`. Result {path, sha256, bytes, ids}.
- `SessionHost.electricalModel` offers both tools; `electricalModelPlugin(plugin)` is true for manifest ecosystem
  `electrical` or `automation`, and the desktop sets the flag while such a plugin is loaded. The headless CLI does
  not set it.

## Invariants

- Strict format 1 with no defaults, repairs or migrations: an unknown key, another kind or format, a missing
  `value` key, an unknown unit or a unit of another dimension on a known property makes the document invalid and
  nothing is read or written (REQ-DATA-06c0bd54, REQ-DATA-9d50631c).
- `value: null` is unknown and stays null; it is never read as zero (REQ-DATA-006f36b5).
- One ID namespace (project, sources, objects, relations); a visible `ref` is unique and never equals an ID;
  relations name object IDs only (REQ-DATA-183b71d2, REQ-DATA-05117b78).
- Relation endpoint types and cardinalities follow `relationRules`; no self-relation, no repeated relation, no
  feeds cycle (REQ-DATA-b75d05b0). Missing feeds or protection are issues, never refusals.
- A valid canonical file round-trips byte for byte (REQ-FUNC-11cf80d0).
- A result is stale exactly when an input snapshot's canonical hash differs from the current entity or the entity
  is gone; an invalid result is never listed as current (REQ-FUNC-7f4b0a41, REQ-DATA-8b66f751).
- The model is written only inside the write queue with the before-hash recheck: a file changed after preparation
  is a conflict and stays as it is; read-only sessions never get the change tool (REQ-REL-cc710d50,
  REQ-SEC-4dfa2a5b).
- An import merges only through a mapping naming every imported ID as new or an existing entity of the same kind
  and type; anything else refuses the whole change (REQ-FUNC-784f108f).

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Model fields, limits, result fields | shared electrical-model.ts, spec | electrical/model.test.ts, results.test.ts |
| Units or known properties | electrical/units.ts | electrical/model.test.ts (units) |
| Relation types or cardinalities | `relationRules` in model.ts | electrical/model.test.ts (relation rules) |
| Operations or import mapping | electrical/edit.ts | electrical/tools.test.ts |
| Views, freshness listing, write preparation | electrical/tools.ts, results.ts | electrical/tools.test.ts |
| Offering the tools | sessions/service.ts filter, desktop main/sessions.ts | sessions/electrical-model.test.ts, desktop main/sessions.test.ts |

## Key behaviors

- REQ-DATA-06c0bd54 — accept only a strictly valid format-1 electrical model.
- REQ-DATA-183b71d2 — refuse duplicate IDs and references that repeat or equal an ID.
- REQ-DATA-05117b78 — refuse relations and citations to missing entities.
- REQ-DATA-b75d05b0 — refuse relations that break endpoint types, cardinalities or a radial feed.
- REQ-DATA-006f36b5 — keep an unknown quantity unknown and never zero.
- REQ-DATA-9d50631c — refuse unknown units and units of another dimension.
- REQ-FUNC-11cf80d0 — write the model in one canonical form that round-trips.
- REQ-DATA-8b66f751 — accept only strictly valid format-1 results.
- REQ-FUNC-7f4b0a41 — mark exactly the results whose inputs changed as stale.
- REQ-FUNC-4437aa41 — read the model through finite views.
- REQ-FUNC-46374a53 — change the model through an approved prepared change.
- REQ-REL-cc710d50 — refuse a change when the file changed after preparation.
- REQ-SEC-4dfa2a5b — offer the tools only to hosts that enable them; never the change tool in read-only.
- REQ-FUNC-784f108f — import an exchange file only through an explicit mapping.
- REQ-TEST-033d495e — two-pump panel fixture.
- REQ-UX-d32cc9db — tool descriptions in the workbench tools editor (en/ro/de/fr).

## Files

- `05_Software/src/libraries/shared/src/electrical-model.ts` — format-1 schemas, names and limits.
- `05_Software/src/libraries/core/src/electrical/units.ts` — the unit table and known properties.
- `05_Software/src/libraries/core/src/electrical/model.ts` — validation, issues, canonical form, hashes.
- `05_Software/src/libraries/core/src/electrical/edit.ts` — operations and the explicit-mapping import.
- `05_Software/src/libraries/core/src/electrical/results.ts` — result checks and derived freshness.
- `05_Software/src/libraries/core/src/electrical/tools.ts` — access port, both tools, host-flag helpers.
- `05_Software/tests/fixtures/electrical-model/two-pump-panel.json` — fictional two-pump panel model.
- `05_Software/src/libraries/core/src/electrical/model.test.ts` — format, IDs, relations, units, unknowns, round trip, fixture.
- `05_Software/src/libraries/core/src/electrical/results.test.ts` — result format and freshness.
- `05_Software/src/libraries/core/src/electrical/tools.test.ts` — views, prepared change, conflicts, import.
- `05_Software/src/libraries/core/src/sessions/electrical-model.test.ts` — approval, auto-edit, read-only, gating.
