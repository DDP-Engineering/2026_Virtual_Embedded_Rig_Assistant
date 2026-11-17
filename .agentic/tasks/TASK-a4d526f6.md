# TASK-a4d526f6 - VIEW-05 Mode switch and binary files (#290)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-bc3f25bd, REQ-FUNC-12972046, REQ-DATA-7af13314, REQ-REL-2c2e6e93, REQ-UX-968b89b0
parent:
branch: master
base: e1e477afbeccd86ff96fd48e65b23bc5e28ebe5f
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

Problem: STATED issue #290: file viewing lacks general toolbar mode selection and automatic Hex for binary/unknown files.
Desired outcome: STATED Rendered/Text/Hex where applicable, remembered deliberate mode per real extension, Open externally retained.
Actors: STATED workbench file reader.
Primary scenario: STATED open binary in Hex, switch Markdown through all three modes, reopen another Markdown in remembered mode after restart.
Examples: STATED #290 Done A/B and coordinator delegation.
Counterexamples: STATED citation tokens cannot become arbitrary file paths; artifacts, downloads and run logs retain their semantics.
In scope: STATED VIEW-05 only: safe host extension metadata, bounded mode selection, persistence, localized toolbar/help/release notes and focused acceptance.
Out of scope: STATED VIEW-06 images, packaging/delivery rebuilds, full suites, workflow payload, untracked bundled-plugins and PERF task.
Constraints: STATED shared master/default master, full base e1e477afbeccd86ff96fd48e65b23bc5e28ebe5f; coordinator owns local commit/closure. User authorizes local commit after validation; implementer must not stage/commit/push. OBSERVED HEAD equals base and VIEW-04 anchor is committed. STATED version1 in place, no compatibility; preserve masking, owner/attempt guards and verified citation range.
Success signals: STATED binary automatic Hex; Markdown all modes; another same-extension file and actual restart retain user preference; focused tests, both independent reviews, statics and strict AEGIS.
Evidence: OBSERVED tea issues --login ddp --repo dpasare/2026_Virtual_Embedded_Rig_Assistant --comments=false 290 and 285; file-viewer plan; viewer-context/read-text-file/hex-source; verification-policy and knowledge/document-viewer.
Assumptions: INFERRED existing localStorage is the established renderer persistence seam; host metadata supplies real extension without exposing secret names.
Unknowns: native Ubuntu unavailable; Windows native and browser acceptance available; unchanged byte/packaging proof reused.
Decision-blocking questions: none.
Proposed behaviors: accepted through explicit delegated autopilot scope; no extra product behavior.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Positive case | Boundary/failure | Verification | Design |
|---|---|---|---|---|---|---|
| Applicable modes | Select file presentation | REQ-FUNC-bc3f25bd | Markdown all three; binary Hex | Unknown explicit Text; citations unchanged | focused model/consumer/native/browser | metadata-first loader |
| Automatic view | Binary and unknown default Hex | REQ-FUNC-12972046 | binary bytes / unknown extension | explicit Text remains possible | model / component / native | bounded sniff |
| Storage failure | Invalid/unavailable records leave viewer usable | REQ-REL-2c2e6e93 | invalid JSON/version/mode | quota/denial; unsupported mode | file-mode.test.ts | strict format1 / no writes on resolution |
| Existing presentation | Admit authorized toolbar | REQ-UX-968b89b0 | toolbar plus document | actions remain in menu | tab consumer test | DocumentPanel |
| Remember choice | Persist deliberate choice | REQ-DATA-7af13314 | another same-extension file/restart | invalid storage; unsupported preference; other extensions | persistence/model/consumer/native | version1 localStorage |


## Design

### Approach
REQ-FUNC-bc3f25bd: a metadata-first ordinary-file loader selects a mode before content assembly. Existing Rendered, bounded Text and Hex readers remain authoritative. Verified citations retain the existing provenance loader and range; mode controls apply to plain file targets only. The existing tab Open externally actions remain.
### Interfaces and data
Host docs.stat adds the real extension key before path identity projection: a lower-case recognized public suffix, or a sealed unknown suffix under the existing global viewer-extension namespace. The bound admits opaque expansion to4096 characters; this prevents a secret in an unknown suffix leaking through metadata. Shared viewerExtensionKind supplies one classification vocabulary. A renderer mode module classifies rendered/text extensions and reads/writes a strict version1 extension map in localStorage. Deliberate toolbar selection (including the active fallback button, without reloading it) or the Files Hex action writes; automatic defaults and errors never overwrite preferences (REQ-DATA-7af13314). Unknown files default Hex but can explicitly select Text. Core statEntry adds current Rendered capability via one indexed-record lookup plus extraction-presence/status/freshness/ignore checks. The loader removes unavailable Rendered and resolves Markdown/HTML to Text or containers to Hex without writing preferences. A bounded prefix classifies binary known text before assembly; late responses retain owner/attempt guards.
### Files and test seams
Mode model/loader and tests; viewer-context state/actions and DocumentPanel toolbar; shared metadata, host projection and mock; four locales/help, release notes, inventories and plan/knowledge. Focused component tests exercise asynchronous switching and isolation; browser/native acceptance proves real mode changes and restart persistence.
### Risks and open decisions
Opaque identities and masked labels never provide extensions. Ref/citation targets never get converted into plain paths. Mode changes invalidate the content attempt and reset incompatible place. Existing live Display refresh reloads the same chosen mode. Unchanged byte/Hex/text/packaging proof is reused. No plugin source/system changes, no new dependencies, no migrations.
### Requirement map
REQ-FUNC-bc3f25bd: metadata-first loader and toolbar. REQ-FUNC-12972046: bounded BOM-aware control-byte sniff and unknown Hex default. REQ-DATA-7af13314: validated extension-keyed version1 persistence, with explicit menu override consumed once. REQ-REL-2c2e6e93: invalid/unavailable storage and unsupported preferences resolve without automatic writes. REQ-UX-968b89b0: preserve tooltip/action-menu separation while admitting the requested toolbar.
Diagrams: [diagram_TASK-a4d526f6.md](diagram_TASK-a4d526f6.md).


## Log

- 2026-11-17 frame: journal opened
- 2026-11-17 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-17 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-17 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-17 build: red: focused document-tabs unknown-file test expects Hex but current text reader renders nontext controls; original red.log in evaluation-outputs/view05 (REQ-FUNC-bc3f25bd).
- 2026-11-17 build: green: original focused unknown-file test 1pass/32skipped exit0. Shared mode/persistence increment now under model and component regression; first full focused consumer run exposed stale metadata fixtures and toolbar assertions, being corrected within scope.
- 2026-11-17 build: Existing REQ-UX-968b89b0 is revised only to admit the explicitly requested mode toolbar; path tooltip and file-action menu remain. No unrelated UI behavior changes. Original focused modes/host/tabs 53pass exit0 in modes-host-tabs.log.
- 2026-11-17 build: red: HexViewer under StrictMode fails initial byte-row assertion (strict-hex-red.log, 1failed). Browser automatic Hex exposed disposed memo source reuse during effect replay; native DoneA/B already passed including full restart (native-receipt.json). Scope correction is limited to Hex source lifecycle.
- 2026-11-17 build: green: lifecycle-modes.log 44pass exit0, including StrictMode Hex navigation/find/copy/retry and new mode stale-answer/error recovery checks. Native restart original receipt passed; rerun affected native/browser acceptance after lifecycle correction. Complete app/plugin/E2E suites, 200MiB and packaging proof remain explicitly deferred/reused.
- 2026-11-17 build: Consumer fixture corrections retain actual trust boundaries: document-menu log fixture now supplies bounded stat/readBytes; artifact test uses artifact ref rather than an arbitrary file path. Explicit Files Hex is a deliberate extension preference; its target override is consumed once and later toolbar choices survive restore. No production reader/provenance weakening.
- 2026-11-17 build: Focused final scope: nine named files 89pass/4fixture failures initially; all affected three consumer files rerun after corrections:53pass exit0 (consumers-corrected.log). Unchanged six files40pass retained from focused-final.log. Latest prefix validation model8pass exit0 (prefix-check.log). Typecheck found only test typing issues; explicit object/Promise types and discriminated text fixture corrected. No product type errors remain observed; final typecheck still required.
- 2026-11-17 build: red: extension-red.log 1failed/11skipped exit1 demonstrates unknown extension metadata exposing a stored secret. Fix uses public known-extension vocabulary and existing host-keyed identities for unknown extension preference keys; namespace is global per installation, independent of file/workbench/Display state. No additional key, migration, path authority or dependency.
- 2026-11-17 build: DEVIATION build: shared mode/preference increment preceded a dedicated persistence red test; subsequent model/component and actual native restart proof passes. Initial mode red and StrictMode/secret-extension regression reds are retained truthfully. All original logs remain in one owned ignored view05 root.
- 2026-11-17 build: green: extension-green.log 69pass in four named files; other immediate consumers retain passing53-file/40-case subset proof (total focused scope94cases). e2e-approved-source.log 2pass exit0: browser reload, native binary/unknown Hex, Markdown all3, opaque identity, another Markdown, actual restart for Markdown and unknown extension, four locales, no page errors or outbound attempts. Original screenshots visually reviewed; no toolbar clipping.
- 2026-11-17 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-17 validate: Proof count clarification: latest extension-green has69cases in4files (8 model +12 host +13 shared +36 tabs). Consumers-corrected has53cases in3files, of which17 documents/menu cases are additional. Retained Hex1/downloads3/tab-store4 add8, for94 unique current focused cases. Native/browser e2e2pass is separate. Earlier wording '53-file/40-case' was a journal typo.
- 2026-11-17 validate: Round1 both independent reviewers changes_required on candidate1fbfb8f8df7de7588a29f5cf4667696f9f737a082386553fb888131ff71d73ff: extension alone overstates Rendered availability for unindexed/ignored Markdown/HTML, violating usable current capabilities and unsupported preference fallback. No other findings. Add compact host capability via indexed record/extraction lookup, preserve unknown/text readers and preference isolation, refresh both reviews. Core workbench service/knowledge are newly affected metadata seams; routing page read.
- 2026-11-17 validate: returned to build - Round1 current Rendered capability finding; fix and focused proof then both round2 reviews
- 2026-11-17 build: red round2: capability-red-valid.log1failed/8skipped returns actual NOT_FOUND through docs.open for unavailable Rendered; capability-host-red.log1failed/50skipped lacks the new compact capability. Proceeding under explicit coordinator autopilot correction authorization after round1 review return.
- 2026-11-17 build: green round2: capability-core-green.log3pass/48skipped proves metadata missing extraction/current extraction/ignored/stale and owner isolation plus immediate existing byte/lifecycle cases; capability-consumer-green.log45pass; capability-regression.log42pass. e2e-capability-final.log2pass includes real unindexed and ignored Markdown, unindexed PDF Hex, unsupported Rendered fallback without any preference writes, return to indexed Rendered and actual restart/4locales. Latest model includes both Markdown and HTML unavailable cases.
- 2026-11-17 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-17 validate: Round2 specification compliance approved for nonjournal candidate43263ebca84835ae2fca2148fbe7fc681d05f39a81401f4667aff7d36b016f32; complete41owned-path manifest and original focused/native proof reviewed. Implementation quality verdict pending; no candidate edits after freeze.
- 2026-11-17 validate: Round2 spec approved, quality changes_required for candidate43263ebca84835ae2fca2148fbe7fc681d05f39a81401f4667aff7d36b016f32: active effective fallback Text click returns before remembering deliberate choice. Fix without reloading/resetting same-mode view, add consumer/native proof, refresh both round3 reviews. Self-inspection of check-i18n.mjs also requires replacing new dynamic template translation with explicit literal keys; displayed strings unchanged.
- 2026-11-17 validate: returned to build - Round2 active fallback deliberate choice and explicit i18n key contract correction
- 2026-11-17 build: red round3: active-fallback-red.log1failed/36skipped exit1; explicit click on effective Text leaves saved Rendered. Fix same-mode persistence without resetting the existing body/place or content attempt; native acceptance will exercise indexed peer reopen. Continuing original explicit autopilot correction authorization.
- 2026-11-17 build: green round3: round3-consumers.log54pass in3files, active choice stores Text while retaining exact body; e2e-round3-final.log2pass with real active-fallback click and indexed peer reopen plus prior restart/capabilities/4locale assertions. Build Biome identified new group markup requiring semantic fieldset; correcting that markup/style before freeze and rechecking affected browser/native UI.
- 2026-11-17 build: green final round3: semantic toolbar candidate Biome exit0 (82advisory warnings/1info), e2e-final-candidate.log2pass exit0 after fieldset markup. Native activeFallbackChoiceRemembered, unindexed/ignored Text, unsupported preference no-write, indexed peer, actual restart and4locales all pass. Latest native screenshot visually confirms horizontal toolbar/no clipping. Product candidate frozen for both round3 reviews; retained focused scope100 unique cases across current original logs.
- 2026-11-17 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-17 validate: Both independent round3 reviews approved exact41-path nonjournal candidate8a9a423c5ef0e8e59c7690eabe0c69be8b787f47289c4693e6f6e7ba5431393e. Specification and quality independently verified current manifest/hashes and original focused/native acceptance; no remaining findings. Final statics follow, no candidate edits allowed.
- 2026-11-17 validate: Final statics after both round3 approvals: candidate-only Biome/typecheck/check:i18n/check:help/check:release-notes all exit0; final-statics.json preserves exact argv, timings and original logs. Biome21files reports82warnings/1info (no errors); full stylesheet and existing host useTemplate info remain advisory. No candidate files edited; strict AEGIS without --run follows per explicit coordinator instruction.
- 2026-11-17 validate: Final strict: python .agentic/aegis.py check --task TASK-a4d526f6 --strict --full exit0, errors0 warnings64 notes38; original final-strict.log. Explicit instruction replaces configured --run with the already passing independent final statics; global lint's known bundled-plugin/shared-test errors excluded, no suites rerun. Existing context/ticket/retired/manual advisories and external workflow/untracked changes remain out of scope. Native Ubuntu unavailable; unchanged platform/byte/packaging proof reused and delivery/full gates deferred.
- 2026-11-17 validate: Count correction: retained unchanged Hex/download/tab-store proof is1+2+5=8 cases (earlier3/4 download/store subcounts were a journal typo). The unique combined focused total remains100: core3 +model10 +tabs37 +documents14 +menu3 +host12 +shared13 +retained8. No claim of one fresh100-case run.
- 2026-11-17 validate: Strict advisory interpretation: mockApi metadata is offline-fixture implementation covered by the viewer consumers; service.test.ts is linked verification code counted by source globs, so uncovered-source heuristics are accepted. The viewer-modes password literal is the intentional synthetic safeStorage masking fixture, not a user credential. CHANGELOG outside-layout is the mandatory repo release record. Other outside-layout/unscanned ZIPs belong to protected user bundled-plugins; no audit, revert or bundling. Existing oversized knowledge/context pages and historical ticket/manual notices remain advisory; unrelated splitting/polish is deferred.
- 2026-11-17 validate: Handover readiness:41owned paths remain unstaged; full HEAD/base e1e477afbeccd86ff96fd48e65b23bc5e28ebe5f unchanged; nonjournal SHA8a9a423c5ef0e8e59c7690eabe0c69be8b787f47289c4693e6f6e7ba5431393e still binds both approvals. Owned Electron/browser/test processes have closed. Original ignored view05 logs/receipts/screenshots and profiles/caches retained; no optional cleanup attempted. User workflow payload/config/root instructions, bundled-plugins and PERF journal excluded. Coordinator owns local commit and issue closure; implementer performed neither staging nor commit nor remote writes.
- 2026-11-17 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-17 | decision=Autopilot on shared master; user authorizes local ticket commit, owned by coordinator after validation; implementer leaves candidate unstaged | reason=Explicit delegation and root AGENTS implementation cycle | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a4d526f6.md
changed: VIEW05 complete unstaged candidate; toolbar modes and safe persistent real-extension choices
evidence: 100 focused cases across current/reused proof; browser/native2pass with actual restart; both round3 reviews approved; final5statics exit0; strict errors0 exit0
issues: Advisory Biome82warnings/1info and AEGIS64warnings/38notes; native Ubuntu unavailable; full/delivery gates deferred; scratch retained
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-bc3f25bd - Select applicable workbench file viewer modes
  - REQ-FUNC-12972046 - Open binary and unknown sources in Hex automatically
  - REQ-DATA-7af13314 - Remember deliberate file viewer mode by real extension
  - REQ-REL-2c2e6e93 - Keep file viewing usable with invalid or unavailable mode storage
  - REQ-UX-968b89b0 - Show only the document in a document tab
- deviations: 1 recorded
  - build: shared mode/preference increment preceded a dedicated persistence red test; subsequent model/component and actual native restart proof passes. Initial mode red and StrictMode/secret-extension regression reds are retained truthfully. All original logs remain in one owned ignored view05 root.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base e1e477a: 72 file(s) changed, 2555 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=64 notes=38
- checklist: 9/9 done
