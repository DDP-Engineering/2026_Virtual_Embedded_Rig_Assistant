# General web search and reading

## Routing

Select for web_search, web_read, WebProvider, Exa MCP, Web access settings or source links. Start at core/src/web/{provider,exa}.ts and tools/web.ts under05_Software. Tests: web/exa.test.ts,tools/registry.test.ts,renderer session/markdown.test.ts and tests/e2e/web-search.spec.ts. Local retrieval belongs to [document search](document-search.md); execution belongs to [file tools](file-tools.md).

## Purpose and boundaries

WebProvider is the vendor-neutral search/read port. ExaWebProvider implements it with pinned official MCP SDK1.32.2. Desktop WebAccessService and CLI compose ConfiguredWebProvider around it; SessionService injects it into contexts. Constructor/startup makes no network request. General MCP configuration, OAuth, billing management, browser automation and document downloading/indexing are outside this adapter.

## Public interface

- web_search: query1..2000, optional objective1..4096, limit1..8 default5. Result: provider,retrievedAt,sources[{title,url,content}],truncated. Search content is capped3500 characters per source; registry JSON cap32000 applies.
- web_read: one public HTTP(S) URL<=4096 characters without credentials/local addresses; maxCharacters1..16000 default12000. Exa remotely extracts content, including provider-accessible documents. No local PDF download or OCR guarantee.
- WebProvider.search/read receive AbortSignal. Exa normalizes the current MCP Title/URL/Highlights search blocks and fetch title/URL header. Invalid/empty/unusable responses are actionable errors, not invented results.
- Workbench tools.disabled denies both read-class tools through the canonical catalog. Existing execution/activity events persist the calls/results.
- Markdown HTTP(S) source buttons show translated browser confirmation in a body portal; cancel/Escape restore focus without invoking IPC. Confirmation uses existing app.openExternal with confirmed=true. Relative/file/script/credential links and remote images stay inert.

## Invariants

Only https://mcp.exa.ai/mcp is contacted, without redirects, roots, sampling or server instructions in prompts. Separate MCP client per call,30s deadline,1MiB response limit, cancellation through initialize/fetch/call and close on settlement. Anonymous sends no auth header; explicitly selected API-key mode sends only x-api-key to that fixed destination. Only explicit tool arguments leave the process; no automatic project/context upload. Local/private IPs and local hostnames are rejected before remote reading. Canonical prompt treats web content as untrusted and cites returned URLs as Markdown links, retaining local [[ref]] provenance. Anonymous quotas/availability are external limits; no automatic paid fallback or sign-in. Selecting own-key mode uses that account quota; a missing key fails closed.

## Global access and credentials

Settings > Web access persists enabled/provider:exa/authentication (anonymous by default). The public app.settings.update cannot change web authority; web.access.get/save/removeKey/test/cancel are strict dedicated channels. Main stores web:exa in CredentialFile, returns only metadata, preserves existing secure-storage consent/memory options, and rolls back failed writes. Anonymous ignores a retained key; Remove key explicitly selects anonymous. No secret hints or raw provider errors reach renderer snapshots/results. Test may use an unsaved draft key, performs a fixed public documentation query and never saves it. Close/unmount cancels only its UUID attempt.

ConfiguredWebProvider enforces the current global gate before and after credential resolution, revokes active calls when configuration changes and drains on shutdown. Workbench disabledTools remain effective. CLI honors the gate and uses explicit EXA_API_KEY in API-key mode; it does not decrypt desktop keys. Native acceptance covers no automatic requests, key/draft/header use, denial, cancellation, restart, translations and stable modal geometry.

## Key behaviors

REQ-FUNC-39dc23b2 anonymous general search; REQ-FUNC-a0ed7785 public reading; REQ-REL-ee363d68 bounded/recoverable calls; REQ-SEC-6cf2d0e1 egress/untrusted content; REQ-UX-442043ad tool selection/confirmed sources.

## Change map

| Change | Start | Verification |
|---|---|---|
| Settings/credentials/UI | main/web-access.ts; renderer/components/web-access.tsx | main/renderer web-access.test.ts; native web-access.spec.ts |
| Global runtime gate | web/configured-provider.ts; main/sessions.ts; cli/run.ts | configured-provider.test.ts; native web-access.spec.ts |
| MCP/errors/normalization | web/exa.ts | web/exa.test.ts; manual live anonymous search/read |
| Vendor-neutral schema/public URLs | web/provider.ts; tools/web.ts | exa.test.ts; registry.test.ts |
| Host lifetime/exposure | main/sessions.ts; cli/run.ts; sessions/service.ts | native web-search.spec.ts; typecheck |
| Sources/tool selection | session/external-source-link.tsx; workbench-tools.tsx | markdown.test.ts; native web-search/workbench-tools |

## Files

Under05_Software: core/src/web,tools/web.ts,tools/{registry,context}.ts,sessions/service.ts,index.ts,core/package.json; shared/src/tools.ts; desktop/main/sessions.ts,renderer/components/{workbench-tools,session/markdown,session/external-source-link}.tsx,locales/{en,ro,de}.json; cli/src/run.ts; tests/e2e/{web-search,workbench-tools,workbench-navigation}.spec.ts; package-lock.json. Architecture01 §8 and03 §4 govern egress/tools.
