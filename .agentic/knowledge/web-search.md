# General web search and reading

## Routing

Select for web_search, web_read, WebProvider, Exa MCP, Web access settings or source links. Start at core/src/web/{provider,exa}.ts and tools/web.ts under05_Software. Tests: web/exa.test.ts,tools/registry.test.ts,renderer session/markdown.test.ts and tests/e2e/web-search.spec.ts. Local retrieval belongs to [document search](document-search.md); execution belongs to [file tools](file-tools.md).

## Purpose and boundaries

Direct PDF downloads route to [managed PDF downloads](pdf-downloads.md). web_download is a separate prepared-write transport; it shares global Web access cancellation/authorization without requiring Exa/Tavily/Brave credentials, and remains available with Brave when globally enabled. The shared URL guard keeps IPv4 and IPv6 BlockLists separate because Node matches IPv4 against mapped-IPv6 ranges.


WebProvider is the vendor-neutral search/read port. ConfiguredWebProvider selects Exa MCP, Tavily REST or Brave Search REST; main and CLI inject it into sessions. Tavily supports anonymous keyless or keyed search/extraction. Brave requires a key and is explicitly search-only: new model definitions omit web_read and already-bound calls reject it locally. No startup egress, generic MCP configuration, OAuth, account provisioning, browser automation or automatic provider fallback.

## Public interface

- web_search: query1..2000, optional objective1..4096, limit1..8 default5. Result: provider,retrievedAt,sources[{title,url,content}],truncated. Search content is capped3500 characters per source; registry JSON cap32000 applies.
- web_read: one public HTTP(S) URL<=4096 characters without credentials/local addresses; maxCharacters1..16000 default12000. Exa remotely extracts content, including provider-accessible documents. No local PDF download or OCR guarantee.
- WebProvider.search/read receive AbortSignal. Exa normalizes the current MCP Title/URL/Highlights search blocks and fetch title/URL header. Invalid/empty/unusable responses are actionable errors, not invented results.
- Workbench tools.disabled denies both read-class tools through the canonical catalog. Existing execution/activity events persist the calls/results.
- Markdown HTTP(S) source buttons show translated browser confirmation in a body portal; cancel/Escape restore focus without invoking IPC. Confirmation uses existing app.openExternal with confirmed=true. Relative/file/script/credential links and remote images stay inert.

## Invariants

Fixed destinations are https://mcp.exa.ai/mcp, https://api.tavily.com/search and /extract, and https://api.search.brave.com/res/v1/web/search. Redirects are denied; calls have a30s deadline and1MiB streamed response cap with cancellation through fetch/body reads. Exa anonymous has no auth; Tavily anonymous sends X-Tavily-Access-Mode:keyless. Keyed requests use only the selected key in x-api-key, Authorization:Bearer or X-Subscription-Token respectively. No credentials in URLs/body, roots, sampling or server instructions. Only explicit tool arguments leave the process; no automatic project/context upload. Local/private URLs are rejected before remote extraction; returned content remains untrusted and cited with public source links. Anonymous limits are external; missing keys fail closed with no automatic fallback. Brave queries reject its400-character/50-word limit rather than silently truncating.

## Global access and credentials

Settings > Web access persists enabled/provider/authentication, default enabled anonymous Exa. The registry lists Exa/Tavily/Brave names and anonymous/read capabilities. Dedicated strict web.access.get/save/removeKey/test/cancel own authority; generic settings patches cannot write it. Main serializes metadata and writes, using isolated web:<provider> credential slots with existing encryption/weak-storage consent/rollback. Snapshot keys:{exa,tavily,brave} exposes only keyConfigured/storage per provider plus secureStorage. Test/remove require provider id and results identify the tested provider. Switching clears draft passwords; inactive keys remain. Removing active Exa/Tavily key selects anonymous; removing active Brave key disables web without fallback. Tests use fixed public queries, never save drafts or echo raw errors, and cancel by UUID. The translated centered dialog restores focus after cancellation settles.

ConfiguredWebProvider enforces the current global gate before and after credential resolution, revokes active calls when configuration changes and drains on shutdown. Workbench restrictions remain effective. CLI uses explicit EXA_API_KEY/TAVILY_API_KEY/BRAVE_SEARCH_API_KEY in isolated memory slots without decrypting desktop keys. Focused http-providers/configured-provider/main/UI/shared tests and native web-access acceptance cover provider routing, key isolation, unsupported-read denial, rollback, password clearing, cancellation, restart and translations. Separate live Tavily anonymous search/extraction succeeded; no real private account keys were supplied.

## Key behaviors

REQ-FUNC-957a5ff0 selects independent adapters/capabilities; REQ-SEC-3f814549 isolates credentials/bounded egress; REQ-UX-9a97f953 governs provider selection/test metadata; REQ-REL-08ad7b8e governs revocation/rollback and retained inactive keys.

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
