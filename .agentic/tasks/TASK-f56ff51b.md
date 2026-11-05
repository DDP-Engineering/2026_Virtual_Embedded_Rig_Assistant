# TASK-f56ff51b - Stabilize remaining Analysis capabilities verification failures (#75)

stage: done
type: fix
path: full
interaction: autopilot
requirements: REQ-REL-2512a455, REQ-FUNC-80b2033a, REQ-TEST-2308561a, REQ-TEST-fa9a50c1, REQ-TEST-21b726d6, REQ-UX-4bea0002, REQ-REL-4bea0006
parent:
branch: master
base: dbc6c0b3a5736a974e6a8c2e5149d4f9fd766afd
opened: 2026-11-05

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

Problem: STATED user requests stabilization of the remaining failed verification for epic #75. OBSERVED original CAP04 gate retained failed Windows/Ubuntu WSL2 unit/integration and E2E checks (02_Tools/cache/cap-04/windows/proof/verification.json); its four capabilities are already implemented.
Desired outcome: STATED repair those software/test failures, validate the complete candidate, allow coordinator's authorized local commit and issue closure without remote publication. INFERRED unchanged passing proof can be reused per verification-policy.md.
Actors: STATED VERA users; OBSERVED desktop/core/CLI consumers, deterministic replay fixtures and verification harnesses.
Primary scenario: OBSERVED execute each original failed/affected check on current master, fix its established root cause, retain original red and new green receipts, and independently review complete uncommitted candidate.
Examples: OBSERVED shared dist tests collected alongside source; program-approval E2E expects an obsolete strong label; other failures include PDF readiness and session recovery and remain UNKNOWN until diagnosis.
Counterexamples: STATED no new ecosystem plugins, remote publication or changes to personal data/credentials. OBSERVED WSL2 proof cannot establish native Ubuntu acceptance.
In scope: STATED remaining #75 verification failures and immediate consumers, including actual product defects and stale or interfering test fixtures/harnesses; AEGIS records, focused regression proof and two independent final reviews.
Out of scope: STATED new optional plugin queue, remote code/artifact/release publication; INFERRED unrelated refactoring or polish excluded by verification-policy.md.
Constraints: STATED shared checkout/master only, recorded base dbc6c0b3a5736a974e6a8c2e5149d4f9fd766afd; one implementer owns mutations; coordinator commits after review. STATED development format1 only/no migration. OBSERVED only Ubuntu WSL2 locally available. STATED preserve assertions/security boundaries and do not relabel unknown failures as baseline passes.
Success signals: STATED all originally failed/affected software checks repaired and green on available Windows/Linux hosts, static/strict checks pass and both independent reviews approve; remaining unavailable native-platform proof is explicitly reported rather than claimed.
Evidence: OBSERVED user request 2026-11-05; root AGENTS.md; 02_Tools/verification-policy.md; original CAP04 manifest/logs; live #75; software-tooling/chat-ui/desktop-shell/plugin requirements and knowledge.
Assumptions: INFERRED no user behavior redesign is needed to restore existing requirements; verify by diagnosis.
Unknowns: UNKNOWN exact root causes and touched contracts until each failure is examined; UNKNOWN native Ubuntu host availability beyond root's WSL2 inventory.
Decision-blocking questions: None for diagnosis and restoration of existing contracts; new behavior decisions will be escalated only with concrete evidence.
Proposed behaviors: None; restore established contracts and faithful deterministic verification.
Path and reason:
| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | unknown | production defects not fully diagnosed |
| no new interface or format | yes | current contracts authoritative |
| no new dependency | unknown | avoid additions, diagnose first |
| existing requirement covers behavior | yes | component requirements and epic Done |
| no security/data handling change | unknown | approval/recovery failures need inspection |
Full path selected because diagnosis spans multiple components and unknowns. No independent child feature tasks; investigators prepared disjoint test patches under this task, and two separate reviewers inspect the complete candidate independently.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| Whole-command wildcard matching and irreversible word remain equivalent | REQ-FUNC-80b2033a | collapse adjacent sequence wildcards | original300ms bound and zero/many/choice/confirmation cases |
| Instrumented seams absent from normal builds | REQ-TEST-2308561a | isolated output directories and compile-time probe import | real ordinary/test builds + runtime override refusal |
| A source root appearing during registration or after ready stays monitored | REQ-REL-2512a455 | target existence/type in generation key; await rebind before background scan | real Linux add/change/hash/search, late-root rewrite, pruning and close cases |
| Authored source tests collected once | REQ-TEST-fa9a50c1 | explicit workspace include/source guard | collection and source config regression |
| Reproducible isolated commands/fixtures | REQ-TEST-21b726d6 | bounded owned fixtures/build outputs, faithful current-state UI selectors | original failed unit/integration/E2E checks |
| Accessible current transcript/tool/reasoning rendering | REQ-UX-4bea0002 | preserve product UI contracts; correct stale fixture assumptions | failed workspace/mock/approval/browser matrices |
| Snapshot/subscription recovery keeps terminal text | REQ-REL-4bea0006 | diagnose missed terminal events before changing recovery | original recovery E2E and affected units |

OBSERVED no new externally visible behavior proposed; further affected existing requirements will be mapped as concrete diagnosis establishes ownership.

## Design

### Approach
Restore existing behavior by diagnosing original red receipts, isolating fixture state and output ownership, and rerunning only failed/affected checks. Keep production deadlines, risk/approval gates and assertion meaning. Explicit shared test discovery removes generated duplicate tests (REQ-TEST-fa9a50c1).

### Interfaces and data
No new persisted schema or public API. Current format1 contracts stay authoritative. Each test owns its temporary profile/catalog/build output and cleans it after owned processes finish (REQ-TEST-21b726d6). Renderer tests observe terminal/current UI state rather than incidental markup/timing (REQ-UX-4bea0002, REQ-REL-4bea0006).

### Files and test seams
Shared vitest configuration and tooling collection regression; original failing core/CLI/catalog/worker/renderer tests; E2E fixture setup and isolated dev build launcher; product sources only where reproduction demonstrates a contract defect. Rootcause inventory records each exact file as diagnosed.

### Risks and open decisions
Performance/resource contention and fixtures growing with the entire official catalog can mask assertion failures. Do not increase arbitrary deadlines or drop scenarios; partition independent matrix cases and use controlled fixtures while retaining separate real inventory coverage. Native Ubuntu availability remains unknown and WSL2 stays explicitly labeled.

### Requirement map
REQ-REL-2512a455: lstat target existence/type detects missing-root registration gaps, and queued scans await the refreshed generation before publication, without rebinds on ordinary timestamp changes. REQ-FUNC-80b2033a: adjacent wildcard canonicalization preserves classifications. REQ-TEST-2308561a: fresh source checkout and isolated output prove compile-time seams absent from release.
REQ-TEST-fa9a50c1: source-only collection. REQ-TEST-21b726d6: deterministic owned fixture/build isolation. REQ-UX-4bea0002: current accessible transcript oracle. REQ-REL-4bea0006: terminal recovery/replay oracle.

No structural product change or new process/state protocol is proposed, so no design diagrams apply; this restoration changes harness ownership and concrete defect sites only.


## Log

- 2026-11-05 frame: journal opened
- 2026-11-05 frame: User explicitly authorizes stabilization #75, subsessions and a local commit after successful validation; coordinator owns commit/closure; no remote publication. Original gate proof retained and only failed/affected checks rerun.
- 2026-11-05 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-05 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-05 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-05 build: red: test-discovery focused Vitest exit1 selects shared dist copies beside sources (REQ-TEST-fa9a50c1); original CAP04 program-rules perf failure retained and current catalog/workspace red rerun exit1.
- 2026-11-05 build: green: shared source collector/program-rules/catalog focused Vitest exit0,97tests. Adjacent wildcard canonicalization preserves risk/confirm/timeouts and original300ms bound; explicit source-only discovery excludes generated copies.
- 2026-11-05 build: red diagnosis: original ChatGPT fake-login E2E attempted real catalog network; instrumented probe now supplies only exact fictional endpoint/credential transport. Original HMR build wrote common output and was terminated during build; verification output is isolated. Resource contention corrected with serialized Vitest files rather than longer production deadlines.
- 2026-11-05 build: Windows original failed-files rerun:307pass/5skip/4fail across3files;12sourcefiles now green including unchanged1–3s worker deadlines. Remaining4failures are fixture workflows (PDFcompile+inference,4CLIprocesses,3ASARbuilds) combined under default5s; setup/partition corrections preserve all oracles and deadlines.
- 2026-11-05 build: Windows affected E2E:15/16pass, including real sandboxed HMR with unchanged native entrypoint hash, six PDF matrices, native artifacts delete and fictional ChatGPT login/catalog/restart. Only recovery readiness selector was hidden; changed to visible shell+app.info before IPC/reload. PDF diagnostic instrumentation removed; no product PDF change retained.
- 2026-11-05 build: green: Windows fixes-unit-03 exit0, fresh-source ordinary/instrumented builds and exact collector plus npm success/usage/owned-live-child drain; original60s/5s limits retained by splitting independent workflows. Windows e2e-recovery-02 exit0 all4cases incl missed-terminal recovery, Plan observer, settled reading and final PDF code without diagnostics.
- 2026-11-05 build: red: Linux failed-files exit1,391pass/3fail only ingest rewrite/hash/search. Diagnostic real Chokidar getWatched at ready/end lacks docs entirely and raw events contain only metadata WAL; initial reconciliation finds source but late writes have no listener. Scope now includes restoring missing-root watcher registration (REQ-REL-2512a455), preserving selected-prefix/symlink confinement.
- 2026-11-05 build: green: completed final watcher fix without diagnostics: Linux ingest/workbench69pass exit0, Windows68pass1skip exit0; generation refresh/readiness before background reconciliation covers missing roots during initialization and afterready (REQ-REL-2512a455). Windows affected native ingest/Docs/office/citations4pass exit0. Linux affected E2E currently running; final receipt pending.
- 2026-11-05 build: Inspection: pre-review strict exit0 errors0 warnings50:48 unrelated existing metadata warnings (20 stale-paths,13 journal-header,10 no-linked-tests,5 ticket-ref), plus2 secret-in-diff heuristics for explicitly fictional test bearer/model constants; no actual secret. No candidate uncovered-path warning. Existing manual product acceptance remains covered by unchanged prior proof; native Ubuntu unavailable and not claimed.
- 2026-11-05 build: red: Linux e2e-final exit1 21pass2fail. Both native artifact/ingest failures are exact execPath lexical equality against symlinked pinned Electron dependency; expected mirror path, actual canonical vendor path. Native candidate entrypoint/workspace sources are current mirror. Preserve identity with realpath on both sides; all other21cases passed incl WM maximize and isolated HMR.
- 2026-11-05 build: OBSERVED residual anomaly: Windows e2e-identity-final exit1 native ingest first indexed-event poll saw0 within unchanged5s; artifact passed. No backend state retained in that run, cause UNKNOWN, not baseline. Twelve completed fresh native launches afterward passed unchanged deadlines; phase sample5 showed pending1.32–1.39s/indexed2.10–2.21s, not proof of cause. Further undifferentiated sampling interrupted at coordinator request, no acceptance verdict. Final fixture captures minimal phases/DB/status/volume/IPC JSON only on future failure; intentional999 selfcheck exit1 proved capture, original1 restored and Windows final focused exit0. Both reviewers must explicitly accept residual warning or block stabilization.
- 2026-11-05 build: LIMITATION cleanup: automatic approval review rejected verified owned scratch deletion of C:\Users\pasar\AppData\Local\Temp\vera-ingest-native-oXPj7c with reason blocked by policy. No alternate deletion attempted. Original rejection is in tool transcript, no shell receipt was produced; recorded note in task proof. Remaining scratch is isolated fixture data, not user profile or running process.
- 2026-11-05 build: green: final failure-only diagnostic fixture retains originalassertion1/5s and no successful-path logging; focused Windows e2e-ingest-final-02 exit0 1pass, Linux e2e-ingest-final-02 exit0 1pass. Linux e2e-final retained21pass2lexical-path-fails, followed by identity-only rerun exit0 2pass. Changed software30files SHA256 match mirror exactly. All original remaining source failure files are covered by focused green proofs; generated shared/dist duplicate excluded, never counted as passed.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: Independent final reviews: SPEC APPROVED by spec_final and QUALITY APPROVED by quality_final, both read-only nonauthors, complete candidate/original logs/hashes inspected and verdicts sent directly to coordinator. Both explicitly accept WINDOWS-NATIVE-FIRST-INDEX as residual warning with cause UNKNOWN, not baseline/fixed; no5s product SLA. Coordinator independently inspected complete diff,38nonjournal hashes and22Windows/10Linux logs with zero mismatch, and accepted that warning for this local candidate. Preserve anomaly/nativeUbuntu/ARM64/cleanup rejection in closure comment.
- 2026-11-05 validate: final red: strict-final exit1 after approvals: lint4format errors in documents/session-recovery/CLI/ingest (CRLF), typecheck TS2379 in diagnostic status optionalundefined with exactOptionalPropertyTypes; i18n exit0. Correct only formatting and omit absent diagnostic status, then re-review round2. Original proof preserved; no product behavior/deadline changes.
- 2026-11-05 validate: returned to build - Final static proof found4format errors and diagnostic exactOptionalPropertyTypes mismatch; repair only affected files, rerun affected statics, independent review round2
- 2026-11-05 build: DEVIATION build: continue narrow static repair after automatic return marked needs_user - existing user/coordinator authorization explicitly covers completing stabilization and affected fixes; no new scope or permission decision. Changes are LF normalization and omission of absent diagnostic status only.
- 2026-11-05 build: green: affected format check4files exit0 and typecheck exit0 after exactOptionalPropertyTypes fix; docs/session-recovery/CLI changes proved EOL-only against reviewed hashes (LF→CRLF reconstructs oldSHA); diagnostic absent status is omitted rather than explicitundefined, same serialized JSON. Existing runtime/E2E proof remains valid; no repeated test sampling needed.
- 2026-11-05 build: CORRECTION to previous green note: EOL-only hash reconstruction is true for documents and session-recovery, not CLI (which also has formatter whitespace adjustments). CLI reviewed archive SHA matches prior manifest; normalized diff inspected separately. No semantic change. The preceding format/typecheck exit0 results are unchanged.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: DEVIATION validate: final proof will compose strict without --run, focused failed-lint4files exit0 and typecheck exit0, with original i18n exit0 reused - 02_Tools/verification-policy.md overrides routine repeated checks; coordinator explicitly accepted this composition. Original full lint checked640files and reported only4format-error files; all other source bytes are unchanged. Original strict-final --strict --run remains exit1, never relabeled passed. JSON output for omitted diagnostic status is unchanged from status:undefined.
- 2026-11-05 validate: Round2 SPEC/QUALITY APPROVED: independent reviewers verified EOL-only docs/recovery, callback whitespace CLI with identical UTF8 bytes, and omit-undefined diagnostic JSON equivalence. Initial quality Unicode finding explicitly withdrawn after correcting reviewer cp1252 reading; no candidate edit was needed. Both original corrected verdicts delivered directly to coordinator. Residual first-index warning remains accepted without claimed cause/fix.
- 2026-11-05 validate: final: authorized composed proof passed: strict-affected-final --strict exit0 (errors0/warnings50/notes20); failed formatter4files corrected and focused lint exit0; typecheck exit0; original strict-final i18n exit0 reused. Original --strict --run exit1 remains recorded. Fifty warnings are48 unrelated existing metadata plus2 explicitly fictional token heuristics. Both independent reviews approved round2. Runtime reds/expected-failure/interrupted receipts preserved; residual first-index cause UNKNOWN accepted as warning, never claimed fixed.
- 2026-11-05 validate: final build: npm run build with VERA_TEST/VERA_BUILD_ROOT absent exit0; pure-module normal-inspection exit0 confirms testBuild=false even with runtime VERA_TEST=1, probe markers absent and no application/user profile launched. Windows desktop/out restored to normal build. NativeUbuntu/ARM64/hardware not claimed; blocked cleanup target remains isolated fixture path as logged. Coordinator owns authorized local commit and issue closure; implementation handed back without staging/commit/push.
- 2026-11-05 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-f56ff51b.md
changed: Stabilization candidate validated and normal local build restored; no staging/commit/push
evidence: Composed strict0+focused lint4/typecheck0+reused i18n0; both independent reviews approved round2; final Windows/Linux native proof retained; normal-build/inspection exit0
issues: Accepted residual WINDOWS-NATIVE-FIRST-INDEX cause UNKNOWN; no nativeUbuntu/ARM64/hardware proof; cleanup of C:\Users\pasar\AppData\Local\Temp\vera-ingest-native-oXPj7c rejected by automatic approval review, isolated scratch remains
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-05)

- stage: validate; type: fix; path: full; branch: master
- requirements:
  - REQ-REL-2512a455 - Scoped document monitoring avoids unrelated directory watches
  - REQ-FUNC-80b2033a - Match rule patterns against the whole command line
  - REQ-TEST-2308561a - Compile-time test build flag
  - REQ-TEST-fa9a50c1 - Source-only deterministic workspace verification
  - REQ-TEST-21b726d6 - Reproducible desktop commands
  - REQ-UX-4bea0002 - Streamed transcript
  - REQ-REL-4bea0006 - Resume renderer session streams
- deviations: 2 recorded
  - build: continue narrow static repair after automatic return marked needs_user - existing user/coordinator authorization explicitly covers completing stabilization and affected fixes; no new scope or permission decision. Changes are LF normalization and omission of absent diagnostic status only.
  - validate: final proof will compose strict without --run, focused failed-lint4files exit0 and typecheck exit0, with original i18n exit0 reused - 02_Tools/verification-policy.md overrides routine repeated checks; coordinator explicitly accepted this composition. Original full lint checked640files and reported only4format-error files; all other source bytes are unchanged. Original strict-final --strict --run remains exit1, never relabeled passed. JSON output for omitted diagnostic status is unchanged from status:undefined.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base dbc6c0b: 39 file(s) changed, 1169 line(s) added
- checks: errors=0 warnings=50 notes=20
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-05)

- stage: done; type: fix; path: full; branch: master
- requirements:
  - REQ-REL-2512a455 - Scoped document monitoring avoids unrelated directory watches
  - REQ-FUNC-80b2033a - Match rule patterns against the whole command line
  - REQ-TEST-2308561a - Compile-time test build flag
  - REQ-TEST-fa9a50c1 - Source-only deterministic workspace verification
  - REQ-TEST-21b726d6 - Reproducible desktop commands
  - REQ-UX-4bea0002 - Streamed transcript
  - REQ-REL-4bea0006 - Resume renderer session streams
- deviations: 2 recorded
  - build: continue narrow static repair after automatic return marked needs_user - existing user/coordinator authorization explicitly covers completing stabilization and affected fixes; no new scope or permission decision. Changes are LF normalization and omission of absent diagnostic status only.
  - validate: final proof will compose strict without --run, focused failed-lint4files exit0 and typecheck exit0, with original i18n exit0 reused - 02_Tools/verification-policy.md overrides routine repeated checks; coordinator explicitly accepted this composition. Original full lint checked640files and reported only4format-error files; all other source bytes are unchanged. Original strict-final --strict --run remains exit1, never relabeled passed. JSON output for omitted diagnostic status is unchanged from status:undefined.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base dbc6c0b: 39 file(s) changed, 1189 line(s) added
- checks: errors=0 warnings=50 notes=20
- checklist: 9/9 done
