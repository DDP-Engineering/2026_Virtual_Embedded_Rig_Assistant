# TASK-aa5fe257 - Add Tavily and Brave Search web providers

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-957a5ff0, REQ-SEC-3f814549, REQ-UX-9a97f953, REQ-REL-08ad7b8e
parent:
branch: master
base: 48ac860b7cbc3163841199d5c40312ef859866d4
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

Problem: OBSERVED: Web access currently selects Exa only although WebProvider is vendor-neutral.
Desired outcome: STATED: add Tavily and Brave Search, selected by the user reply.
Actors: STATED: desktop user and agent. OBSERVED: CLI shares web preferences.
Primary scenario: STATED: select a search provider, configure/test its own access and use it in agent searches. INFERRED from current contract: save is explicit and only one provider is active globally.
Examples: OBSERVED official Tavily documentation supports anonymous keyless Search/Extract and optional Bearer key. Brave Web Search requires X-Subscription-Token. Exa retains anonymous/optional key mode.
Counterexamples: INFERRED from existing no-fallback contract: an unavailable/unauthorized provider does not silently send the request or key to another provider; Brave does not pretend to extract arbitrary URLs.
In scope: STATED: Tavily and Brave Search. INFERRED: independent adapters, per-provider credential slots, global selector/test/remove, provider capability labels, CLI selected-provider keys, bounded egress, focused/native visual verification.
Out of scope: INFERRED from named providers: other vendors, browser automation, generic MCP servers, account provisioning/billing or new LLM providers.
Constraints: OBSERVED: master base48ac860, preserve8 baseline paths and historical journals. Current data contract only; no migration/compatibility. Root AGENTS authorizes one validated local commit, no push. Existing30s/1MiB bounds, encrypted credentials/weak-storage consent, strict IPC, redaction and explicit selection remain.
Success signals: INFERRED: Exa unchanged; Tavily search/read and Brave search normalize public sources; provider keys never cross; anonymous ignores saved keys; draft test does not save; switch/revoke cancels stale calls; missing key fails closed; Brave read rejected without egress; UI labels en/ro/de and native selector/test/key isolation proven.
Evidence: OBSERVED: current WebProvider/configured-provider, main WebAccessService, settings form and tests inspected; official Tavily keyless/search/extract docs and Brave Web Search docs checked via Context7 and primary pages.
Assumptions: INFERRED from existing UX: single active provider, retain inactive keys; removing active Brave key disables web because Brave has no anonymous mode. UI explicitly describes Brave search-only and offers Exa/Tavily for reading without automatic fallback.
Unknowns: No private Tavily/Brave keys supplied: real paid-account success cannot be proven, use owned scripted transports. Anonymous external limits may vary.
Decision-blocking questions: Answered: user chose Tavily and Brave Search.
Proposed behaviors: None outside scope above.
Path and reason: Full: new provider behavior, egress, credential ownership and IPC/UI contracts require specify/design/build/validate.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| When a configured web provider is selected, VERA shall execute supported web tools through that provider while rejecting unsupported operations without network access. | REQ-FUNC-957a5ff0 | provider registry/isolated slots | Adapter tests prove Tavily anonymous/keyed search/read, Brave keyed search, public result normalization, unsupported Brave reading and unchanged Exa behavior. |
| When web access credentials or requests are processed, VERA shall isolate each provider key and restrict egress to its fixed service with existing cancellation and size bounds. | REQ-SEC-3f814549 | provider registry/isolated slots | Prove selected-only header/key use, anonymous omission, no credential in URL/body/metadata, fixed destinations and redirect denial, private URL rejection, deadline/cancellation and1MiB cap. |
| When Web access settings are used, VERA shall provide translated provider selection, capability information and provider-specific save/remove/test controls with a stable dismissible result dialog. | REQ-UX-9a97f953 | provider registry/isolated slots | Native/UI en/ro/de provider selection, password clearing on switch, saved credential metadata separation, draft Test no persistence, one centered Close dialog and Brave API-key-only/search-only labels. |
| When provider access changes or a configuration write fails, VERA shall revoke stale calls and retain the previous committed preferences and isolated credentials on failure. | REQ-REL-08ad7b8e | provider registry/isolated slots | Focused transaction/switch/cancel tests, missing-key/auth/quota/failure recovery, retained inactive keys and active Brave removal disables without fallback. |


## Design

### Approach
REQ-FUNC-957a5ff0: keep WebProvider vendor-neutral; registry Exa/Tavily/Brave exposes names, anonymous capability and page-reading capability. Add independent Tavily search/extract REST and Brave search REST adapters over fixed bounded JSON transport; Exa MCP remains unchanged. Brave read is denied locally; model tool definitions omit it. No implicit service fallback.
REQ-SEC-3f814549: request headers only, per-provider web:<id> credential slots; no user-configurable host. Native fetch+signal,30s deadline,1MiB cap, redirect:error, sanitize public sources and reject local read URLs before egress. Public tool/result shape unchanged.
### Interfaces and data
Global preferences keep enabled/provider/authentication with provider enum expanded. Strict anonymous/auth validation uses provider capabilities. Snapshot replaces selected-only key metadata with keys:{exa,tavily,brave}, each keyConfigured/storage; no secret. Test/remove require provider id. Draft key is cleared on selector change; testing locks provider controls until cancel settles. Test result includes tested provider. Main serializes metadata/writes, saves optional key only in its slot and rolls back on failure.
REQ-REL-08ad7b8e: explicit switch/save revokes in-flight calls; reads recheck current authorization after credentials. Remove active Exa/Tavily key selects anonymous; remove active Brave key disables web with no fallback. Inactive keys remain. CLI uses EXA_API_KEY/TAVILY_API_KEY/BRAVE_SEARCH_API_KEY, independent slots, and same global/capability gate.
### Files and test seams
Shared web-access/ipc; core web adapters/http/configured provider; main web-access/sessions; renderer form/mock/locales; CLI run; focused shared/core/main/UI and native web-access acceptance. No dependencies or migrations.
### Risks and open decisions
REQ-UX-9a97f953: retain translated en/ro/de stable result dialog, close/focus lifecycle and weak-storage consent; literal i18n keys pass static catalog audit. Brave query limits rejected clearly rather than silently truncating. Without user keys, real keyed-account acceptance is unavailable; isolate native/scripted transports and separately test live anonymous Tavily. No unresolved decision.
### Requirement map
REQ-FUNC-957a5ff0 -> registry/adapters/capability denial; REQ-SEC-3f814549 -> bounded REST/isolated credentials; REQ-UX-9a97f953 -> selector/metadata/test dialog; REQ-REL-08ad7b8e -> serialized transactions/revocation.


## Log

- 2026-10-30 frame: journal opened
- 2026-10-30 frame: completed; next specify
- 2026-10-30 specify: completed; next design
- 2026-10-30 design: Root AGENTS authorizes validated local commit on master, no push. Full design in diagram_TASK-aa5fe257.md; REST adapters preserve fixed egress/cancellation and per-provider credential isolation; Brave search-only is explicit, not silently delegated.
- 2026-10-30 design: completed; next build
- 2026-10-30 build: RED adapter existence assertion reproduced; implemented bounded Tavily/Brave adapters and8 focused transport/normalization/error tests now pass. Anonymous Tavily requires explicit keyless header per official docs; no account or key auto-fallback.
- 2026-10-30 build: Provider isolation regression failed INVALID before schema expansion; current main/core routing and rollback tests pass. UI provider result label reproduced Exa instead of Brave in3 locales, corrected to tested provider. Focused full web pass pending; native fixture extended for provider selection/key isolation. Gracefully stopped only VERA before native shared-output build.
- 2026-10-30 build: Focused47/47 passed. Native Exa acceptance passed. Extended provider acceptance exposed fixture-only GET405: old MCP fixture rejected every GET before REST handling. Brave correctly uses GET; limit405 to MCP path, remove temporary diagnostic probe, retain explicit selected-key wire assertion. Production adapter required no workaround.
- 2026-10-30 build: Native Web access passed7.6s after fixture GET correction: real bundled Tavily anonymous+key and Brave draft+stored key tests, three isolated key slots, password clearing on provider switch, no secret snapshots, Exa restoration, cancellation/global denial/restart/removal/translations. Separate native Exa search/read acceptance passed3.5s. Visual Brave/Tavily captures inspected; no layout or unresolved-label issues.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: Live anonymous Tavily search returned1 source; extraction of official keyless documentation returned1 source, bounded/truncated to1000 chars. No private account key supplied; paid/keyed account acceptance is not claimed. Current component knowledge/settings spec/context/architecture and fixed-selected-provider egress requirement reconciled; historical journals untouched.
- 2026-10-30 validate: Immediate consumers72/72 passed (settings/router/preload/mock). Catalog audit complete; targeted formatting done. Final metadata/anonymous-key-required wording generalized across en/ro/de. Shared contract test uses a fixed UUID to match its platform-neutral TS environment; no Node dependency introduced. Native/live proof reused for unchanged behavior.
- 2026-10-30 validate: returned to build - Both reviews found4 invalid TOML template tails; quality also found missing provider tag in browser mock Test response. Fix metadata/mock and prove narrow regressions.
- 2026-10-30 build: DEVIATION validate: continue bounded review corrections without another user checkpoint - standing repository autopilot authorization covers routine metadata/mock fixes. Round1 identified4 invalid requirement template tails and browser mock missing tested provider; no production desktop/adapter findings. Corrected4TOMLs with explicit tomllib validation.
- 2026-10-30 build: RED browser mock provider regressions failed INTERNAL for Exa/Tavily/Brave. Added missing response provider tag; full mockApi14/14 now pass. Four requirement TOMLs explicitly parse with tomllib after removing template tails. No desktop adapter/runtime change; native/live proofs remain valid.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: final: check --task TASK-aa5fe257 --strict --run exit1; typecheck and i18n passed, lint found only formatting in core/index.ts and http-providers.test.ts. No green claimed.35warnings are baseline30 plus5 inspected fixture/schema secret heuristics; all candidate key values are named owned test fixtures, no user key supplied.
- 2026-10-30 validate: returned to build - Final lint requires LF normalization of core export file and a test mock-chain layout. Apply formatting only, verify idempotence and focused adapter proof, then both reviews.
- 2026-10-30 build: Formatting correction only: core export LF and adapter-test chain layout; immediate second targeted biome check is idempotent exit0. Adapter9/9 green. No runtime or contract change; previous native/live/main/UI proofs remain valid.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: returned to build - User observed pending Tavily test still says Exa. Generalize progress translations and pass tested provider into dialog; add deferred-response regression before final review.
- 2026-10-30 build: User reported Tavily pending Test still said Exa. RED deferred-response UI regression reproduced Connecting to Exa before result. Passed selected provider into progress dialog and generalized en/ro/de interpolation; added6 pending Tavily/Brave locale cases. Local dev HMR received correction. No layout/service change; prior native flow/geometry and live adapter proofs remain applicable.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: final: python -X utf8 .agentic/aegis.py check --task TASK-aa5fe257 --strict --run exit0; lint5.9s,typecheck22.6s,i18n2.3s passed. Focused47, immediate72, CLI1 and native2 proofs retained; final adapter9/UI13/browsermock14 green. Independent spec/quality approved round3.35 accepted warnings: baseline30 and5 reviewed fixture/schema secret heuristics, no real user key present. Live Tavily anonymous search/extract returned1 source each. Normal local VERA responds(PID27088). Prior task journals/baseline8 unchanged; useful scratch logs/screenshots retained and live script removed.
- 2026-10-30 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-aa5fe257.md
changed: Tavily/Brave providers, isolated keys and correct provider name during connection tests
evidence: check --task TASK-aa5fe257 --strict --run exit0; native/live checks and focused UI13/13 passed
issues: 35 accepted baseline/fixture warnings; real private-key account acceptance unavailable without user keys
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-10-30)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-957a5ff0 - Select and execute Tavily and Brave web providers
  - REQ-SEC-3f814549 - Isolate web provider credentials and bounded egress
  - REQ-UX-9a97f953 - Configure and test each web provider with capability labels
  - REQ-REL-08ad7b8e - Revoke provider changes and recover failed web configuration
- deviations: 1 recorded
  - validate: continue bounded review corrections without another user checkpoint - standing repository autopilot authorization covers routine metadata/mock fixes. Round1 identified4 invalid requirement template tails and browser mock missing tested provider; no production desktop/adapter findings. Corrected4TOMLs with explicit tomllib validation.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 48ac860: 50 file(s) changed, 1476 line(s) added
- checks: errors=0 warnings=35 notes=3
- checklist: 8/9 done; open: `report` appended
