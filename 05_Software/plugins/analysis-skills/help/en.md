# Firmware Analysis & Test Planning

Analysis skills gives the agent two procedures for work on evidence you have already captured. The `firmware-comparator` skill compares a baseline and a candidate firmware run from their logs, the documented run conditions, release notes and an acceptance criterion, and saves a cited comparison report in the session. The `test-planner` skill turns a firmware change, a captured failure or an objective into one to five manual test cases with sourced setup, steps, acceptance criteria and a results table, and saves the plan in the session. Neither skill flashes, captures, builds or runs a test.

## What it needs

- No programs and no configuration: the plugin only adds skills.
- Captured logs in the workbench (for example under `logs/`), run notes such as `docs/runs.md` or `WORKBENCH.md`, and the criterion and release-note documents the comparison or plan should cite. Indexed documents make release notes searchable; without indexing the agent reads the files directly.
- Optional: to compare two builds by size or symbols, both build folders and an enabled plugin with a safe size or symbol command, for example esp32-idf (`idf.py size`).

## How to use it

- "Compare the boot logs of firmware 1.0.0 and 1.1.0 on board rev B against the boot criterion in docs/boot-test.md."
- "Which of these runs differ, and what changed between them? Ask me if several runs match."
- "Plan up to three manual tests for the I2C timing change in release 1.1.0."
- "Turn the comparison report into a test plan with a baseline control."

To use a saved report after reopening the chat, give its exact `artifact:...` reference in that
same session. The plan shows readiness for each case. A case with a documented setup and an unknown
acceptance limit can still describe what to measure and mark the result as observation-only.
Saved line citations use the exact reference from the smallest tool result that covers the cited lines.

When several runs match, the agent asks you to choose; it never picks the newest one silently. A missing board, revision, setup or criterion keeps the report or plan marked blocked, and the agent asks for the missing facts. A numeric limit that no source states is never invented.

## Risk and approvals

The plugin declares no rules and runs no programs of its own. A test plan may name a command of another enabled plugin, such as `esptool write-flash` (device-write), but only as an optional step you can request separately. The optional size comparison uses only a safe command of the other plugin, which runs without asking.

## Limits

- Windows x64 and Linux x64.
- A comparison establishes what the captures show, not why: matching notes do not prove the bench matched, and comparability is not release readiness.
- A plan is preparation only; results stay pending until you supply measured evidence.
