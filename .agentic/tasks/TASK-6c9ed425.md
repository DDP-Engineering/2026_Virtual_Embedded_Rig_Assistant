# TASK-6c9ed425 - #403 Wireshark media profiles and Desktop coverage

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-78062da1, REQ-FUNC-3bd95cb0, REQ-SEC-4c92a247, REQ-FUNC-143f7173, REQ-REL-57b13fde, REQ-SEC-9f2b4752
parent:
branch: master
base: 3f4bdde2e42d22b2f477578cef8951b9589ed30e
opened: 2026-11-25

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

Problem: STATED #403 asks for offline media protocol coverage and a guide-linked map of Desktop handoffs and hardware gaps.
Desired outcome: STATED bounded Wi-Fi, BLE, USB and VoIP/RTP evidence with exact local capture frame refs, platform limits and a repeat-query backend decision.
Actors: STATED VERA analyst, Wireshark Desktop operator and final verification owner.
Primary scenario: STATED profile a synthetic saved trace, cite its source frames and follow the relevant local Wireshark Desktop procedure.
Examples: INFERRED capture-observed RTP packet/stream statistics and Wi-Fi link-layer metadata derived from native TShark fields.
Counterexamples: STATED a local verified frame open supplies no evidence that playback, decryption or hardware capture worked.
In scope: STATED #403 work package, Windows terminal proof, native synthetic fixtures, benchmark, guide coverage, focused checks and two reviews.
Out of scope: STATED live capture or adapter access, native Ubuntu, complete suites, window/UI automation, automatic key handling, speculative backends.
Constraints: OBSERVED master is the default and working branch, with exact pre-edit base 3f4bdde2e42d22b2f477578cef8951b9589ed30e. STATED protect bundled-plugins, evaluator trends HTML and journal #391. Coordinator owns the authorized local commit and Gitea close.
Success signals: STATED each shipped profile demonstrates bounded coverage and verified frame evidence, and remaining Desktop and live proof is enumerated accurately.
Evidence: OBSERVED Gitea #403, committed #404 integrated journal, #334 Desktop journal and original Windows receipts, existing typed capture kit, native Windows TShark 4.6.10.
Assumptions: INFERRED compact metadata with path and filter redaction fits the existing private capture locator seam.
Unknowns: UNKNOWN hardware support, native Ubuntu compatibility of the new profiles, playback, Desktop manual steps and benchmark result.
Decision-blocking questions: None.
Proposed behaviors: None beyond the accepted work package.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| Native metadata and coverage | REQ-FUNC-78062da1 | Typed media request, field contract and native projection |
| Observed directional RTP statistics | REQ-FUNC-3bd95cb0 | Directional grouping and scoped statistics |
| Local-only sensitive media data | REQ-SEC-4c92a247 | Allowlisted result and private locator |
| Verifiable source-frame references | REQ-FUNC-143f7173 | Typed media evidence through existing citations and Desktop preparation |
| Unavailable dissector diagnostics | REQ-REL-57b13fde | Native field and Decode As validation |
| Embedded secrets rejected | REQ-SEC-9f2b4752 | shared PCAPNG guard before native reads |

## Design

**Approach.** OBSERVED the typed saved-capture service already owns trusted plugin
verification, isolated native execution, source snapshots and bounded results.
Add a strict media operation to that service with a native field table per family
(REQ-FUNC-78062da1). Add media packet and directional RTP projections and reuse the
traffic facts reader. Extend the native error classification (REQ-REL-57b13fde).
Extend the existing citation and model masking code to use a private source
locator (REQ-FUNC-143f7173, REQ-SEC-4c92a247).

**Interfaces and data.** OBSERVED existing bounds apply. Media has an optional
display filter and a result limit, with total matched frames in the scanned range
and explicit omitted rows. VoIP supports an optional, explicit UDP RTP Decode As
port, and native SIP/SDP dissection otherwise. Use packet structure, section,
interface, VLAN, endpoint and SSRC locally to aggregate unambiguous directions.
Return observed packet counts, available sequence gaps and arrival timing with
a restricted static clock model (REQ-FUNC-3bd95cb0). Filtered or prefix data
supports counts only. Suppress gaps and jitter where prerequisites fail.

**Files and test seams.** OBSERVED the official TShark plugin replay harness
supports outbound model result inspection and citation reopening. Independent
wire captures and raw native output establish packet oracles. A core test injects
a native missing-field diagnostic. Document the measured and pending workflows.

**Risks and open decisions.** STATED Windows live, native Ubuntu, hardware and
Desktop manual actions are deferred. Keep private locators, payload and keys
local and apply the existing PCAPNG secrets guard before dissection (REQ-SEC-9f2b4752).
A benchmark informs the local sharkd decision. No capture backend is added.

**Requirement map.** Profile/counts: media projection. RTP: scoped grouping and
numeric stats. Sensitive data and citations: field allowlist, guard and private
locator. Unavailable dissectors: native argument validation.

Diagrams: [diagram_TASK-6c9ed425.md](diagram_TASK-6c9ed425.md)


## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: Pre-edit master/base, initial status and #391 hash preserved in test-outputs/403. Reuse #334 Windows Desktop evidence and #404 integrated proof.
- 2026-11-25 frame: completed; next specify
- 2026-11-25 specify: completed; next design
- 2026-11-25 design: completed; next build
- 2026-11-25 build: Red: native Windows focused media replay and injected missing media fields exited 1 with missing profile capabilities and invalid_filter instead of media_unavailable. Original red.log retained.
- 2026-11-25 build: Green: npmw npx vitest run --project core --project plugins with named media replay, native field diagnostics, Desktop exact frame and networking regression exited 0 (5 selected). The separate focused core run exited 0 (17 tests). Native TShark and Capinfos 4.6.10 terminal field and RTP-tap commands exited 0 on required synthetic fixtures. Receipts focused-native.log, focused-core.log, windows-native*.log and win32-media-replay.json.
- 2026-11-25 build: Benchmark and inspection: Windows 4.6.10 standalone TShark 18.12 s vs console sharkd 11.05 s median for 12 lookups on 40,000 synthetic packets, about 39% faster in this sample. Retain TShark pending representative budgets and equivalent permission/lifecycle controls. Matrix inspected against official guide, manifests, #334 and #332 original scope; manual actions remain pending.
- 2026-11-25 build: Build advisory: zero errors. Baseline context pages were already over page_kb. The layout advisory also classifies mandated release files and pre-existing bundled files outside its globs, and two linked core test files as uncovered source. Exact owned paths will include the original fixtures created before the build anchor.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: DEVIATION validate: Windows live, native Ubuntu and complete suites move to final verification - user ruling RULING-001. Specialized views, playback, profile editing, decryption and controlled hardware remain unevidenced. Reuse #334 for native Desktop frame opening.
- 2026-11-25 validate: Focused registry/manifest tests (2), import boundaries (17) and release notes (zero errors) exited 0. Media evidence includes byte-for-byte private snapshots and precise frame/Decode As/filter arguments. No viewer or adapter was opened.
- 2026-11-25 validate: Review round 1: both independent reviewers rejected 48-file manifest SHA-256 40132ceba94f869cbb30aa5aeb9347d1e9b9a171d00b1a3f52138de380eef08d. Count all selected truncated frames before protocol matching. Quality also found that signaled RTP can rebind PT 0/8; withhold unsupported signaled jitter and label the unsignaled RTP/AVP clock assumption.
- 2026-11-25 validate: returned to build - Handle snaplen truncation before profile matching and identify the RTP clock assumption without claiming a negotiated clock.
- 2026-11-25 build: Review red: focused Windows native media replay exited 1 with four expected assertions: clipped UDP frame omitted from truncation and full-scope stats, 16 kHz SDP rebind mislabeled in both implicit and forced modes, and absent clock-assumption label. windows-native-review.log confirms independent native frame and SDP oracle.
- 2026-11-25 build: Review green: Windows native selected media/RTP replay exit 0 (4 selected); dedicated RTP unit file exit 0 (4 tests); tsc workspace build exit 0. Clipped wire frame 3 counts even without an RTP layer. Signaled PT 0 rebound to 16 kHz leaves jitter unavailable in both signaling and forced Decode As modes. Eligible unsignaled RTP reports jitter with an explicit RTP/AVP default-clock assumption. See focused-review.log, focused-rtp-final.log, windows-native-review.log and win32-media-replay.json.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Both independent round 2 reviews approved all 49 candidate paths against the recorded base and exact manifest SHA-256 88ec0371e1a748ac469829ae6258101644f6d6f5754d8a215be1f61aa9dac770. No actionable findings. Local review receipts name both corrected regressions and the original Windows oracle.
- 2026-11-25 validate: Strict attempt 1 exited 1 on a Biome formatting diagnostic in the media fixture test. Typecheck, i18n and help passed. Original failure in aegis-strict-attempt1.log and exact diagnostic in biome-workspace-error.log.
- 2026-11-25 validate: returned to build - Apply the final workspace Biome formatting to the media test assertion and rebind reviews to the formatted candidate.
- 2026-11-25 build: Formatted only the existing native replay assertion chain. Focused Biome check and Windows native media replay both exited 0. The complete assertion text is unchanged after whitespace normalization. See final-format.patch, final-format-identity.txt and focused-final.log.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Both independent round 3 reviews approved the complete 49-path candidate against manifest SHA-256 14785f1043f4ec25d90ef6d31a46b327831bb20900890793667833e8ea22624a. The single formatted assertion and journal were the entire delta since round 2. The final focused native replay passed.
- 2026-11-25 validate: Final: python .agentic/aegis.py check --task TASK-6c9ed425 --strict --run --full exit 0. Lint, typecheck, i18n and help passed. Zero errors, 55 unpromoted advisories and 44 notes. Remaining advisories concern existing journals and page sizes, layout classifications for approved release notes and linked core tests, preserved pre-existing paths and the text scan cap. The full suite command was skipped by configuration and remains deferred by RULING-001.
- 2026-11-25 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-25 | decision=Move native Ubuntu, Windows live and complete suites to separately initiated final verification; use native Windows terminal offline proof for this candidate. | reason=User directed the scope of this implementation and prohibited adapter access, real traffic and UI automation. | source=user | supersedes=none
- RULING-002 | date=2026-11-25 | decision=The coordinator owns the authorized local commit and Gitea issue closure. The implementer hands back the complete unstaged candidate on master. | reason=User authorized the master implementation cycle and assigned commit and issue closure to the coordinator. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-6c9ed425.md
changed: Offline Wi-Fi, BLE, USB and VoIP/RTP coverage and Wireshark Desktop procedures.
evidence: Windows native offline replay, focused checks and strict AEGIS exit 0. Both independent reviews approved.
issues: Final gate owns native Ubuntu, Windows live, complete suites, hardware and hands-on Desktop procedures.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-25)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-78062da1 - Profile saved Wi-Fi BLE USB and VoIP captures
  - REQ-FUNC-3bd95cb0 - Report scoped RTP stream statistics
  - REQ-SEC-4c92a247 - Keep offline media payload and decryption secrets local
  - REQ-FUNC-143f7173 - Issue exact source-frame evidence for offline media
  - REQ-REL-57b13fde - Report unavailable media fields as a typed diagnostic
  - REQ-SEC-9f2b4752 - Reject embedded decryption secrets before media analysis
- deviations: 1 recorded
  - validate: Windows live, native Ubuntu and complete suites move to final verification - user ruling RULING-001. Specialized views, playback, profile editing, decryption and controlled hardware remain unevidenced. Reuse #334 for native Desktop frame opening.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 3f4bdde: 60 file(s) changed, 1948 line(s) added; 18 file(s) not content-scanned
- checks: errors=0 warnings=55 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
