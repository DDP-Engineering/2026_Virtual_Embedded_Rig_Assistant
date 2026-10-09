# ADR-0003: Agent loop — start from the reference loop

Date: 2026-10-09
Status: Proposed — the runtime spike WP-10 confirms it or switches to pi-agent-core

## Context
A session turn needs streaming, parallel read tools and sequential write tools, a wait for the
user's approval before a write, abort, events for the UI, resumption from stored messages, and a
context budget before every model call, including the first turn. Steering and advanced historical
compaction follow in M5. Two candidates exist, and the BenchPilot reference code in `09_Others/benchpilot-reference/` may be reused:

- The reference loop (`09_Others/benchpilot-reference/apps/server/src/agent/loop.ts`, 185 lines on pi-ai 1.1.0), together with its
  session hub (persisted events folded by the shared reducer), approval gate, replay provider and
  end-to-end replay tests.
- `@earendil-works/pi-agent-core` 1.1.0: an `Agent` with `beforeToolCall` and `afterToolCall` hooks,
  `transformContext`, `steer()` and `followUp()` queues, `abort()` and per-tool execution modes; the
  engine of pi and pi-desktop.

## Decision
Start from the reference loop, moved behind `packages/core/src/agent/runtime.ts` (03 §2). Per-call
approvals reuse its approval-gate pattern, with the immutable request, single consumption and
workbench-wide writer contract of ADR-0012. M1 adds the shared context policy of 03 §2 before every
model call. Steering (user messages queued before the next call) and advanced historical compaction
extend that policy in M5. WP-10 proves the seven behaviours of 03 §2 on this loop and measures the
same on pi-agent-core; if pi-agent-core wins, a new ADR records the switch behind the same interface.

## Alternatives considered
- pi-agent-core from the start: ready hooks for steering and compaction, shared with pi; but VERA
  would rebuild the reference code's tested session hub, replay and approval integration around its events.
- LangGraph.js: far more than one agent loop needs.

## Consequences
- The fastest route to a working M1: tested code moves instead of new code being written.
- VERA owns about 200 lines of loop code and their tests.
- Budgeting and current-turn result reduction are required in M1; steering and historical
  compaction remain M5 additions. The spike measures these requirements rather than assuming the
  reused loop already meets them.
