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
for unusable skill metadata, declared subcommand help, dangerous tokens in safe/device-read rules,
programs without rules, and find without hint. The help warning asks the author to verify the exact parser exit.
A package read from a draft folder leaves out `.git`, `__pycache__`, `.venv`, `.DS_Store` and `Thumbs.db` (`DRAFT_LEFT_OUT` in store.ts): they turn up while a plugin is written and are no part of it; `plugin_validate` lists them as `left-out` warnings. An installed plugin is still read whole, so nothing placed in its folder escapes the integrity hash. Every validation error carries a `detail` sentence (`issueDetail`). The store keeps the reason of a refusal beside its coded error object (`pluginFailureDetail`, a WeakMap, so the strict VeraError shape is unchanged) and the authoring tools turn coded refusals into errors with a message and the code (`explained`), before and after the approval; without it the model saw only a bare tool failure.

`plugin_install {path}` is a program-class prepared tool. Its inline review shows the complete manifest;
ApprovalGate always waits for a user decision, including bypass, and refuses read-only. The exact
request binds the draft path, manifest and integrity hash. The store checks before approval and again
before publication that the agent can replace the installed package. Only another trial is replaceable.
The store publishes only matching bytes as a trial. Stop cancels draft reads and staging before
publication. `enabledByInstall: false` reports that installation leaves any existing workbench selection
in effect. Provisioning remains a separate action.

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
