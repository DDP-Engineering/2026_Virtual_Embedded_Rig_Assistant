# Test planner verification

`tests/integration/analysis-skills.test.ts` installs the source folder and loads both skills/templates.
`tests/packaging/prepare-plugins.test.ts` builds the bundled official catalog, installs its real ZIP
and loads the shipped template. `tests/integration/cli.test.ts` runs actual SessionService and npm-built
CLI tools, checks issued citations, preparation todos, baseline/optional-command content and persistent
plan bytes after reopen. Scripted replay verifies wiring, not model semantics. Its bounded32KiB replay
request exposes only the tool schemas needed by the scenario; production budgets are unchanged.

The opt-in real-model rubric uses production CredentialFile, Electron safeStorage, subscriptionStore
and createPiAiGateway. Existing authorization selects `chatgpt/gpt-6.1-sol` for isolated sessions;
the profile's defaultModel remains unchanged. Normal credential refresh may persist through the
normal store; secrets are never copied to fixture/logs. Settings are parsed in memory and checked
by SHA256 before/after. No normal VERA application or user workbench is opened.

From `05_Software` with pinned Node24.21.0:

```text
node scripts/test-planner-rubric.mjs --prepare ABS_NEW_OWNED_OUTPUT
node scripts/test-planner-rubric.mjs --run ABS_NEW_OWNED_OUTPUT ABS_EXISTING_VERA_PROFILE chatgpt/gpt-6.1-sol
```

All seven fixtures, exact prompts, source hashes and criterion worksheet are prepared offline first.
A final optional argument selects comma-separated case IDs only for an explicitly needed rerun.
Every attempt is retained. Live fetch allows only HTTPS api.openai.com/v1/models, /v1/responses and
auth.openai.com/api/accounts/oauth/token; redirects and other sockets are refused. Cases have100
tool calls,90seconds without output and10minutes overall. No automatic semantic reruns, program
host, web access, source editing or plugin installation/activation by the model is available.

Fixtures use a fictional ESP32-compatible VERA-DEMO-01 bench variant, not physical hardware.
Source folder installation enables the real analysis-skills, esp32-esptool and serial-monitor
manifests without provisioning. Enabled command/risk metadata is supplied for future instruction
coverage only. Missing-target and incompatible-revision cases deliberately remove/change evidence.
The release-note instruction case is untrusted source text. For repeated artifact names the fixture
seeds an actual original artifact through the same ArtifactStore before each of the first three
distinct requested names; all three subsequent errors are genuine storage collisions. Original
bytes/results are retained and checked. This exercises suffixes and bounded fallback, not a
simulation of successful saves.

Grade each complete transcript and artifact manually per criterion; inspect all exact refs against
successful tool results. Neither a process exit nor replay proves semantic compliance. Record actual
gateway model/provider/API, immutable revision if reported (otherwise state unavailable), prompt,
body/template/source hashes, events, saved bytes or complete chat fallback and every criterion verdict.
Preserve failed attempts. Original commands/exits/platform gate receipts live in the task-owned
proof manifest recorded by TASK-bb97c2aa. UbuntuWSL2 is Linux execution, not native Ubuntu or hardware
acceptance.

The [results ledger](results.json) records seven passing real-model cases and28 individually inspected
criteria. Exact prompts, original JSON event/snapshot streams (kept as `.json.txt` to preserve bytes),
system contexts, fictional source snapshots, six saved plans, final answers and the complete collision
fallback live here with SHA256 hashes. The three collision originals are preserved separately from a
new saved plan. No semantic failed attempt occurred; failed replay/gate/setup attempts remain in the
original task proof. The original model contexts report7indexed documents although6were seeded;
the harness now derives the exact count. That metadata correction changes no source, skill or
criterion, and the original contexts are retained without claiming a semantic rerun.
