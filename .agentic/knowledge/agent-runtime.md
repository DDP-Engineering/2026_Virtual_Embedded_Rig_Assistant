# Agent runtime and context compaction

## Routing

Select for AgentRuntime, system prompt composition, turn orchestration, read/write batch ordering, approval-host waits, abort, transcript resume, context budgets, tool-schema conversion and runtime events. Start at core/src/agent/{runtime,prompt,context,compaction,types,tool}.ts under05_Software; focused tests are runtime.test.ts,prompt.test.ts,context.test.ts,compaction.test.ts,runtime-edge.test.ts,steering.test.ts. [LLM gateway](llm-gateway.md) owns model metadata/transport/replay, [workbench storage](workbench-storage.md) owns durable rows and [sessions](sessions.md) owns their integration. [File tools](file-tools.md) owns the production read registry/context adapter and worker hosts; [Sessions](sessions.md) supplies prepared permission-host calls; [file tools](file-tools.md) owns immutable changes and workbench write admission.

## Purpose and boundaries

Core ReferenceRuntime implements AgentRuntime over injected LlmGateway, Clock/IDs and approval host. ContextPolicy creates detached provider request views. [ADR-0003](../../00_Planning/decisions/README.md) records why this loop was kept over pi-agent-core.

The synchronous prompt builder consumes workbench name, decoded pinned text, resolved available skill metadata and host environment. WorkbenchService owns the complete stored text; host/session callers supply Clock and environment. The builder exposes text and size without I/O or state.

## Public interface

ToolDef optionally supplies synchronous `publish(args, output)`. After awaited execution and abort
checking, ReferenceRuntime invokes it before tool.done or transcript disclosure; a rejection becomes
an ordinary failed result. The registry caps structured replacements from delegated tool publication. [User terminals](terminals.md) uses it to recheck revocable read leases.

When the host offers commands, `SystemPromptInput.commands` adds instructions for run_command,
closed stdin/noninteractive flags, background program_output polling with waitMs/until and program_stop.
It explicitly states OS-account execution without a sandbox. Read-only omits this instruction and the
model tool. The plugin-program rule names declared plugin programs using run_program. Prompt tests
cover offered/Read-only commands and retain the existing optional program block contract.


- Canonical prompt permits enabled web_search/web_read for general/current topics, treats web content as untrusted data and cites returned URLs as Markdown links while retaining local [[ref]] syntax. No automatic project/context upload is performed.

- Normal usage updates carry the admitted promptIds group; first dispatch can include the initiating prompt and admitted queue, and later steering takes ownership of subsequent calls. Normal budgets follow durable delivery; internal summary budgets have no prompt ownership. Input consumption includes SDK input/cacheRead/cacheWrite, output uses reported output. Terminal partial reports on error/abort and completed reports before cancellation are accounted once; summary finally retains reported consumption even when summarization fails. Unreported all-zero usage is not a measured zero. prompt-usage.test.ts verifies groups, totals and dispatch order; native prompt-usage.spec.ts verifies persistence and UI.

- A Bypass prompt explicitly names read/list/glob/grep/write/edit plus prepared targets of apply_candidate and the electrical mutation/result tools, with application-data refusal and existing tool/OS boundaries. It names the currently confined program/analysis/plugin-draft tools without granting future capabilities. Ordinary file tool descriptions include that scope before normal runtime budgeting; Bypass does not introduce new tool capabilities or remove size, binary, exact-read or host ownership constraints. The SessionService/ApprovalGate layer supplies live revocable authority.

- Before each model budget calculation, ReferenceRuntime awaits optional gateway.prepareModel(model,signal). This resolves live provider capabilities for cold/expired catalogs without relying on renderer queries; readiness errors settle through the normal turn error path. Timed/session wrappers preserve the hook. Reasoning is snapshotted at dispatch by SessionService, including internal subsequent model calls.

- start accepts systemPrompt,model string,ToolDef[],Message[],ContextPolicy and optional maxToolCallsPerTurn (default50); send runs one turn and returns end/aborted/error/limit; abort propagates the turn signal; onEvent returns unsubscribe; messages returns full detached pi Message[]. Busy start/send return BUSY.
- RuntimeHost owns gateway,now,nextId,approve(validated cloned call,signal) and optional steering(), a detached durable FIFO queue snapshot. ToolDef owns name,class(read/write/session/program),description,params(zod),execute(args,signal,callId?) and optional publish(args,output). The runtime forwards the tool call ID separately from zod-validated arguments; the session launch tool combines it with the host turn ID for admission retries. Approval host binds decisions to the prepared change.
- RuntimeInit optionally accepts a session-owned ContextCompactor; default runtime instances retain it across sends and reset it at start. ContextCompactor.prepare asynchronously creates derived history views using one bounded summary callback and an optional original-turn history boundary.
- ContextPolicy.prepare resolves a counted view from current capabilities. TokenCounter counts a whole system/tools/messages request and labels estimates. toolSpecs converts pure JSON Schema through Type.Unsafe; original zod validates execution arguments.
- buildSystemPrompt({workbench,pinned,skills,env}) returns {text,characters}; characters counts UTF16 code units of the final text. PromptEnvironment supplies Clock, windows/linux OS family, veraVersion, session permissionMode and indexedDocuments. Skill metadata preserves caller order.

## Invariants

- Every dispatch resolves current capabilities and reserves effective output plus max(1024,ceil(context*0.05)). Default fallback counts UTF8 JSON bytes plus explicit framing; estimates are labeled. Preflight budget fields retain accumulated provider actual usage separately.
- Runtime user messages carry optional image path metadata until the provider boundary. ContextPolicy counts masked attachment labels and provider part framing on both sides of file hydration. Its fallback estimates 2048 tokens per image independent of base64 length. During compaction, source image references in selected exchanges become one-line path notes in both the summary request and cached derived history. Active and retained exchanges preserve their attachments. `message-images.ts` owns the reference shape and note, and `compaction.test.ts` checks the normal, summary and cached views.
- Completed results shorten oldest-first only in a detached request view, retaining IDs/outcomes/sourceRefs/marker and complete pairs. Mandatory system/user/unfinished context remains; irreducible view emits CONTEXT_LIMIT/context.budget_exceeded then turn.done limit with zero dispatch.
- Image-capability-gated tool definitions are filtered before budgeting. `view_image` puts pixels in the current turn's derived provider tool result and keeps only the text result in durable history and events. Image calls run serially and can prepare up to eight images per step. The runtime retains the eight most recent tool images during the turn. ContextPolicy removes tool image parts for a text-only model (REQ-FUNC-19936eec, REQ-FUNC-ac4610c1).
- Contiguous ordinary reads overlap. Raster reads, writes and session tools flush reads and run in source order. Every call receives a source-order result, including abort/cap/truncated-output refusal. Tool failures and invalid args return errors to the model.
- One controller per send; approval waits receive it, denied changes never execute. Observer mutation/errors cannot alter transcript or strand state. Full terminal messages remain verbatim; failed streamed text is retained text-only. A gateway error event emits error with code/messageKey; only a timeout keeps params, and only {seconds}, so no provider text or endpoint reaches stored events. Tool terminal events carry detached complete result metadata and abort outcome for the durable session owner; runtime result text is bounded32000 characters.
- `send` emits `message.user` with the prompt's `this.host.now()` time as `timestamp`, the same value the model-side user message carries; nothing is added to the prompt content.
- Transient interrupted pair repair uses the source assistant timestamp so derived caches remain stable, and preserves persisted history; production durable recovery belongs to session owner. Core imports no Electron,renderer or app module. Replay tests make no real-provider requests.
- Prompt order is role, all nine canonical engineering rules (including that `@path` or `@"path"` in the user's message names an attached workbench entry to read with tools, REQ-FUNC-a2f48847), workbench, optional skills, environment. Pinned whitespace/BOM remains verbatim within16384 UTF8 bytes; oversized text contributes the longest complete scalar prefix and an explicit marker. Date is UTC from Clock.now once per call. Tool descriptions belong to schemas.

- Above80% of raw input budget, ContextCompactor summarizes only completed historical exchanges using the same policy/output reserve/safety margin, no tools and at most five passes per normal request: each pass summarizes the previous summary with the next exchanges that fit, until the view fits (a restarted session meets its whole history at once, since summaries are not durable). It validates structured summary/decisions/outstanding work, unions exact refs from full history, preserves current/incomplete exchanges and adopts only shorter views. Cache fingerprints guard reuse; invalid/failed/unavailable compaction falls back to M1 and explicit context limits. Full transcript and citation provenance remain authoritative.
- Optional usage compactionStatus/requestViewTokens settle cancellation status and report summary progress and final normal input count, separately from accumulated actual provider usage.

- Runtime admits queued steering after source-order tool batches, rechecks arrivals after a historical summary, budgets the final normal request and emits one message.delivered batch before gateway dispatch. It protects every current instruction using the original turn boundary, continues a normally completed turn for queued arrivals and leaves undelivered queue durable on stop/error/limit. Recovered queue precedes the new idle instruction in provider views; full messages keep their arrival records.

## Change map

| Change | Start | Focused verification |
|---|---|---|
| Steering/admission/current-turn protection | runtime.ts/types.ts/compaction.ts | steering.test.ts; sessions/service.test.ts |
| Stream/events/abort/resume/order/limits | runtime.ts/types.ts | runtime.test.ts/runtime-edge.test.ts |
| Counting/reduction/tokenizer seam | context.ts | context.test.ts and long-first-turn matrix |
| Historical summaries/cache/failure/budget/refs | compaction.ts/runtime.ts | compaction.test.ts; sessions/service.test.ts |
| zod conversion/validation | tool.ts/types.ts | schema and invalid-tool matrix cases |
| Prompt rules/order/pinned/skills/environment/size | prompt.ts | prompt.test.ts and snapshots |

## Key behaviors

REQ-FUNC-27cc4ac0 streaming; FUNC-fa7348bd ordering; FUNC-1092757e approval; FUNC-3b48cda0 abort; DATA-ec55014b resume; REL-4dd25723 tool errors; NFR-8767cf78 whole-request budget; DATA-e2eba20d transient reduction; REL-20be9104 recoverable limit; FUNC-72e17b0f zod adapter; TEST-0abc4146 measured candidates.

REQ-FUNC-9441c5d6 canonical prompt; DATA-446edf2a UTF8 pinned boundary; FUNC-2faac04b skills metadata; FUNC-76d8e0f2 injected environment; UX-6e2e647a final character size.

REQ-FUNC-63733e2c queued steering admission; REQ-FUNC-e5b6a1c9 bounded derived historical compaction; REQ-UX-d1b480e0 optional status and request-view count.

## Files

Under05_Software/src/libraries/core: src/agent/{runtime,prompt,context,compaction,types,tool}.ts; src/agent/{runtime,prompt,context,compaction,steering,runtime-edge}.test.ts and agent/__snapshots__/prompt.test.ts.snap; runtime-matrix.test-support.ts; package.json/src/index.ts. core/src/llm/replay.ts emits argument deltas.
