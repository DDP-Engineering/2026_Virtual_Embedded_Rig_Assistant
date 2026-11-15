# TASK-a793c9bd - PLG-08 #269 kit build skips named plugins

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-DATA-532b02f5
parent:
branch: feature/261-plugin-management
base: ac6401e284a9d184732ed20180d18fa04447242e
opened: 2026-11-15

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: The full kit build fails on sigrok, whose pinned download is not available from this computer (its package
is unpublished and the URL is https on a plain-http LAN host), so no kit can be built (OBSERVED TASK-3b46b9a6 Log;
STATED user: "skip sigrok - is not on this computer. Build the rest.").
Desired outcome: `vera catalog kit ... --skip <id>[,<id>...]` builds the kit without the named official plugins;
`kit.json` lists them under `skipped` and the README names them as not in the kit (STATED user; INFERRED that a bench
user must see what is missing).
Actors: the release maintainer.
Primary scenario: `--skip sigrok` builds both platform kits; the README says sigrok is not in the kit.
Examples: `--skip sigrok` gives `"skipped": ["sigrok"]`. Counterexample: `--skip missing-id` is refused (exit 1,
names the id), so a typo cannot silently build a full-looking kit (INFERRED).
In scope: CLI argument, core option, kit.json/README field, spec and requirement REQ-DATA-532b02f5, docs.
Out of scope: changing the sigrok manifest (STATED: skip it).
Constraints: as TASK-3b46b9a6; pre-release, kit.json stays format 1 (STATED rule).
Success signals: the full windows and linux kits build with sigrok skipped.
Evidence: OBSERVED `dependency-kit.ts` plan(), `args.ts` catalogCommand.
Assumptions: none. Unknowns: none.
Decision-blocking questions: none.
Proposed behaviors: as Desired outcome (accepted by the user's instruction).
Path and reason: full (a new CLI option and a kit.json field), kept short.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new option |
| no new interface or data format | no | `skipped` field |
| no new dependency | yes | none |
| an existing requirement already covers the behavior | no | REQ-DATA-532b02f5 revised |
| no security or data-handling change | yes | build-side only |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| `--skip` leaves named official plugins out and lists them; an unknown id is refused | REQ-DATA-532b02f5 (revised) |

## Design

Skipped: one option threaded from `args.ts` through `runCatalog` to `buildDependencyKit(..., {skip})`; plan() drops the ids before planning, refuses ids that are not official plugins of the source, and the writer adds `skipped` to kit.json and a README line. No new seam.

## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify - user instruction (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: skipped; next build - one option through existing seams; the spec says how
- 2026-11-15 build: red: vitest dependency-kit.test.ts catalog-args.test.ts exit 1 - no skip option (REQ-DATA-532b02f5)
- 2026-11-15 build: green: vitest dependency-kit.test.ts catalog-args.test.ts exit 0 (8 passed); typecheck exit 0; biome exit 0 (REQ-DATA-532b02f5)
- 2026-11-15 build: scope: full offline bench run found uv in offline mode never downloads CPython implicitly (No interpreter found for Python 3.13); REQ-FUNC-41582b95 fix taken into this task: with a kit, run uv python install before pip/script installs. red: vitest provisioning.test.ts -t 'dependency kit' exit 1 (2 tests)
- 2026-11-15 build: green: vitest provisioning.test.ts exit 0 (54 passed); core plugins+shared+cli exit 0; typecheck, biome exit 0 (REQ-DATA-532b02f5, REQ-FUNC-41582b95)
- 2026-11-15 build: manual: full kits with the real CLI, --skip sigrok: windows-x64 (npm run vera on Windows) 9 downloads, 106 wheels, python, 1178.0 MiB, 3m32s; linux-x64 (node CLI dist in WSL2 Ubuntu 24.04, Node 24.18.0 installed user-local from nodejs.org with SHASUMS256 check, pinned uv linux) 8 downloads, 97 wheels incl. uptime cp313-linux_x86_64, python, 1095.5 MiB, 122 s. Offline benches (fetch throws, UV_OFFLINE, dead proxy, no CPython seed): windows 17 download + 30 script + 5 pip ready, 142 s; WSL2 16 download + 29 script + 5 pip ready, 49 s; ngspice on linux is unavailable/platform (windows-only download, apt find program, listed as vendor in the kit README). A first windows bench from a 150-character scratch folder failed xPack/java probes with ENOENT (Windows path length), not the kit
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: DEVIATION validate: one reviewer gave both verdicts on the small delta and read code only, not the requirement files or tests - the delta is two options through reviewed seams; nits accepted (python install runs before each pip/script install in kit mode, idempotent; empty --skip entries rejected by pluginIdSchema; core error text names --skip)
- 2026-11-15 validate: final: aegis check --task TASK-a793c9bd --strict --run exit 0; lint, typecheck, i18n ok; errors=0; 59 advisory warnings repo-wide (pre-existing plus uncovered-source on test files)
- 2026-11-15 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a793c9bd.md
changed: --skip option (args, catalog, dependency-kit), uv python install before pip/script installs in kit mode (provisioning), tests, REQ-DATA-532b02f5 + spec, REQ-FUNC-41582b95, docs and plan
evidence: strict check exit 0; vitest core plugins+shared+cli 576 passed; full kits windows 1178.0 MiB and linux 1095.5 MiB built with --skip sigrok; offline benches 52 (Windows) and 50 (WSL2) managed programs ready with no network
issues: sigrok not in the kits (package unpublished); native Ubuntu not run (WSL2 only); ngspice on Linux reports download/platform (pre-existing status for a windows-only download)
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-15)

- stage: validate; type: change; path: full; branch: feature/261-plugin-management
- requirements:
  - REQ-DATA-532b02f5 - Build an offline dependency kit per platform
- deviations: 1 recorded
  - validate: one reviewer gave both verdicts on the small delta and read code only, not the requirement files or tests - the delta is two options through reviewed seams; nits accepted (python install runs before each pip/script install in kit mode, idempotent; empty --skip entries rejected by pluginIdSchema; core error text names --skip)
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base ac6401e: 29 file(s) changed, 1705 line(s) added
- checks: errors=0 warnings=59 notes=28
- checklist: 9/9 done
