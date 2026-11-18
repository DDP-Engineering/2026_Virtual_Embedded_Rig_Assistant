# Plugins

## Routing

Select for the plugin system of the product: plugin.yaml, the plugin store, the catalog, provisioning,
the program runner, rules and approvals, the plugin builder and the Plugins page. This page is the index:
each topic has its own page, chosen below by topic or by source path.
[Official plugins](official-plugins.md) owns the shipped plugin packages in `05_Software/plugins/` (one
folder per plugin) and that folder's catalog source files (`packs.yaml`, `catalog.yaml`).
[Native packaging](native-packaging.md) owns `prepare:uv` and the `<resources>/uv/` payload;
[Headless CLI](headless-cli.md) owns the `vera plugin install` command. [Workbench](workbench.md) owns
workbench.yaml, its write queue and warnings; [Skills](skills.md) owns Agent Skills discovery, plugin
skills included; [IPC boundary](ipc-boundary.md) owns channel registration and frame authorization;
[Sessions](sessions.md) owns the ApprovalGate lifecycle, and [Chat UI](chat-ui.md) and
[Renderer foundation](renderer-foundation.md) own the approval card and the permission picker that show
program approvals and the bypass warning.

| Topic | Page |
|---|---|
| plugin.yaml validation, manifest fields and limits, rule matching, risk levels, the mode matrix, trial plugins, the confirmation word | [Plugin manifest and rules](plugins-manifest-rules.md) |
| The installed plugin store under `<userData>/plugins`, workbench-scoped packages under `.vera/plugins`, machine-local hash trust, install.json, the integrity hash ("changed since review"), install from a folder or zip, uninstall, plugin listing issues, `plugins.enabled` in workbench.yaml, the `plugins.*` IPC channels | [Plugin store, trust and integrity](plugins-store.md) |
| The plugin catalog: check and release build, channel indexes and signatures, index read with the bundled fallback, verified zip downloads, the review decision, installs with the catalog tier, update marks, `plugins.catalog*` IPC, the catalog URL setting, the 24 h checks (spec `.agentic/specs/REQ-DATA-b40d3f9b.md`) | [Plugin catalog, channels and signing](plugins-catalog.md) |
| Provisioning: the bundled uv, install kinds pip/script/download/find (including find with a pinned download fallback), the runtime folder, version probes and supported ranges, program statuses, `plugins.programs`/`plugins.provision`, `vera plugin install`, the package index/proxy settings, the offline dependency kit | [Plugin provisioning and dependency kits](plugins-provisioning.md) |
| Running plugin programs: the `ProcessHost` port, `ProgramRunner`, run logs and run records in `.vera/runs/`, timeouts, Stop and process-tree kills, background runs, the serial-port guard, launcher quoting | [Plugin program runner](plugins-runner.md) |
| Bench resources (`lab/resources.json`, identity keys, leases, supervised cleanup, spec `.agentic/specs/REQ-DATA-f2cbfc23.md`) and HIL plans (program field `plan: hil`, spec `.agentic/specs/REQ-DATA-5f714098.md`) | [Plugin bench resources, leases and HIL plans](plugins-bench-resources.md) |
| The agent's program tools run_program/program_output/program_stop, the ProgramHost and executable resolver seam, the `<programs>` prompt entries, the timeout cap, run_program approval requests, typed confirmation, the irreversible rules listed by the bypass warning, run_command | [Plugin program tools and approvals](plugins-program-tools.md) |
| Declared parameters (`settings`), the plugin page's Configuration section and Needs configuration, plugin credentials, the SSH agent socket | [Plugin configuration and credentials](plugins-configuration.md) |
| plugin_validate, plugin_install, trial installs from a draft, promotion and export | [Plugin builder and authoring](plugins-builder.md) |
| The desktop UI: the Plugins page (pickers, review screen, install bound to the reviewed hash, library, packs, status block, workbench draft selection, program installs, uninstall) and the right panel's Runs tab (`runs.*`) | [Plugins page and Runs tab](plugins-ui.md) |
| Paths outside the workbench in Bypass: run_program arguments and cwd, plugin draft sources, HIL inputs | [Plugin bypass input policy](plugins-bypass.md) |

| Source path | Page |
|---|---|
| `05_Software/src/libraries/shared/src/plugins.ts` (schema), `05_Software/src/libraries/shared/src/program-rules.ts` (matcher and policy), shared `git-options.ts`, `stm32-options.ts`, `pymcuprog-options.ts`, `tshark-options.ts` | [Plugin manifest and rules](plugins-manifest-rules.md) |
| `05_Software/src/libraries/core/src/plugins/store.ts` (store), shared `workbench.ts` (`plugins.enabled`), core `workbench/service.ts` (`togglePlugin`, `loadPlugins`), desktop `main/index.ts` (`plugins.*` handlers), `plugin-list-worker`, `main/provisioner-hosts.ts`, renderer `mocks/mockApi.ts` | [Plugin store, trust and integrity](plugins-store.md) |
| `05_Software/src/libraries/core/src/plugins/catalog.ts` (catalog client), `catalog-source.ts` (catalog check and build), shared `plugin-catalog.ts` (formats), CLI `catalog.ts`, desktop `main/catalog-checks.ts`, `02_Tools/release/catalog-signing-key.pub.pem`, `02_Tools/release/catalog-release.md` | [Plugin catalog, channels and signing](plugins-catalog.md) |
| `05_Software/src/libraries/core/src/plugins/provisioning.ts` (provisioning, with `archive.ts`), core `dependency-kit.ts`, CLI `plugin.ts`, `provisioning.ts`, `kit-tools.ts`, `05_Software/src/uv/uv-manifest.json`, `05_Software/tests/integration/provisioning.test.ts` | [Plugin provisioning and dependency kits](plugins-provisioning.md) |
| `05_Software/src/libraries/core/src/plugins/runner.ts` (runner), core `ports.ts`, `node-process-host.ts`, `process-tree.ts`, `run-output.ts`, `launcher.ts`, desktop `main/process-host.ts`, CLI `process-host.ts`, `05_Software/tests/integration/process-hosts.test.ts` | [Plugin program runner](plugins-runner.md) |
| Shared `lab-resources.ts`, `hil-plan.ts`, core `leases.ts`, `resource-registry.ts`, `plugins/hil/` (`adapters.ts`, `compile.ts`, `executor.ts`, `run.ts`) | [Plugin bench resources, leases and HIL plans](plugins-bench-resources.md) |
| `05_Software/src/libraries/core/src/plugins/program-request.ts` (approval requests), `05_Software/src/libraries/core/src/plugins/program-tools.ts` (agent tools), core `plugins/command-tools.ts`, `shell.ts`, `core/src/agent/approvals.ts`, `core/src/agent/program-approvals.test.ts`, desktop `main/program-resolver.ts`, renderer `approval-card.tsx`, `permission-picker.tsx` | [Plugin program tools and approvals](plugins-program-tools.md) |
| Shared `plugin-settings.ts`, `plugin-credentials.ts`, core `plugins/configuration.ts`, desktop `main/plugin-credentials.ts`, renderer `plugin-configuration.tsx`, `plugin-credentials.tsx`, CLI `plugin-credentials-env.ts` | [Plugin configuration and credentials](plugins-configuration.md) |
| Core `plugins/authoring.test.ts`, `tests/integration/plugin-builder.test.ts`, `tests/e2e/plugin-builder.spec.ts` | [Plugin builder and authoring](plugins-builder.md) |
| `05_Software/src/apps/desktop/src/renderer/components/plugins.tsx` and `runs-tab.tsx` (UI), renderer `plugin-catalog.tsx` (source settings and catalog rows), `plugin-contents.tsx`, `plugin-library.ts`, `plugin-library-controls.tsx`, `plugin-dependencies.tsx`, `plugin-status.tsx`, `plugin-packs.tsx`, `workbench-plugins.tsx`, desktop main `RunPresentation` | [Plugins page and Runs tab](plugins-ui.md) |
| `program-bypass.test.ts`, `tests/e2e/program-bypass.spec.ts`, `tests/integration/hil-bypass.test.ts` | [Plugin bypass input policy](plugins-bypass.md) |

## Purpose and boundaries

A plugin is a package: a format-1 `plugin.yaml` (programs, rules, declared parameters) with optional
skills, help pages and data files. The global store at `<userData>/plugins` and workbench-scoped packages
under `.vera/plugins` hold reviewed packages, and each workbench opts in through `plugins.enabled` in its
`.vera/workbench.yaml`. The Provisioner installs or locates declared programs on the user's action; the
plugin's rules classify each command line; the ApprovalGate decides the run_program request; the
ProgramRunner runs the program through the `ProcessHost` port and keeps its log and record in
`.vera/runs/`. The catalog client reads signed channel indexes with the bundled release as fallback, and
the Plugins page presents the library, installs, configuration and runs. Each page above states its own
interface, invariants, requirement ids and files.
