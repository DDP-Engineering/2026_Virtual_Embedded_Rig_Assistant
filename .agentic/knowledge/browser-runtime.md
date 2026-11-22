# Desktop browser runtime

## Routing

Select for browser runtime provisioning, the Playwright/Chromium pin, visible
sandboxed Chromium, or isolation and disposal of VERA browser sessions. Start
in `05_Software/src/apps/desktop/src/main/browser/` and its adjacent tests.
For Settings > Web access and Chat, start with `browser-settings.tsx` and
`session/browser-controls.tsx` in the Desktop renderer components. For
model-facing browsing, start with `agent-browser.ts`, `page-reading.ts` and
`05_Software/src/libraries/core/src/tools/browser.ts`.
Existing search, reading, and managed downloads are covered by
[web search](web-search.md) and [PDF downloads](pdf-downloads.md).

## Purpose and boundaries

Desktop main owns the external Chromium executable and browser sessions.
Electron continues to serve the Desktop interface and trusted IPC. Browser
policy and the browser process belong to the Desktop host. The browser's
HTTP(S) read transport and the existing managed-download transport have
separate lifetimes and policies.

## Public interface

`BrowserRuntime` provides provisioning, a status snapshot, inspection,
cancellation, removal, and the verified executable. `provision({ file })` takes
the archive from a picked local copy instead of the release host, with no network
request. Trusted IPC `browser.runtime.installFile` opens Desktop main's ZIP
picker and returns the current view when it closes without a file. `BrowserHost` owns sessions by
workbench and session identity and exposes main-process tab ownership.
`BrowserAccessPolicy` owns in-memory, exact-origin grants by workbench and
session. Trusted Desktop main calls `grant`, `origins` and `release`. The
browser host acquires a proxy lease before reading the runtime. App setting
`interactiveBrowser` and workbench option `interactive_browser` both default
to disabled when omitted. They are independent of file permission mode.
The Desktop session host assigns an `AgentBrowser` port to the trusted owner.
Its seven typed tools require the current opt-ins, an owner grant and individual
workbench tool enablement. The model receives opaque tab IDs, scoped link
references, and public citation URLs. The host retains grant and tab control.
Trusted renderer IPC manages runtime installation and scopes grant, state,
Show and Close requests to a verified workbench/session pair. The preload
accepts a grant only during live trusted input. Show observes the live grant
and a deadline outside the session queue. Close and Revoke
both release the grant and window. Chat Stop uses the existing turn abort.

## Invariants

- The archive comes from the pinned release URL or a picked local copy; both are
  streamed into staging through the same length and SHA-256 check before extraction.
- The release table pins archive length, SHA-256, the installed file digest, and
  the executable path for each supported x64 platform. Activation follows
  verified extraction and atomic publication in VERA application data.
- Browser processes use a local Playwright pipe, Chromium OS sandboxing,
  dedicated temporary profiles and fresh non-persistent browsing contexts.
  Chrome loads mandatory restrictions into the owned process. A startup
  probe rejects the launch if the local-file rule fails. The process uses
  a virtual clipboard. Chromium denies permission prompts, local file
  navigation, file selection and browser-owned downloads.
- Desktop keeps one process per VERA browser session, with three concurrent
  sessions, four tabs per context, a 30-second startup budget and a 30-minute
  lifetime. The Playwright process launch has a 15-second timeout. Cap-rejected
  popups stay outside the model's tab list while Chromium closes them.
- Workbench transitions suspend browser acquisition and drain the outgoing
  workbench. Desktop shutdown drains all browser sessions and cancels
  provisioning. Process disconnect and session close use the same disposal.
  Disabling either opt-in synchronously revokes affected grants and aborts
  downstream and upstream connections before asynchronous browser cleanup.
  Runtime removal blocks acquisition and drains all owners before deleting the
  installed runtime. Chat resolves its current authorized location and activity
  from main, so renderer reload preserves the live window of its owner and
  cannot transfer grants or tabs between conversations. Closing the last
  visible tab externally also disposes the lease, including during navigation.
  The adapter marks its own failed-navigation tab cleanup separately.
  Terminal browser notices are scoped to the current renderer and opt-ins.
- The loopback proxy rechecks the exact HTTP(S) origin at every request and
  redirect. Every A and AAAA answer must be public. The request signal
  cancels both queries. Connections dial one validated numeric address and
  HTTPS verifies the original server name. A per-session key secures the local browser-to-proxy TLS hop without
  installing a certificate authority.
- The proxy forwards anonymous GET and HEAD requests. Its limits are 32
  in-flight requests, 2,000 requests per session, 16 MiB per resource,
  128 MiB per session and a 15-second request deadline. Service-worker
  scripts, protocol upgrades, attachments and encoded responses are denied.
- Agent browser calls serialize by VERA session. Close has a reserved queue slot.
  The lease admits 80 other calls with 35 seconds for open and 12 for other
  calls including queue time. Active cancellation or timeout closes the owned
  browser. A snapshot uses a fixed isolated-world reader for bounded top-level
  viewport text and links. The 24,000-byte result marks page content untrusted.
  Navigation, tab selection, scroll and a new snapshot retire prior references.
- Policy refusals and unsupported document responses produce a proxy-owned
  marker and preserve the currently displayed page. Upstream pages cannot set
  the marker. Search, provider reading and managed downloads remain separate.

## Change map

| Change requested | Start with | Focused verification |
| --- | --- | --- |
| Pin, integrity or provisioning | `release.ts`, `runtime.ts`, `integrity.ts` | `runtime.test.ts` |
| Installation from a picked archive | `runtime.ts` (`provision({ file })`), `browser.runtime.installFile` in Desktop main, `browser-settings.tsx` | `runtime.test.ts`, `install-from-file.test.ts`, `install-from-file.spec.ts`, `offline-components.test.ts` (set `VERA_COMPONENTS_DIR`) |
| Sandbox and runtime errors | `launcher.ts`, `failure.ts` | `launcher.test.ts`, `browser-runtime.spec.ts` |
| Ownership, gates and grants | `host.ts`, `policy.ts`, Desktop main | `host.test.ts`, `browser-policy.test.ts` |
| Public destinations, request limits and alternate paths | `network.ts`, `proxy.ts`, `restrictions.ts` | `browser-policy.test.ts`, `network.test.ts`, `browser-runtime.spec.ts` |
| Agent browser tools, budgets and refs | `agent-browser.ts`, `page-reading.ts`, core `tools/browser.ts` | `agent-browser.test.ts`, `browser.test.ts`, `browser-agent.spec.ts` |
| Settings and Chat controls | `browser-settings.tsx`, `session/browser-controls.tsx`, shared `browser.ts`, Desktop main | `browser-controls.spec.ts` |
| Packaged fixture | `fixture.ts`, `02_Tools/release/package.mjs` | `browser-runtime.spec.ts` |

## Key behaviors

- `REQ-FUNC-facf03ca`, `REQ-FUNC-8db3fff6` — explicit provisioning and progress.
- `REQ-SEC-92a60a12`, `REQ-REL-b48a282e`, `REQ-REL-c0d8c2ab` — integrity,
  cancellation, and recovery instructions.
- `REQ-PLAT-2dafaac0`, `REQ-REL-b3c5a310`, `REQ-DATA-d8426151` — sandboxed
  visible process with ephemeral state and explicit refusal on sandbox failure.
- `REQ-NFR-68c245d2`, `REQ-REL-7f4d1af6`, `REQ-SEC-c372d1ee` — resource
  limits, cleanup and a closed network policy default.
- `REQ-TEST-dafabd63` — controlled fixture compiled into the instrumented build.
- `REQ-SEC-28b95ad2`, `REQ-SEC-84b7927e`, `REQ-SEC-a0dafabc` — opt-ins,
  ownership, exact origins and revocation.
- `REQ-SEC-1ae1db7c`, `REQ-SEC-f03f9d4e`, `REQ-SEC-b90a7966`, `REQ-NFR-e4b04da4` —
  pinned network requests, isolated browser surfaces and bounded reads.

- `REQ-FUNC-072acfac`, `REQ-FUNC-d219825f` — rendered reading, citations and tab operations.
- `REQ-SEC-a3c7aa38`, `REQ-SEC-2a1b6fb6`, `REQ-SEC-fcab766f`, `REQ-SEC-ad60d613` — live authority, scoped refs, denied destinations and untrusted data.
- `REQ-REL-48dddd59`, `REQ-REL-7274a3e9`, `REQ-REL-d97264a7`, `REQ-NFR-2661da07`, `REQ-REL-fff52da3`, `REQ-REL-c8d7898f` — supported documents, closed pages, deadlines, bounded results, cancellation and close.

- `REQ-UX-4c16a20f`, `REQ-UX-8c54a766`, `REQ-SEC-39c979a5` — runtime settings, opt-ins and trusted chat grants.
- `REQ-FUNC-75aa4017`, `REQ-UX-f17b5648`, `REQ-REL-5b7d34d9` — offline installation from a picked
  delivery archive, Install from file beside Install, and a closed picker that starts nothing.
- `REQ-UX-59086d40`, `REQ-UX-74f740e9`, `REQ-FUNC-ae3000ef`, `REQ-SEC-1f3fba00` — current owned state, Show, Stop, Revoke and Close.
- `REQ-REL-df91d9fe`, `REQ-REL-6fecfe63`, `REQ-REL-646a1376`, `REQ-REL-3dc8d834`, `REQ-UX-da941b4d` — localized missing runtime, transfer failure, denied destination and window closure.

## Files

The main-process browser folder and test files are listed in the change map.
`05_Software/tests/e2e/browser-runtime.spec.ts` verifies the native runtime,
session state and cleanup with the release archive for its host.
