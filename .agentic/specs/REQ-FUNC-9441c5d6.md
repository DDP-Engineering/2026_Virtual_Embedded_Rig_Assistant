# Canonical system prompt

## Contract

`buildSystemPrompt({ workbench, pinned, skills, env })` returns `{ text, characters }`.
`workbench` needs the shared WorkbenchConfig name; `pinned` is decoded .vera/WORKBENCH.md text. `skills` is a readonly array of resolved available `{ name, description }` metadata in caller order. `env` supplies Clock, OS family (`windows` or `linux`), VERA version, session permission mode using the shared workbench mode type, and indexedDocuments count. Inputs are host-validated; the builder performs no I/O/catalog filtering or session state work.

Role and nine rules follow architecture03 section3 verbatim. Blocks use LF separators: role, blank line, Rules with nine dash-lines, blank line, workbench tags around pinned text, optional skills tags with dash-lines, then Environment with date/OS/VERA version/permission mode/indexed documents. Empty pinned text remains between workbench tags. Whitespace and BOM remain verbatim.

The threshold is16384 UTF8 bytes, matching WorkbenchService. Oversized text contributes its longest Unicode-scalar prefix whose encoded size is <=16384, then `[.vera/WORKBENCH.md truncated at 16 KiB (UTF-8).]` on a separate line inside workbench tags. The marker is outside the pinned byte budget. Original text remains untouched. An exact-limit string is not marked. UTF16 character size is `text.length`, including the marker and every generated block; this matches existing JavaScript text conventions and is distinct from UTF8 bytes/token budgets.

Date uses `env.clock.now().toISOString().slice(0, 10)` once per call. Environment metadata reflects supplied session mode, independently of workbench default. Future session/UI callers consume `.text`/`.characters`.

## Verification

Snapshot no skills, two skills,20KiB pinned, each mode. Boundary assertions cover multibyte cutoffs, exact limit, trailing whitespace, BOM, Unicode count, mutable clock, OS/count metadata and immutable inputs. All rules have a literal oracle independent of snapshots. No live provider required.
