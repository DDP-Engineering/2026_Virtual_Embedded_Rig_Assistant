# Tooling, tests and evaluators — repository reorganization

Date: 2026-11-12. Work package: **REPO-01**.
Status: **implemented 2026-11-12** at the user's explicit request, directly (repository/tool layout
work, no AEGIS task). The [implemented map](#implemented-source-to-target-map) records every move.
Tracking: [Gitea #110 — REPO-01 Separate environment tooling, tests, E2E and evaluators](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/110).

## Purpose and agreed boundaries

Separate environment/build/release tooling from product tests and evaluators. The software root
remains `05_Software/`; `04_HardwareDocu/` retains its existing hardware-documentation role.
This is a structural reorganization, with no change to application behavior, data formats,
evaluation methods, thresholds or acceptance criteria.

- `02_Tools/`: environment setup and pinned toolchain, build tooling, release preparation and
  environment orchestration. Download caches and local runtimes also belong here.
- `05_Software/tests/`: functional checks, including integration, packaging, tooling and E2E tests,
  with their shared support code, fixtures and mocks.
- `05_Software/evaluators/`: independent harnesses that produce measurements, scores and reports.
  A harness may also enforce documented thresholds; this does not make it a unit or E2E suite.
- `05_Software/evaluation-outputs/`: generated evaluation outputs, separated by evaluator family.
- `06_SoftwareDocu/`: explanatory documentation and deliberately retained historical evidence.

Unit and component tests remain beside the code they exercise in `src/`. E2E remains a clearly
separated suite under `tests/e2e/`, with its own Playwright configuration and execution command.

## Target layout

```text
02_Tools/
  environment/                 # setup, toolchain, resource preparation, development launchers
  build/                       # compilation and build orchestration
  release/                     # packaging, update-feed tooling, release environment orchestration
  runtime/                     # ignored, locally installed toolchain
  cache/                       # ignored, reproducible environment/build/release caches
  verification-policy.md       # existing repository verification policy

05_Software/
  src/                         # product code and colocated unit/component tests
  tests/
    integration/
    packaging/
    tooling/
    e2e/
    fixtures/                  # shared test data and scenarios
    mocks/                     # shared test substitutes, only where needed
    support/                   # test utilities, runners, reporters, fixture generators
  evaluators/
    eval-performance-harness/
    eval-retrieval-harness/
    eval-embedding-comparison-harness/
    eval-firmware-comparator-harness/
    eval-test-planner-harness/
  evaluation-outputs/
    performance/
    retrieval/
    embedding-comparison/
    firmware-comparator/
    test-planner/
```

Each harness owns its entrypoint, implementation and evaluator-specific `fixtures/`, `mocks/`
and `support/` when needed. Do not create empty directories or move shared fixtures into a single
consumer. A fixture is input/scenario data; executable evaluation logic is harness/support code.
The previously agreed `eval-performance-harness` name is retained. Generated performance output
uses `evaluation-outputs/performance/`; the parent already identifies the role, so repeating
`eval-performance-outputs` there is unnecessary.

## Inventory at planning time and move boundaries

| Current location or role | Target |
|---|---|
| `02_Tools/setup.py`, `toolchain.py`, `toolchain.json`, `npmw.py` | `02_Tools/environment/`; update every caller and documented invocation |
| `05_Software/scripts/prepare-*.mjs`, development launchers | `02_Tools/environment/`, grouped by role |
| `05_Software/scripts/build-cli.mjs` and build orchestration | `02_Tools/build/` |
| Packaging, update-feed/config tooling, offline VM/Sandbox launchers and configuration | `02_Tools/release/` |
| Test-only runners/reporters, fixture generators and product assertions currently under `scripts/` | Appropriate `05_Software/tests/` suite or `tests/support/` |
| `scripts/perf-sessions.mjs` and `scripts/eval-performance-harness/` | `evaluators/eval-performance-harness/` |
| `scripts/eval-retrieval.mjs` and retrieval evaluation modules | `evaluators/eval-retrieval-harness/` |
| `scripts/compare-embeddings.mjs` | `evaluators/eval-embedding-comparison-harness/`; keep its historical-experiment status explicit |
| `scripts/firmware-comparator-rubric.mjs` and executable `tests/fixtures/firmware-comparator/` code | `evaluators/eval-firmware-comparator-harness/` |
| `scripts/test-planner-rubric.mjs` and executable `tests/fixtures/test-planner/` code | `evaluators/eval-test-planner-harness/` |

Classify mixed-purpose scripts by responsibility, rather than moving everything named `smoke` or
`probe` into one folder. Release environment launchers belong in `02_Tools/release/`; assertions
about product/package behavior belong in `05_Software/tests/packaging/` or `tests/e2e/`.
Place shared retrieval/embedding evaluation helpers once, under a clearly named evaluator support
directory if both harnesses need them. Product static checks such as i18n remain explicit checks,
not evaluators; place their executable tooling with build checks and their tests under `tests/tooling/`.

Preserve the existing renderer browser-development mock bridge unless a concrete consumer analysis
justifies moving it. Production modules must not acquire dependencies on tests or evaluators.
Product resource manifests and assets remain in their current product locations.

## Implemented source-to-target map

Paths are repository-relative; `S` = `05_Software/scripts/` before the move.

| Source | Target |
|---|---|
| `02_Tools/{setup.py,toolchain.py,toolchain.json,npmw.py}` | `02_Tools/environment/` |
| — (new) | `02_Tools/environment/software.mjs`: `05_Software` path and its pinned packages for tools outside it |
| `S/prepare-{model,uv,plugins,windows-runtime}.mjs`, `S/dev-renderer.mjs` | `02_Tools/environment/` |
| `S/build-cli.mjs`, `S/check-i18n.mjs` | `02_Tools/build/` |
| `S/{package,package-checks,update-config,update-feed,smoke-live}.mjs` | `02_Tools/release/` |
| `S/probe-windows-offline.ps1`, `S/probe-windows-sandbox.ps1`, `S/probe-linux-offline.sh`, `S/sandbox/` | `02_Tools/release/` |
| `S/{test-e2e,cleanup-e2e-output,dev-test-server,make-demo-pdfs,make-office-fixtures}.mjs` | `05_Software/tests/support/` |
| `05_Software/tests/{network-setup,network-guard}.ts` | `05_Software/tests/support/` |
| `S/smoke-{package,runtime,server,egress,report,calibration}.mjs` | `05_Software/tests/packaging/smoke/` |
| `S/probe-upgrade.mjs` | `05_Software/tests/packaging/probe-upgrade.mjs` |
| `S/perf-sessions.mjs`, `S/eval-performance-harness/{fixtures,report,runner}.mjs` | `05_Software/evaluators/eval-performance-harness/` |
| `S/retrieval/{corpus,evaluation}.mjs`, `S/retrieval/README.md` | `05_Software/evaluators/retrieval-support/` (shared by both search harnesses) |
| `S/eval-retrieval.mjs`, `S/retrieval/product-eval.mjs` | `05_Software/evaluators/eval-retrieval-harness/` |
| `S/compare-embeddings.mjs`, `S/retrieval/embedding-worker.mjs` | `05_Software/evaluators/eval-embedding-comparison-harness/` |
| `S/firmware-comparator-rubric.mjs`, `tests/fixtures/firmware-comparator/{harness,live}.ts` | `05_Software/evaluators/eval-firmware-comparator-harness/` |
| `S/test-planner-rubric.mjs`, `tests/fixtures/test-planner/{harness,live}.ts` | `05_Software/evaluators/eval-test-planner-harness/` |
| `S/README.md` | split into `02_Tools/README.md`, `05_Software/tests/README.md` and `05_Software/evaluators/README.md` |
| — (new) | `05_Software/evaluation-outputs/README.md`; the rest of that folder is ignored |

Kept in place after consumer analysis: the renderer mock bridge
(`src/apps/desktop/src/renderer/mocks/`) is selected at build time by `VITE_API=mock`, used by
`dev:renderer`, renderer tests and browser E2E, and dropped from normal builds; moving it under `tests/`
would make product source import tests. `tests/e2e/network-guard.ts` stays the E2E suite's guard (also imported by the performance runner);
`tests/e2e/settings-navigation.ts` stays E2E-local. Product manifests and assets keep their locations.

Ownership decisions taken with the move:

- npm command names and flags are unchanged; only their script paths changed. `npm run lint` and
  `format` add a second Biome pass over `02_Tools/{environment,build,release}` with the same
  configuration (VCS integration off for that pass, so the ignored `runtime/` and `cache/` stay out).
- Evaluator scratch uses owned temporary directories or `05_Software/node_modules/.cache/evaluators/<family>/`
  (retrieval default scratch, both rubric host bundles, and the embedding comparison, whose scratch must be
  a subdirectory there instead of `02_Tools/cache/wp24-TASK-fd4046b2/`). The historical cache is untouched.
- The update probe's build inputs now list `05_Software` plus `02_Tools/{environment,build,release}`.
- The packaging fingerprint and the performance harness hash name the new paths, as anticipated below.

## Outputs, temporary data and historical evidence

- New saved runs use an evaluator-specific directory under `evaluation-outputs/`, with unique run
  identities. Ignore generated runs in Git; deliberately retained evidence is selected explicitly.
- Evaluator scratch profiles, databases and intermediate builds use owned temporary directories
  or an ignored evaluator-local work area, with cleanup appropriate to the existing ownership rules.
  Do not use `02_Tools/cache/` for new evaluator runs; that cache serves environment/build/release work.
- Replace the embedding comparison's task-specific scratch-path coupling with an explicitly owned,
  bounded evaluation work area. Preserve its measurement method and do not promote it to a new gate.
- Do not sweep, audit, delete or relocate historical caches, original skill verification receipts or
  accepted reports. Existing retained reports in `06_SoftwareDocu/eval-performance-outputs/` remain
  valid historical evidence. Their recorded hashes and provenance must not be rewritten.
- The path reorganization changes the current candidate fingerprint; it does not invalidate or
  silently reattribute the original performance measurements.

## Execution and validation — one ticket

One ticket owns the mechanical moves and all affected references. Before moving files, record the
source-to-target map and identify consumers in package scripts, imports, worker URLs, TypeScript,
Vitest, Playwright, lint/coverage, build/package configuration, CI, AEGIS command configuration and
documentation. Scripts outside `05_Software/` must still resolve the pinned dependencies installed
in `05_Software/node_modules/`; do not install a second dependency tree or rely on global Node tools.

Preserve existing npm command names, flags and behavior, including `test`, `test:e2e`, `perf:sessions`
and `eval:retrieval`. Update internal paths and documented setup-wrapper paths together; obsolete
paths do not need compatibility shims. Preserve runnable fixture generation and release isolation.

Done criteria:

- [x] Tooling, tests, E2E and all five evaluator families follow the agreed ownership/layout.
- [x] Executable harness logic is removed from fixture-data folders; shared and local fixtures,
      mocks and helpers have clear consumers and names.
- [x] All imports, workers, commands, build/package inputs, CI references and documentation resolve;
      normal artifacts exclude evaluators, fixtures, generated outputs and test-only hooks.
- [x] Existing functional behavior, fixture contents, metrics, thresholds, network isolation and
      temporary-directory ownership remain unchanged except for the explicit path ownership above.
- [x] Focused tooling/runner/reporter tests, applicable static/strict checks, targeted E2E/build/package
      verification and both independent reviews pass under `02_Tools/verification-policy.md`.
- [x] Every evaluator has an entrypoint/import or preparation smoke check appropriate to its current
      interface. Live-model evaluations, downloads and full performance sweeps are not required just
      to validate moves; do not execute them or establish new baselines/gates as incidental work.
- [x] Update the architecture/software/tooling documentation after implementation, remove obsolete
      current-path references and clean only scratch data owned by this ticket.

Results 2026-11-12 (Windows): lint (both Biome passes), typecheck and i18n pass. Focused Vitest passes
for the tooling, packaging, retrieval, analysis-skills and CLI integration suites and one test per
workspace project; the E2E runner, reporter, dev-renderer and dev-test-server paths pass in targeted E2E.
`eval:retrieval` reproduces the ADR-0015 metrics; the other evaluators stop at their offline
preparation or argument guards. Packaging staging ran from the new location into scratch and its payload
contains no evaluators, fixture harnesses or outputs; `package:test` itself was not run because the
pinned uv archive is not cached locally. Both independent reviews ran and their findings are fixed.
Failures that predate this work: the CLI catalog test still expects 9 official plugins (there are 14),
and `mock.spec.ts` matches two status elements in the workbench editor. Native Ubuntu was not run.

## Related work and exclusions

Related: [PERF-01 / #91](performance-regression.md). Its current-behavior measurement is delivered;
calibration, comparison acceptance and mandatory regression gates remain deferred. This ticket
neither completes nor restarts that phase. Coordinate against measurement checkpoint `672e094`
and the separate Plugins follow-up `f24b0cf`; do not discard or absorb unrelated changes.
No application optimization, new evaluator,
general framework, data migration, schema increment or historical-cache audit is included.

Planning/ticket creation opened no AEGIS task. The user requested implementation on 2026-11-12 and
asked for it to run directly, without AEGIS; no product behavior changed.
