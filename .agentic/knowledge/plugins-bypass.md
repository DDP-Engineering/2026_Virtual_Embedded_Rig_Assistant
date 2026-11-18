# Plugin bypass input policy

## Routing

Select for paths outside the workbench in plugin work: run_program file arguments and cwd in Bypass,
agent plugin draft sources, HIL plan inputs and the captured Bypass epoch.
[Plugin program tools and approvals](plugins-program-tools.md) owns the run_program request and its file
binding inside the workbench; [Plugin bench resources, leases and HIL plans](plugins-bench-resources.md)
owns HIL plans and the resource registry; [Plugin builder and authoring](plugins-builder.md) owns draft
validation and trial installs. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

This page holds the path-admission rules for plugin inputs outside the workbench: run_program arguments and cwd, agent plugin draft sources and HIL inputs.

## Invariants

Ordinary `run_program` calls use `toolPathGuard`; only Bypass accepts outside cwd and binds existing outside file arguments. Read-only/Ask/Auto-edit refuse recognized existing outside files and directories, including aliases. File bindings/cwd are canonical absolute paths outside and workbench-relative inside; outside directory arguments have separate unhashed `directories` metadata while raw argv stays exact. Directory aliases are re-resolved at spawn and must retain the recorded path. Internal prefixes/executable loading keep host authority. `verifyProgramFiles` rechecks path scope and application-data exclusions for every original argument, including initially unbound paths, without hashing or binding HIL-generated files; it re-resolves each approved original argument (detecting alias target changes), rehashes bytes and refuses CONFLICT before spawn. ApplicationDataAccessError never becomes an ordinary argument. Runner record I/O precedes final checks, cwd identity/type and current authorization are checked again at spawn. Bypass epochs are captured before asynchronous preparation and apply admission, retained through background lifetime without the turn signal, and never replaced by re-entering Bypass. Registry rechecks retain the captured tool guard, canonical identity and host exclusions; outside access requires the original Bypass epoch. Logs/records remain `.vera/runs`. HIL plans/compiled calls and resource registries use the shared guard; generated request/result storage stays confined. This path admission is not a sandbox for arbitrary child-process behavior. Focused boundary tests: `program-bypass.test.ts`; session lifetime/export: `sessions/programs.test.ts`; native sibling Git repositories: `tests/e2e/program-bypass.spec.ts`.

Agent plugin draft sources use captured toolPathGuard authority; outside absolute sources require Bypass, while internal stores retain their host authority and installation still requires explicit review. HIL calls and their compiled plan, firmware, source files and resource registry use the same guard through preparation, apply and pre-spawn checks. Registry provenance is canonical absolute for outside aliases and is rehashed through that authority. The original Bypass epoch survives normal turn completion and cancels background HIL holds and child runs on downgrade, even after re-entry. Generated requests and result/log storage remain workbench-owned; generated files acquire no extra approval bindings. Focused input/authoring/HIL tests and CLI sibling analysis cover these seams.

HIL input cwd supplies relative plan/firmware/source/resource lookups. Child cwd and generated output remain workbench-owned. Canonical source parameters prevent raw-alias retargeting; lab-validation 0.3.0 consumes host-only captured scope/exclusions for its source/member reads, with standalone calls still confined. Real Python integration is tests/integration/hil-bypass.test.ts.
