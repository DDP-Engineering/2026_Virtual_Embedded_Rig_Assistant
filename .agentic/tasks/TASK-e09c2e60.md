<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-e09c2e60 - WP-25 Keyword index

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-6c9447cb, REQ-FUNC-463b6c91
parent:
branch: master
base: aa90ca8be82c2ba097bf55d33d9d4f405c65639c
opened: 2026-10-12

## Done checklist (current stage)

- [x] validated candidate confirmed unchanged
- [x] validation evidence, diff, exclusions, and outcome presented in handoff
- [x] coordinator local delivery commit confirmed by standing explicit human authorization
- [x] journal and report included in coordinator delivery commit
- [x] agreed local outcome delivered by coordinator
- [x] close-out carried by coordinator local commit

## Frame

Problem: STATED persisted chunks lack production word/identifier fragment indexes.
Desired outcome: word and fragment retrieval with precise stored locators.
Actors: core search caller, ingest, migration runner, downstream WP26.
Primary scenario: ingest or upgrade -> synchronized indexes -> ranked chunk candidates.
Examples: I2C1_CR1 and C1_CR find the defining page first.
Counterexamples: punctuation-only input returns []; short PA is word-only.
In scope: migration2/backfill/triggers, repository atomic cleanup, keyword candidates, focused native proof, current knowledge.
Out of scope: embeddings/hybrid service/tools/CLI/UI/viewer/eval gate, model pins, staging/commit/push/issue closure, protected optional-companions and user data.
Constraints: STATED master/base/autopilot and sole implementer; coordinator owns authorized local commit; immutable migration1 and checksums; verification-policy v3.
Success signals: Done fixture; no stale matches on change/delete/reindex; backfill/rollback/read-only correctness; independent reviews and targeted Windows/Ubuntu proof.
Evidence: OBSERVED M3 WP25, architecture05 sections5/6, reference schema/tools/repos, storage/migrate/db/docs repository, ingest, component pages, WP24 evaluation.mjs and ADR0015. INFERRED triggers are the narrow consistent lifecycle mechanism.
Assumptions: current pinned better-sqlite3 supports both tokenizer modes; verify using real driver. WSL Ubuntu supplies native Linux execution.
Unknowns: none blocking; final proof resolves tokenizer/lifecycle/ranking assumptions.
Decision-blocking questions: none.
Proposed behaviors: persistent synchronized indexes and deterministic keyword candidates with original path/locator/text.
Path and reason: full; new interface/data format/observable behavior. Quick-path criteria: existing behavior=no; existing interface=no; no new dependency=yes; existing requirement covers entire behavior=no; unchanged data handling=no.

## Requirement coverage

Behavior inventory and traceability:

| Frame outcome | Atomic behavior | Requirement | Positive case | Boundary/failure | Verification | Design |
|---|---|---|---|---|---|---|
| durable index | synchronized migration/lifecycle | REQ-DATA-6c9447cb | schema1 backfill and publication | rollback, readonly, replacement/delete/cascade | real SQLite keyword/ingest/db tests | migration2 and triggers |
| precise retrieval | ranked word/fragment candidates | REQ-FUNC-463b6c91 | defining page, word and fragment | punctuation, quoting, short terms, caps/ties | keyword.test.ts | bound literal OR terms, WP24 rank convention |

## Design

REQ-DATA-6c9447cb: new contiguous migration2 creates exact external-content FTS tables,
rebuilds existing chunks and owns all FTS writes through insert/update/delete triggers.
Remove manual FTS delete in clearDerived to prevent duplicate deletion; preserve optional
embedding cleanup and wrap standalone clearDerived/remove in transactions. Ingest's outer
publication transaction remains authoritative. Read-only schema1 cannot upgrade and search
returns no candidates. Existing runner supplies exclusive backups/checksums/atomic rollback.
REQ-FUNC-463b6c91: synchronous core KeywordSearch reads real index joins with persisted
locators. Bound safe token literals ORed; Unicode letters/numbers/marks/underscore; top50
bm25/id per list; digit/underscore qualifying >=3-code-point fragments; RRF60 when present,
following isolated WP24 convention without importing dev scripts. Rank is one-based.
No refs/snippets/semantic/tool APIs. Test Done plus caps/determinism/diacritics/input syntax.
Spec: .agentic/specs/REQ-FUNC-463b6c91.md.
Focused set: keyword, ingest, processor, db, repositories, workbench service and tooling
boundaries. These cover migration/search/lifecycle and immediate producers/consumers;
no UI/CLI behavior changes require e2e. Static lint/typecheck/i18n and strict on both OS.
Full M3 gate remains WP29/coordinator, per policy. One scratch root per platform; preserve
original logs/receipts, close handles/processes before finally cleanup. No child tasks.

## Log

- 2026-10-12 frame: full scope accepted in autopilot on recorded master/base; Windows readiness exit0; AEGIS exclusive per delegation.
- 2026-10-12 specify: two new independent requirements; exact migration/query/rank contract in spec; coverage audited.
- 2026-10-12 design: trigger ownership and WP24-compatible ranking selected against source/lifecycle; no unresolved scope decisions.

- 2026-10-12 build red REQ-DATA-6c9447cb: `python ../02_Tools/npmw.py npx vitest run packages/core/src/storage/keyword-migration.test.ts` (05_Software), exit1; schema_version stays1, FTS tables absent and migration2 absent; original windows/red-migration.log.

- 2026-10-12 build green REQ-DATA-6c9447cb: real migration/backfill/lifecycle/rollback/read-only/checksum tests4pass exit0; original windows/green-migration.log.
- 2026-10-12 build red REQ-FUNC-463b6c91: `python ../02_Tools/npmw.py npx vitest run packages/core/src/knowledge/keyword.test.ts` (05_Software), exit1; public persisted keyword search capability is undefined; original windows/red-search.log.

- 2026-10-12 build green REQ-FUNC-463b6c91 and final behavior set: Windows focused8files91pass1skip, exit0; keyword Done/ranking/input/caps/locators plus real processor/watcher/search lifecycle, immediate storage/workbench/boundaries. Skip is existing POSIX symlink case on Windows; Ubuntu exercises it. Original argv/cwd/UTC/exit/stdout hashes in windows/focused.json. Adapted initial runner fixtures explicitly to immutable migration1 and synthetic ingest fixtures to real migration2 triggers; preserves their oracles. Advance validate.

- 2026-10-12 validate round1: independent /root/spec_review and /root/quality_review both approved with no findings; original spec-review-round1.json/quality-review-round1.json bound to review-round1-manifest.json (20paths; journal-only evidence/delivery metadata exempt). Both verified scope, atomicity/keyword correctness and focused coverage sufficiency. Native/statics final proof remains required, approvals make no completion claim. Current knowledge/context and diagrams reconciled; evolution10non-agentic paths reviewed, no unexpected paths.

- 2026-10-12 validate final: native Ubuntu WSL2 focused8files92pass exit0; Windows focused91pass1POSIXskip exit0. Both use Node24.21.0/better-sqlite3 13.0.3/SQLite3.53.4 with platform addon hashes in runtime.stdout. Configured strict --run exit0 on both: lint/typecheck/i18n only, import-boundary tests in focused set. Windows11 pre-existing advisory warnings/3notes; native first318warnings were mirror executable-bit copy noise, corrected without source changes; final native strict-catalog exit0 has same11warnings/4notes (additional missing local anchor, covered by root anchor/evolution/parity). Original statics reused on identical347software-file hashes; no repeated tests/statics. Full M3 gate remains WP29, no e2e/CLI selection justified by unchanged interfaces/host composition. Original receipts, raw stdout/stderr and exact argv/cwd/UTC/exit/hash in windows and linux folders; proof-reuse.json verifies current software, both OS and nonjournal reviewed candidate byte-identical. No candidate failures or unresolved findings.
- 2026-10-12 DEVIATION validate: automatic approval review rejected the owned Windows TEMP/native task-mirror scratch cleanup before execution, reason 'blocked by policy' with no additional rationale. Retain ignored scratch on both platforms, including accidental owned CR-suffixed setup directories; do not bypass. cleanup.json records rejection. Original native logs copied/hash-verified to local ignored task cache before handback; no user/previous-ticket cache/runtime deletion attempted.
- 2026-10-12 validate completed: all20 candidate paths reviewed; immutable migration1/model pins/Electron44.7.0/protocol/runtime/config unchanged. Protected optional-companions SHA2562a69f5b335a53e498b1f8e30fa5adb8096e870e7a12bbc05b0727a03cee72c6b preserved/excluded; wp21 manual-user-data and other user data untouched/unaudited. Both independent round1 approvals remain bound; candidate unchanged except journal-only evidence. git diff --check exit0; master/HEAD equal base; no staged files. Advance deliver for coordinator-authorized local commit, with no publication by implementer.

- 2026-10-12 deliver handback: paused idle with coordinator commit pending under standing user authorization; report appended/read. Original approvals and proof unchanged; exact20path manifest excludes protected human file (report advisory diff includes it). No new approval requested and no staging/commit/publication performed.

- 2026-10-12 deliver report clarification: generated report counts the single cleanup deviation twice because its notice is repeated in the handback section; this is one material deviation. Advisory21file diff includes the excluded human optional-companions; exact commit candidate is manifest20files. Remaining12th advisory is the expected pending coordinator delivery checklist.

- 2026-10-12 coordinator deliver acceptance: complete20file candidate, full journal/requirements/spec, both original round1 reviewer verdicts and native proof verified. All19nonjournal review hashes and347software files match original Windows/native final proof;91pass1skip/92pass, statics/strict0, explicit Done satisfied. No tests rerun. Standing user authorization applies to one local WP25 commit; excluded human file SHA preserved. Cleanup rejection and11pre-existing advisories accepted as documented. Acceptance: 02_Tools/cache/wp25-TASK-e09c2e60/coordinator-acceptance.json.

- 2026-10-12 coordinator local closeout: delivery report read, errors0; expected pending closeout advisory plus11pre-existing advisories. The approved outcome is the local commit itself, so done6/6 is carried in that single commit per deliver step7. No push/PR/publication; software proof unchanged.

## Rulings

- RULING-001 | date=2026-10-12 | decision=Implement on shared master in autopilot; hand back without staging/commit; coordinator local commit authorized by user | reason=Explicit delegation and AGENTS automated cycle | source=user | supersedes=none
- RULING-002 | date=2026-10-12 | decision=AEGIS exclusively; optional BMAD bootstrap not required; protect and exclude optional-companions.md | reason=Explicit user workflow and exclusion | source=user | supersedes=none

## Handoff

current: done
status: ready
next: coordinator verify local commit and start eligible WP26
must_read: .agentic/tasks/TASK-e09c2e60.md
blockers: none; rejected cleanup retains ignored scratch

## Stage report

stage: deliver
result: completed
current: done
changed: 20 candidate files; keyword indexes/search and tests/docs
evidence: Windows91pass1skip; native Ubuntu92pass; original static/strict0; both round1approved; coordinator acceptance
issues: 11 pre-existing advisories; automatic cleanup rejection retains ignored scratch
next: verify local commit then WP26
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Original proof and candidate handback

Scope: migration2/backfill/trigger synchronization, atomic repository cleanup,
KeywordSearch persisted top50 word/identifier candidates, typed locators and
focused regressions. Done assertions find I2C1_CR1 and C1_CR with defining page
first; ordinary-word bm25 order, literal input, caps/ties and lifecycle covered.

Evidence root: `02_Tools/cache/wp25-TASK-e09c2e60/` (ignored). Both original review
receipts `spec-review-round1.json` and `quality-review-round1.json` bind
`review-round1-manifest.json`; no findings. Final exact base-relative inventory,
staged/unstaged/untracked flags, per-file SHA256 and exclusions are in
`candidate-manifest.json`; 20 paths (19 nonjournal hashes unchanged from review).
No child implementation tasks. No staging/commit/push/PR/issue closure performed.

Original `windows/focused.{json,stdout,stderr}`: exit0,91pass1POSIXskip, UTC
19:10:01.951459..19:10:35.849037. Original native
`linux/focused.{json,stdout,stderr}`: exit0,92pass, UTC
19:17:43.575829..19:18:18.188410. Exact test command from05_Software on Windows:
`python ../02_Tools/npmw.py npx vitest run packages/core/src/storage/keyword-migration.test.ts packages/core/src/knowledge/keyword.test.ts packages/core/src/knowledge/ingest.test.ts packages/core/src/knowledge/processor.test.ts packages/core/src/storage/db.test.ts packages/core/src/storage/repositories.test.ts packages/core/src/workbench/service.test.ts tests/tooling/boundaries.test.ts`.
Ubuntu uses `python3` with the same selectors from the isolated native mirror.

Original `windows/strict.{json,stdout,stderr}`: exit0 UTC
19:17:01.773797..19:17:24.556583; native `linux/strict.{json,stdout,stderr}`:
exit0 UTC19:18:18.264976..19:18:48.132694. Exact root command:
`python .agentic/aegis.py check --task TASK-e09c2e60 --strict --run` (Ubuntu python3).
Configured run list is lint/typecheck/i18n via repository npmw; test is explicitly
excluded by the project policy. `linux/strict-catalog.*` is the final exit0
catalog-only check after correcting mirror-only file modes; original successful
statics are reused byte-identically, without repeating them. Source/config/test
before-after hashes and current347software-file cross-platform parity are in
`*.software-hashes.json`, `linux/source-parity.json` and `proof-reuse.json`.
Native mirror: `/home/dpasare/.cache/vera-wp25-TASK-e09c2e60/mirror`; native dependencies
were installed with pinned npm ci in this own mirror; readiness and runtime
receipts are retained. Ubuntu is native Linux x64 under WSL2, not a clean release
VM. Windows uses its original own dependencies. All receipts include exact
argv/cwd/UTC/exit/stdout and stderr SHA256; copied native originals were verified.

Limits: full suite/e2e/CLI and retrieval gate remain later milestone work, as
required; Windows symlink skip is passed on Ubuntu. Harmless PDF fixture warning
'Indexing all PDF objects' remains. Eleven pre-existing AEGIS advisories concern
prior journals and DEMO-01 ticket heuristic; no task finding/gate failure. Local
root anchor/evolution provide fingerprint evidence; native missing-anchor note
is supplemented by explicit byte parity. No weak/clean offline release claim.

DEVIATION validate: cleanup was rejected automatically ('blocked by policy',
no additional explanation); ignored Windows TEMP and native task scratch remain,
with no bypass. `cleanup.json` records the exact refusal. Original logs/receipts
are preserved. Protected optional-companions remains byte-identical and excluded;
all user/manual data and prior caches are excluded and were not audited.
Next: coordinator review manifest/current diff/original proof, close out journal
and make the previously authorized local commit; routine retesting is unnecessary.

## Delivery report (2026-10-12)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-DATA-6c9447cb - Persist synchronized keyword indexes
  - REQ-FUNC-463b6c91 - Search persisted chunks by words and identifier fragments
- deviations: 2 recorded
  - validate: automatic approval review rejected the owned Windows TEMP/native task-mirror scratch cleanup before execution, reason 'blocked by policy' with no additional rationale. Retain ignored scratch on both platforms, including accidental owned CR-suffixed setup directories; do not bypass. cleanup.json records rejection. Original native logs copied/hash-verified to local ignored task cache before handback; no user/previous-ticket cache/runtime deletion attempted.
  - validate: cleanup was rejected automatically ('blocked by policy',
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base aa90ca8: 21 file(s) changed, 1018 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 3/6 done; open: journal and report included in coordinator delivery commit; agreed local outcome delivered by coordinator; close-out carried by coordinator local commit

## Delivery report (2026-10-12)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-DATA-6c9447cb - Persist synchronized keyword indexes
  - REQ-FUNC-463b6c91 - Search persisted chunks by words and identifier fragments
- deviations: 2 recorded
  - validate: automatic approval review rejected the owned Windows TEMP/native task-mirror scratch cleanup before execution, reason 'blocked by policy' with no additional rationale. Retain ignored scratch on both platforms, including accidental owned CR-suffixed setup directories; do not bypass. cleanup.json records rejection. Original native logs copied/hash-verified to local ignored task cache before handback; no user/previous-ticket cache/runtime deletion attempted.
  - validate: cleanup was rejected automatically ('blocked by policy',
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base aa90ca8: 21 file(s) changed, 1038 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 5/6 done; open: close-out carried by coordinator local commit
