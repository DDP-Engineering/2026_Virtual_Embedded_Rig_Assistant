# Typed IPC boundary

Status: active

## Contract

Channels are a const registry of defineChannel(name, request, response) descriptors. app.info accepts an empty strict object and returns nonempty name, version, platform, arch, locale strings and portable boolean. Shared imports only zod. Desktop Vite main/preload/renderer and desktop Vitest resolve @vera/shared from its source entrypoint so a fresh setup can build and serve before library output exists; package exports supply compiled output for library consumers. Channel/Request/Response types derive from that registry.

VeraError is a strict object: code enum INVALID, NOT_FOUND, CONFLICT, BUSY, DENIED, CONTEXT_LIMIT, PROVIDER, OFFLINE, INTERNAL; messageKey nonempty string; optional params record of string or finite number. Main sends {ok:true,value} or {ok:false,error}; the preload validates and returns value or rejects with the plain VeraError object. Plain objects preserve fields across contextBridge, unlike Error custom properties. Native IPC failures map to INTERNAL.

The sole invoke transport is vera:invoke(channel, request). Main checks live own WebContents plus reference identity with its mainFrame and exact authorized URL (vera://app/index.html, or the checked loopback development URL). Sender denial precedes channel/request validation. Unknown channel is NOT_FOUND; malformed request is INVALID. Dispatch result is validated. Malformed response and unknown thrown failures return INTERNAL and log only channel and failure category, never raw exception text, request data or response data. Known schema-valid VeraError passes through. Logger/service expansion belongs to WP-03.

AppEvent currently contains {type:'settings.changed'} as an invalidation signal. App envelopes are {topic:'app',id:'app',seq?:nonnegative integer,event:AppEvent}. subscribe('app', on) installs a wrapped IPC listener, validates/filter envelopes, passes event only and returns idempotent cleanup. Callback receives no Electron event. Each subscription owns its listener. Session/workbench overloads and replay need future event schemas/services; none are invented here.

The emitter validates envelopes and sends vera:event to a live target. A generic keyed coalescer takes caller key and merge functions so future message.delta can concatenate and tool.update can retain the latest update. First pending delta starts one 50ms timer; repeated keys retain first insertion order. Explicit flush sends pending values before callers emit terminal events. dispose cancels the timer and clears pending data; no replay/persistence is implemented.

Renderer VeraApi extends VeraBridge with getAppInfo. ipcApi and mockApi share the boundary. The mock switch is a compile-time VITE_API value, following BenchPilot client/index and in-memory fixtures. Production default uses ipcApi; mock fixture metadata version comes from desktop package.json via a compile-time constant. TanStack Query owns request loading/error/cache; English i18next source catalog owns home labels and error translations. Full locale selection belongs to WP-04.

app.info uses app.getName/getVersion/getLocale and process.platform/arch. portable indicates presence of vera.portable beside process.execPath only; WP-03 owns actual portable data paths. Unit tests inject app metadata inputs, transport, targets and timer clock. No test contacts a model or needs credentials.

## Verification

Router and bridge unit tests cover authorization, strict parsing, error envelopes, response validation and cleanup. Generic batching tests use fake timers and explicit caller merge policies. Real Electron acceptance checks full metadata, plain-object rejection, subscription delivery/removal and retained sandbox/CSP. Browser acceptance starts the actual dev:renderer with mock environment and checks the same metadata screen. Existing boundary/pin/build/security tests remain required on Windows and Ubuntu WSL.
