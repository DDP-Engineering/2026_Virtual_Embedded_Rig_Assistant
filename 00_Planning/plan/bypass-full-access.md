# BYP — Bypass reaches every folder

PURPOSE: in Bypass mode, let every agent tool that takes a path or a working directory use any folder the user's
account can reach, not only the workbench, so the agent can work on another repository or a folder next to it.
STATE: planned 2026-11-16. Product code follows AEGIS, one work package per task.

## Today (2026-11-16)

- Permission modes are `read-only`, `ask`, `auto-edit` and `bypass` (`shared/src/session.ts`). Bypass approves
  every request without asking (`core/src/agent/approvals.ts`), and switching away from it revokes running bypass
  work (`toolSignal`, `bypassSignal`).
- In Bypass the ordinary file tools already reach absolute paths outside the workbench and ignored locations:
  `read`, `list`, `glob`, `grep`, `write`, `edit`, the electrical tools and the change records use `toolPathGuard`
  (`core/src/tools/context.ts`), which gives a `filesystem` guard in Bypass. The system prompt tells the model so
  (`core/src/agent/prompt.ts`).
- Still workbench-only in Bypass:
  - `run_program`: the working directory must be a workbench folder and only workbench files are bound to the
    approval (`core/src/plugins/program-request.ts`, `runner.ts`); outside paths pass as plain arguments.
  - `parse_log` and `decode_register` read only workbench files (`tools/parse-log-worker.ts`,
    `tools/decode-register/definition.ts`).
  - `plugin_validate` and `plugin_install` take a plugin folder or zip from the workbench only
    (`plugins/authoring.ts`).
  - HIL plans and the bench resource registry read their files from the workbench (`plugins/hil/`,
    `plugins/resource-registry.ts`).
- Places where VERA keeps its own data stay inside the workbench by design: the document index, artifacts,
  run logs and `.vera/`.

## Decisions (2026-11-16)

- **Bypass means the whole file system for agent tools.** Every tool path or working directory the agent passes
  may be absolute and outside the workbench in Bypass, through one guard (`toolPathGuard`), the same rule the file
  tools follow today. Other modes keep the workbench confinement unchanged.
- **VERA's own data stays where it is:** the document index, artifacts, run logs and `.vera/` remain in the
  workbench; Bypass widens what the agent reads and runs on, not where VERA stores things.
- **One exception stays refused in every mode:** VERA's application data folder (settings, stored credentials,
  installed plugins and their review records), so an agent cannot rewrite its own permissions or plugin integrity.
  OS permissions still apply everywhere.
- **Revocation stays immediate:** leaving Bypass ends outside access for running tools and background runs, as the
  file tools do today.
- **Approval records name absolute paths** for outside files and folders, so a session export shows exactly what
  was touched. Formats stay at version 1 (pre-release policy).
- **The mode picker says it plainly:** choosing Bypass shows one confirmation naming that the agent can read,
  change and run programs in any folder the user can reach. No other helper text.

## Work packages

| WP | Title | Result |
|---|---|---|
| BYP-01 | Program runs outside the workbench | In Bypass, `run_program` accepts an absolute working directory outside the workbench and binds outside files named in its arguments by absolute path (hash checked like workbench files); run logs stay in `.vera/runs`; revocation stops background runs started with an outside directory |
| BYP-02 | Remaining path tools | `parse_log`, `decode_register`, `plugin_validate`, `plugin_install` and HIL plan files use `toolPathGuard`, so they follow Bypass like the file tools |
| BYP-03 | Application data refused, prompt and picker | VERA's application data folder refused by the filesystem guard in every mode; the system prompt's Bypass paragraph names all tools; the Bypass confirmation in the mode picker in en, ro, de, fr; help pages (Permissions) updated |

Order: BYP-03's refusal of the application data folder first (it guards the other two), then BYP-01 and BYP-02,
independent of each other. The [terminal plan](terminal.md) builds on BYP-01.

## Verification

- Unit: the guard gives a `filesystem` scope only in Bypass and refuses the application data folder in every
  mode; `run_program` refuses an outside working directory in Ask and Auto-edit and accepts it in Bypass; an outside
  file argument is bound and re-hashed before the run.
- Integration: in Bypass, `parse_log` reads a log in a sibling folder of the workbench and `run_program` runs a
  declared program there; switching to Ask while a background run in an outside folder is running stops it.
- E2E (native): a session in Bypass edits and runs in a second repository next to the workbench; the export lists
  the absolute paths.

## Out of scope

- Indexing documents outside the workbench, a sandbox or container for Bypass, and per-folder allow lists in the
  other modes (the terminal plan's additional folders cover Ask and Auto-edit).
