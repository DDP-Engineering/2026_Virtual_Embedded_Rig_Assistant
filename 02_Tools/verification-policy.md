# Verification policy for the VERA implementation cycle

The user approved this policy on 2026-10-12 ("ok, modifica conform propunerii").
It takes effect for WP-18 and later. WP-17 completes its already-started full
Windows/Ubuntu validation under the previous policy. This project-owned policy
overrides the generic AEGIS instruction to run a full suite for every ticket;
the managed AEGIS payload is unchanged.

## Ticket validation

Run lint, typecheck, i18n/import-boundary checks and strict AEGIS on every ticket.
Run focused unit/integration tests for changed behavior and affected consumers,
plus relevant Electron/browser/CLI E2E tests. Keep every explicit Done criterion,
requirement-specific test and platform-specific proof. Validate relevant behavior
on Windows and native Ubuntu using the pinned repository runtimes.

Select the tests from the complete diff against the recorded base, requirements
and dependency impact. Record the concrete test files, commands, reason for the
selection and platform coverage before final validation; the two independent
reviewers must assess this coverage as well as the exact candidate. AEGIS impacted
selection is a starting point, not proof that downstream coverage is complete.
Use --no-fallback when relying on impacted selection and inspect its selection.
If selection is unavailable, select explicit files or run the full suite.

Configured check --run runs lint/typecheck/i18n only; it does not prove tests passed.
Execute and record selected tests separately, for example via npmw.py npx vitest
run <test-files> and npmw.py npm run test:e2e -- <spec-files>. Use actual file names
from the candidate. Never count an empty selection as successful verification.

The coordinator reads the entire journal, complete diff and original evidence,
checks both reviews and reruns the selected acceptance checks on the exact handed
back candidate. Do not repeat a successful unchanged final check within one role
without a changed candidate, failure or unresolved concern. Keep original failed
attempts, logs and real process return codes; do not reconstruct success evidence.

## Full verification gates

Run npm run verify once (it includes the full unit/integration suite and static
checks), the full Electron/browser E2E suite, applicable CLI regression suite and
strict AEGIS on Windows and native Ubuntu at the end of each remaining milestone:
M2 (WP-16 through WP-21), M3 (WP-22 through WP-29), M4 (WP-30 through WP-33), and
M5 (WP-34 through WP-38). A gate requires all milestone tickets validated and
committed, and evidence bound to the resulting exact integrated candidate/commit.
Do not start the next milestone before its predecessor's gate passes. Record gate
status, commit, platform coverage and evidence paths in implementation-cycle.json.
These cycle gates do not create extra product tasks or tickets.

The milestone-ending ticket may supply full proof instead of a redundant focused
run. Reuse it for the milestone only if all integrated source/configuration hashes
match the committed milestone, evidence is complete and reviewed, and the journal
documents any metadata-only difference. Otherwise run the full gate after commit.

Run the full suite between milestones when the change has broad or uncertain
impact, especially shared runtime/security/permission boundaries, database schema
or migrations, IPC/shared contracts, dependency/build/test infrastructure and
packaging. Record the risk-based decision; a touched filename alone does not
automatically require all tests if impact can be bounded and reviewed.

The final integrated validation and all release proof in the plan remain required.
The deferred clean/offline Windows and VC++ runtime self-containment evidence from
WP-05 remains due at the relevant WP-30/WP-33/release gates. This policy does not
change remote publication authority, acceptance criteria or review requirements.
