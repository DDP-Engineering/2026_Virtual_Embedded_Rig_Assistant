# TASK-4262ecbb - Web search and reading through an anonymous Exa MCP provider adapter

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-39dc23b2, REQ-FUNC-a0ed7785, REQ-REL-ee363d68, REQ-SEC-6cf2d0e1, REQ-UX-442043ad
parent:
branch: master
base: c96ebee135b64a974c68c1d30935a54dc32dd03b
opened: 2026-10-30

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

Problem: STATED: VERA needs general Internet search and page reading; not limited to electronics. OBSERVED: builtin tools currently read only workbench files/documents, and Markdown external links are inert.
Desired outcome: STATED: implement Exa MCP without mandatory user configuration, behind a separate provider adapter so other providers can be added later; verify it works.
Actors: STATED: users of desktop VERA and agent tool execution. INFERRED: CLI shares the same runtime/tools and should use the same host adapter.
Primary scenario: STATED: user asks a current-information question; agent invokes web_search, optionally web_read, then answers with usable source links and activity records.
Examples: STATED: datasheets, components and prices are examples, but search is global. OBSERVED: live anonymous Exa initialize/tools-list/search/fetch succeeded with VERA user agent; current search tool requires query and objective; fetch accepts urls and maxCharacters.
Counterexamples: INFERRED: disabled web tools must not contact Exa; ordinary file reads stay local; fetched page instructions are data, not agent instructions.
In scope: STATED: provider-independent tools, dedicated Exa remote MCP client adapter and anonymous default. INFERRED from accepted prior proposal: bounded page/search content, URL source links, existing workbench tool checkboxes and Agent activity integration. OBSERVED: current network architecture must be explicitly extended for Exa; no renderer remote browsing is needed.
Out of scope: INFERRED from accepted restricted-adapter approach: arbitrary MCP server configuration, tool discovery UI, OAuth/account management, paid fallback providers, browser automation, downloads/import/RAG extensions, price-specific integrations. No account or billing change.
Constraints: OBSERVED: master shared checkout at c96ebee, no push; preserve 8 baseline paths, existing historic journals and no migrations. Local commit authorized by user-supplied root AGENTS.md. Existing 02_Tools verification policy requires focused proof and two independent reviews. Network calls only after explicit agent tool invocation; no startup/background search. No project files or conversation automatically transmitted, only tool query/URL. Existing current tool limit and cancellation apply.
Success signals: INFERRED: anonymous live search and read; provider adapter tests over real MCP transport with failure/limit/abort/bounds; disabled tools make no request; native replay executes real web tools against owned loopback MCP fixture and displays source links/tool activity; external links use existing confirmed system browser IPC; localized Tools labels.
Evidence: OBSERVED: core tools/{registry,context}.ts; shared/tools.ts; sessions/service.ts; main/sessions.ts; cli/run.ts; Markdown currently replaces anchor with span; existing app.openExternal requires confirmed=true. Exa official docs and live schemas read 2026-10-30. SDK latest pinned 1.32.2 from npm registry.
Assumptions: INFERRED: explicit web tool activation uses existing read-class permissions and per-workbench disabled list; anonymous free-tier throttling is an actionable recoverable tool failure, not automatic sign-in/payment. Prefer authoritative sources when appropriate without restricting general search.
Unknowns: Exa service availability and future free-tier quotas remain external limits, not promises. PDF text extraction quality is provider-dependent; no OCR promise.
Decision-blocking questions: None; user explicitly approved anonymous Exa and separate adapter; routine implementation limits follow existing bounded tool behavior.
Proposed behaviors: None beyond the accepted request and existing tool/UI boundaries.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new observable behavior | no | web search/read |
| no new interface/data format | no | WebProvider port and normalized sources |
| no new dependency | no | pinned official MCP SDK |
| existing requirement covers behavior | no | current tools local only |
| no security/data-handling change | no | explicit Exa egress and external content |

Full path, one task, independent read-only reviews at validate.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| General search / anonymous replaceable provider | REQ-FUNC-39dc23b2 | WebProvider + Exa adapter | MCP fixture, provider injection, live search |
| Public page read | REQ-FUNC-a0ed7785 | web_read and normalized source | MCP fixture, live read |
| Failure/abort/bounds/retry | REQ-REL-ee363d68 | per-call deadline, bounded transport and close | transport failure matrix |
| Egress / untrusted data | REQ-SEC-6cf2d0e1 | fixed-origin guarded fetch + public URL validation + prompt | transport/prompt tests |
| Tools/source links | REQ-UX-442043ad | catalog + localized browser confirmation | renderer/native replay |

## Design

### Approach
REQ-FUNC-39dc23b2/REQ-FUNC-a0ed7785: add core WebProvider port with search/read methods and normalized sources; Exa is a separate implementation using official pinned @modelcontextprotocol/sdk 1.32.2 Streamable HTTP client. Desktop/CLI explicitly compose its default anonymous instance; SessionHost passes the provider into context. Runtime/catalog expose only web_search/web_read, no general MCP discovery or server instructions.
REQ-UX-442043ad: existing read tools, disabled list and activity events work unchanged. Add en/ro/de descriptions and guarded source-link buttons in Markdown with a translated dialog using existing confirmed app.openExternal. Files/images/arbitrary renderer navigation stay inert.
### Interfaces and data
WebProvider returns provider, retrievedAt, sources[{title,url,content}], truncated. search query1..2000, optional objective<=4096, limit1..8 default5; read one public http(s) URL with no credentials and maxCharacters1..16000 default12000. Existing registry cap32000 still applies. Parse current observed Exa Title/URL/Highlights and fetch header formats into bounded sources; report malformed content instead of inventing results.
REQ-REL-ee363d68: one MCP client per operation, total deadline30s, bounded1MiB response transport, no retries/billing/auth fallback, always close. Pass cancellation through initialize/call/fetch; future request may retry independently. Clear typed errors for limit/auth/network/timeout/invalid response.
REQ-SEC-6cf2d0e1: fixed https://mcp.exa.ai/mcp, guard every transport fetch against cross-origin/redirect, no credentials/roots/sampling/elicitation; validate public URL syntax and reject local/private IP/hostnames before Exa. Remote Exa resolves remote public URLs, VERA never directly fetches them. Only explicit query/URL arguments leave process; no startup traffic. Prompt differentiates web source Markdown links from local [[refs]], treats external text as untrusted, allows global questions and no fabricated sources. Existing 01-system egress policy extended for explicitly invoked Exa tools.
### Files and test seams
core/web/{provider,exa}.ts + tests; tools/web.ts + registry/context tests; sessions/service host port; desktop/main/sessions.ts and cli/run.ts default composition. shared/tools catalog; workbench-tools/locales/test. Markdown/external-source-link.tsx and test; prompt/test/snapshots. core package and root lock. Existing external-open IPC/security stays unchanged. Native web-search.spec.ts and replay fixture use owned loopback MCP through a test-only main-fetch reroute, no external CI traffic. Separate manual live public-topic search/read verifies anonymous production adapter without LLM spend.
### Risks and open decisions
No broad MCP plugin UI or arbitrary endpoint. Remote content untrusted; normalized URLs do not assert datasheet authenticity. Search can be unavailable/free-tier limited; no unlimited promise. PDF availability/extraction follows Exa; no OCR/download/RAG changes. Stop live dev before shared-output native build; restore normal development afterwards. Preserve all eight baseline paths and historic journals. No blocking unknowns.
### Requirement map
FUNC-39dc23b2 -> port, Exa adapter, search tool; FUNC-a0ed7785 -> read tool; REL-ee363d68 -> bounded/cancelled per-call connection; SEC-6cf2d0e1 -> transport/public URL/prompt; UX-442043ad -> catalog, translated confirmation and native activity.
Diagrams: [diagram_TASK-4262ecbb.md](diagram_TASK-4262ecbb.md)

## Log

- 2026-10-30 frame: journal opened
- 2026-10-30 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-10-30 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-30 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-30 build: red: vitest core/web/exa.test.ts exit 1, 17 expected failures because ExaWebProvider is absent; tests cover anonymous search/read, provider injection, disabled tools, URL confinement, HTTP errors/retry, malformed/oversized results and cancellation/deadline. Anchor recorded before production edits.
- 2026-10-30 build: red UI: markdown.test.ts exit1 because source anchors are inert spans; core16/17 pass and remaining core assertion only omitted the intended isError message wording. New link confirmation regression checks no navigation before consent, cancellation and exact existing external-open IPC.
- 2026-10-30 build: green: focused web/registry/Markdown/Tools tests exit0,25/25. red: new prompt research test exit1 because existing canonical rules omit enabled web tools, URL citations and untrusted web content; update current prompt and snapshots under requested general web scope.
- 2026-10-30 build: green: focused web transport/registry/prompt/Markdown/Tools 42/42 passed; typecheck exit0. Manual live production ExaWebProvider via Vite SSR completed anonymous search (two official sources) then read (3000 characters with truncation), no credentials/model spend. Normal development gracefully closed before native shared-output build.
- 2026-10-30 build: green: core web18/18 including initialization cancellation and redirect rejection; native web-search and workbench-tools exit0 (2 cases), browser workbench-navigation exit0, workspace34/34 passed. Native web-search rerun exit0 after test-only source/confirmation screenshots. Replay fixture is owned temporary data rather than a shipped JSON file. Baseline edits and historical journals preserved.
- 2026-10-30 build: Inspection: source, confirmation and activity screenshots reviewed: source button readable in transcript, centered translated browser-confirmation modal, completed web_search/web_read in activity. Native source cancellation restores trigger focus; confirmed open reaches intercepted existing main shell route. Boundary tests12/12 passed. Owned paths reviewed against design; no full-suite rerun required under verification policy.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: Additional focused consumer check: first CLI2-case invocation timed out under default5s while normal development was rebuilding; no passing claim for that run (afterAll cleanup also hit ENOTEMPTY in owned temporary fixture). Rerun of the same2 cases with --testTimeout=30000 exit0 in6.25s, including compiled CLI restart and public npm command. Live anonymous Exa PDF read also passed (W3C dummy PDF,14 extracted characters). Validation reconciled architecture03's canonical prompt list with the already tested production prompt; this is a documentation-only correction, requesting refreshed reviews.
- 2026-10-30 validate: final: check --task TASK-4262ecbb --strict --run exit0 after both independent round2 approvals; lint, typecheck and i18n passed, errors=0 warnings=30. Warnings are24 pre-existing metadata/historical records plus6 pre-existing unrelated uncovered paths, accepted without historic edits. Focused proof91 unique cases passed (web18,registry4,prompt17,Markdown2,Tools2,workspace34,boundaries12,CLI2), three unique interface E2E cases passed; live anonymous Exa search/read and public PDF extraction passed. PDF/OCR and free quotas remain provider-dependent. Normal development PID27872 Responding=True. Initial timed-out CLI run is separately recorded, passing rerun supplies final proof; its temporary failure data retained as diagnostics outside repository.
- 2026-10-30 validate: Commit authorization: user-provided root AGENTS.md explicitly authorizes one local commit per validated ticket on master. Stage only owned task paths, preserve all eight baseline edits/untracked document and historical journals; no push.
- 2026-10-30 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-4262ecbb.md
changed: Cautare si citire web prin Exa MCP anonim, adaptor separat si surse accesibile
evidence: 91 teste tintite si3 scenarii E2E trecute; Exa live HTML/PDF verificat; lint/typecheck/i18n si AEGIS strict exit0; doua review-uri aprobate
issues: Se aplica limitele externe Exa; 30 avertismente AEGIS preexistente
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-10-30)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-39dc23b2 - General web search through a replaceable anonymous provider
  - REQ-FUNC-a0ed7785 - Read public web pages through the web provider
  - REQ-REL-ee363d68 - Bound web provider calls and expose recoverable errors
  - REQ-SEC-6cf2d0e1 - Confine web egress and treat retrieved content as untrusted data
  - REQ-UX-442043ad - Expose web tools and confirmed source links in the desktop
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base c96ebee: 53 file(s) changed, 2511 line(s) added
- checks: errors=0 warnings=30 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
