# REQ-DATA-18d4b62d — Project metadata layout

## Behavior

The selected project root contains .vera/workbench.yaml, .vera/WORKBENCH.md,
optional .vera/.veraignore and .vera/skills/<name>/SKILL.md. Project-relative
source/document paths keep their meanings. Existing .vera runtime locations persist.
Opening requires the authoritative configuration; root-level predecessors are ordinary
user content. No detection, fallback, migration or user-file moves occur.

## Data / interface

Configuration schema and IPC are unchanged. Lifecycle metadata checks reject redirected
.vera parents and nonordinary management files. Creation prepares .vera and exclusively
publishes workbench.yaml, preserves existing pinned/ignore bytes and makes .vera/skills.
The default internal .gitignore allows its own file, the three metadata basenames and
skills descendants, ignoring all other runtime files. Existing ignore content is retained.
Ignore patterns are relative to the project root. The bounded skill loader evaluates
logical skills/name/file paths with the owning project's ignore policy. Generic tools
and document indexing cannot traverse .vera. The watcher observes configuration and
ignore changes while excluding other internal files from document processing.

## Examples

Creating Board gives Board/.vera/workbench.yaml and Board/.vera/WORKBENCH.md.
Saving pinned context then reopening Board returns the saved bytes. A root-only
Board/workbench.yaml does not make Board openable and remains byte-identical.
A .vera junction is rejected without accessing its destination metadata.

## Acceptance

Lifecycle create/save/reopen and root-only refusal; confined ignore reads; live external
ignore refresh; dedicated project skill create/load/shadow/disabled/extra-file guards;
ordinary metadata tools denied; desktop create/restart/pinned/skills and headless CLI.

## Assumptions and open decisions

The user explicitly chose current layout only during development. Global userData settings,
credentials and user skills remain outside projects. No open decision.
