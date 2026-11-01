# ADR-0007: No shell tool; confined file tools; gated writes

Date: 2026-10-09
Status: Accepted; superseded in part by ADR-0016 (process execution); implemented with deviations (see Implementation status)

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

## Implementation status (2026-11-01)
- No shell or process tool exists. The agent tools are `list`, `glob`, `grep`, `read`, `write`,
  `edit`, `artifact_save`, `todo`, `search_docs`, `read_doc`, `load_skill`, `web_search`,
  `web_read` and `web_download` (`src/libraries/core/src/tools/`). ADR-0016 (accepted 2026-11-01)
  supersedes this ADR for process execution but is not implemented yet; the Plugins view is a
  placeholder (`src/apps/desktop/src/renderer/components/plugins.tsx`).
- Deviation: a fourth permission mode, `bypass` (`src/libraries/shared/src/session.ts:5`). In
  `bypass`, file tools accept absolute paths and reach `.vera/` and ignored files
  (`core/src/tools/context.ts:49-55`, `core/src/workbench/path-guard.ts:45,79-99`), and every
  approval is granted by the mode (`core/src/agent/approvals.ts:100,152-161`). Writing into `.vera/`
  is tested (`05_Software/tests/e2e/bypass.spec.ts:117,188`).
- Deviation, stricter than decided: outside `bypass` the path guard refuses `.vera` outright
  (`core/src/workbench/ignore.ts:3`). Since ADR-0004's files moved into `.vera/`, edits to
  `workbench.yaml`, `WORKBENCH.md`, skills and `.veraignore` are refused, not approved; the
  protected-path check (`core/src/tools/changes.ts:76-79`) only has an effect in `bypass`.
- App-managed writes into `.vera/` exist: `web_download` saves to `.vera/downloads` under the
  session's write permission (`tools/web-download.ts:69`), `artifact_save` to `.vera/artifacts`
  (`core/src/artifacts/store.ts:63`).
- In `read-only`, `ask` and `auto-edit`, workbench confinement and gated `write`/`edit` work as decided.
