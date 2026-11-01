# ADR-0014: Confirm the reference agent runtime

Date: 2026-10-11
Status: Accepted; implemented

## Context

ADR-0003 proposes the reference gateway loop behind architecture03 section2. M1 needs incremental output, parallel reads with ordered writes, exact approval waits, cancellation, verbatim resume, tool error results and mandatory context budgets before every request. The WP10 spike executed the same replay matrix on the reference runtime and actual @earendil-works/pi-agent-core1.1.0.

## Decision

Confirm ADR-0003: production core/agent/runtime.ts provides ReferenceRuntime implementing AgentRuntime. ContextPolicy is the shared preflight/reduction policy. Keep pi-agent-core as an exact-pinned experiment-only dev dependency, unexported from production core.

The common matrix measures pi's native behavior: executionMode=sequential on a write serializes an entire mixed batch, reducing read peak concurrency from2to1; abort in a sequential approval batch leaves subsequent calls without results. The reference runtime supplies contiguous concurrent reads and complete source-order results after stop. Approve, deny, resume, failures and bounded replay requests work on both candidates through the experiment adapter. See [comparison and event mapping](../../06_SoftwareDocu/agent-runtime-spike.md) and core agent tests for observed evidence.

## Consequences

VERA owns a small gateway loop and its approval/context seams. Session engine and production prepared-change/write-queue ownership remain WP13/WP16/WP17. Pi would require gateway event adaptation, system/tools baseline projection, stop-reason mapping, batch scheduling changes and interrupted pair repair. Its steering/compaction hooks may inform WP34/WP35 but do not change M1 selection.

Tool parameters remain zod4, converted to pure JSON Schema then Type.Unsafe; original zod parsing precedes execution. The default counter is a labeled conservative UTF8-byte estimate with explicit framing, injectable tokenizer support, current output reserve and mandatory safety margin. Full messages remain unchanged when request views shorten completed results. Irreducible requests end a recoverable limit without gateway dispatch.

## Implementation status (2026-11-01)

- Implemented as decided: `ReferenceRuntime` (`src/libraries/core/src/agent/runtime.ts:68`) implements
  `AgentRuntime` (`agent/types.ts:57`) and is exported from `core/src/index.ts:6`; `ContextPolicy`
  (`agent/context.ts:74`) uses the conservative UTF-8 counter (`context.ts:23-31`); limits end as
  `CONTEXT_LIMIT` (`runtime.ts:244`).
- pi-agent-core 1.1.0 is an exact-pinned dev dependency (`core/package.json:52`), imported only by
  `agent/pi-spike.test-support.ts:3-4` and not exported.
- Tool parameters: zod to JSON Schema to `Type.Unsafe` (`agent/tool.ts:11`), zod parsing before
  execution (`tools/registry.ts:129-135`).
- Since then, WP-34/WP-35 steering and compaction were built on the reference runtime, not on pi hooks
  (`runtime.ts:72-84,115,152`, `agent/compaction.ts`). The linked `06_SoftwareDocu/agent-runtime-spike.md`
  still exists.
