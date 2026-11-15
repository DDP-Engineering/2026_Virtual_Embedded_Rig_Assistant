# TASK-3b46b9a6 - PLG-08 #269 Offline dependency kit per platform

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-532b02f5, REQ-REL-7d6dc443, REQ-FUNC-b1afbd8c, REQ-SEC-51f93776, REQ-FUNC-41582b95, REQ-DATA-6cd3e1ec
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

Problem: An offline bench cannot make plugin programs ready: pip and script programs resolve from PyPI through the
bundled uv (which also downloads its managed CPython 3.13), and download programs fetch their pinned URL one by one;
the only offline route today is "Install from dependency archive", one picked file per download program, with no
route at all for pip/script programs (STATED ticket PLG-08 #269; OBSERVED core `provisioning.ts` `installOne`,
`installArchive`, `uvEnvironment`).
Desired outcome: `vera catalog kit --source <dir> --platform <windows-x64|linux-x64> --out <dir>` builds, next to the
catalog release in `07_Delivery/` (`kit-windows-x64/`, `kit-linux-x64/`), a kit of the official plugins'
download files (exactly as the manifests pin them by SHA-256), the wheels of their pip and script programs, the
CPython archive the pinned uv installs, an index `kit.json` and a `README.md` that lists the vendor (find) programs
with their official download pages and the kit size. A bench sets the plugin setting `kit` to the kit folder; Install
dependencies (and the CLI install) then take download files from the kit through the same verify-and-unpack path as
"Install from dependency archive", and uv resolves only from the kit's wheels and Python (STATED ticket deliverables;
coordinator: "extend, don't build a second install path").
Actors: the release maintainer (builds the kits with network); the bench user (copies a kit, sets `kit`, installs
without network).
Primary scenario: the maintainer runs the kit build for both platforms; the bench user copies `kit-windows-x64` to
`D:era-kit`, sets `"plugins": {"kit": "D:era-kit"}` in settings.json, installs a plugin and clicks Install
dependencies; every pip, script and download program reports ready with no network.
Examples: arduino-cli's pinned `arduino-cli_1.6.0_Windows_64bit.zip` (20404890 bytes, PLG-04 hand-back) is
`files/<sha256>/arduino-cli_1.6.0_Windows_64bit.zip` in the windows kit; `cantools>=45,<46` resolves to wheels in
`wheels/`. A kit file changed after the build is refused with problem `sha256` and a detail naming the file.
Counterexamples: KiCad, LTspice or other find-only programs are never in the kit, only in its README with their guide
link (STATED). A kit file never overrides a manifest hash; a missing kit file falls back to the pinned URL.
In scope: core kit planner/writer, CLI `vera catalog kit`, plugin setting `kit` (shared settings schema), provisioner
use of the kit (downloads, uv variables), docs in `02_Tools/release/catalog-release.md` and `07_Delivery/README.md`,
knowledge page and spec updates.
Out of scope: a settings UI field (index and proxy have none either, INFERRED precedent: OBSERVED no renderer field
for `plugins.index`/`proxy`); bundling vendor programs (STATED); publishing kits; hash-pinning wheels in manifests
(uv lock files per script: a manifest/package change across ~30 plugins, coordinator "keep it simple").
Constraints: pre-release, no compatibility code, `format: 1` (STATED). Windows and Linux. No new dependency.
Downloads during this task: PyPI and the pinned arduino-cli only (STATED coordinator); the full kit build waits for
the user's go-ahead. No commit, no push.
Success signals: PLG-08-A offline readiness of pip, script and download programs from a kit; PLG-08-B a tampered kit
file is refused and named, a failed build leaves no kit; PLG-08-C reproducible from the manifests, size per platform
reported; PLG-08-D Windows and native Ubuntu (native Ubuntu UNKNOWN: no machine).
Evidence: OBSERVED pinned uv 0.13.7 (PyPI wheel binaries match `uv-manifest.json` binarySha256 for both platforms):
`uv pip compile <script.py> --python-platform x86_64-unknown-linux-gnu` resolves PEP 723 deps with target markers;
pip 26.1.2 `download --platform ... --require-hashes` fetches the target wheels; `uv tool install "cantools>=45,<46"`
with `UV_NO_INDEX=1`, `UV_FIND_LINKS=<wheels>` installed offline; `UV_PYTHON_INSTALL_MIRROR=file:///...` reads
`<mirror>/<tag>/<file>` and refuses a wrong archive with uv's built-in SHA-256 (scratch runs, 2026-11-15).
Assumptions: benches have glibc >= 2.28 (linux kit takes manylinux_2_28 and older wheels) (INFERRED: Ubuntu 22.04+).
Unknowns: whether every official requirement has a wheel for both platforms (an sdist-only one fails the build);
full kit size (manifest `bytes` give the downloads part).
Decision-blocking questions: none (coordinator delegated the pip trust choice: "decide the simplest trustworthy
approach ... and record it (no new trust root)").
Proposed behaviors (decided under the coordinator's delegation, recorded as rulings): download files are trusted by
the manifest SHA-256 only; CPython by the SHA-256 built into the pinned uv; wheels carry no manifest hash, so the
kit's wheel folder takes the role of the package index the user already chooses with `plugins.index` (the same trust
as online PyPI installs), and pip download checks each wheel against PyPI's hashes at build time.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new CLI command and setting |
| no new interface or data format | no | `kit.json`, kit layout, `plugins.kit` |
| no new dependency | yes | uv and pip are already the toolchain; no npm package |
| an existing requirement already covers the behavior | no | new |
| no security or data-handling change | no | new local source of install bytes |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| `vera catalog kit` writes the kit layout, index, README (vendor list, size) and prints the size | REQ-DATA-532b02f5 (spec) |
| a failed fetch, hash, wheel or non-empty output leaves no kit and names the failure | REQ-REL-7d6dc443 |
| with `kit` set, download programs install from the kit file through the archive verify path; URL when absent | REQ-FUNC-b1afbd8c |
| a tampered kit file is refused with `sha256`, named, nothing installed, no fallback | REQ-SEC-51f93776 |
| with `kit` set, uv resolves wheels and CPython only from the kit | REQ-FUNC-41582b95 |
| `plugins.kit` accepts an absolute local folder only | REQ-DATA-6cd3e1ec |

## Design

**Approach.** The build and the bench are two halves of one folder contract (spec REQ-DATA-532b02f5). Build: a new
core module `plugins/dependency-kit.ts` plans the kit from the catalog source (shared `readCatalogSource` over
`examineSource`). It then writes it through injected tools (fetch, wheel resolution, CPython URL) into a staging
sibling that is renamed only at the end (REQ-REL-7d6dc443). The CLI `vera catalog kit` supplies those tools with the
pinned uv (`cliUv`), `uv pip compile --python-platform`, and pip 26.1.2 via `uv tool run` (`apps/cli/src/kit-tools.ts`).
Bench: no new install path. The provisioner's existing `download(entry, ..., localPath)`, the code behind "Install
from dependency archive", receives `<kit>/files/<sha256>/<name>` when the setting `kit` is set and the file exists
(REQ-FUNC-b1afbd8c, REQ-SEC-51f93776). `uvEnvironment` adds the kit's find-links, no-index and Python mirror
(REQ-FUNC-41582b95). Rejected: a kit-wide "install kit" action or a bench reader of kit.json (a second install path,
and the kit would become a trust source); pip download's own marker evaluation (it uses the host's markers, so a
Windows build would get Linux kits wrong).
**Interfaces and data.** `dependencyKitFile(entry)` → `files/<sha256>/<name>` is shared by the writer and the
provisioner. `buildDependencyKit(source, platform, out, tools)` → `{issues}` | `{kit}`; it throws
`DependencyKitError` naming the program or file. `tools.wheels(platform, {requirement}|{script}, folder)` and
`tools.python(platform)` → `{url}`. Setting `plugins.kit` is an absolute local folder (REQ-DATA-6cd3e1ec). A kit
mismatch keeps the existing problem code `sha256`, with a detail naming the file. A missing kit file falls back to
the URL. Re-install with a kit swaps the verified tree in: `download` skips its "already extracted" shortcut when
`replace` is set.
**Files and test seams.** core `dependency-kit.ts` (+ test: fixture source, fake tools, a local fetch);
`catalog-source.ts` (export reader); `provisioning.ts` (+ tests in `provisioning.test.ts`); shared `settings.ts`
(+ test); CLI `args.ts`, `catalog.ts`, `kit-tools.ts` (+ args test); docs `02_Tools/release/catalog-release.md`,
`07_Delivery/README.md`, the plugins knowledge page, spec REQ-FUNC-714e26bc's uv table.
**Risks.** Wheels are trusted like the configured index (RULING-001). An sdist-only requirement fails the build
(it names the program). Linux wheels are manylinux_2_28 or older, so the bench needs glibc 2.28 or newer.
**Requirement map.** REQ-DATA-532b02f5: the planner and writer, plus the CLI print. REQ-REL-7d6dc443: staging and
rename, cleanup in `finally`, and a non-empty `--out` refused first. REQ-FUNC-b1afbd8c and REQ-SEC-51f93776:
`installOne` passes the kit path to `download` and turns `sha256` into a named detail. REQ-FUNC-41582b95:
`uvEnvironment`. REQ-DATA-6cd3e1ec: `pluginSettingsSchema.kit`.


## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: DEVIATION design: no diagrams - one folder contract and two small seams, the spec carries the layout
- 2026-11-15 build: red: vitest provisioning.test.ts -t 'dependency kit' exit 1 - kit file not used, tampered kit file not refused, uv kit variables absent (REQ-FUNC-b1afbd8c, REQ-SEC-51f93776, REQ-FUNC-41582b95)
- 2026-11-15 build: red: vitest plugins-ipc.test.ts -t 'dependency kit' exit 1 - settings schema has no kit field (REQ-DATA-6cd3e1ec)
- 2026-11-15 build: red: vitest dependency-kit.test.ts exit 1 - buildDependencyKit missing (REQ-DATA-532b02f5, REQ-REL-7d6dc443)
- 2026-11-15 build: green: vitest provisioning.test.ts plugins-ipc.test.ts dependency-kit.test.ts catalog-args.test.ts exit 0 (all six requirements); typecheck exit 0; biome check on touched files exit 0. catalog-args.test.ts was written before args.ts changed but not run red first
- 2026-11-15 build: discovery: real partial build - uptime 3.0.1 (can-python) is sdist-only with an optional C extension; kit-tools now builds sdists into wheels at kit build (pure on any host, compiled only on the kit platform). pip --platform manylinux_2_28 matches that tag only; the linux kit passes the manylinux ladder 2_28..1. Both failures exited 1 naming the program and left no kit (REQ-REL-7d6dc443 observed for real)
- 2026-11-15 build: discovery: uv 0.13.7 has no UV_NO_INDEX variable (ignored silently); the offline bench run reached pypi.org through the dead proxy for 16 script and 5 pip programs. Changed to UV_OFFLINE=1 (no network at all; local find-links and the file:// Python mirror still apply, verified with the pinned uv). REQ-FUNC-41582b95 prose updated accordingly
- 2026-11-15 build: manual (REQ-FUNC-41582b95, PLG-08-A/B/C): real partial windows kit (30 official plugins without non-PyPI downloads other than arduino-cli; CPython placeholder) built in 150 s, 105.1 MiB; offline bench (fetch throws, uv offline behind dead proxy, CPython 3.13.14 seeded) made 26 script, 5 pip and 1 download program ready in 78 s, fetches []; one byte appended to the kit's arduino-cli zip gave missing/sha256 naming the file, no download folder, no record; two rebuilds with SOURCE_DATE_EPOCH gave identical kit.json; linux partial kit (can-python excluded) built cross-platform, 98.6 MiB, no win wheels. Linux bench install not run (no CPython 3.13 linux or node in WSL; downloads not approved)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 1: spec changes_required - catalog-release.md JSON example D:\vera-kit lost its escape; RULING-002 names UV_NO_INDEX. quality approved, nits accepted as limits: dangling kit symlink falls back to URL (hash still enforced), kit README does not say downloads without a kit file use the URL, wheels hashed with readFile, no test for a linked or oversized kit file
- 2026-11-15 validate: returned to build - review round 1 spec findings: doc JSON escape, superseding ruling for UV_OFFLINE
- 2026-11-15 build: green: round-1 fixes are docs/journal only (catalog-release.md example, RULING-003 supersedes RULING-002); no source change, focused proof unchanged
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: final: aegis check --task TASK-3b46b9a6 --strict --run exit 0; lint, typecheck, i18n ok, strict ok, errors=0; 57 advisory warnings pre-existing repo-wide except uncovered-source on dependency-kit.test.ts (a test file classified as source, advisory). Pre-existing out of scope: cli.test.ts 9-plugin count
- 2026-11-15 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-15 | decision=Wheels and CPython carry no manifest hash: download files are trusted by the manifest SHA-256 (verified on the bench, a mismatch is refused and named); CPython by the SHA-256 built into the pinned uv; the kit's wheel folder takes the role of the package index the user already sets with plugins.index (same trust as online PyPI), with pip --require-hashes against PyPI's hashes at build time. Hash-pinned wheels (uv lock files) are a follow-up. | reason=coordinator delegated the simplest trustworthy approach with no new trust root; manifests pin pip ranges and script versions without hashes | source=user | supersedes=none
- RULING-002 | date=2026-11-15 | decision=The bench points VERA at a kit with the plugin setting kit (absolute folder, settings.json, no UI field); provisioning reads files/<sha256>/<name> through the existing download(localPath) verify-and-unpack path and gives uv UV_NO_INDEX, UV_FIND_LINKS and UV_PYTHON_INSTALL_MIRROR; Install from dependency archive keeps working with kit files. | reason=pip/script programs have no archive route; one setting extends the existing path instead of a second install path; index/proxy have no UI either | source=user | supersedes=none
- RULING-003 | date=2026-11-15 | decision=The bench points VERA at a kit with the plugin setting kit (absolute folder, settings.json, no UI field); provisioning reads files/<sha256>/<name> through the existing download(localPath) verify-and-unpack path and gives uv UV_OFFLINE=1, UV_FIND_LINKS and UV_PYTHON_INSTALL_MIRROR (uv 0.13.7 has no UV_NO_INDEX variable); Install from dependency archive keeps working with kit files. | reason=real offline bench run: UV_NO_INDEX was ignored and uv reached pypi.org; UV_OFFLINE keeps local find-links and the file:// Python mirror, verified with the pinned uv | source=user | supersedes=RULING-002


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-3b46b9a6.md
changed: core dependency-kit.ts (+test), provisioning.ts kit file path and uv kit variables (+tests), catalog-source readCatalogSource, shared settings plugins.kit (+test), CLI catalog kit, kit-tools.ts, args/catalog/index, docs catalog-release.md, 07_Delivery/README.md, .gitignore, knowledge plugins.md, spec REQ-FUNC-714e26bc, environment.md, plan plugin-management.md; 6 requirements + spec
evidence: aegis check --strict --run exit 0 (lint, typecheck, i18n); vitest 4 targeted files 66 passed; core plugins+shared+cli 574 passed; real partial windows kit 105.1 MiB built, offline bench 32 managed programs ready with no network, tampered kit file refused and named, two rebuilds identical kit.json; linux partial kit 98.6 MiB; review round 2 both approved
issues: full kit build waits for user go-ahead (GitHub/xPack/SourceForge/CPython downloads); sigrok download URL is https on a plain-http LAN host with no bytes, so the full build fails until its package is published or sigrok is left out; Linux bench install and native Ubuntu not run; can-python needs the linux kit built on Linux; wheels trusted like the configured index (RULING-001); review nits accepted
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: feature/261-plugin-management
- requirements:
  - REQ-DATA-532b02f5 - Build an offline dependency kit per platform
  - REQ-REL-7d6dc443 - Publish no partial dependency kit
  - REQ-FUNC-b1afbd8c - Install download programs from the dependency kit
  - REQ-SEC-51f93776 - Refuse a kit file that does not match its manifest hash
  - REQ-FUNC-41582b95 - Point uv at the dependency kit
  - REQ-DATA-6cd3e1ec - Plugin setting kit folder
- deviations: 1 recorded
  - design: no diagrams - one folder contract and two small seams, the spec carries the layout
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base ac6401e: 28 file(s) changed, 1476 line(s) added
- checks: errors=0 warnings=57 notes=27
- checklist: 8/9 done; open: `report` appended
