# ADR-0010: zod is the only schema language

Date: 2026-10-09
Status: Accepted

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
