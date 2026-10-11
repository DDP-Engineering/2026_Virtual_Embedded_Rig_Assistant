# M1 runtime and context policy

## Behavior and interface

The public AgentRuntime is architecture03 section2: start(systemPrompt, model string, ToolDef[], pi-ai Message[], ContextPolicy); send(text) returns end/aborted/error/limit; abort; onEvent unsubscribe; messages returns a detached full transcript. Constructor injects gateway, clock/IDs and approval host. Busy sends/start return BUSY. The runtime owns one abort controller per send. Session persistence, prepared filesystem changes, write queue and citations are supplied by later owning components.

ToolDef owns name/class(read/write/session), description, zod4 params and execute(args,signal). JSON Schema is obtained from z.toJSONSchema and JSON-serialized to remove hidden StandardSchema functions before Type.Unsafe at pi boundary. Validation precedes approval/execution. Approval host receives immutable cloned call ID/name/validated arguments and the signal; it resolves approved/denied/aborted. Production preparation/persistence/permissions belongs to WP17; spike uses a bound one-use dummy gate. Contiguous read batches overlap; sequential calls flush them. All results enter the transcript in assistant source order, including errors/aborted calls.

## Request policy

Before EACH gateway dispatch resolve capabilities(model,effective output requested) synchronously; never reuse an earlier budget. Reserve gateway maxOutputTokens; safety=max(1024,ceil(contextWindow*0.05)); input=context-output-safety. Count system, tools, message/call/result content and framing. Current dependencies contain no local model tokenizer. Conservative fallback counts UTF8 bytes of JSON-serialized input (one byte per estimated token) plus32 request,16 system,32 per schema,16 per message,8 per content block. A host may inject a whole-request model tokenizer/counter returning tokens and estimated=false. Test counter is deterministic. Estimates cannot guarantee opaque remote framing; provider context rejection maps to limit without automatic retries.

Transient cloning preserves all persisted bytes. Completed tool results shorten oldest-first to a deterministic JSON note with toolCallId/toolName/outcome, extracted source refs, truncated=true and visible '[context truncated]' marker. Full tool arguments/call identity and all message order remain. No completed exchanges need removal for M1; if minimum retained messages still exceed budget end limit. The system/current user/unfinished work are preserved; interrupted persisted calls receive deterministic interrupted error results only in the transient provider view, following reference buildContext. No automatic steering or model-written historical compaction.

usage.updated publishes provider actual input/output (initial zero) separately from next-view contextTokens, contextWindow,inputBudgetTokens,reservedOutputTokens,safetyMarginTokens,estimated. Limit emits error CONTEXT_LIMIT/context.budget_exceeded/retryable=false then one turn.done limit; state returns idle and transcript remains complete.

## Acceptance and evidence

Common dummy read/write replay matrix: streaming, read concurrency/write order, approve and deny separately, abort wait separately, persisted resume, throwing/invalid tools, bounded requests including multiple large results in one first turn. Additional context unit tests cover all budget constituents, output/safety, transient immutable refs/outcomes/pairs, model/config switches and irreducible requests. Experiment uses actual pi-agent-core1.1.0 Agent with beforeToolCall, executionMode and abort and a pi event stream adapter over WP09 ReplayGateway. All automatic tests use replay/guarded loopback only. Event mapping and selection ADR describe observed behavior.

## Assumptions

The runtime accepts the gateway's current configured capabilities as authoritative. The approval host is the ownership seam for the exact prepared change. The fallback is explicitly an estimate; model-specific counters can replace it. ADR0014 confirms the reference runtime from measured mixed-batch and abort-pairing gaps.
