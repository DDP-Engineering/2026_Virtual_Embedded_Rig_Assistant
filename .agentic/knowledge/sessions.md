# Durable workbench sessions

## Routing

[Chat UI](chat-ui.md) owns renderer transcript/composer/navigation and native UI acceptance.

Select for SessionService, session CRUD/model/mode, persisted snapshots, turn/tool rows, replay/live subscriptions, citations and restart recovery. Start under05_Software at core/src/sessions/{service,hub,timed-gateway}.ts. Focused tests are sessions/service.test.ts, shared/session-state.test.ts, agent/citations.test.ts and desktop main/session-events.test.ts,sessions.test.ts,preload/bridge.test.ts. [Agent runtime](agent-runtime.md) owns model/tool execution and M1 policy; [workbench storage](workbench-storage.md) owns schema/driver; [workbench](workbench.md) owns lifetime/lock; [IPC](ipc-boundary.md) owns validated transport; [file tools](file-tools.md) owns confinement/worker execution.

## Purpose and boundaries

Core SessionService owns one workbench's durable sessions over injected AgentRuntime, gateway, registry, permission port and Clock. SessionHub stores schema-validated events and folds shared snapshots. Main SessionsHost binds current workbench/config/pinned/environment/settings and credentials, owns subscription transport and drains turns before workbench lifecycle changes. The default ApprovalGate executes reads and selects immutable write approvals from current ask/auto-edit/read-only/Bypass mode and canonical protection. It owns pending requests, transactional rows/events, exact single-use grants and abort. Injected PermissionEngine retains the host policy seam; every write keeps core mode/ownership checks. Desktop and CLI decide through the same core lifecycle.

## Public interface

SessionHost may own a PdfDownloads instance, exposed as listDownloads/openDownload and ctx.downloads. Prepared web_download requests use the existing write approval gate; close cancels/drains downloads before releasing storage. Download files remain workbench-owned after deleting their session. Live read-only model filtering covers all bound write-class tools. See [PDF downloads](pdf-downloads.md).


- Optional SessionHost.web supplies the provider to session context; desktop/CLI compose anonymous Exa without startup requests. Web tools use existing read execution/permissions/activity. [Web search](web-search.md) owns the network boundary.

- SessionService.create(modelRef?,mode?,reuseEmpty=false) keeps explicit creation separate. Opt-in New session selects the most recently updated idle/unarchived row with no user transcript row or submitted/queued event, or creates within the same synchronous transaction. Reuse preserves name, model, mode and history. Separate workbench databases and main ownership checks prevent cross-workbench reuse; archived/used/queued rows stay excluded. service.test.ts covers reuse and boundaries; navigation-actions.spec.ts covers concurrent IPC, UI and restart.

- usage.updated optionally carries host/runtime-owned promptIds. The common reducer resets current counters with each turn, attributes only positive cumulative deltas to admitted user items, freezes their first normal-request context snapshot and marks shared batches. All-zero unreported consumption remains unavailable; queued undelivered messages receive no measurements. Durable event replay reconstructs the same per-prompt statistics without a database migration or extra provider request.

- Bypass persists through the existing session mode/event contracts and grants enabled ordinary file tools full filesystem scope without manual approvals. Exact automatic grants retain single-use hashes; filesystem requests require current Bypass. Selecting Bypass resolves existing approval waits. Downgrade aborts scoped work and pending grants; later calls use the normal confined policy. Workbench read-only/ownership and injected host permission policies remain authoritative. Canonical absolute Bypass change paths support hash-only startup recovery.

- reasoningOptions(id) and setReasoning(id,reasoning,expectedModel) prepare current model metadata and return modelRef/options/selected. Strict writable/current-model validation protects saves; an active turn may change its next-request preference. Optional nullable session.updated.reasoning persists/replays the preference in the existing event store, without SQL schema changes. A latest-event lookup seeds the service cache; durable commit precedes cache update and publication. Model switches retain compatible choices and atomically reset incompatible ones. Each request snapshots the current supported value; in-flight requests remain unchanged.

- setArchived(id, archived) updates the existing workbench-owned archived flag and
  updated timestamp atomically with a session.updated notification. It checks
  idle state, current ownership and writable storage; read-only workbenches and
  active/deleting sessions reject the mutation. list returns the flag. Archival
  preserves messages/events and is explicitly reversible. No schema change is needed.


- SessionService(host) recovers writable state before accepting work. host supplies SQLite/root/gateway/Clock/model/prompt and optional workers/registry/permissions/policy/runtime/limits/scrubbing/ownership check and [skill catalog](skills.md). Desktop refreshes catalog metadata before each turn and binds its owned loader to the tool context. Read-only services expose reads/subscriptions.
- TodoHost binds synchronous validated whole-list upserts and durable todo.updated recording/publication for sequential session tools; [Plan](plan.md) owns bounds and renderer status presentation.
- search(query) matches scrubbed titles and durable message.user/message.queued/message.done text using case-insensitive literal substrings; bounded queries read existing per-session events, including full historical and pending messages. exportSession(id) returns strict schemaVersion1 metadata and ordered durable event records; main scrubs fields and uses the pure core buildSessionMarkdown formatter with applied stored diffs or JSON serialization. [Session export](session-export.md) owns formats/native disclosure and acceptance seams.
- listArtifacts/openArtifact/verifiedArtifact expose current managed session content; [Artifacts](artifacts.md) owns bounded storage, refs and native actions. Session class tools stay available in all session permission modes; workbench read-only still denies mutation.
- listChanges(sessionId) and getChange(changeId) project applied SQLite rows, ascending creation time/id and stored-patch hunk counts/details. [Changes](changes.md) owns the read protocol and renderer/native reveal.
- create(modelRef?,mode?) returns camelCase metadata with ses_ULID,UTC dates,empty title and idle status. list, get(id)->{snapshot,seq}, rename,delete,setModel,setMode own metadata and errors. Default mode comes from host; model resolution applies session/workbench/app precedence. First user text sets an empty title to60 UTF16 units; explicit nonempty rename survives.
- send returns turnId/messageId promptly, waitIdle is core completion, stop propagates abort, close aborts/drains all turns. Active sends durably queue message.queued and return the active turnId/new messageId; stopping/finishing/failed turns and approval waits return BUSY. Model/title and deletion mutations remain idle-only. setMode remains available during active turns; read-only aborts pending approvals. Many sessions may run together.
- subscribe(id,sinceSeq,listener(seq|undefined,event)) replays persisted rows then live events. Non-live seq starts1 and increases per session; message.delta/reasoning.delta/tool.update have no persisted row or seq. Detached callbacks cannot alter persistence or fail execution.
- Shared SessionEvent/schema, SessionState/schema, emptySessionState and applySessionEvent form the common projection. message.done text/citations replace deltas even when deltas were missed; unfinalized live-only messages disappear at a terminal boundary. Transient reasoning/tool updates have no durable projection; usage preflight fields preserve actual provider token totals.
- validateCitations checks unique extracted references against successful structured tool ref fields. Shared parseRef recognizes pages, explicit page ranges, heading slugs, lines and artifacts. Current confined text line bounds verify line refs; DocumentKnowledge.validDocumentRef verifies indexed current SHA256/extraction page/heading bounds; ArtifactStore verifies current-session artifact content. Malformed, invented, failed-tool-only, stale, removed, ignored, binary, escaping and out-of-range refs are invalid. Resolver errors produce invalid citations without failing the turn.
- openCitation(sessionId,messageId,ref) requires a completed valid assistant citation and revalidates successful issued tool results that precede that message, resolves their exact ref snippet/text, and opens current confined content or that session artifact. [Document viewer](document-viewer.md) owns viewer payloads.
- decideApproval({sessionId,approvalId,requestSha256,decision,switchToAutoEdit?}) accepts one active exact request or returns CONFLICT. The optional switch applies auto-edit atomically with the user decision. Known credential-bearing patches are refused before approval persistence. Default ApprovalGate records requested/decided status and SHA256 over recursively sorted request JSON, waits outside write admission and consumes each grant once. Automatic grants require current auto-edit on queued checks; protected changes require user decisions.
- readPermissions allows read classes for explicitly injected hosts. Session wrapper consults the injected PermissionEngine and scrubs tool output and write-preparation errors through its host. An injected engine receives prepared ChangeRequest before the write is admitted; read-only mode filters write tools and rejects them at approval/execution. Prepared records retain provider call IDs and active turn identity; per-turn sequential runtime execution consumes each prepared closure once.
- waitReady resolves guarded pending-change recovery; desktop/CLI await it before exposing snapshots or starting turns. Core execution also gates gateway/tool dispatch on readiness. host.writeQueue shares admission with all sessions/app saves; standalone SessionService owns one queue. close drains turns/readiness/write admission before storage closes.

## Invariants

- Full pi messages and results persist independently of transient model request reduction. User/assistant completion synchronizes the verbatim transcript; source-order completed tool messages persist before the next provider response, alongside native provider-ID tool_calls rows. Multi-row transitions are transactional; live delivery follows persistence.
- Initial user persistence runs synchronously. Host gateway/tool wrappers wait the ordered persistence/citation queue before provider dispatch or tool execution; failed durability aborts the turn and prevents external work. Tool-start rows and complete assistant messages are durable before execution, and completed results before the next request. Reentrant publication serializes subscriber fanout; replay drains append nested emissions and skip already delivered persisted sequences.
- Each runtime call applies ContextPolicy using fresh gateway capabilities and emits context usage separately from actual usage. Settings supply maxToolCallsPerTurn; default50. Results cap32000 characters. timedGateway bounds each provider-output wait at300000ms, excluding tool/approval waits and containing iterators that ignore cancellation.
- Cancellation after ownership/decision persistence failure removes the in-memory gate and rejects its waiter through the runtime, allowing close to drain; AbortSignal callbacks contain errors. Durable undecided rows remain untouched until writable recovery. Recovery marks undecided approvals aborted/by mode and makes old decisions conflict. It preserves original content_json bytes, inserts missing result messages in valid pair order, restores completed outcomes from tool_calls, closes pending rows and running/awaiting_approval status with interrupted/aborted/idle events. Repetition makes no further changes. Read-only startup preserves rows.
- Session IDs validate before artifact removal; ordinary .vera/artifacts ancestors and target are required. SQLite cascades all child rows. Host checks lock token/pid before mutations; lifecycle drains prevent closed-DB writes.
- Core remains Electron-independent. Main uses existing exact renderer-frame authorization for invokes and subscription control; sandbox/CSP/vera://app baseline remains. Known-secret text/title/model requests are rejected, gateway and tool outputs are scrubbed, event transport and snapshot/summary responses preserve protocol discriminants/IDs while redacting user fields and bounding titles.

- SessionService supplies one ephemeral ContextCompactor per session across recreated runtimes, clearing it on delete/close. Full SQLite message rows and transcript snapshots remain verbatim; restart regenerates derived historical summaries. Summary calls share the durable dispatch barrier, timeout/abort and scrubbed gateway. Optional usage compactionStatus/requestViewTokens replay through the shared reducer.

- Pending queue lives in durable message.queued events with user timestamp/text/ID. Optional user pending/timestamp fields replay through shared state; message.delivered atomically persists the admitted transcript batch and clears its markers before gateway dispatch. Stop/limits/recovery retain unapplied pending messages for the next request. Closing refuses new sends while draining accepted work.

## Change map

| Change | Start | Focused proof |
|---|---|---|
| Prepared writes/startup barrier | tools/changes.ts,SessionService,desktop SessionsHost | sessions/write-edit.test.ts,main/sessions.test.ts,tests/e2e/write-edit.spec.ts |
| Modes/digest/decisions/abort | agent/approvals.ts,sessions/service.ts | sessions/approvals.test.ts; tests/e2e/approvals.spec.ts |
| Full filesystem Bypass/revocation | sessions/service.ts,tools/context.ts,PathGuard | sessions/bypass.test.ts; tests/e2e/bypass.spec.ts |
| Lifecycle/persistence/recovery/budgets/permission | core sessions/service.ts | service.test.ts |
| Replay/live ordering | sessions/hub.ts | service.test.ts replay/reentrancy |
| Terminal projection | shared session-state.ts/events.ts | session-state.test.ts |
| Citation resolution | agent/citations.ts; knowledge/search.ts | citations.test.ts; search.test.ts; artifacts.test.ts; tests/e2e/citations.spec.ts |
| Model output wait | sessions/timed-gateway.ts | service.test.ts timeout/ignored abort |
| Main host/transport/bridge | desktop main sessions/session-events,index;preload bridge | sessions/session-events/bridge tests; tests/e2e/sessions.spec.ts |

## Key behaviors

REQ-FUNC-63733e2c durable queued steering; REQ-UX-3001bd00 pending/delivery replay; REQ-FUNC-5e2438d5 reducer; FUNC-c76b4c8f CRUD; DATA-24394d5f durable transcript/events; REL-384b6464 BUSY/stop; NFR-83ac0a94 limits; FUNC-2e1261c2 citations; FUNC-eca9b9a1 replay/coalescing; REL-2098b145 recovery; FUNC-2b462360 IPC; SEC-5a7ef5e4 permission seam.

## Files

Under05_Software: src/libraries/shared/src/{session,session-state,events,ipc,index}.ts and session-state.test.ts; src/libraries/core/src/sessions/{service,hub,timed-gateway}.ts/service.test.ts; agent/{approvals,permissions,citations,runtime,types}.ts/citations.test.ts; sessions/approvals.test.ts; core exports; workbench/service.ts ownership/snapshot seams; llm/replay.ts session-isolated deterministic IDs. Desktop main/{sessions,session-events,events,ipc-router,index}.ts and related tests; preload/bridge.ts/test; renderer api/subscriptions.ts,ipc.ts and mocks/sessions.ts,mockApi.ts. tests/fixtures/llm-scripts/read-then-answer.jsonl and tests/e2e/sessions.spec.ts provide deterministic acceptance.

Desktop main injects a shared ConfiguredWebProvider into SessionsHost. New turns omit globally disabled web tools and unsupported Brave web_read in addition to workbench restrictions; already-bound web calls also consult the live global gate. Saving access/key changes revokes active requests. No SessionsHost fallback constructs an ungated Exa provider. See [web access](web-search.md).
