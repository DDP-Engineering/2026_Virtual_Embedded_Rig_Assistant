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
policy and the browser process belong to the Desktop host.

## Public interface

`BrowserRuntime` provides provisioning, a status snapshot, inspection,
cancellation, and the verified executable. `BrowserHost` owns sessions by
workbench and session identity and exposes main-process tab ownership.
`BrowserNetworkPolicy` supplies a per-session proxy and attaches policy
to the context before it exposes a tab. The product default denies acquisition.

## Invariants

- The release table pins archive length, SHA-256, the installed file digest, and
  the executable path for each supported x64 platform. Activation follows
  verified extraction and atomic publication in VERA application data.
- Browser processes use a local Playwright pipe, Chromium OS sandboxing,
  temporary browser state, and fresh non-persistent contexts.
- Desktop keeps one process per VERA browser session, with three concurrent
  sessions, four tabs per context, a 30-second startup budget and a 30-minute
  lifetime. The Playwright process launch has a 15-second timeout.
- Workbench transitions suspend browser acquisition and drain the outgoing
  workbench. Desktop shutdown drains all browser sessions and cancels
  provisioning. Process disconnect and session close use the same disposal.

## Change map

| Change requested | Start with | Focused verification |
| --- | --- | --- |
| Pin, integrity or provisioning | `release.ts`, `runtime.ts`, `integrity.ts` | `runtime.test.ts` |
| Sandbox and runtime errors | `launcher.ts`, `failure.ts` | `launcher.test.ts`, `browser-runtime.spec.ts` |
| Ownership, limits and policy | `host.ts`, `policy.ts`, Desktop main | `host.test.ts`, `browser-runtime.spec.ts` |
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

## Files

The main-process browser folder and test files are listed in the change map.
`05_Software/tests/e2e/browser-runtime.spec.ts` verifies the native runtime,
session state and cleanup with the release archive for its host.
