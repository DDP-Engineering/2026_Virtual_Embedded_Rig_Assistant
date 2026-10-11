# M1 agent runtime spike

The production selection is ReferenceRuntime behind AgentRuntime in core/agent/runtime.ts. Architecture03 section2 remains the session owner's interface. The actual experimental dependency is @earendil-works/pi-agent-core1.1.0 with pi-ai1.1.0 and typebox1.3.27. Its published npm types and JavaScript were inspected and its Agent executed through an injected stream function; no real provider was used.

## Common replay observations

Both engines run runtimeMatrix in runtime-matrix.test-support.ts against the same temporary JSONL scripts, two strict-zod dummy read/write tools, approval gate, counter, gateway and assertions. runtime.test.ts requires the VERA outcomes; pi-spike.test.ts records the actual upstream gaps explicitly. These are measured differences, not passing VERA acceptance for pi. context.test.ts and runtime-edge.test.ts add boundary coverage.

| Behavior | ReferenceRuntime | pi Agent1.1.0 experiment |
|---|---|---|
| Streaming text and tool arguments | Multiple text deltas, tool.delta and complete messages | Adapted AssistantMessageEventStream preserves text/tool deltas |
| Parallel reads and ordered writes | Read-only and mixed batches peak2; writes ordered after reads; results source-order | Read-only batch peak2; any executionMode=sequential tool serializes the entire mixed batch, peak1 |
| Approval approve / deny | before execution wait; single exact call/hash gate decision; approved writes once, denied error result continues | beforeToolCall gate passes both cases; upstream first validates JSON Schema, hook revalidates zod |
| Abort during approval | Gate aborted; every call gets a result; turn aborted | abort() cancels gate; sequential engine stops after current call and leaves following calls unanswered (two calls produce one result) |
| Persisted resume | JSON round-trip verbatim Message[], detached snapshots | Works through adapter; Agent seeds a system/tools message internally, adapter excludes that injected baseline from external snapshots |
| Throwing / invalid tool | Error results then next model response; invalid args execute zero times | Upstream exception/error-result handling and zod hook both pass |
| Bounded model calls including long first turn | Shared policy before each dispatch;3large results plus another result reduced in the same first turn, full history retained | Same shared policy in streamFn before gateway dispatch; preserves upstream full transcript |

The shared matrix has10cases per engine (separate approve/deny plus budget boundaries). Pi's mixed ordering and abort assertions require its observed outcomes rather than pretending the reference requirements passed. Deterministic deferred barriers release read b before a while results remain source-order; write c stays pending before d starts. Captured requests are counted directly, without another reduction, and an unreduced oversized request exceeds the same bound. Reference edge cases cover stream/tool cancellation, retained partial text including terminal EOF, truncated arguments refused, provider context rejection without retries, fresh effective output reserve, interrupted transient repair, observer isolation, empty stream and50tool cap.

## Context accounting

ContextPolicy counts a whole request. No model-specific tokenizer is present in the pinned dependency set. The conservative fallback uses UTF8 bytes of JSON(system,schemas,messages) at one byte per estimated token, plus32request,16system,32per tool,16per message and8per content block. This over-reserves input compared with typical text tokenizers; remote framing is opaque, so estimated=true and provider context rejection ends limit without retries. A host can inject a complete-request tokenizer/counter with estimated=false; tests use a deterministic counter.

Every dispatch resolves gateway capabilities anew. Reserve the current effective maxOutputTokens and max(1024,ceil(contextWindow*0.05)); input budget is the remainder. Preflight reports contextTokens and budget fields separately from accumulated actual provider usage. System rules, schemas, user messages, call arguments and unfinished work remain. Completed results shorten oldest-first to an explicit JSON context note retaining toolCallId,toolName,outcome,sourceRefs,truncated=true and '[context truncated]'. Calls/results stay paired and ordered. Irreducible views emit CONTEXT_LIMIT/context.budget_exceeded and turn.done limit with no gateway dispatch. The full transcript is retained; a larger configured model/context can make a subsequent turn usable.

buildContext follows reference transient interruption repair: each unanswered call gets an interrupted error result and a trailing result before a new user instruction gets a deterministic assistant separator. WP13 owns durable recovery. Transcript snapshots are detached. Completed provider messages are stored verbatim; when a failed stream has text but no final provider message, a synthetic text-only runtime-partial message retains visible text and never carries executable partial calls.

## zod boundary

Tool schemas originate in zod4.6.5. toolSpecs serializes z.toJSONSchema to pure JSON before Type.Unsafe because zod attaches a hidden StandardSchema property containing validation functions and Type.Unsafe can copy it. The serialization preserves the JSON Schema while keeping requests cloneable/data-only. The original zod schema parses arguments before approval/execution. Pi uses the same pure schema with Type.Unsafe, its own JSON Schema validation and beforeToolCall zod parsing. There are no VERA-owned TypeBox schema definitions.

## Runtime events to SessionEvent

Runtime events are internal core events. WP13 supplies session ownership, IDs/persistence/seq and citations; WP17 owns prepared-change metadata and approval persistence. No session IPC or engine is added by this spike.

| Runtime event | SessionEvent / ownership |
|---|---|
| message.user | message.user using runtime messageId/text; session persists before dispatch |
| turn.started / turn.done | Same turnId/stopReason; session owns status and durable event append |
| message.delta | message.delta same messageId/text; live-only,50ms coalescing in main |
| tool.delta | Partial argument UI seam, no SessionEvent equivalent in03§8; do not persist or reinterpret as executed tool output |
| message.done | message.done messageId/text with citations computed by session citations owner; persist full pi message separately |
| tool.started | Same callId/name/args |
| tool.done | Same callId/ok/summary/durationMs; optional preview supplied by tool/session owner |
| approval.requested | Host supplies approvalId,requestSha256,tool,path,diff,bytes from exact immutable prepared change; runtime supplies call identity/validated args |
| approval.decided | Host supplies approvalId and by=user/mode; runtime decision approved/denied/aborted |
| usage.updated | Same actual inputTokens/outputTokens and optional contextTokens/window/budget/reserve/safety/estimated fields; preserve actual usage during preflight |
| error | Same code/messageKey/retryable |

session.updated,session.interrupted,change.recorded,artifact.saved,todo.updated and reasoning.delta belong to their later owning components. No citation/seq/approval identity is invented in the runtime.

## Adapter effort and choice

The experiment adds a full streamFn bridge (start/text/tool/done/error protocol), system/tools transcript projection, hook validation, approval bridge, event conversion and outer VERA stop-reason accounting. transformContext is unsuitable for irreducible failures because its declared contract requires a safe fallback rather than throwing; the mandatory policy therefore runs at the last streamFn gateway boundary. Hooks and executionMode are used directly. The reference engine needs no second protocol/state layer and satisfies mixed concurrency and abort pairing itself. A pi switch would require batch scheduling changes plus durable pair repair and event/state adaptation. Steering/advanced historical compaction remain WP34/35.

Automated source/runtime validation uses the repository network guard and replay only. Exact commands, UTC timing, actual return codes, candidate/source SHA manifests, original failures and final native-platform receipts are kept in ignored02_Tools/cache/wp10 and referenced by the task journal. Windows current-host and Ubuntu native validation are separate. Clean/offline Windows and VC++ self-containment remain final-release obligations.
