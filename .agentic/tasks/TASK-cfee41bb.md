# TASK-cfee41bb - MASK-02 Display area masking (#281)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-c07a945e, REQ-SEC-df8a595a
parent:
branch: master
base: f78c1de6599a876c7990c04047abd16288ffa7a2
opened: 2026-11-17

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

Problem: STATED #281: Display currently drops secret-bearing file paths and always masks viewer content.
Desired outcome: STATED: Display resolves live app/workbench choices; all entries remain discoverable and open their original targets with safe presentation.
Actors: STATED: local user browsing Files, Find and documents.
Primary scenario: STATED MASK-02-A/B: save an MQTT password, browse a file named after it and its contents with masking off/on; Find counts remain equal.
Examples: STATED: two secrets masking to the same label remain separately selectable; two workbenches retain separate ownership.
Counterexamples: STATED: provider errors and connection tests always scrub; Display never changes indexing, model, export or Runs policy.
In scope: STATED: Display handlers, validated path identities, renderer presentation, focused boundary/component/native replay proof, four-language help/release notes and accurate records.
Out of scope: STATED coordinator: VIEW-01/readBytes unless already present; settings pages MASK-05; artifacts rebuilds, full suites, commits, staging, issue closure and publication.
Constraints: STATED: shared master/default master; full candidate reviewed against f78c1de6599a876c7990c04047abd16288ffa7a2. Coordinator owns final local commit under existing user authorization. Preserve unrelated workflow/root payload, PERF task and user bundled-plugins. Single owned scratch evaluation-outputs/mask02. Formats stay 1.
Success signals: STATED: A and B observed through real validated settings/workbench IPC and native UI navigation; focused tests/statics/strict and two independent reviews pass.
Evidence: OBSERVED git HEAD matches base; tea #281/#279/#311; plan secret-masking.md; main/index.ts unconditional filters and publicViewer.
Assumptions: INFERRED: no settings page is required to configure acceptance because validated IPC already exists.
Unknowns: UNKNOWN: precise affected renderer paths until identity-flow inspection; native Ubuntu unavailable, WSL2 reported separately.
Decision-blocking questions: None; explicit coordinator scope supplies behavior and authorization.
Proposed behaviors: None beyond stated scope.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Conditional presentation preserving entries and identity | REQ-FUNC-c07a945e | Scoped DisplayDocuments projection | focused-final.log:127; native-final.log:1 |
| Refuse cross-workbench, forged or stale identity | REQ-SEC-df8a595a | Host-owned opaque identity registry and existing confinement | display-documents/identities tests; native foreign refusal |

## Design

### Approach
STATED REQ-FUNC-c07a945e: compose a DisplayDocuments host adapter around the existing WorkbenchService; use createMaskingResolver with live SettingsService data at publication. Preserve all counts and the original disk/index operations.
### Interfaces and data
STATED coordinator restart requirement and REQ-SEC-df8a595a: use authenticated encrypted opaque portable path segments for sensitive paths, with separate displayPath/displayRef strings. A random 256-bit host-local format-1 key persists in userData/display-identities.json; deterministic HMAC nonces and AES-GCM bind each segment to workbench ID, canonical folder and original parent. Path identity segments end in a dot, which the existing ordinary-path guard refuses; real prefix names remain ordinary. Complete refs use a separate authenticated suffix segment, keeping original locators encrypted without colliding with real heading slugs. Session citations retain exact original refs for core provenance; specs/REQ-SEC-df8a595a.md records the protocol. Labels alone follow Display. Decrypt originals before existing confinement and refuse malformed/foreign identities. No plaintext path registry or renderer key exists.
STATED REQ-SEC-df8a595a: verify owning workbench before and after awaits and invalidate pending reads at close. Foreign/tampered opaque tokens return NOT_FOUND. Existing path policy still validates resolved originals. PDF bytes stay unchanged as in the existing viewer; extracted text follows Display. No readBytes channel exists.
### Files and test seams
OBSERVED: main/index.ts composes DisplayDocuments; shared documents/ipc gain optional presentation fields; Docs tree/Find, hit rows and viewer tabs read those fields. Focused host tests exercise projection/resolution; existing viewer/tree tests protect immediate consumers; native replay acceptance uses stored MQTT credential and real settings/workbench IPC.
### Risks and open decisions
STATED coordinator: current-format sensitive tabs must reopen after app restart. Stable host-key identities provide that behavior and ordinary paths retain their current meaning. The new key file stays at schemaVersion 1; no migrations/compatibility layer. Generic session/Runs/provider scrub stays unchanged. Additional-folder/prefix editors retain existing host grants and safety; index document events get Display-specific projection only.
### Requirement map
REQ-FUNC-c07a945e: adapter + presentation fields + live refresh + native acceptance.
REQ-SEC-df8a595a: authenticated workbench-owned identities, exact original-path checks before correlated publication, close revocation and post-await ownership checks.
Diagrams: [diagram_TASK-cfee41bb.md](diagram_TASK-cfee41bb.md)

## Log

- 2026-11-17 frame: journal opened
- 2026-11-17 frame: User authorizes local ticket commits; coordinator alone stages/commits this candidate after handover. Base f78c1de6599a876c7990c04047abd16288ffa7a2, current/default master. Preserve externally changed payload and user bundles. Autopilot assigned MASK-02 only.
- 2026-11-17 frame: completed; next specify
- 2026-11-17 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-17 design: completed; next build
- 2026-11-17 build: red: focused document-viewer.test.ts exit 1 (1 missing-behavior assertion, 5 passing); retained sensitive entry absent. Original evaluation-outputs/mask02/red.log. Anchor completed before product edits.
- 2026-11-17 build: red: host boundary focused run exit 1, 9 pass/1 failure: altered token path reached fake disk host. Identity canonicalization must refuse altered forms (REQ-SEC-df8a595a). Coordinator additionally requires restart-safe tab identity; replace runtime registry with deterministic authenticated encryption and persistent host-local key.
- 2026-11-17 build: green: focused-final.log exit0:11files/127tests (host identity/projection, events/router/preload, renderer Docs/tree/tabs, shared IPC, core tree); focused2.log exit0:5files/43tests earlier. Native-final.log exit0:1 real Electron UI case with stored encrypted MQTT credentials, actual indexed results, Files/Find selection, live default/on/off overrides, protected aliases, two workbenches and app restart tab reopening. Linux-proof.log exit0:pinned Node24.21.0 Ubuntu WSL2 real confined file logic, nine named checks. Native Ubuntu unavailable; no full suites or package rebuilds; unchanged TERM native/package proof reused.
- 2026-11-17 build: green: focused-last-edits.log exit0:3files/28tests after final original-path/ref check tightening and helper identity contracts; includes actual tooling/boundaries.test.ts. candidate Biome18files exit0; typecheck/i18n/help/release-notes exit0 in original logs. AEGIS build zeroerrors; known oversized context/knowledge, legacy records, excluded user ZIPs and layout gaps remain advisory. Added test paths to coverage. No plugin or plugin-system source changed, so plugin suite not applicable.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: returned to build - Round1: clear inactive cached scope content/labels on Display changes, preserve privacy enum protocol in events, and retain expanded opaque paths in tab persistence
- 2026-11-17 build: red: review-red.log exit1:4failing/42passing across3files. Regression oracles reproduce cached inactive scopes, plaintext inactive labels, enum-spelling credential event rejection and expanded opaque tab persistence loss. Both round1 reviews changes_required; original spec-live-repro.json and quality proof retained.
- 2026-11-17 build: green: review-focused-final.log exit0:6files/84tests after round1 fixes; inactive labels/tooltip and all cached owner scopes cleared, inactive tabs reload metadata, Display query caches/Properties reset, strict privacy enum protocol preserved, format1 opaque target/key bounds retained. review-native2.log exit0:real1case amended to cache another session, both off-loaded labels and short MQTT password on, then live app/config masking and actual app restart. review-typecheck.log exit0; candidate Biome22files0. Reviewed evolution31product/docs/test paths; no unrelated source changes.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: returned to build - Round2: symmetric encoding beneath literal reserved-prefix folders and safe restored inactive labels when credentials registered after tabs saved
- 2026-11-17 build: red: review2-red.log exit1:2failing/29passing, confirming reserved-prefix descendant symmetry and raw current-format inactive restore label disclosure after credential registration. Round2 spec and quality changes_required; original native restart repro retained.
- 2026-11-17 build: green: review2-focused-passed.log exit0:2files/31tests, including literal reserved-prefix descendant roundtrip and current-format raw-target inactive restore after credential registration; prior84 focused and unchanged proof reused. review2-native3.log exit0:real Electron1case expanded with actual prefix-folder child read and two later-registered MQTT filenames reopened as inactive tabs after restart. linux-proof-final.log exit0:10named checks on pinned Node24.21.0 WSL2, rebuilt actual product bundle includes prefix regression. Existing failed exploratory logs retained; owned runtime scratch cleaned.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: returned to build - Round3: disjoint opaque-path syntax, exact raw session-citation provenance and final candidate hook lint
- 2026-11-17 build: red: review3-red.log exit1:2failing/7passing, exposing ordinary raw prefix paths/session refs classified as ciphertext. Round3 quality also reports unused metadata-effect dependency; spec approved prior candidate but next edit refreshes both reviews.
- 2026-11-17 build: green: review3-green.log exit0:4files/44tests after path/ref namespace separation and exact session-ref route; typecheck-final-candidate.log0 and candidate-biome-final.log0 (22files, no warnings). review3-native.log exit0:1case includes genuine replay read-tool issuance and core-valid raw prefix session citation, plus MQTT Display/Find/UI/cached-session/late-credential restart scenarios. linux-proof-protocol.log0:11named WSL2 checks on freshly bundled current product. New protocol spec documents host-invalid trailing-dot path markers and authenticated complete-ref suffixes; ordinary prefix paths/headings retain original meaning. Reviewed evolution/current requirements, zero AEGIS errors; only advisory baseline/layout/context warnings remain.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: returned to build - Round4: enforce original8192ref bound before ordinary/session host reads
- 2026-11-17 build: red: review4-red.log exit1,1failed/6passed: oversized ordinary original ref reached host callback after envelope transport cap increased. Round4 spec changes_required, quality approved; next edit refreshes both.
- 2026-11-17 build: green: review4-green.log exit0:7focused host tests, original8192boundary accepted and8193ordinary/session refs refused with INVALID before read callback. Serializer also bounds originals. Valid native/WSL refs and remaining source are unchanged; prior44/native1/WSL11 proof reused per verification policy, no broad/native rerun. candidate-biome-approved.log0:22files/no warnings.
- 2026-11-17 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-17 validate: DEVIATION validate: final strict --run exit1 solely known global lint baseline: untracked user bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. Assignment requires preserving both; narrow known-lint-baseline.log independently proves exactly2format errors, matching global2errors. Candidate Biome22files0 (one nonblocking concat info), typecheck/i18n/help0, release-notes0. No new source/strict errors or promoted warnings; advisory context/layout/legacy records/user ZIPs and synthetic password-on fixture warning accepted within scope. Native Ubuntu unavailable; WSL2 distinct. Full suites and final exact-source delivery gate deferred to coordinator; no plugin-system change.
- 2026-11-17 validate: final: python .agentic/aegis.py check --task TASK-cfee41bb --strict --run exit1; test skipped by explicit project check list; lint1 known2baseline, typecheck0/i18n0/help0, zero promoted warnings. Both independent exact-candidate round5 reviews approved (review-spec-round5.md, review-quality-round5.md). Original focused44 + lastguard7, nativeReplay1 and WSL11 logs retained with valid predecessor focused proof. No candidate edits after final review/proof; only journal records and ignored handover manifest follow. HEAD remains f78c1de6599a876c7990c04047abd16288ffa7a2; no staging/commit; coordinator owns local commit.
- 2026-11-17 validate: completed; next done - Scoped candidate complete; assignment accepts preserved known global lint baseline

## Rulings

- RULING-001 | date=2026-11-17 | decision=Sensitive-path document tabs retain current-format app restart reopening through persistent host-local encrypted identities | reason=Coordinator follow-up explicitly requires restart-safe persistence and workbench ownership; in-memory-only identity is insufficient | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-cfee41bb.md
changed: MASK-02 completed;40owned files, uncommitted on master; coordinator owns commit
evidence: Focused44 plus final7; native1; WSL2eleven; reviews5approved; candidateBiome/typecheck/i18n/help/notes0; strict1knownbaseline
issues: Known global lint2format errors preserved; native Ubuntu unavailable; full suites and exact-source delivery gate deferred
spec_compliance: approved
implementation_quality: approved
review_round: 5

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-c07a945e - Display masking retains document entries and original identities
  - REQ-SEC-df8a595a - Display identities are confined to their owning workbench
- deviations: 1 recorded
  - validate: final strict --run exit1 solely known global lint baseline: untracked user bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. Assignment requires preserving both; narrow known-lint-baseline.log independently proves exactly2format errors, matching global2errors. Candidate Biome22files0 (one nonblocking concat info), typecheck/i18n/help0, release-notes0. No new source/strict errors or promoted warnings; advisory context/layout/legacy records/user ZIPs and synthetic password-on fixture warning accepted within scope. Native Ubuntu unavailable; WSL2 distinct. Full suites and final exact-source delivery gate deferred to coordinator; no plugin-system change.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=5
- diff vs task base f78c1de: 71 file(s) changed, 2923 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=56 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-c07a945e - Display masking retains document entries and original identities
  - REQ-SEC-df8a595a - Display identities are confined to their owning workbench
- deviations: 1 recorded
  - validate: final strict --run exit1 solely known global lint baseline: untracked user bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. Assignment requires preserving both; narrow known-lint-baseline.log independently proves exactly2format errors, matching global2errors. Candidate Biome22files0 (one nonblocking concat info), typecheck/i18n/help0, release-notes0. No new source/strict errors or promoted warnings; advisory context/layout/legacy records/user ZIPs and synthetic password-on fixture warning accepted within scope. Native Ubuntu unavailable; WSL2 distinct. Full suites and final exact-source delivery gate deferred to coordinator; no plugin-system change.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=5
- diff vs task base f78c1de: 71 file(s) changed, 2936 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=56 notes=38
- checklist: 9/9 done
