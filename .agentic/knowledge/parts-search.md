# Supplier parts search

## Routing

Select for parts_search, supplier catalogs (Mouser, DigiKey, TME, Farnell, Rutronik), Settings > Parts search,
supplier credentials or the parts.access.* channels. Start at 05_Software/src/libraries/core/src/parts/
(configured.ts, suppliers.ts, provider.ts, http.ts) and tools/parts.ts, with spec
.agentic/specs/REQ-DATA-9fd50acb.md. Tests: core/src/parts/parts.test.ts, desktop main/parts-access.test.ts,
renderer components/parts-access.test.ts, cli/src/parts-env.test.ts. The offline comparison program parts-compare
belongs to [official plugins](official-plugins.md); general web search belongs to [web search](web-search.md).

## Purpose and boundaries

A first-party host capability for the official `parts-search` plugin: plugin programs never receive VERA secrets,
so authenticated supplier search runs in VERA itself and reaches the agent only as the read-class tool
`parts_search`. It searches, normalizes and groups; it never orders, never stores a supplier result (Farnell, TME and
DigiKey terms forbid or restrict it) and never sends anything but the query or part number, the limit and the
region. No generic proxy, no endpoint for scripts, no automatic upload of schematics or BOMs.

## Public interface

- Tool `parts_search` {query 2..200 | mpn 2..64 printable ASCII without `|`, supplier id or `all`, limit 1..20,
  default 5}. Result `parts-search-result`: search, retrievedAt, suppliers[{supplier, status, retrievedAt?, items,
  message?, notice?}], devices[{manufacturer, mpn, package, description, lifecycle, datasheetUrl, parameters,
  offers[{supplier, sku, packaging, stock, moq, multiple, leadTime, currency, region, productUrl, priceBreaks
  [{quantity, unitPrice, text}], retrievedAt}]}], truncated, notes. Unknown values are null. Devices take each
  supplier's items in turn; the result is fitted under 30 000 characters (parameters, then price breaks, then
  devices from the end) and says so.
- Supplier statuses: ok, partial, failed (errors only, or an answer not in the documented shape:
  `unexpected-answer`), key-required, auth, rate-limited, timeout, unavailable.
- IPC parts.access.get / save {preferences, supplier?, credential? {secret, id?}, storageConsent?} / removeKey /
  test {testId, supplier} / cancel. Settings `partsSearch` is optional; readers apply `partsSearchDefaults`
  (every supplier off, US, en, USD, uk.farnell.com).
- Core exports ConfiguredPartsProvider, PartsAccessBlocked, unavailablePartsTools, officialPartsPlugin,
  partsAdapters, partsJson, PartsSearcher (the ToolContext/SessionServiceHost port `parts`).

## Invariants

- Gate: Web access enabled AND the workbench has `parts-search` loaded with record tier `official` AND a supplier
  enabled; the tool is hidden otherwise (disabledTools) and every call rechecks Web access and revocation before
  and after the credential read and the plugin gate once more after it.
- Fixed endpoints only (exact origin and path), redirect error, 30 s per request, 4 MiB body; one retry after 429
  bounded to 5 s; fixed messages per failure, never a body, URL or credential.
- Credentials in `parts:<id>` slots (`api_key`, `env.id` for DigiKey client id and TME token); snapshot shows only
  keyConfigured/storage; weak storage needs consent; save and removeKey revoke calls in flight and drop tokens; a
  Web access change revokes too. Results are redacted against every credential and token of the call.
- Tokens (DigiKey, TME): one request at a time per supplier and credential, reused until 60 s before expiry on
  the provider's clock, refreshed once on 401/403.
- Grouping: offers of one MPN (case-insensitive) whose manufacturers share their first word form one device.

## Key behaviors

REQ-DATA-9fd50acb contract; REQ-FUNC-7b42ac37 search and normalization; REQ-FUNC-c5cb293b grouping;
REQ-SEC-1518625d gate; REQ-REL-d9f0b8da revocation; REQ-SEC-2ccecd75 secrets; REQ-SEC-597d9e43 endpoints;
REQ-REL-ee71e2b0 auth; REQ-REL-94d8d0ca 429; REQ-REL-a953f579 timeout; REQ-REL-51a2423d partial;
REQ-REL-375c4622 cancel; REQ-FUNC-244f9aef tokens; REQ-FUNC-e6ac90ad key-required; REQ-FUNC-cec25871 notices;
REQ-UX-664afc86 Settings; REQ-SEC-ddb16bb1 consent; REQ-FUNC-fd5a2a7b test; REQ-FUNC-2ed99e46 CLI env;
REQ-TEST-d3aeb7d8 live probes (open until the user enters keys).

## Change map

| Change | Start | Verification |
|---|---|---|
| A supplier's request or field mapping | core/src/parts/suppliers.ts | parts.test.ts fixtures; live probe (REQ-TEST-d3aeb7d8) |
| Transport, limits, retry | core/src/parts/http.ts | parts.test.ts transport block |
| Gate, tokens, revocation, redaction | core/src/parts/configured.ts; main/sessions.ts; cli/run.ts | parts.test.ts access block; parts-env.test.ts |
| Settings, credentials, test | main/parts-access.ts; renderer/components/parts-access.tsx; locales | parts-access.test.ts (main and renderer); check:i18n |
| Contracts and IPC | shared/src/parts-search.ts, settings.ts, ipc.ts, tools.ts | ipc-router.test.ts; bridge.test.ts; typecheck |

## Files

Under 05_Software/src: libraries/shared/src/{parts-search,settings,ipc,tools,index}.ts;
libraries/core/src/parts/{http,provider,suppliers,configured}.ts, tools/{parts,context,registry}.ts,
sessions/service.ts, index.ts; apps/desktop/src/main/{parts-access,sessions,index}.ts;
apps/desktop/src/renderer/components/{parts-access,settings,workbench-tools}.tsx, mocks/mockApi.ts,
locales/{en,ro,de}.json; apps/cli/src/{parts-env,run}.ts.
