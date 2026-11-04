# TASK-dd7824ac - PLG-21 sigrok (#83)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-PLAT-193f7af3, REQ-SEC-f8d84877, REQ-FUNC-e47bbb9a, REQ-FUNC-20b10001
parent:
branch: master
base: e924f042c19f400fe58437289c00ac80a3b9baa6
opened: 2026-11-03

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

Problem: STATED: VERA needs an official plugin for capturing and decoding signals and using bench instruments through the DDP sigrok fork.
Desired outcome: STATED: the official sigrok package integrates the pinned fork and five skills, and sends commands through the existing approval and runner path.
Actors: STATED: embedded engineer and the agent in an enabled workbench.
Primary scenario: STATED: discover a device, capture a bounded srzip trace in captures/, decode UART or I2C offline, and read instrument settings.
Examples: STATED: atk-dl16 capture, Hantek DSO-3062L frame, Korad/SCPI supply read.
Counterexamples: STATED: a supply setting or ATK PWM configuration is irreversible and asks for typed confirmation in ask.
In scope: STATED: official catalog and general pack, fork provisioning and deliberate local CLI fallback, rules and five skills, focused verification and local release assembly.
Out of scope: STATED: no remote release/tag/upload, staging/committing the VERA candidate, privileged driver installation or ARM64 VERA build.
Constraints: STATED: shared master, base e924f042c19f400fe58437289c00ac80a3b9baa6, AEGIS autopilot. Local commit authorized for the coordinator alone. OBSERVED: manifest downloads require HTTPS in REQ-DATA-4d4471f9.
Success signals: STATED: every risk row, option variants and collisions, typed ask replay, real package/decoder execution on available hosts, and Windows/Linux bench acceptance separately reported.
Evidence: OBSERVED: clean base on master; five matching package hashes from SHA256SUMS, no releases from authenticated Gitea GET, and exact fork source object 66540df92da13c4d6861736e788b523709526262 fetched read-only.
Assumptions: INFERRED: verify the future HTTPS endpoint by contract and use local transport until publication; do not change the HTTPS constraint.
Unknowns: UNKNOWN: accessible native bench instruments and Linux native host, ARM64 runtime, a recorded UART/I2C trace, and future availability of authenticated or unauthenticated hosted assets.
Decision-blocking questions: None for the local candidate. STATED: the coordinator owns acceptance and publication is separate.
Proposed behaviors: STATED: see scope and Done criteria. OBSERVED: -c is applied before --get and capture, and colon groups can specify PWM keys.
Path and reason:

| Criterion | Holds | Evidence |
| --- | --- | --- |
| no new externally observable behavior | no | STATED: official sigrok tool and skills |
| no new interface or data format | no | INFERRED: normalize verified sigrok arguments and manage download selection |
| no new dependency | no | STATED: pinned sigrok packages |
| existing requirement already covers behavior | no | OBSERVED: generic plugin contract only |
| no security or data-handling change | no | STATED: physical output approvals |

## Requirement coverage

| Requirement | Accepted behavior | Design | Proof |
| --- | --- | --- | --- |
| REQ-PLAT-193f7af3 | STATED: official pinned fork and local fallback | Preferred managed install, fallback discovery and platform launch prefixes | tests/integration/sigrok.test.ts and renderer/packaging tests |
| REQ-FUNC-20b10001 | OBSERVED: existing combined find-first default | Keep find-first unless a manifest explicitly prefers its managed download | provisioning.test.ts |
| REQ-SEC-f8d84877 | STATED: strongest matching hardware risk and typed ask | Parse sigrok option roles before applying manifest rules and reuse approval gate | tests/integration/sigrok.test.ts |
| REQ-FUNC-e47bbb9a | STATED: five bench workflow skills | Installed catalog and skills | tests/integration/sigrok.test.ts |

## Design

### Approach

OBSERVED: exact GLib CLI accepts long equals and bundled short flags with separate values. Match a projection of actual options instead of mistaking arguments such as `--get=-i` for independent flags. Keep command display, execution and exact grant digest on raw argv.

### Interfaces and data

REQ-SEC-f8d84877: optional sigrok option syntax normalizes driver and grouped config keys before highest-risk matching. Unknown commands retain the normal fallback. Treat output-driver config in capture and get like set. Escalate config with no explicit driver. Preserve the existing ask gate.
REQ-PLAT-193f7af3: retain the find-first default for existing plugins and add an opt-in for sigrok to select an installed managed executable before discovery. Keep the explicit install action available while using a discovered CLI. Preserve HTTPS manifest transport. AppImage launch flags are download-only. Device skills explicitly check fork driver presence via -L.
REQ-FUNC-e47bbb9a: declarative plugin and five skills, captures under captures/ using srzip. User manages drivers and USB permissions.

### Files and test seams

The sigrok package, catalog and general pack, shared program schema/classifier, immediate core consumers and integration tests. Real assets run via injected local fetch, simulated approval uses the production gate.

### Risks and open decisions

Gitea has no releases and is private on HTTP. The proposed anonymous HTTPS asset/source endpoint requires separate publication and infrastructure. The Linux host is WSL and no ARM64 VERA build is planned. Hardware acceptance stays independent.

### Requirement map

Each requirement maps to its section above and the coverage table.

## Ticket acceptance

- [x] Every matcher row, accepted forms and highest-risk collisions, including reserved selectors and actual PWM group names.
- [x] Real pinned provisioning and recorded UART/I2C offline decoding on available Windows x64 and Ubuntu WSL x64. Recorded captures were obtained from the upstream Sigrok archive and both platforms produced matching annotations.
- [x] Typed confirmation in Ask before starting a simulated supply command.
- [x] Five local release assets and SHA256SUMS assembled with exact source, provenance and SHA-256 proof.
- [ ] Physical Windows and Linux smoke with identified ATK-DL16, Hantek DSO-3062L and supply.
- [ ] ARM64 execution after an appropriate host is available. Archive and executable inspection complete.
- [ ] Authorized Gitea release and verified trusted HTTPS asset/source delivery.

## Log

- 2026-11-03 frame: journal opened
- 2026-11-03 frame: Verified clean master at e924f042c19f400fe58437289c00ac80a3b9baa6. User authorization covers the coordinator's local ticket commit after validation. This implementer hands back the complete uncommitted candidate.
- 2026-11-03 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-03 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-03 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-03 build: red: pinned vitest tests/integration/sigrok.test.ts exit 1, missing official package (REQ-PLAT-193f7af3, REQ-SEC-f8d84877, REQ-FUNC-e47bbb9a). Original evidence/red.txt.
- 2026-11-03 build: Release prep: exact source fetched and authenticated Gitea release list empty. Five local assets match 07_Delivery SHA256SUMS and master LFS pointers. Exact fork reports CLI 0.8.0, 189 Windows/191 Linux listed driver rows and 137 decoder rows; plan driver counts differ. Temp/vera-PLG-21-dd7824ac holds original raw output, local assets and release-proposal.md.
- 2026-11-03 build: AppImage x86_64 mount 0.071 s, env extract-run 0.681 s, extraction flag 0.115 s with FUSE available, one-time extract 0.662 s then AppRun 0.013 s. Isolated unavailable FUSE mount exit 127, extraction flag exit 0 in 1.876 s. ARM64 runtime and CLI ELF members inspected only.
- 2026-11-03 build: green: Windows pinned vitest --maxWorkers=1 focused seven files, 161 passed/one platform skip. Original windows-focused-final.txt and Windows ask/provision JSON. Test trace is generated; offline decoding uses actual pinned binary and srzip.
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: returned to build - Both reviewers found reserved driver/group overrides, PWM0 risk and managed fork shadowing. Quality also found truncated -L output guidance.
- 2026-11-03 build: Review round 1: spec and quality changes_required. Red focused review-round1-red.txt recorded 3 failures for reserved override classification, preferred provisioning status, and renderer install action. Corrections cover ATK PWM0/1, ambiguous reserved selectors, truncated -L and opt-in preferred managed download preserving default find-first.
- 2026-11-03 build: Recorded offline proof: exact Windows zip CLI and WSL x86_64 AppImage decoded upstream physical UART/I2C dumps from 0ad13477abc959d37fc9a5acbd23901c371c9c76 without hardware. Outputs agree on 392 UART and 84 I2C lines (including DS1307 address 0x68). Evidence recorded/ contains original traces, source metadata, SHA-256 and outputs.
- 2026-11-03 build: Round 2 driver review found rdtech-rd shares the pinned fork supply setter. rdtech-alias-red.txt shows exit 1 before adding its narrow rule. The meter rdtech-um remains device-write. The WSL fixture now preserves system PATH for AppRun's bash and dirname.
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: green: Windows original focused 207 passed and 2 platform skips; final affected sigrok/packaging 6 passed; import boundaries 17 passed. WSL Ubuntu original focused 197 passed/11 platform skips/1 harness PATH failure, corrected final affected 6 passed including real AppImage provision/decode and simulated Ask, and final Ubuntu typecheck exit 0. Original evidence in windows-round2-focused.txt, windows-final-affected.txt, windows-import-boundaries.txt, ubuntu-focused.txt, ubuntu-final-affected.txt, ubuntu-final-typecheck.txt.
- 2026-11-03 validate: final: python .agentic/aegis.py check --task TASK-dd7824ac --strict --run exit 0; lint, typecheck and i18n passed. Original windows-strict.txt. Advisory uncovered-source warnings for README (inspected) and renderer test (linked regression) do not indicate missing product checks. Remaining advisory findings predate this task.
- 2026-11-03 validate: DEVIATION validate: physical Windows/Linux bench smoke remains open - no identified ATK-DL16, Hantek DSO-3062L or supply was available. Verify real scans, bounded ATK acquisition with UART/I2C, Hantek frame and supply read on both systems. Ask proof uses a simulated output process.
- 2026-11-03 validate: DEVIATION validate: ARM64 packages inspected without execution - no ARM64 execution host or VERA build was available.
- 2026-11-03 validate: DEVIATION validate: live provisioning remains open - release assets are staged locally and the proposed endpoint needs separate publication authority and trusted HTTPS.
- 2026-11-03 validate: Handover: master still e924f042c19f400fe58437289c00ac80a3b9baa6; empty index; 29 exact candidate paths listed in evidence/candidate-files.txt. Both independent reviewers approved amended round 2, original text in evidence/reviewer-verdicts-round2.md. No VERA stage, commit, push or Gitea write. Command policy rejected recursive cleanup of verified task scratch; owned test mirrors/extractions remain separate from the candidate.
- 2026-11-03 validate: Coordinator reviewed complete 29-file candidate and original round 2 independent approvals, final strict and focused Windows and Ubuntu WSL proof, recorded UART/I2C decodes and simulated Ask. Verified the five local release hashes against SHA256SUMS and LFS receipts and inspected the exact source/tag and proposed trusted HTTPS contract. Physical bench, ARM64 execution and live authenticated-independent release delivery remain unverified. Awaiting explicit user disposition before local integration.
- 2026-11-04 validate: Coordinator confirmed master/base e924f042c19f400fe58437289c00ac80a3b9baa6, empty index, exact 29-file candidate and every SHA-256 against the reviewed receipt. Original passing proof is reused under verification-policy.md; no handover retest. User explicitly authorized this local PLG-21 commit and continuation with PLG-22 issue 84; remote publication remains forbidden. RULING-001 preserves physical bench, ARM64 execution and hosted trusted HTTPS asset/source delivery as outstanding.
- 2026-11-04 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-04 | decision=Defer sigrok hardware acceptance, ARM64 execution and hosted release as outstanding; accept the reviewed PLG-21 implementation for local commit and continue with Git issue 84 without remote publication. | reason=Explicit human instruction on 2026-11-04. Existing focused/static/strict proof and both independent reviews cover the unchanged software candidate; the deferred criteria are not passed and require separate follow-up. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: Coordinator commits only PLG-21 locally, then starts Git issue 84; no remote publication
must_read: .agentic/tasks/TASK-dd7824ac.md
changed: Reviewed 29-file sigrok implementation accepted for local integration under user RULING-001
evidence: Original check --task TASK-dd7824ac --strict --run exit 0 and focused Windows/Ubuntu WSL proof, matching recorded UART/I2C output, import boundaries and both amended round 2 approvals; unchanged candidate hashes verified by coordinator
issues: Outstanding per user RULING-001: physical Windows/Linux bench acceptance, ARM64 execution and hosted release with trusted HTTPS asset/source delivery; simulated Ask is not physical bench proof
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-PLAT-193f7af3 - Offer the official pinned sigrok tool and its local fallback
  - REQ-SEC-f8d84877 - Classify sigrok hardware actions from parsed option roles
  - REQ-FUNC-e47bbb9a - Expose five sigrok bench workflow skills
  - REQ-FUNC-20b10001 - Prefer discovered tools before downloads
- deviations: 3 recorded
  - validate: physical Windows/Linux bench smoke remains open - no identified ATK-DL16, Hantek DSO-3062L or supply was available. Verify real scans, bounded ATK acquisition with UART/I2C, Hantek frame and supply read on both systems. Ask proof uses a simulated output process.
  - validate: ARM64 packages inspected without execution - no ARM64 execution host or VERA build was available.
  - validate: live provisioning remains open - release assets are staged locally and the proposed endpoint needs separate publication authority and trusted HTTPS.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base e924f04: 29 file(s) changed, 1033 line(s) added
- checks: errors=0 warnings=48 notes=9
- checklist: 9/9 done
