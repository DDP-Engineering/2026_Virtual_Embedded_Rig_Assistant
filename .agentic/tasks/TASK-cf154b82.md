# TASK-cf154b82 - EMB-01 Embedding model registry

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-372352ae, REQ-DATA-428ff836, REQ-DATA-acfca53d, REQ-REL-9195e56a, REQ-REL-38e40369
parent:
branch: ddp/epic-298
base: eab13c15ca68b852f96ae3317769936b1b779e40
opened: 2026-11-19

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

Problem: OBSERVED — the shared workbench schema accepts one literal and preparation reads one root manifest.
Desired outcome: STATED — EMB-01 / Gitea #299 requires both registered q8 model IDs and a pinned manifest per model.
Actors: STATED — workbench operators and developers preparing the offline assets.
Primary scenario: STATED — prepare both model caches, and validate a format-1 workbench with either registered ID.
Examples: STATED — Xenova/bge-small-en-v1.5 and Xenova/multilingual-e5-small are valid format-1 model values.
Counterexamples: STATED — a model ID absent from the registry is invalid. OBSERVED — missing or changed offline assets fail preparation.
In scope: STATED — registry, format-1 validation, asset preparation, and preservation of BGE consumers after the manifest move.
Out of scope: STATED — selection and workers per model (EMB-02), switching UI and re-embedding (EMB-03), E5 delivery and notices (EMB-04).
Constraints: STATED — use sibling worktree on ddp/epic-298, base eab13c15ca68b852f96ae3317769936b1b779e40. Format remains 1. Follow focused verification policy. The user authorized the coordinator to make one local commit after validation. This implementation session hands back the unstaged candidate.
Success signals: STATED — EMB-01-A both manifests validate and unknown workbench IDs fail; EMB-01-B prepare:model verifies every pinned asset of both models.
Evidence: OBSERVED — Gitea #299, multilingual-embeddings.md, the shared workbench schema, the existing model manifest and prepare-model.mjs.
Assumptions: INFERRED — keep BGE as the default and as the BGE consumer model until the follow-up runtime tickets, from the scope and ordering in the plan.
Unknowns: None that affect this ticket.
Decision-blocking questions: None.
Proposed behaviors: None outside the stated criteria and existing integrity behavior.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Accept registered IDs and default to BGE | REQ-DATA-372352ae | See Design |
| Reject an unknown ID | REQ-DATA-428ff836 | See Design |
| Validate one manifest per registered ID | REQ-DATA-acfca53d | See Design |
| Verify every pinned asset across both models | REQ-REL-9195e56a | See Design |
| Fail on missing or invalid bytes | REQ-REL-38e40369 | See Design |

## Design

### Approach

OBSERVED: the renderer and IPC use the shared workbench schema, and core depends on shared.
Keep the ID tuple and default in a runtime-neutral shared module. The core embedding entry
exports that same registry, and preparation iterates it using the pinned Node runtime.

### Interfaces and data

- REQ-DATA-372352ae and REQ-DATA-428ff836: enum validation uses the same IDs for format-1 YAML and draft patches; BGE remains the default and unknown IDs keep the existing INVALID result.
- REQ-DATA-acfca53d: both the source and installed model roots use <model-id>/model-manifest.json alongside assets. The installed payload continues to stage the BGE descriptor and listed assets for this ticket. BGE's model ID, pinned files, byte hashes, and vector identity stay identical.
- REQ-REL-9195e56a and REQ-REL-38e40369: preparation loads validated, model-specific pinned manifests. The existing checks compare size and SHA-256 before accepting cached or fetched bytes. Offline mode requires every file to be present.

### Files and test seams

- Shared workbench and core YAML parser tests cover the two valid IDs, BGE default and invalid-ID error.
- Packaging tests load both manifests through the preparation reader and verify their descriptors; the existing materializer test covers rich integrity failures without the network.
- The preparation command supplies real online and offline proof. Compiled CLI and desktop host tests and the BGE native worker smoke cover the manifest relocation.
- Main, CLI, release staging, packaging probes and retrieval evaluation use the model-relative path. Linux and Windows use the same layout.

### Risks and open decisions

OBSERVED: source assets are ignored by Git and packaging previously copied the entire model root. Stage only the listed BGE files and its manifest so preparing E5 cannot implicitly change the delivery scope. Packaging selection and notices for E5 belong to EMB-04.

### Requirement map

- REQ-DATA-372352ae and REQ-DATA-428ff836: shared enum, default and YAML parser tests.
- REQ-DATA-acfca53d: shared descriptor shape and tooling manifest validation tests.
- REQ-REL-9195e56a and REQ-REL-38e40369: registered manifest loop, real online/offline proof, asset failure tests.

Diagrams: [diagram_TASK-cf154b82.md](diagram_TASK-cf154b82.md)

## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: User authorized one local commit by the coordinator after validation; implementer hands back unstaged changes on ddp/epic-298.
- 2026-11-19 frame: completed; next specify
- 2026-11-19 specify: completed; next design
- 2026-11-19 design: completed; next build
- 2026-11-19 build: red: npmw.py npx vitest run workbench.test.ts packaging.test.ts -t registered-model criteria exit 1; E5 rejected by the BGE literal, and the registered-manifest reader is absent (REQ-DATA-372352ae, REQ-DATA-acfca53d).
- 2026-11-19 build: green: targeted Vitest registered YAML/workbench schema and packaging model tests exit 0 (7 passed). Existing offline missing, corrupt cache/download and path/URL checks retained (REQ-DATA-372352ae, REQ-DATA-428ff836, REQ-DATA-acfca53d, REQ-REL-38e40369).
- 2026-11-19 build: green: pinned Windows npm run prepare:model from the empty asset cache and npm run prepare:model -- --offline both exit 0, verifying 7 BGE and 8 E5 files. A same-size mutation of the final E5 asset (README.md) failed the offline command with Model integrity mismatch; restored the original and the offline command passed (REQ-REL-9195e56a, REQ-REL-38e40369).
- 2026-11-19 build: Focused Windows broadening: 107 tests passed across workbench, worker, packaging and import boundaries; the instrumented ASAR case hit its existing 5 s deadline under concurrent load, then passed on a single-case rerun (3.27 s total).
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Pinned Windows typecheck exit 0. Compiled CLI and desktop BGE PDF extraction and vector tests passed in both layouts: 3/4 initially under concurrent load (source CLI hit the existing 5 s deadline), then both source cases passed in the isolated source-only retry. Packaging staging checks the manifest and every BGE byte hash and rejects an unexpected staged path.
- 2026-11-19 validate: Review round 1: specification changes required for stale architecture/inventory paths and diagram label; implementation quality approved. No product-code findings.
- 2026-11-19 validate: returned to build - Reconcile current RAG architecture, inventories and preparation diagram label
- 2026-11-19 build: Reused product focused proof after round-1 documentation-only corrections. Native Windows Electron indexer E2E passed (1 case, including restart and full indexing). Pinned native Ubuntu WSL prepare:model -- --offline exit 0 (15 files), and Linux BGE staging smoke exit 0 (manifest plus 7 asset hashes, no other paths). The BGE manifest Git blob equals the task base.
- 2026-11-19 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-19 validate: Round 2: independent specification and implementation-quality reviewers approved the complete unstaged candidate against eab13c15ca68b852f96ae3317769936b1b779e40. Build checklist evidence from round 1 remains valid after the documentation-only correction.
- 2026-11-19 validate: final: python .agentic/aegis.py check --task TASK-cf154b82 --strict --run exit 0; lint, typecheck, i18n and help passed. 33 advisory warnings are existing record findings, help/CHANGELOG layout classifications and three linked tests classified as source by the checker. No ticket errors. The release-notes audit exited 0 and flagged the changelog-only internal preparation entry; the four localized help pages describe BGE inference.
- 2026-11-19 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-cf154b82.md
changed: Per-model registry, YAML validation, pinned preparation and BGE consumer layout
evidence: Strict AEGIS and static checks exit 0; EMB-01-A and EMB-01-B passed on focused proof.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-19)

- stage: validate; type: feature; branch: ddp/epic-298
- requirements:
  - REQ-DATA-372352ae - Accept the registered local embedding model IDs
  - REQ-DATA-428ff836 - Reject unknown local embedding model IDs
  - REQ-DATA-acfca53d - Pin one valid q8 manifest per registered embedding model
  - REQ-REL-9195e56a - Prepare and verify the assets of every registered embedding model
  - REQ-REL-38e40369 - Fail preparation when any pinned embedding asset cannot be verified
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base eab13c1: 51 file(s) changed, 736 line(s) added
- checks: errors=0 warnings=33 notes=38
- checklist: 9/9 done
