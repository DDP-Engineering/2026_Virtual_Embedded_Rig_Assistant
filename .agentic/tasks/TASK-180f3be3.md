# TASK-180f3be3 - VIEW-06 Image preview in the viewer (#291)

stage: done
type: feature
interaction: autopilot
requirements: REQ-REL-2b14e715, REQ-FUNC-71a6501a, REQ-SEC-21021e27, REQ-UX-2b81bcdc, REQ-REL-35fd9a5f, REQ-FUNC-bc3f25bd
parent:
branch: master
base: f272ad5179e6f52f36263b12cbbf3d444eb48407
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

Problem: STATED issue291: workbench images cannot be previewed inside VERA.
Desired outcome: STATED PNG/JPEG/GIF/WebP/BMP/SVG fitted image preview with zoom through400%, Hex retained.
Actors: STATED workbench user opening ordinary files.
Primary scenario: STATED open image from Files, inspect fitted image, zoom original decode, switch Hex and back.
Examples: STATED board PNG and script-bearing SVG; each of six formats previews without indexing.
Counterexamples: STATED SVG is never live markup; corrupt or Display-masked images may fail decoding safely with Hex accessible.
In scope: STATED VIEW06 only, applicability/preferences, bounded byte assembly into renderer Blob URL, cancellation and URL cleanup, four languages/help/release records and final VIEW plan reconciliation.
Out of scope: STATED migrations, new dependencies, packaging rebuild, full app/plugin/E2E suites,200MiB retest, unrelated PERF/user/workflow changes and optional deletion.
Constraints: STATED shared master/default master, base f272ad5179e6f52f36263b12cbbf3d444eb48407; complete owned uncommitted candidate review. User authorizes local ticket commit; coordinator exclusively stages/commits/closes291+285. Implementer does neither. Preserve opaque identities, provenance, existing modes and all CSP restrictions except the authorized image-only Blob source, Display refresh and byte-mask policy. Wait for completed anchor before implementation.
Success signals: STATED DoneA all six actual previews and inert scripted SVG; DoneB fit/resize/400%/zoom back, original decoded image scaling. Focused failure/lifetime checks, browser/native geometry/screenshots, two independent reviews and final statics/strict.
Evidence: OBSERVED tea issues291 and285 (ddp login/repo), file-viewer.md, file-mode.ts, shared/documents.ts, viewer-context.tsx and bounded HexSource. OBSERVED HEAD equals assigned base; only unrelated protected workflow payload and bundled-plugins preexist.
Assumptions: INFERRED reusable HexSource can enforce existing byte reply/metadata boundaries for image Blob parts; confirmed by source.
Unknowns: UNKNOWN browser decoder memory ceiling and calibrated session-open budget; native Ubuntu/final delivery/full gates deferred by user.
Decision-blocking questions: none.
Proposed behaviors: accepted explicit delegated autopilot scope; no extra product behavior.

## Requirement coverage

| Outcome | Atomic behavior | Requirement | Positive/boundary proof | Design |
|---|---|---|---|---|
| Preview workbench images from bounded bytes | Preview workbench images from bounded bytes | REQ-FUNC-71a6501a | Open all six formats without indexing; verify bounded original-offset reads, opaque identity, preferences and actual Hex bytes for each; reject mismatched byte replies. | Metadata descriptor, bounded Blob loader and image-only component |
| Keep SVG preview in an inert image context | Keep SVG preview in an inert image context | REQ-SEC-21021e27 | Load SVG with script, onload, links and external image/style references; assert actual decode, unchanged script sentinel/location, no nested live SVG or frame and no resource requests in browser and native Electron. | Metadata descriptor, bounded Blob loader and image-only component |
| Fit and zoom original decoded images | Fit and zoom original decoded images | REQ-UX-2b81bcdc | Assert natural dimensions, fitted geometry, resize,400 percent and zoom back using the same resource URL; capture browser/native screenshots and geometry. | Metadata descriptor, bounded Blob loader and image-only component |
| Keep failed image previews recoverable | Keep failed image previews recoverable | REQ-REL-35fd9a5f | Inject changed-file/invalid byte/decode failures and Retry; assert typed error, safe decode text and Hex access; exercise Display refresh with a stored secret. | Metadata descriptor, bounded Blob loader and image-only component |
| Resource lifetime | Dispose obsolete image resource ownership | REQ-REL-2b14e715 | Deferred reply cancellation, StrictMode, URL revocation and live Display refresh | Effect-owned AbortController and URL |

| Applicable modes | Index-independent image Rendered plus existing Text/Hex preferences | REQ-FUNC-bc3f25bd | Seven image suffixes, opaque identities and preserved predecessor mode/restart proof | Shared extension category and metadata-first loader |

## Design

### Approach
REQ-FUNC-71a6501a: shared viewerExtensionKind recognizes an image category (including .jpg/.jpeg). file-mode resolves images as Rendered without indexed capability and returns transient ImageFile metadata using the existing readHexFile metadata boundary. Existing text/hex and verified sources stay unchanged.
### Interfaces and data
ImageFile is HexFile plus MIME. It lives only in current tab state, is cleared with other transient content, and never enters shared IPC or persisted tabs. ImageViewer owns asynchronous bounded assembly and its Blob URL in a mount effect. A fresh HexSource reads64KiB parts, checks final size/mtime and yields between windows; cleanup aborts publication and revokes its URL. The provider's existing owner/key/attempt guards retain authority. No arbitrary image size cutoff; encoded Blob and browser decoded surfaces require memory proportional to image size (browser resource limits remain).
### Files and test seams
New image-source.ts/image-viewer.tsx/css and focused tests; file-mode/shared classification, viewer-context/DocumentPanel pass descriptor. Unit/component tests cover windows, mismatch, cancellation, StrictMode, URL cleanup, failure/Retry and mode applicability. New focused image-preview.spec.ts generates fixtures and provides browser/native DoneA/B with geometry/screenshots and script/network/load assertions. Four locales/help, release notes, inventories and plan/knowledge complete the scope.
### Risks and open decisions
REQ-SEC-21021e27: create only img with a MIME-typed Blob; never parse/insert SVG, no object/frame/data navigation or markup. Add only img-src self blob to matching production/meta policies (coordinator clarification RULING002 and explicit user approval); preserve every script/object/frame/connect restriction. Browser secure SVG image mode disables scripts and external references. REQ-REL-35fd9a5f: decode failure shows localized safe message and Retry; byte errors preserve typed errors; Hex remains in parent toolbar. Existing Display masking may corrupt image bytes: do not bypass or change host policy. URL is revoked on content/owner replacement and unmount, aborted requests cannot publish. No new dependencies or compatibility.
### Requirement map
REQ-FUNC-71a6501a and revised REQ-FUNC-bc3f25bd map to image classification and plain-file metadata loader. REQ-SEC-21021e27 maps to img-only Blob resource under restrictive CSP with the authorized image-only Blob source. REQ-UX-2b81bcdc maps to naturalWidth/Height sizing, intrinsic CSS fit and percent selector through400. REQ-REL-35fd9a5f maps to localized failure with Retry plus existing mode toolbar. REQ-REL-2b14e715 maps to effect-owned AbortController/URL disposal.
Diagrams: [diagram_TASK-180f3be3.md](diagram_TASK-180f3be3.md).


## Log

- 2026-11-17 frame: journal opened
- 2026-11-17 frame: completed; next specify - Explicit VIEW06 scope recorded (7 Done checklist item(s) left unticked)
- 2026-11-17 specify: completed; next design
- 2026-11-17 design: completed; next build
- 2026-11-17 build: red: focused file-mode image applicability7failed (mode-red.log); existing loader returns no image descriptor and resolves images Hex (REQ-FUNC-71a6501a).
- 2026-11-17 build: green: file-mode17pass exit0 (mode-green.log), images resolve Rendered independently of indexing and explicit extension Hex/Rendered preferences work without early bytes. red: image-viewer2failed waiting for img (viewer-red.log), expected missing ImageViewer integration; covers fit/zoom and decode recovery.
- 2026-11-17 build: green: initial image UI/model19pass exit0 (viewer-green.log): inert img-only resource, StrictMode effect ownership, fit/resize/400%/zoom-back, same URL and decode Retry. Additional bounded-source/lifetime regressions and full immediate consumers initially77pass1assertion mismatch: existing typed CONFLICT text is current-state conflict rather than literal changed; assertion corrected, no product weakening. Initial native/browser image acceptance is running.
- 2026-11-17 build: Scope clarification: initial browser/native acceptance exposed actual Chromium CSP Blob rejection; original e2e-initial/e2e-diagnostic and native-console evidence retained. Coordinator authorizes img-src self blob only (RULING002), and user explicitly answered Allow the image-only CSP rule. No other CSP relaxation or canvas rewrite. Desktop-shell knowledge routing read. red: content-policy1failed exit1 (csp-red.log), missing image-only directive; matching production/header and renderer meta policy added.
- 2026-11-17 build: red: e2e-final-build/e2e-images-current expose actual native1024px Fit mismatch after scrollbar changes (measured730 vs viewport746); browser six-format2pass previously, predecessor viewer-modes browser/native2pass retained. Correcting Fit to browser intrinsic max-width/max-height sizing, eliminating self-induced measurement/gutter feedback; percentage zoom still uses original natural dimensions. Unit assertions cover fit constraints, actual browser/native geometry remains the fit oracle. No source/menu/byte/CSP scope expansion.
- 2026-11-17 build: green: focused-final.log92pass across7named files, followed by affected intrinsic-fit-unit.log3pass after native Fit correction. e2e-intrinsic-fit.log2pass exit0 proves six real formats/Hex, scripted SVG with remote/loopback/same-origin loads absent, PNG/SVG original-resource400% and zoom back, native minimum-size Fit, masked opaque identity/byte refresh, corrupt Retry and4locales. Production meta/header match and injected inline script remains blocked. Existing viewer-modes browser/native2pass with full restart retained from e2e-final-build.log. Screenshots visually reviewed. No calibrated budget comparison, native Ubuntu/full/delivery gates deferred; no plugin-system files changed.
- 2026-11-17 build: Reconciled all six VIEW packages in plan, including prior commit hashes and current candidate/coordinator ownership; context/knowledge and five image requirements plus existing mode requirement now describe actual implementation. Failure recovery and resource lifetime are separately atomic requirements. Evolution28owned product/docs paths matches design; protected external workflow payload, bundled-plugins and unrelated PERF excluded. Advisory build AEGIS errors0/warnings62/notes38; historical oversized context/ticket/manual/outside-layout heuristics remain out of scope.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: Evidence retention clarification: each original command log remains in view06; shared screenshot/receipt/native-console paths hold the latest successful acceptance and were overwritten by subsequent runs. Initial observed native CSP diagnostic was Loading image blob:vera://app violates default-src self; the original failing command logs remain, but earlier console/screenshot paths are superseded rather than separate retained copies. No deletion attempted.
- 2026-11-17 validate: Round1 specification compliance approved exact40-path nonjournal candidate d0fc50bbcf1333137c049df26c7373bc0493358e0351cc306073344d4c2a1b37; full manifest, actual assertions, original focused/native/browser receipts and screenshots reviewed; no actionable findings. Quality review remains pending; no candidate edits after freeze.
- 2026-11-17 validate: Both independent round1 reviews approved exact40-path candidate d0fc50bbcf1333137c049df26c7373bc0493358e0351cc306073344d4c2a1b37 with no actionable findings. Original review receipts are spec-review-round1.md and quality-review-round1.md in view06. Candidate remains frozen; final candidate-only Biome and individual typecheck/i18n/help/release checks follow, then strict without --run per explicit delegation.
- 2026-11-17 validate: Final independent statics after both approvals: candidate-only Biome20files/typecheck/check:i18n/check:help/check:release-notes all exit0 on unchanged candidate d0fc50bbcf1333137c049df26c7373bc0493358e0351cc306073344d4c2a1b37. Original final-name.log/json receipts retain exact argv/timing/exit codes; no candidate edits. Final strict without --run follows explicit user/coordinator verification scope.
- 2026-11-17 validate: DEVIATION validate: configured check --strict --run is replaced by candidate-only Biome and individual approved static checks plus strict without --run - explicit delegated policy avoids known unrelated global lint errors and forbidden full suites. Native Ubuntu, calibrated session-open budget and final full/delivery gates remain explicitly deferred; unchanged native/byte/packaging evidence is reused. No plugin/system changes require a plugin suite in this ticket.
- 2026-11-17 validate: final: python .agentic/aegis.py check --task TASK-180f3be3 --strict --full exit0 (final-strict.log/json), errors0 warnings62 notes38. Independent five final statics all exit0 after both approvals. Advisory unscanned bundled-plugin ZIPs/external user inventory, historical oversized context/ticket/journal/manual notices remain excluded; mandatory help/release/CHANGELOG outside-layout notices are accepted. content-policy.test is verification code under source globs and locales are covered by the four-language native assertion; uncovered-source heuristics do not indicate absent proof. image-preview password literals are intentional synthetic safeStorage fixtures. No global lint or full suites ran.
- 2026-11-17 validate: Handover observation: external repository operations advanced HEAD from recorded base f272ad5179e6f52f36263b12cbbf3d444eb48407 to41724607522cefab8be0edd055f735953020eda4 and staged unrelated plan README/bypass-full-access with an AA conflict in plan/terminal.md. Implementer did not stage/commit/change those paths. Preserve external index/conflict and use frozen owned manifest only; verify candidate hashes unchanged. External workflow payload is now clean against new HEAD. No source/test/config candidate changes invalidate the reviewed proof.
- 2026-11-17 validate: Handover ready: all9validate checklist items now checked (report's0/9 was the snapshot before ticking). Reviews/stats/strict bind the unchanged40-path nonjournal candidate;41owned paths including journal remain unstaged by this implementer. Focused runners completed; browser servers awaited exit and Electron apps awaited close in finally. Owned ignored view06 logs/profiles/screenshots are retained without optional deletion. Coordinator exclusively owns local commit and291+285closure; unrelated external index/conflict preserved.
- 2026-11-17 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-17 | decision=Autopilot on shared master; user authorizes local ticket commit; coordinator exclusively owns staging, commit and issue closure after handover | reason=Explicit delegation and root implementation-cycle policy | source=user | supersedes=none
- RULING-002 | date=2026-11-17 | decision=Allow minimal image-only CSP img-src self blob; preserve all existing sources and every script/object/frame/connect restriction | reason=Coordinator clarified earlier retain-CSP instruction prevents broader weakening, not image transport; explicit delegated clarification supersedes optional pending input question | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-180f3be3.md
changed: Completed VIEW06 unstaged candidate: six image formats, inert SVG, original-image zoom400%, Hex, safe resource lifetime
evidence: 92 focused cases with affected3-case rerun; image browser/native2pass and modes2pass; both round1 reviews approved; final5statics exit0; strict errors0 exit0
issues: AEGIS62warnings38notes; native Ubuntu/calibrated budget/full-delivery gates deferred; external HEAD advanced and unrelated planning index/conflict preserved; scratch retained
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-REL-2b14e715 - Dispose obsolete image resources
  - REQ-FUNC-71a6501a - Preview workbench images from bounded bytes
  - REQ-SEC-21021e27 - Keep SVG preview in an inert image context
  - REQ-UX-2b81bcdc - Fit and zoom original decoded images
  - REQ-REL-35fd9a5f - Keep failed image previews recoverable
  - REQ-FUNC-bc3f25bd - Select applicable workbench file viewer modes
- deviations: 1 recorded
  - validate: configured check --strict --run is replaced by candidate-only Biome and individual approved static checks plus strict without --run - explicit delegated policy avoids known unrelated global lint errors and forbidden full suites. Native Ubuntu, calibrated session-open budget and final full/delivery gates remain explicitly deferred; unchanged native/byte/packaging evidence is reused. No plugin/system changes require a plugin suite in this ticket.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base f272ad5: 75 file(s) changed, 2652 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=62 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
