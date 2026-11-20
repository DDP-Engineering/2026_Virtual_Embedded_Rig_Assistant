# Desktop browser runtime

## Routing

Select for browser runtime provisioning, the Playwright/Chromium pin, visible
sandboxed Chromium, or isolation and disposal of VERA browser sessions. Start
in `05_Software/src/apps/desktop/src/main/browser/` and its adjacent tests.
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
cancellation, and the verified executable. `BrowserHost` owns sessions by
workbench and session identity and exposes main-process tab ownership.
`BrowserAccessPolicy` owns in-memory, exact-origin grants by workbench and
session. Trusted Desktop main calls `grant`, `origins` and `release`. The
browser host acquires a proxy lease before reading the runtime. App setting
`interactiveBrowser` and workbench option `interactive_browser` both default
to disabled when omitted. They are independent of file permission mode.

## Invariants

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
  lifetime. The Playwright process launch has a 15-second timeout.
- Workbench transitions suspend browser acquisition and drain the outgoing
  workbench. Desktop shutdown drains all browser sessions and cancels
  provisioning. Process disconnect and session close use the same disposal.
  Disabling either opt-in synchronously revokes affected grants and aborts
  downstream and upstream connections before asynchronous browser cleanup.
- The loopback proxy rechecks the exact HTTP(S) origin at every request and
  redirect. Every A and AAAA answer must be public. The request signal
  cancels both queries. Connections dial one validated numeric address and
  HTTPS verifies the original server name. A per-session key secures the local browser-to-proxy TLS hop without
  installing a certificate authority.
- The proxy forwards anonymous GET and HEAD requests. Its limits are 32
  in-flight requests, 2,000 requests per session, 16 MiB per resource,
  128 MiB per session and a 15-second request deadline. Service-worker
  scripts, protocol upgrades, attachments and encoded responses are denied.

## Change map

| Change requested | Start with | Focused verification |
| --- | --- | --- |
| Pin, integrity or provisioning | `release.ts`, `runtime.ts`, `integrity.ts` | `runtime.test.ts` |
| Sandbox and runtime errors | `launcher.ts`, `failure.ts` | `launcher.test.ts`, `browser-runtime.spec.ts` |
| Ownership, gates and grants | `host.ts`, `policy.ts`, Desktop main | `host.test.ts`, `browser-policy.test.ts` |
| Public destinations, request limits and alternate paths | `network.ts`, `proxy.ts`, `restrictions.ts` | `browser-policy.test.ts`, `network.test.ts`, `browser-runtime.spec.ts` |
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

## Files

The main-process browser folder and test files are listed in the change map.
`05_Software/tests/e2e/browser-runtime.spec.ts` verifies the native runtime,
session state and cleanup with the release archive for its host.
