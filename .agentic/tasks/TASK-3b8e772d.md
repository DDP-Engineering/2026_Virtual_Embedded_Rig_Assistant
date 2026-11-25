# TASK-3b8e772d - Gitea #331 - Import firmware and UART hexdumps as PCAPNG

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-7836f1cc, REQ-FUNC-b6277db6, REQ-DATA-80c2e7e1, REQ-REL-25df8c0c, REQ-REL-52df4686, REQ-REL-84e4d071, REQ-REL-4973eae0, REQ-SEC-5cccb37c
parent:
branch: master
base: ef7a76b2cb21498493b69fd98988ff2c2e281dec
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

Problem: STATED #331 requests offline capture import for firmware and UART hexdumps.
Desired outcome: STATED A verified managed PCAPNG with source hash and explicit provenance.
Actors: INFERRED Embedded engineers and the Wireshark plugin tool acting in their workbench.
Primary scenario: STATED Select a saved hexdump and a profile, import locally, then inspect the verified result.
Examples: STATED Independent firmware raw frames and UART payloads with distinct packet boundaries.
Counterexamples: STATED Malformed, incompatible, oversized or cancelled input must leave no complete result.
In scope: STATED #331, the concise work package, native Windows focused proof, and independent reviews.
Out of scope: STATED Active protocols, other tickets, branch and worktree changes, staging and publication.
Constraints: OBSERVED master and origin default master at the recorded candidate base; STATED preserve unrelated paths.
Success signals: STATED TShark reads expected bytes, counts and timestamps; source hashes stay unchanged.
Evidence: OBSERVED Gitea API issue #331, commits ef7a76b2 and 5dcc4462, and the local recorded base.
Assumptions: INFERRED A narrow fixed profile can satisfy the requested subset using typed offline tools.
Unknowns: UNKNOWN The profiles' numeric bounds until specified from existing capture limits and native behavior.
Decision-blocking questions: None.
Proposed behaviors: INFERRED Fixed offset grammar with trace or deterministic synthetic time; controlled raw and synthetic encapsulations.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Discover the hexdump converter | REQ-FUNC-7836f1cc | Find-only dependency and independent readiness. |
| Convert profiled hexdumps offline | REQ-FUNC-b6277db6 | Canonical offset text and independent packet audit. |
| Bind hexdump provenance to a managed capture | REQ-DATA-80c2e7e1 | Content-addressed manifest in the group publication. |
| Reject malformed hexdumps | REQ-REL-25df8c0c | ASCII grammar and line-indexed errors. |
| Reject incompatible hexdump profiles | REQ-REL-52df4686 | Timestamp and frame shape constraints. |
| Enforce hexdump budgets | REQ-REL-84e4d071 | Bounds before read, during parsing and on native stdout. |
| Reject incomplete hexdump conversion | REQ-REL-4973eae0 | Existing deadline, scratch cleanup and verified publication. |
| Confine hexdump import to the source workbench | REQ-SEC-5cccb37c | Reuse guarded file snapshot and workbench write admission. |

## Design

**Approach.** INFERRED from the fixed profile and the existing capture-tool contract: extend `wireshark_derive` with `import_hexdump`. Parse a bounded snapshot before invoking text2pcap with fixed arguments and canonical text; the source never goes to the utility. Audit the returned PCAPNG against parsed packets before publishing either file.

**Interfaces and data.** STATED in the hexdump spec: the profile names parser, timestamps and encapsulation. Use nanosecond comparison and fixed synthetic timestamps. Stage a content-addressed format-1 manifest and reuse `publishCaptures` for the binary and new companion. Return the manifest and both identities; keep source paths and source content out of the manifest. Verify the reply budget before publication.

**Files and test seams.** OBSERVED `service.ts`, `wireshark-files.ts`, `capture-files-native.ts` and `storage.ts` own tool dispatch, typed input, external process resolution and managed publication. Add `hexdump-parser.ts` and `capture-hexdump.ts`, and allow `indexCapture` to visit packet bytes during the existing PCAPNG audit. Extend the focused official plugin test with independent fixtures and injected native output faults.

**Risks and open decisions.** OBSERVED Windows text2pcap 4.6.10 preserves nine fractional digits with ISO UTC and pads synthetic Ethernet to 60 bytes. Validate lengths, payload, IPv4/UDP envelope and padding. The existing signal, admission, exclusive publication and rollback cover partial operations. Native Ubuntu is deferred by the recorded user ruling.

**Requirement map.** The Design column above maps every requirement to its implementation. The plugin suite exercises the normal tool entry point and uses TShark as a separate native readback.

Diagrams: [diagram_TASK-3b8e772d.md](diagram_TASK-3b8e772d.md)

## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify - Autopilot scope recorded (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: completed; next build
- 2026-11-25 build: red: focused Windows native Wireshark hexdump Vitest exit 1, three expected failures: absent converter readiness and missing typed import. Original windows-red.log.
- 2026-11-25 build: green: Python npmw.py npx vitest run --project plugins tests/plugins/wireshark-tshark.test.ts -t hexdump|capture-file operations|official find-only tshark package, exit 0 (6 passed on Windows with text2pcap and TShark 4.6.10). Evidence: windows-focused-final.log and win32-hexdump-{readback,refusals}.json.
- 2026-11-25 build: green: Python npmw.py npx vitest run src/libraries/core/src/wireshark/storage.test.ts tests/tooling/boundaries.test.ts, exit 0 (21 passed). Typecheck and check:release-notes exit 0; original logs retained.
- 2026-11-25 build: DEVIATION validate: Native Ubuntu acceptance and complete suites deferred to user-owned final verification by RULING-001.
- 2026-11-25 build: Evolution checked from the pre-build anchor (test-first files already present). Advisory check has zero errors and no findings against task-owned files; historical warnings and notes are retained in aegis-build.log. Initial frame and specify checklist markers were not ticked before transition; the frame, requirements and evidence are present and were audited.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Independent round 1: spec approved, quality changes required. Both verified 40 bound paths at candidate SHA-256 1764713b05db853efffebbe014872717cccad4435c46eb975e049157f10fc197. Quality reproduced native TShark refusing a malformed Name Resolution or Interface Statistics block that the general index skipped. Original verdicts are in test-outputs/331.
- 2026-11-25 validate: returned to build - Round 1 quality finding: reject unexpected PCAPNG blocks at hexdump publication.
- 2026-11-25 build: red: focused Windows Vitest hexdump refusals exit 1 after appending a malformed Name Resolution block to valid native output. The tool returned a complete result before the fix (REQ-REL-4973eae0). See windows-review-red.log.
- 2026-11-25 build: green: Windows focused Wireshark selector, round 2 exit 0 (6 passed), including malformed auxiliary-block rejection and exact native readback (REQ-REL-4973eae0). Existing storage/import-boundary and release-note proof reused. See test-outputs/331/round2.
- 2026-11-25 build: Advisory inventory correction: zero errors. Covered fixtures and storage tests are also classified as sources by layout, and CHANGELOG is outside its advisory docs globs. Project context was already 25 KB at base. Other findings are historical requirements/context and preserved untracked bundled plugins. No policy configuration changes.
- 2026-11-25 build: completed; next validate
- 2026-11-25 validate: Independent round 2: specification and implementation quality approved. Both original verdicts and all 40 reviewed paths verified at f4891d127219c7afb83a376a60bdaacecd257e3677596bbb8fe91903a2ecc502. Only journal bookkeeping may follow.
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-3b8e772d --strict --run --full exit 0. Lint, typecheck, i18n and help passed. AEGIS: 0 errors, 55 advisory warnings, 44 notes. Layout warnings flag CHANGELOG and release notes as outside the configured globs and classify the linked storage test and three fixture files as uncovered sources. The project context size was already above threshold at base. The other warnings cover historical records and the preserved preexisting bundled-plugins folder. See aegis-strict-windows.log.
- 2026-11-25 validate: Handover: 40 owned paths in test-outputs/331/owned-files.txt. The recorded full repository base is ef7a76b2cb21498493b69fd98988ff2c2e281dec. Original Windows 4.6.10 proof, grouped storage/import boundaries and both independent review rounds are retained. Coordinator owns the separately authorized local commit and Gitea close; candidate remains unstaged and uncommitted.
- 2026-11-25 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-25 | decision=The user owns native Ubuntu acceptance and complete suites at separately started final verification. | reason=Ticket #331 retains focused native Windows conversion/readback, relevant static checks, strict AEGIS and independent reviews. Any WSL2 evidence is distinct. | source=user | supersedes=none
- RULING-002 | date=2026-11-25 | decision=Use the recorded master base and return an unstaged uncommitted candidate. The coordinator alone is authorized to commit locally and close #331. | reason=User-authorized ticket cycle and delegated scope. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-3b8e772d.md
changed: Verified firmware and UART ASCII hexdump import and managed provenance
evidence: 27 focused Windows tests passed; AEGIS strict passed; both independent reviews approved
issues: Native Ubuntu and complete suites deferred to separate final verification by RULING-001
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-25)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-7836f1cc - Discover the hexdump converter
  - REQ-FUNC-b6277db6 - Convert profiled hexdumps offline
  - REQ-DATA-80c2e7e1 - Bind hexdump provenance to a managed capture
  - REQ-REL-25df8c0c - Reject malformed hexdumps
  - REQ-REL-52df4686 - Reject incompatible hexdump profiles
  - REQ-REL-84e4d071 - Enforce hexdump budgets
  - REQ-REL-4973eae0 - Reject incomplete hexdump conversion
  - REQ-SEC-5cccb37c - Confine hexdump import to the source workbench
- deviations: 1 recorded
  - validate: Native Ubuntu acceptance and complete suites deferred to user-owned final verification by RULING-001.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base ef7a76b: 51 file(s) changed, 1496 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=55 notes=44
- checklist: 9/9 done
