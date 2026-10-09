# ADR-0007: No shell tool; confined file tools; gated writes

Date: 2026-10-09
Status: Accepted

## Context
Coding agents (Codex, opencode, pi, Claude Code) offer a shell tool. VERA's users point it at vendor
documents and logs that may contain text addressed to the model, and later at hardware where a wrong
command can damage a board (for example STM32 option bytes or ESP32 eFuses). External programs such
as flashers will arrive after 1.0 as declared wrapper tools with typed parameters.

## Decision
VERA 1.0 has no shell or process-execution tool. File tools act only inside the workbench root (path
guard, 03 §5), never write `.vera/`, and change files only through `write` and `edit` under the
session's permission mode (`read-only`, `ask`, `auto-edit`). `workbench.yaml`, `WORKBENCH.md`,
`skills/**` and `.veraignore` always need an explicit approval, so the agent cannot rewrite its own
instructions unseen.

## Alternatives considered
- A shell tool with approval per command: flexible, but each approval asks the user to judge an
  arbitrary command line; the risk lands on the user.
- Unrestricted file access with approvals: exposes the whole disk to prompt injection.

## Consequences
- Tasks that need external programs wait for wrapper descriptors after 1.0, each declaring its
  arguments, policy, timeout and success criteria.
- Users who need wider access open a larger folder as the workbench.
