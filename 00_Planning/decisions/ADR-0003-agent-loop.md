# ADR-0003: Agent loop — start from BenchPilot's loop

Date: 2026-10-09
Status: Proposed — the runtime spike WP-10 confirms it or switches to pi-agent-core

## Context
A session turn needs streaming, parallel read tools and sequential write tools, a wait for the
user's approval before a write, abort, events for the UI, resumption from stored messages, and later
steering and context compaction. Two candidates exist, and reusing BenchPilot's code is permitted:

- BenchPilot's own loop (`apps/server/src/agent/loop.ts`, 185 lines on pi-ai 1.1.0), together with its
  session hub (persisted events folded by the shared reducer), approval gate, replay provider and
  end-to-end replay tests.
- `@earendil-works/pi-agent-core` 1.1.0: an `Agent` with `beforeToolCall` and `afterToolCall` hooks,
  `transformContext`, `steer()` and `followUp()` queues, `abort()` and per-tool execution modes; the
  engine of pi and pi-desktop.

## Decision
Start from BenchPilot's loop, moved behind `packages/core/src/agent/runtime.ts` (03 §2). Per-call
approvals reuse its approval-gate pattern. Steering (user messages queued and given to the model
before its next call) and compaction (a transform of the message list before each call) are added to
the loop in M5. WP-10 proves the six behaviours of 03 §2 on this loop and measures the same on
pi-agent-core; if pi-agent-core wins, a new ADR records the switch behind the same interface.

## Alternatives considered
- pi-agent-core from the start: ready hooks for steering and compaction, shared with pi; but VERA
  would rebuild BenchPilot's tested session hub, replay and approval integration around its events.
- LangGraph.js: far more than one agent loop needs.

## Consequences
- The fastest route to a working M1: tested code moves instead of new code being written.
- VERA owns about 200 lines of loop code and their tests.
- Steering and compaction are VERA's own, small additions in M5.
