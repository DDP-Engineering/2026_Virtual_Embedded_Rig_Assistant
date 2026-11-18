# Plugin builder and authoring

## Routing

Select for the agent's authoring tools plugin_validate and plugin_install, trial plugins installed from a
workbench draft, and the user-only `plugins.promote` and `plugins.export`.
[Plugin store, trust and integrity](plugins-store.md) owns the store and install.json;
[Plugin manifest and rules](plugins-manifest-rules.md) owns the schema and the trial policy;
[Plugin bypass input policy](plugins-bypass.md) owns draft sources outside the workbench;
[Skills](skills.md) owns the built-in create-plugin skill. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

`plugin_validate {path}` reads a confined workbench draft folder and returns schema errors plus warnings
for dangerous tokens in safe/device-read rules, programs without rules, and find without hint.
`plugin_install {path}` is a program-class prepared tool. Its inline review shows the complete manifest;
ApprovalGate always waits for a user decision, including bypass, and refuses read-only. The exact
request binds the draft path, manifest and integrity hash. The store installs only matching bytes as
trial, does not enable or provision, and permits the agent to replace only another trial.

`plugins.promote {id,sha256}` is a user-only IPC action bound to a healthy trial's displayed hash;
it atomically changes install.json tier to local. The Plugins button asks the user to confirm trust.
`plugins.export {id,sha256}` verifies a healthy package and saves a zip through the native save picker,
without install.json or runtime files; its size is not limited. Promotion and export invalidate/reload the relevant UI state.
The agent has no promotion, enablement or session-mode tools. Its file tools refuse workbench.yaml,
managed application data and multiply linked write targets even in bypass. Trials retain the existing
per-command override and irreversible typed confirmation in every writable mode. The official
create-plugin skill is built into SkillCatalog; CONTRIBUTING.md explains draft/trial/sharing.

## Files

Focused proof: core plugins/authoring.test.ts, agent/program-approvals.test.ts, tools/write-edit.test.ts,
renderer plugins.test.ts, tests/integration/plugin-builder.test.ts and tests/e2e/plugin-builder.spec.ts.
