# Bounded historical context compaction

Status: active. Requirement: REQ-FUNC-e5b6a1c9. Architecture: 03 §2/7/8, 04 §3/7/8.

## Request flow

1. Build the repaired transient transcript view. Reuse a session-local summary only when the SHA256 of its covered stable repaired prefix still matches.
2. Count the complete request before M1 reduction. The trigger is strictly greater than80% of the current input budget. The budget is context window minus maxOutputTokens minus max(1024,ceil(window*0.05)).
3. Keep system/tools/current user and current tool chain intact. If that current context is irreducible under M1, return the M1 view without a summary request.
4. Select whole historical user exchanges before the current user. An eligible exchange ends in assistant stop, has all tool-call/results paired and has no failed/aborted/length assistant response or interrupted-repair terminal marker. Preserve other historical messages verbatim in the request view.
5. Accumulate eligible exchanges in source order. Select the largest candidate whose summary request fits ContextPolicy. Include a previous derived summary, original system rules and explicit summary instructions, with no tools. Completed tool results may use M1 reduction. Every summary dispatch reserves the same effective output/safety as a normal dispatch.
6. Dispatch at most five summary calls (passes) per normal request: after a completed pass whose view still does not fit, the next pass summarizes the previous summary with the next budget-fitting completed exchanges. A restarted session meets its whole history at once because summaries are not durable (decided 2026-11-01: passes instead of persisting summaries). A successful text-only assistant stop must parse as JSON with nonempty string summary and string arrays decisions/outstandingWork. No tool calls execute; summary deltas/messages stay outside transcript events.
7. Attach the exact union of source refs from the full selected exchanges and previous summary. Structured tool-result JSON refs and inline citations are retained before request reduction.
8. Adopt only a strictly smaller raw request view. Cache the covered prefix hash, derived note, exact refs and retained incomplete historical messages. Return a detached M1-budgeted normal request view. Resolve capabilities again immediately before the normal dispatch.
9. Missing fitting history, provider failure, invalid/empty/length/tool summary or non-shrinking output uses M1 fallback. An irreducible normal view emits CONTEXT_LIMIT/context.budget_exceeded and turn.done limit. Cancellation publishes a terminal compaction usage status and stops the normal dispatch. A summary request is never itself compacted, and a failed pass is not retried.

## Ownership and presentation

SessionService owns one ephemeral ContextCompactor per session and clears it on session delete/workbench close. ReferenceRuntime owns a default compactor across sends and replaces it on start unless the session owner supplies one. Restart can regenerate summaries from full SQLite history; summaries never replace durable messages or become citation provenance.

Usage fields are optional for backward-compatible replay: compactionStatus is none/running/completed/unavailable/failed; requestViewTokens equals the current whole-request count (system, schemas, framing and messages), labeled with the existing estimated flag. Running reports the summary request; the final preflight reports the normal view. Summary provider usage accumulates with normal provider usage, separately from estimates.

## Verification

Authored replay scenarios cover repeated small-window turns with decisions/refs, all dispatch budgets, current-input/first-turn/smaller-window failures, invalid/failed/length/tool summaries, interrupted repair with stable source timestamps/advancing-clock cache reuse, cancellation terminal usage, cached structured refs, unchanged history and restart transcript. Shared projection and en/ro/de meter scenarios cover optional fields. Runtime execution and all plan Done proof are deferred by explicit user instruction; source review and static checks are independent evidence.
