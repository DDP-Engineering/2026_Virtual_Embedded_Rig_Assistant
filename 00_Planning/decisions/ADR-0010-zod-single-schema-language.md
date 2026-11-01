# ADR-0010: zod is the only schema language

Date: 2026-10-09
Status: Accepted; implemented (registry test weaker than decided; see Implementation status)

## Context
VERA validates IPC messages, settings, credentials metadata, `workbench.yaml`, skill frontmatter,
replay scripts and tool parameters. pi-ai and pi-agent-core describe tool parameters with TypeBox
(JSON Schema). Two schema libraries would double the patterns agents must follow.

## Decision
Every VERA-owned schema is written in zod (v4). Tool parameter schemas are converted to JSON Schema
with `z.toJSONSchema` and handed to pi as TypeBox `Type.Unsafe` values; tool arguments are validated
again with the zod schema before execution. The reference code uses the same conversion.

## Alternatives considered
- TypeBox everywhere: native to pi, but less familiar ergonomics for parsing and refinement.
- zod and TypeBox side by side: two idioms for the same job.

## Consequences
- One idiom for agents and reviewers.
- A conversion step per tool, covered by a registry test that every tool schema converts and
  round-trips a valid example.

## Implementation status (2026-11-01)
- zod 4.6.5 (`src/libraries/core/package.json:49`, `src/libraries/shared/package.json`) defines
  VERA's schemas: IPC (`shared/src/ipc.ts`), settings, `workbench.yaml` (`shared/src/workbench.ts`),
  the model manifest (`core/src/knowledge/embedding.ts:6`) and replay scripts (`core/src/llm/replay.ts`).
  No other schema library is imported.
- typebox 1.3.27 is a direct core dependency (`core/package.json:46`). It is used only for
  `Type.Unsafe` around `z.toJSONSchema` output (`core/src/agent/tool.ts:1-16`) and in the
  pi-agent-core spike harness (`agent/pi-spike.test-support.ts:13,49`); VERA writes no TypeBox schemas.
- Arguments are parsed again with zod before `prepare` and `execute` (`core/src/tools/registry.ts:113,129-135`).
- Deviation: the registry test (`tools/registry.test.ts:26-33`) parses one valid sample per tool with
  zod and checks that the JSON Schema is a closed object. It does not validate the sample against the
  converted JSON Schema, so the round trip is not checked.
