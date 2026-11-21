# TASK-fc2d54a9 - BRW-02 Enforce public destinations and scoped browser permissions

stage: done
type: feature
interaction: autopilot
requirements: REQ-SEC-28b95ad2, REQ-SEC-84b7927e, REQ-SEC-a0dafabc, REQ-SEC-1ae1db7c, REQ-SEC-f03f9d4e, REQ-SEC-b90a7966, REQ-NFR-e4b04da4
parent:
branch: ddp/epic-338
base: f4eceb35049e0fd4714c368c15ef867b363bf198
opened: 2026-11-20

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

Problem: STATED — #344 requires a public network boundary and scoped permission for the #343 runtime.
Desired outcome: STATED — The Desktop host admits browser activity when the app and active workbench opt in and the user grants the exact public origin to that VERA session.
Actors: STATED — Desktop user, Desktop main, sandboxed Chromium and public destinations.
Primary scenario: STATED — The user enables the capability in both scopes, authorizes an origin, and later revokes access while the browser is active.
Examples: STATED — An authorized public page can load resources on authorized origins, including through redirects, frames, popups and background requests.
Counterexamples: STATED — The host refuses unauthorized destinations, local files, special-use addresses, site permissions, file pickers and browser-owned downloads.
In scope: STATED — #344 stored gates, session grants, immediate revocation, connection policy, bounded browser surfaces and controlled fixtures.
Out of scope: STATED — #345 agent tools, #346 browser UI, provisioning UI and final epic acceptance. Existing Electron and managed downloads retain their policies.
Constraints: STATED — Use ddp/epic-338 at the recorded base. The coordinator owns the one authorized local commit. Exercise Windows and WSL2 with sandboxed Chromium, focused tests and two independent reviews.
Success signals: STATED — The four Done criteria in Gitea #344.
Evidence: OBSERVED — tea issues --comments 342, 344, 345 and 346, TASK-16426506, browser-runtime knowledge, git status and rev-parse establish scope, runtime seam and the clean assigned base.
Assumptions: INFERRED — Trusted Desktop main can supply the grant interface for #346 while no agent-facing method can grant origins.
Unknowns: UNKNOWN — Runtime coverage for Chromium background paths and browser control restrictions until verified on the pin.
Decision-blocking questions: None.
Proposed behaviors: Fixed request and resource budgets implement the ticket's explicit bounds.

## Requirement coverage

| Accepted behavior | Requirement | Design | Proof |
| --- | --- | --- | --- |
| Require both browser opt-ins | REQ-SEC-28b95ad2 | policy.ts, host.ts, index.ts | browser-policy.test.ts |
| Scope browser grants to one session | REQ-SEC-84b7927e | policy.ts | browser-policy.test.ts |
| Revoke browser network access immediately | REQ-SEC-a0dafabc | policy.ts, host.ts, index.ts | browser-policy.test.ts |
| Pin browser requests to public addresses | REQ-SEC-1ae1db7c | policy.ts, network.ts, proxy.ts | browser-policy.test.ts |
| Enforce the browser boundary across request contexts | REQ-SEC-f03f9d4e | proxy.ts, launcher.ts | browser-policy.test.ts |
| Disable unsafe browser surfaces | REQ-SEC-b90a7966 | launcher.ts, proxy.ts | browser-policy.test.ts |
| Bound browser network and grant resources | REQ-NFR-e4b04da4 | policy.ts, proxy.ts | browser-policy.test.ts |


### Ticket Done criteria

| Criterion | Observed proof |
| --- | --- |
| Authorized public page and resources load with the grant enforced | Sandboxed Chromium 156.0.8078.4 on Windows and Ubuntu 24.04 WSL2 rendered the authorized redirect destination, allowed asset, frame and popup. The proxy admitted only exact scheme, host and port grants. A controlled HTTP test observed the vetted socket address and original Host header. |
| Blocked destinations and revocation | Focused tests rejected private and special-use literals and mixed DNS results. Both browser runs denied disallowed redirects, frames, background traffic, service workers, WebSocket and WebTransport. The browser exercised both fetch and top-level navigation against an owned loopback listener, which recorded zero TCP connections. Revocation also cancels a stalled DNS query before an upstream connection begins. Disabling the app setting aborted a pending upstream response, closed the browser and left no grant after re-enabling. All four VERA file permission modes left the browser gate in force. |
| Browser permissions, local files and downloads | Browser runs denied geolocation, disabled the file picker API, refused navigation to the owned local file and rejected an attachment. The managed browser has no VERA IPC or write surface. Existing managed-download transfer tests passed. |
| Controlled fixtures and production policy | The instrumented Desktop drives the same host, managed Chrome profile and loopback proxy using controlled DNS and upstream ports. The release build omitted the fixture entry point, archive hook and fixture origins. |

Focused and runtime logs and both receipts live under
`05_Software/evaluation-outputs/browser/brw02/`. The prior packaging proof
and verified archives are retained under `browser/brw01/`. These browser
runs used instrumented source builds. Native Ubuntu and packaged feature
acceptance remain open for the milestone.

## Design

**Approach.** STATED (#344) — Gate the Desktop host with a global setting, current workbench opt-in and trusted owner-specific grants (REQ-SEC-28b95ad2, REQ-SEC-84b7927e). Route Chromium HTTP(S) through a local session proxy; the proxy authorizes each request and resolves all addresses with the existing public destination checks before forwarding to a vetted address (REQ-SEC-1ae1db7c, REQ-SEC-f03f9d4e). End browser TLS locally using a per-session key that Chromium recognizes by its SPKI hash. Validate upstream TLS separately using the original host and pinned address. A tunnel never relays arbitrary Chrome bytes to the public network.

**Interfaces and data.** Store optional boolean settings at format 1 and interpret absence as disabled. Acquire a lease after trusted Desktop main grants an exact origin. Settings and workbench observers reconcile grants synchronously. Revocation aborts connections and closes the browser context. Session ending clears grants and ownership (REQ-SEC-a0dafabc). Set fixed origin, request, byte and deadline limits (REQ-NFR-e4b04da4).

**Files and test seams.** Extend the shared settings/workbench schemas, Desktop main observers, and browser host, policy and launcher. Browser network modules own destination validation and proxy transport. Browser flags/context policies reject other transports and protect desktop surfaces (REQ-SEC-b90a7966). Exercise policy with deterministic DNS/upstream ports and the sandboxed Chromium pin.

**Risks and open decisions.** OBSERVED — Playwright route interception skips redirected requests and blocks service workers independently. INFERRED — Chromium with a fixed loopback proxy, no DNS fallback and alternate browser surfaces disabled can enforce the network without depending on page events. The pin must prove browser surface behavior through native tests. HTTP reads use GET/HEAD, can follow only granted redirects, and keep upstream credentials out.

**Requirement map.** See Requirement coverage above.

Diagrams: [diagram_TASK-fc2d54a9.md](diagram_TASK-fc2d54a9.md)


## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify
- 2026-11-20 specify: completed; next design
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: focused Windows browser-policy.test.ts exit 1. Both the settings/opt-in schema and Chromium resolver guard were missing.
- 2026-11-20 build: DEVIATION build: the initial red run confirmed missing settings schema and resolver guard; runtime probes established local-file and startup gaps. Other behavior is covered by focused positive and negative tests without independent pre-implementation red runs.
- 2026-11-20 build: Focused Vitest on Windows and Ubuntu 24.04 WSL2: 11 files, 191 passed on each, exit 0. Covers browser policy/transport/host/runtime/launch, settings and workbench services, existing managed-download transfer, shutdown and import boundaries.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Browser runtime e2e: Windows 1 passed in 2.0m and Ubuntu 24.04 WSL2 1 passed in 1.9m, both exit 0 with sandboxed pinned Chromium. WSL receipt confirms PID and network namespaces and Seccomp-BPF. Existing package proof is reused for unchanged packaging, provisioning and digest pins.
- 2026-11-20 validate: Windows release npm run build with VERA_TEST=0 exit 0; inspection of the emitted main bundle found no browser fixture global, archive hook or fixture origin. Release notes audit exit 0 with its expected unchanged-notes warning; the host seam has no user-facing UI or tool yet and #346 owns its localized release entry.
- 2026-11-20 validate: Round 1 quality findings: an aborted proxy request freed the admission slot before uncancellable OS DNS work ended, and an HTTPS page fetch could leave the loopback trap untouched because of Chromium page-level protection. Use cancellable queries and exercise top-level loopback navigation.
- 2026-11-20 validate: returned to build - Address cancellable DNS and the native direct-loopback oracle from quality review.
- 2026-11-20 build: Round 2 red: Windows Vitest cancellation selector exited 1 because the DNS port received no AbortSignal.
- 2026-11-20 build: Round 2: request-scoped cancellable A/AAAA resolution and top-level navigation to the owned loopback listener. Affected browser-policy and network Vitest files passed 34/34 on Windows and WSL2 (exit 0). Reused round 1 passing proof for the unchanged focused suites.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 2 independent specification and implementation-quality reviews both approved. The reviewers verified cancellable DNS and the stronger native loopback oracle, reviewed exact focused proof and raised no additional findings.
- 2026-11-20 validate: Final sandboxed browser test: npm run test:e2e -- browser-runtime.spec.ts --serial-only, exit 0 with 1 passed in 1.1m on each of Windows and Ubuntu 24.04 WSL2. Both round 2 receipts verified direct-loopback denial, zero TCP connections and app-setting revocation.
- 2026-11-20 validate: Final strict AEGIS exit 0. Lint, typecheck, i18n and help passed, with zero errors and 32 advisory warnings for existing records, co-located tests and fixture/error-file source classification, and CHANGELOG outside the globs. Focused import boundaries and existing download tests passed on both platforms.
- 2026-11-20 validate: Owned WSL overlay and temporary transfer files removed. The automatic approval review refused recursive deletion of the ignored Windows release-build scratch directory, which remains within the BRW-02 evidence folder.
- 2026-11-20 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-20 | decision=The coordinator may make one local commit after validation; this implementation subsession leaves the candidate unstaged on ddp/epic-338. | reason=The repository and coordinating instruction explicitly authorize the local ticket commit and assign it to the coordinator. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-fc2d54a9.md
changed: BRW-02 validated candidate on ddp/epic-338, unstaged for the coordinator
evidence: Windows and WSL2 each passed 191 focused tests, plus 34 affected tests after review fixes and 1 final sandboxed Chromium fixture. Strict AEGIS exit 0.
issues: Native Ubuntu and packaged end-to-end browsing remain milestone scope. Automatic cleanup review left the ignored release-build scratch directory.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-SEC-28b95ad2 - Require both browser opt-ins
  - REQ-SEC-84b7927e - Scope browser grants to one session
  - REQ-SEC-a0dafabc - Revoke browser network access immediately
  - REQ-SEC-1ae1db7c - Pin browser requests to public addresses
  - REQ-SEC-f03f9d4e - Enforce the browser boundary across request contexts
  - REQ-SEC-b90a7966 - Disable unsafe browser surfaces
  - REQ-NFR-e4b04da4 - Bound browser network and grant resources
- deviations: 1 recorded
  - build: the initial red run confirmed missing settings schema and resolver guard; runtime probes established local-file and startup gaps. Other behavior is covered by focused positive and negative tests without independent pre-implementation red runs.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base f4eceb3: 28 file(s) changed, 1691 line(s) added
- checks: errors=0 warnings=32 notes=42
- checklist: 8/9 done; open: `report` appended
