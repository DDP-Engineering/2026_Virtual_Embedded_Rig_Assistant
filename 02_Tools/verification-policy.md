# VERA verification and handover

Current user policy, approved 2026-10-12. This overrides the generic AEGIS
full-suite-per-ticket default. Prioritize the planned implementation; defer
unrelated cleanup, refactoring and polish.

## Ticket

- Run the smallest sufficient tests for changed behavior and immediate consumers.
  Keep explicit Done criteria, including real/manual proof where required.
- Keep lint, typecheck, i18n/import boundaries, strict AEGIS and both independent
  reviews. Use the pinned runtimes and relevant Windows/native Ubuntu coverage.
- Reuse passing proof for unchanged source/tests/configuration. After a fix rerun
  only affected or failed checks. Journal-only handover edits do not require tests.
- No complete suites between milestone gates; address concrete risks with focused
  checks. Static checks are not test results.

## Milestone

Full testing runs once per milestone on Windows and native Ubuntu:
M2/WP-21, M3/WP-29, M4/WP-33 and M5/WP-38.

Choose one owner: the last ticket OR the coordinator. The last ticket may supply
full proof for the integrated commit when source/test/configuration match; otherwise
the coordinator runs it after commit. Never both. Record owner, commit and results
in implementation-cycle.json before starting the next milestone.

The gate is npm run verify, the complete Electron/browser suite, applicable CLI
regressions and strict AEGIS. Avoid repeated tests/statics already covered by these
commands. A failed gate reruns only its failed/affected checks unless the integrated
candidate changes their coverage.

## Handover and monitoring

The implementer hands back the candidate without staging/commit. Handover contains
only scope, relevant commands/results, both review verdicts, blockers and next action.
The coordinator checks the complete current diff/journal and relevant original proof,
then makes the authorized local ticket commit. No routine handover retesting,
historical-cache audits or extra monitoring/gate AEGIS tasks.

Monitoring uses a compact snapshot with the saved cursor. Keep one owned scratch
root per task/platform and clean it after processes close; retain useful original
logs and failure diagnostics. Do not multiply mirrors/build archives or delete
unknown Temp folders, user files, other chats or pinned runtimes.

## Release

After WP-38, reuse the M5 suite proof for unchanged code and perform the remaining
release checks required by the plan, including deferred clean/offline Windows and
VC++ self-containment. No duplicate full suite for a handover or release label.
Remote publication requires its separate authorization.
