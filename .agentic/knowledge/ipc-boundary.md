# IPC boundary

## Routing

Select for defineChannel, VeraError, app.info, window.vera, vera:invoke, vera:event,
settings.changed, subscriptions, 50ms coalescing and renderer API/mock behavior.
Start with shared src/ipc.ts and desktop src/main/ipc-router.ts under 05_Software.
Focused tests are ipc-router.test.ts, preload/bridge.test.ts and main/events.test.ts.
Native window/security/state belongs to [desktop-shell](desktop-shell.md);
compiler and acceptance commands belong to [software-tooling](software-tooling.md).

[Verification fixtures](demo-onboarding.md) routes the fictional board corpus and PDF sources under tests/fixtures, used by isolated tests and evaluation/smoke harnesses.

## Purpose and boundaries

Shared owns schemas and inferred request/response/event types. Main authorizes and dispatches
calls, reads native app metadata and emits application events. Preload validates the transport
and exposes invoke/subscribe; renderer api selects ipcApi or in-memory mockApi.
React reads metadata and settings through TanStack Query, applies confirmed preference snapshots, invalidates settings on app events and translates catalog labels and structured errors through i18next.

createDeltaCoalescer is a separately tested utility whose callers supply merge policy and flush ordering.

## Plugin authoring controls

Shared channels include strict `plugins.promote {id,sha256}` and `plugins.export {id,sha256}`.
They are available only through the authorized renderer bridge; they are not agent tools. Promotion
returns the installed summary; export returns the native save path or null on cancellation.
Session approval event/state variants include `plugin_install`, with its full manifest review in
`diff`, the draft path and exact request digest. It never receives a mode-only decision or mode-switch
shortcut. Existing persisted event format remains 1.

## Public interface

downloads.list/open are strict workbench-scoped channels; open takes only a UUID identifier, never an arbitrary path or external-launch option. Download approval events require source/budget and reject invented text diffs/byte counts. See [PDF downloads](pdf-downloads.md).


- session.create accepts optional boolean reuseEmpty for the New session command. Response remains SessionSummary; main validates current workbenchId before forwarding the opt-in flag. Core owns transactional reuse and mock mirrors it. Existing callers omitting the flag retain explicit creation.

- session.reasoning.get takes sessionId; session.reasoning.set takes sessionId/modelRef/reasoning (nullable for Default). Both return strict modelRef/options/selected metadata. Main delegates to the owned session, scrubs returned strings, and rejects credential-bearing setters. Preload derives channel authorization from shared contracts; mock metadata/save behavior mirrors current provider profiles and session events.

- session.archive.set requires an exact sessionId and boolean archived, rejects
  extra/missing fields and returns a sanitized SessionSummary. Main delegates to
  the owned SessionService lifecycle with idle/writable guards; preload derives
  the allowlist from channels and the mock mirrors the metadata mutation.

- session.move takes {workbenchId, sessionId, offset: -1 | 1} and returns {}; main requires the
  active workbench (CONFLICT), a listed non-archived session (NOT_FOUND) and writable settings
  (DENIED). workbench.recent accepts move {folder, offset}. The mock mirrors both orders.


- window.menu is a strict fixed-role request with menu=file/edit/view/help and bounded
  integer x/y popup coordinates. The exact main-frame authorization protects native dispatch;
  main constructs role templates and clamps coordinates. No supplied templates, URLs or
  commands are accepted. Browser mock acknowledges this native-only operation.


Strict update.get/check/download/restart/openRelease channels and update.available/update.changed
AppEvents use shared updates.ts; [updates](updates.md) owns their lifecycle/capability gates.

- plugins.list/install/uninstall/toggle use strict optional workbenchId, absolute install path and plugin id
  contracts; see [plugins](plugins.md).
- skills.list/open/create/save/toggle use strict workbenchId/source/name contracts;
  save requires original content SHA256. Main authorizes the existing exact frame
  before WorkbenchService lifecycle/ownership checks. [Skills](skills.md) owns content.

- docs.reindex accepts an optional workbenchId and an empty response with workbench ownership checks. docs.list/search/open require exact workbenchId and return scoped typed records/results/content. Open accepts an indexed path, document ref, or session/message citation; host provenance and current guarded source checks precede disclosure. [Document viewer](document-viewer.md) owns these reads.
  Workbench index.progress/index.document transport batch counters and typed
  records/removals; main redacts paths while retaining enums/hashes/counts.
  docs.tree/find/read/stat (exact workbenchId; folder entries, name matches, a text view and
  entry properties of the Docs tree; tree entries carry `ignored`) are confined by core
  workbench/tree.ts; docs.openers {} -> {apps}, docs.openWith {workbenchId,path,app},
  docs.reveal {workbenchId,path}, docs.copyPath {workbenchId,path,form}, docs.systemApps
  {workbenchId,path} -> {apps:[{id,name}]} and docs.openSystemApp {workbenchId,path,app} -> {}
  reach the OS only after core `locateEntry` (TASK-eae3a69e, TASK-c49f03d5, main/openers.ts); main drops listed
  or found paths the credential scrub would change and scrubs text views.
  index.volume and docs.volume ({workbenchId} -> {workbenchId, volume|null}) carry
  only counters and pass unscrubbed. App event indexer.status {state} and the strict empty
  channels indexer.status -> {state} and indexer.restart -> {} belong to the
  [indexer process](indexer-process.md).
  [Knowledge ingest](knowledge-ingest.md) owns their lifecycle and persistence.

- Shared defineChannel, channels, Channel, Request, Response, VeraError and VeraBridge.
- providers.list/save/remove/models/test use strict public projections and key-bearing write requests; [Providers](providers.md) owns main-only values, consent, configuration and bounded hints. Main scrubs known-secret error params and event user text before transport.
- providers.chatgpt.login/cancel/status/logout use strict metadata and guarded manualCode/promptId requests. app.openExternal requires confirmed:true and HTTP(S); main further confines OAuth to the pinned auth page. [Providers](providers.md) owns secret isolation and lifecycle.
- app.info accepts a strict empty object and returns name/version/platform/arch/portable/locale,
  compiled testBuild and signing (signed/unsigned/not-applicable). [Native packaging](native-packaging.md)
  owns the immutable identity and signature acceptance; transport/preload/mock retain the strict schema.
- vera:invoke returns a validated success/error envelope; window.vera.invoke resolves the value
  or rejects a plain VeraError. Plain error objects retain fields across contextBridge.
- subscribe('app', on) receives AppEvent settings.changed and returns idempotent unsubscribe.
- subscribe('workbench', wbId, on) filters validated opened/closed/config.changed events by id.
- app.chooseFolder and workbench.create/open/close/recent/config.get/config.update/pinned.get/
  pinned.update/files have strict requests/responses; configuration objects retain extensions.
  config.get includes optional folder/readOnly metadata for renderer reload. [Workbench](workbench.md) owns lifecycle semantics.
- emitAppEvent sends validated app/workbench/session envelopes on vera:event to the current live window. Schema-aware sanitization preserves protocol fields, identities and enums while scrubbing known-secret user text and arbitrary extension keys/values.
- artifacts.list/open/reveal/export use strict shared metadata/content schemas and current SessionsHost lifetime; [Artifacts](artifacts.md) owns verified files, native save cancellation, reveal/export and scrubbing.
- changes.list/get use strict summary/detail schemas and current SessionsHost recovery/lifetime. Main scrubs path/diff while preserving IDs/dates/counts. app.revealPath accepts a workbench-relative path, validates canonical confinement/ordinary existence and calls native shell; [Changes](changes.md) owns behavior and proof.
- app.openPath({path}) opens a workbench document with the OS default application: main refuses any extension outside shared `externalDocumentExtensions` (DENIED) before the filesystem is touched, then applies the same PathGuard/ordinary-file/identity checks as reveal (DENIED, NOT_FOUND) and checks the allowlist again on the resolved file, since a link or short name may resolve to a script; an OS failure is INTERNAL (REQ-FUNC-d37a2092, REQ-SEC-33b98d33, REQ-REL-85ae1f66).
- todo.updated and session snapshot todos use shared bounded list validation; current known secrets redact optional todo IDs and text, with presentation text bounded at200 after redaction; Plan consumes the existing snapshot/subscription channels. [Plan](plan.md) owns whole replacement and icons.
- session.list/create/get/rename/delete/send/stop/model.set/mode.set/approval.decide use strict shared contracts. subscribe('session',id,sinceSeq,on) registers its listener before vera:subscription control; control authorizes the same current main frame, validates requests and caps active subscriptions128. Replay/live envelopes bind subscriptionId; unsubscribe and navigation/window/lifecycle cleanup release core listener and transport timers. [Sessions](sessions.md) owns persistence/recovery.
- Durable session events include message.queued {messageId,text,timestamp} and message.delivered {messageIds}; user snapshot pending/timestamp fields are optional. Existing sanitizer preserves IDs/numeric timestamps and scrubs queued user text.
- session.approval.decide validates ses_/apv_ ULIDs, lowercase SHA256, approved/denied and approved-only switchToAutoEdit; main forwards to the live SessionService. session.mode.set stays available during active turns and read-only aborts waits. shared/approval-ipc.test.ts and tests/e2e/approvals.spec.ts cover strict values and real exact decisions.
- Session list/get and mutation summaries redact user fields while preserving schema identities and enums. Titles remain bounded after redaction; known-secret text/title/model requests are refused. Mock sessions bind delayed responses to their originating workbench and drain aborted turns before switches/close.
- session.search validates trimmed1..1000 character query; session.export validates session ID and md/json enum, returns exported boolean. Both dispatch through existing exact-frame authorization and serial SessionsHost; renderer supplies no filesystem path. Main shares schema-preserving session sanitizers and the existing native export destination guard.
- createDeltaCoalescer takes key/merge/emit functions, batches for 50ms, flushes explicitly before
  terminal events and cancels pending values on dispose.
- VeraApi adds getAppInfo/getSettings/updateSettings to VeraBridge; VITE_API=mock selects mockApi during compilation.
- app.settings.get({}) and app.settings.update(patch) return {settings}.
  [Application data](app-data.md) owns schema defaults, validation and persistence semantics.

## Invariants

- Only the current live own WebContents main frame at the configured exact renderer URL dispatches.
  Foreign, missing or detached frames return DENIED.
- Unknown/prototype channel names return NOT_FOUND; invalid requests return INVALID before dispatch.
- Invalid responses and unknown handler failures return logged INTERNAL; logs carry channel/category.
- Shared's sole runtime dependency is zod; Vite resolves the source entrypoint and sandbox preload bundles the shared schemas as CommonJS.
- Events validate topic/id/seq/payload and callbacks receive only event data.
- Each subscription owns its listener; unsubscribe removes it once.
- Coalescing preserves first-key insertion order; caller merge policies own text/update semantics.
- App metadata portable reports the effective executable-adjacent regular vera.portable marker decision.
- Changed settings saves emit settings.changed after persistence. Settings are never read-only.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Channel/schema/type contract | shared src/ipc.ts | bridge.test.ts type assertions and router tests |
| Authorization/errors/dispatch | main/ipc-router.ts | ipc-router.test.ts; foreign renderer acceptance |
| Event lifecycle/batching | shared events.ts; main/events.ts; preload/bridge.ts | events.test.ts; bridge.test.ts; subscription acceptance |
| Metadata and mock parity | main/app-info.ts; renderer api/ and mocks/ | Electron shell and browser mock acceptance |
| UI query/error translations | renderer hooks/use-preferences.ts, components/error-message.tsx, i18n.ts, locales/ | mock.spec.ts |

## Key behaviors

- REQ-FUNC-17dfdd16 — schema-derived channel contracts.
- REQ-SEC-744eb0a2 — own live main-frame authorization.
- REQ-FUNC-f3dfc04e — strict request validation before dispatch.
- REQ-REL-477c1921 — structured and sanitized failures.
- REQ-FUNC-c43658e9 — validated application event lifecycle.
- REQ-NFR-b8df2592 — keyed 50ms delta coalescing and cleanup.
- REQ-UX-6340c035 — metadata home through Query and translation.
- REQ-TEST-799c278d — browser mock boundary parity.

## Files

Paths relative to 05_Software.

- src/libraries/shared/src/{index,ipc,errors,events,settings,workbench,providers}.ts — shared public exports, invoke/error schemas and app events.
- src/apps/desktop/src/main/{ipc-router,events,app-info}.ts — dispatch, event utilities, native metadata.
- src/apps/desktop/src/main/{sessions,session-events}.ts and their tests — session host, authorized subscription control and delta transport.
- src/apps/desktop/src/main/{ipc-router,events}.test.ts — request/error/frame/batching regression seams.
- src/apps/desktop/src/main/index.ts — installs the one router and exposes the current-window emitter.
- src/apps/desktop/src/preload/{index,bridge}.ts and bridge.test.ts — sandbox bridge and transport tests.
- src/apps/desktop/src/renderer/api/{client,index,ipc,subscriptions}.ts and ipc.test.ts — one boundary and validation.
- src/apps/desktop/src/renderer/mocks/{fixtures,mockApi}.ts and mockApi.test.ts — in-memory metadata/event fixture.
- src/apps/desktop/src/renderer/mocks/sessions.ts and sessions.test.ts — session contract and lifecycle fixtures.
- src/apps/desktop/src/renderer/{vera.d.ts,i18n.ts,locales/en.json,App.tsx,main.tsx} — browser types, translation and foundation Query view. [Renderer foundation](renderer-foundation.md) routes the complete UI file set.
- tests/e2e/{shell,mock,workbench}.spec.ts — real Electron and standalone browser acceptance.
- scripts/dev-renderer.mjs — renderer-only Vite entrypoint, configured by desktop electron.vite.config.ts.

Dedicated strict web.access.get/save/removeKey/test/cancel channels expose safe preferences and an exhaustive keys map of provider-specific key-presence/storage metadata. Only save accepts a credential write; test accepts an optional ephemeral draft and returns stable status/timing, never raw errors or a secret. Test/remove require provider id and results identify the tested provider. Cancel matches the caller UUID. Router/preload and mock implement the same surface. See [web access](web-search.md).

Workbench configuration event sanitization preserves the chat.detail protocol enum and scrubs arbitrary chat extensions; main/events.test.ts covers short secrets matching chat/detail/minimal.
