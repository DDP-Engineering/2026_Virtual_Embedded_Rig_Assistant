# TASK-e68d92ee - PLG-05 Provisioning and packaging

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-PLAT-c99d7918, REQ-SEC-1a151052, REQ-PLAT-1ecf3d4f, REQ-SEC-e0567486, REQ-FUNC-714e26bc, REQ-REL-e27cda96, REQ-FUNC-e7cb0626, REQ-FUNC-edbe037c, REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c, REQ-SEC-cde8b481, REQ-SEC-e51bc0d8, REQ-REL-e068dcd7, REQ-FUNC-c9dde429, REQ-UX-46085ddf, REQ-FUNC-514708b5, REQ-SEC-ba78d876, REQ-SEC-49ff111b, REQ-FUNC-5491d410, REQ-FUNC-06eaa9a5, REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060, REQ-FUNC-c44675ed, REQ-FUNC-c12941f3, REQ-SEC-0bc97768, REQ-FUNC-565e908d, REQ-NFR-a881a281, REQ-PLAT-8b3408cb, REQ-DATA-4d4471f9, REQ-FUNC-fa6222a5
parent:
branch: master
base: af4fbdf339a6a0e775e8fdad4c1238cf0b36de70
opened: 2026-11-02

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: plugins declare programs with install kinds `pip`, `script`, `download` and `find`, but nothing installs or locates them: desktop production and the CLI compose `unresolvedPrograms`, so no declared program resolves, the `<programs>` block is always empty and `run_program` can never run a real program (OBSERVED: `main/index.ts` resolver line, `cli/src/run.ts` "Provisioning (PLG-05) will resolve executables"; TASK-4f040d30 State `issues`). The package carries no `uv`, there is no runtime directory, no version probe or range check, and `install.json.programs` stays `{}` (OBSERVED: `electron-builder.yml` extraResources lists only models; `store.ts` writes `programs: {}`). The desktop recomputes the `<programs>` entries on every session IPC call (OBSERVED: `main/sessions.ts` `run()` calls `programPromptEntries` each time; STATED: brief section 2).
Desired outcome: on a user action, VERA installs a plugin's programs without touching the user's system: PyPI programs through a pinned, bundled `uv` into `<userData>/plugins/runtime/`, PEP 723 scripts through `uv`, portable binaries from SHA-256-pinned downloads, and vendor programs located on the machine with a hint when missing; each program's version is probed and checked against its supported range; the resolver hands `run_program` the real executable, so desktop and the CLI run declared programs and the prompt lists them with versions; the prompt entries are cached and refreshed on install, enable and disable (STATED: ticket #61 scope; brief sections 2 and 3).
Actors: the engineer who installs a plugin and its programs (desktop IPC now, Settings UI in PLG-06, CLI); the agent, which only runs resolved programs and can never install (STATED: architecture §5 "Only the user installs"); plugin authors declaring install kinds; the release build that bundles `uv`.
Primary scenario: the user installs plugin `esp32-esptool` (`programs.esptool.install.pip: "esptool>=5,<6"`) and asks VERA to install its programs; VERA runs the bundled `uv tool install` with every uv directory under `<userData>/plugins/runtime/`, probes `esptool version`, records `5.6.0` in `install.json`, and reports the program ready; after enabling the plugin for a workbench the prompt lists `esptool 5.6.0 (plugin esp32-esptool)` and `run_program {program: "esptool", args: ["version"]}` runs it (STATED: ticket done-when; architecture §2.1 example).
Examples: a PEP 723 script `scripts/serial.py` installs its dependencies with uv and runs through `uv run --script` (STATED); a `download` whose bytes hash differently from `sha256` is refused and nothing is kept (STATED: done-when); a `find` program absent from PATH and the globs reports missing with its `hint` (STATED: done-when); a `download` of a `.tar.xz` extracts into `runtime/downloads/<sha256>/` and runs `path`, an AppImage is stored as is and made executable with `prefix: [--cli]` (STATED: ticket scope); a found `git` 2.39 with a declared supported range `>=2.40` is unavailable with a message naming both (INFERRED from ticket "out-of-range version makes the program unavailable with a message" and git.md "≥ 2.40").
Counterexamples: the agent never installs a program and `run_program` never downloads (STATED: "Installs happen only on a user action"); VERA never runs a vendor installer, `sudo` or elevation (STATED); VERA never uses the user's own Python or writes to `~/.local/bin`, the Windows registry or the user's uv configuration (STATED: "never uses or changes the user's own Python"; OBSERVED: uv defaults write tool links to `~/.local/bin`, `uv python install` registers in the Windows registry unless told not to - uv 0.13.1 `python install --help`).
In scope: pinned uv per platform (`src/uv/uv-manifest.json`, prepare script, packaging staging and verification, extraResources); the provisioner in core implementing `ProgramResolver` for the four kinds with installs, probes, range check and statuses; `install.json.programs` written after install; manifest additions the kinds need (supported range, archive `path`, pip and find guards); package index and proxy settings; IPC channels for program status and install, CLI command to install a plugin with its programs; desktop and CLI composition replacing `unresolvedPrograms`; cached `<programs>` entries; tests with local fixtures; measured sizes in architecture §5; plan/architecture/knowledge updates.
Out of scope: the Settings Plugins UI, review screen and runs panel (PLG-06, STATED plan); catalog installs (PLG-07); launchers (PLG-10, STATED plan R-P5); a `find` + `download` fallback within one program (binutils.md, PLG-20; the schema allows exactly one kind - OBSERVED `installSchema`); offline bundles and a CPython mirror setting (architecture §11 "Offline bundles ... on request"); a linux-arm64 VERA build (STATED: "effective once VERA has a linux-arm64 build").
Constraints: master in this checkout, one commit, no push, no AI attribution, close #61 with tea (STATED: brief); LF; format versions stay 1, no compat or migration code; code wins over 00_Planning, which is updated (STATED); core never imports `child_process` (OBSERVED: biome boundary) - uv, tar and probes spawn through `ProcessHost`; no network in tests: downloads and uv use local fixtures or fakes (STATED: brief section 4); this machine is Windows x64, Linux-only branches unit-tested and the gap stated (STATED).
Success signals: the four done-when boxes of #61 - esptool (pip) and a PEP 723 script install and run on a clean machine (Windows here, Linux owed), a wrong-hash download refused, a missing find program shows its hint, sizes recorded; the CLI runs a real resolved program end to end; desktop production composes the provisioner; the prompt entries are computed once per invalidation; typecheck, lint, i18n, full vitest and the touched e2e pass.
Evidence: uv 0.13.1 is the newest release older than two weeks (OBSERVED: GitHub releases API, 0.13.1 published 2026-10-14); its archives match the published SHA-256 (`3b2661a4…` win-x64 zip, `eadd9d27…` linux-x64 tar.gz) and hold `uv.exe` 32.1 MB / `uv` 37.9 MB (OBSERVED: download in this session); with `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, `UV_TOOL_DIR`, `UV_TOOL_BIN_DIR` under a scratch runtime and only-managed Python, `uv tool install "esptool>=5,<6"` failed because uv picked CPython 3.15.0, for which pyyaml has no wheel; with `UV_PYTHON=3.13` it installed esptool 5.6.0 (`esptool.exe version` -> `esptool v5.6.0`), `uv sync --script` then `uv run --quiet --offline --script` ran a pyserial script, and no Python key appeared under `HKCU\Software\Python` (OBSERVED: commands in this session); sizes there: CPython 3.13 67 MB, esptool tool env 26 MB, cache 15 MB (OBSERVED: du); Windows `tar.exe` is bsdtar 3.8.9 with liblzma (OBSERVED: `tar --version`); install.json is outside the integrity hash (OBSERVED: `store.ts` RECORD excluded); `classifyCommand`, `prepareProgramRequest` bind `executableArgs` (OBSERVED: program-tools.ts); `ProgramHost.resolver` is consulted by `locate` and `programPromptEntries` (OBSERVED).
Assumptions: the program name is the executable name for `pip` (an entry point of the requirement) and `find` (STATED by example: esptool, git); a plugin's tool environments stay apart from other plugins' (INFERRED: two plugins may pin different ranges of one package).
Unknowns: uv, GNU tar and AppImage behaviour on a clean Ubuntu (no Linux machine here); whether a company proxy needs credentials (not stated; refused in the URL for now, see proposals); disk use on Linux.
Decision-blocking questions: none. Every gap has a proposal below that serves the done-when; the user runs autopilot.
Proposed behaviors (accepted for this task in autopilot):
- Pinned uv 0.13.1 for windows-x64 and linux-x64 in `05_Software/src/uv/uv-manifest.json` (archive URL and SHA-256, member path, binary SHA-256); `scripts/prepare-uv.mjs` verifies or fetches the archive and extracts the binary to `src/uv/<platform>/`; packaging stages it to `<resources>/uv/` through extraResources and re-verifies the packaged binary hash.
- uv environment for every call: `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, `UV_PYTHON_BIN_DIR` under `runtime/`, `UV_PYTHON_INSTALL_BIN=0`, `UV_PYTHON_INSTALL_REGISTRY=0`, `UV_MANAGED_PYTHON=1`, `UV_PYTHON=3.13`, `UV_NO_CONFIG=1`, `UV_NO_PROGRESS=1`; `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR` = `runtime/tools/<plugin id>/` and its `bin`; `UV_DEFAULT_INDEX` and `HTTPS_PROXY`/`HTTP_PROXY` from settings.
- A program is installed when `install.json.programs` records its version; installing probes the version, which must match `version.match`, and records it; reinstalling the plugin starts again from `{}`.
- Manifest: optional `version.range` (comma-separated `>=`, `>`, `<=`, `<`, `==`, `!=` with dotted numbers); a `download` URL ending in `.zip`, `.tar.gz`, `.tgz` or `.tar.xz` is an archive and needs `path`; another URL is a single file stored under `path` or the URL's last segment; `pip` requirements start with a letter or digit; `find` patterns never contain `**`.
- `find`: per entry, `%PATH%` (Windows) or `$PATH` (Linux) searches PATH for `<program>.exe` / `<program>`; other entries expand a leading `~` and `%NAME%` or `$NAME`, then `*` globs (highest name first); a directory match means `<dir>/<program>[.exe]`; the first existing file wins and is probed (cached); out of range or unreadable -> unavailable.
- `download`: fetch through a host port, stream to disk while hashing (at most 2 GiB), refuse a wrong hash and delete it, extract zip in core and tar archives with the system tar into a staging folder, refuse links that leave it and special files, rename to `downloads/<sha256>/`, mark executables on Linux; reuse an existing folder.
- `script`: install = `uv sync --script <file>`; run = uv with prefix `run --quiet --offline --script <file>`.
- Statuses per program `{name, kind, state: ready | missing | unavailable, version?, range?, hint?, link?, problem?}`; IPC `plugins.programs {id}` and `plugins.provision {id}`; CLI `vera plugin install --path <folder|zip> --data <dir>` installs the plugin and its programs and prints the statuses.
- Settings `plugins: {index?, proxy?}` (http/https URLs without credentials).
- `ResolvedProgram` gains `env` (uv variables for scripts) and `version` (prompt), and `run_program` merges `env` after the manifest's.
- Desktop caches the `<programs>` entries per workbench, generation and plugin-skill list; `plugins.install`, `uninstall`, `toggle` and `provision` bump the generation; the provisioner caches resolutions until an install or invalidation.
Path and reason: full - new install behaviour, manifest fields, IPC channels, settings, a CLI command, a bundled binary and network/data handling.

   | Criterion | Holds? | Evidence |
   |---|---|---|
   | no new externally observable behavior | no | installs, statuses, prompt entries, CLI command |
   | no new interface or data format | no | IPC channels, manifest fields, settings, uv manifest |
   | no new dependency | no | bundled uv binary (no npm dependency) |
   | an existing requirement already covers the behavior | no | none covers provisioning |
   | no security or data-handling change | no | downloads, archive extraction, external installs |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| uv preparation verifies archive and binary and writes src/uv/<platform>/ | REQ-PLAT-c99d7918 |
| error: uv archive or binary with another hash fails, no binary left | REQ-SEC-1a151052 |
| package ships <resources>/uv/uv(.exe) and re-verifies its hash | REQ-PLAT-1ecf3d4f |
| every uv call runs with the runtime uv environment only | REQ-SEC-e0567486 |
| pip install: uv tool install, entry point, probe, install.json version | REQ-FUNC-714e26bc |
| error: uv fails, does not start or leaves no entry point -> missing install | REQ-REL-e27cda96 |
| script install: uv sync --script, probe, record | REQ-FUNC-e7cb0626 |
| installed script resolves to uv run --quiet --offline --script | REQ-FUNC-edbe037c |
| download archive: verify, extract to downloads/<sha256>/, resolve path, reuse | REQ-FUNC-aa09d82e |
| download single file: stored as is, executable, prefix | REQ-FUNC-d30d568c |
| error: wrong download hash -> sha256, nothing kept | REQ-SEC-cde8b481 |
| error: escaping paths, outside links, special entries -> archive, nothing kept | REQ-SEC-e51bc0d8 |
| error: transfer failure, HTTP error, over 2 GiB, missing path | REQ-REL-e068dcd7 |
| find search: PATH, ~, variables, * globs, folder matches, first file | REQ-FUNC-c9dde429 |
| error: missing find program -> notFound with hint and link | REQ-UX-46085ddf |
| version probe and supported range -> ready with version | REQ-FUNC-514708b5 |
| error: out-of-range or unreadable version -> unavailable, nothing resolves | REQ-SEC-ba78d876 |
| resolve never installs; run_program cannot trigger installs | REQ-SEC-49ff111b |
| error: plugin, download or find excludes this platform -> platform | REQ-FUNC-5491d410 |
| launcher programs -> unavailable launcher | REQ-FUNC-06eaa9a5 |
| plugins.programs returns statuses without installing | REQ-FUNC-13ef1c0c |
| plugins.provision installs one at a time; NOT_FOUND, INVALID | REQ-FUNC-86daf060 |
| vera plugin install installs plugin and programs, prints statuses | REQ-FUNC-c44675ed |
| plugins.index and plugins.proxy reach uv | REQ-FUNC-c12941f3 |
| error: index/proxy not http(s) or with credentials -> invalid | REQ-SEC-0bc97768 |
| desktop production and CLI resolve through the provisioner; resolver env after manifest env | REQ-FUNC-565e908d |
| desktop caches <programs> entries until install, uninstall, toggle, provision or skill change | REQ-NFR-a881a281 |
| clean Windows and Ubuntu machines install and run esptool and a script (manual) | REQ-PLAT-8b3408cb |
| manifest: version.range, archive path, pip start, no ** in find (revised) | REQ-DATA-4d4471f9 |
| prompt entries carry the resolver's version (revised) | REQ-FUNC-fa6222a5 |

## Design

**Approach**
- New core module `plugins/provisioning.ts`: `Provisioner implements ProgramResolver` with `resolve(plugin, program, signal)`, `statuses(id, signal)`, `install(id, signal)` and `invalidate()`. One inner `inspect(plugin, program)` decides the status and the resolution of a program for both callers, so the IPC status, the prompt and run_program never disagree (REQ-FUNC-13ef1c0c, REQ-SEC-49ff111b). `resolve` only reads files and, for `find`, probes; it never fetches or spawns uv (REQ-SEC-49ff111b). Results are cached per plugin id, record sha256, recorded versions and program, cleared by `install` and `invalidate` (REQ-NFR-a881a281).
- Install (user action) runs one at a time per provisioner (a promise queue): load the plugin through the store, install each program that is not ready by kind, probe, then `PluginStore.recordPrograms(id, sha256, versions)` writes install.json atomically only while the sha256 is unchanged (CONFLICT otherwise), reload, return statuses (REQ-FUNC-86daf060).
- Kinds: pip = `uv tool install <req>` with a per-plugin `UV_TOOL_DIR` (REQ-FUNC-714e26bc); script = `uv sync --script`, run as `uv run --quiet --offline --script <file>` (REQ-FUNC-e7cb0626, REQ-FUNC-edbe037c); download = fetch port, staging file hashed while streamed, `archive.ts` (zip in core through fflate's streaming `Unzip`; tar archives through the system tar spawned via `ProcessHost`), tree check, rename to `downloads/<sha256>/` (REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c, REQ-SEC-cde8b481, REQ-SEC-e51bc0d8, REQ-REL-e068dcd7); find = PATH and glob search (REQ-FUNC-c9dde429, REQ-UX-46085ddf). The probe and the range check are shared by every kind (REQ-FUNC-514708b5, REQ-SEC-ba78d876).
- Rejected: a JavaScript xz decoder (a new npm dependency; Windows bsdtar and GNU tar already decode xz, OBSERVED in frame); one shared `UV_TOOL_DIR` (two plugins with different ranges of one package would replace each other's environment); `uv run --script` without `--offline` (a run could install, REQ-SEC-49ff111b); probing pip, script and download versions on every resolve (a spawn per prompt; their version is fixed at install).

**Interfaces and data**
- Shared: manifest `version.range`, pip requirements starting with a letter or digit, find patterns without `**`, archive downloads need `path` (REQ-DATA-4d4471f9); helpers `downloadForm(url)`, `downloadName(entry)`, `versionInRange(version, range)`; `pluginProgramStatusSchema` (spec REQ-FUNC-714e26bc.md); channels `plugins.programs {id}` and `plugins.provision {id}` returning statuses (REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060); settings `plugins?: {index?, proxy?}`, http(s) URLs without user info, in the settings and patch schemas (REQ-FUNC-c12941f3, REQ-SEC-0bc97768).
- Core: `ResolvedProgram` gains `env?` and `version?`; run_program merges `env` after the manifest env (REQ-FUNC-565e908d); `programPromptEntries` takes `resolved.version` (REQ-FUNC-fa6222a5). `ProvisionerOptions {store, root, uv?: {executable, prefix?}, host: ProcessHost, clock, platform: PluginPlatform | undefined, fetch(url, {signal}): Promise<Response>, settings(): {index?, proxy?}, timeouts?}`; `close()` aborts its lifetime signal; `pluginPlatform(platform, arch)`. The uv environment is `programEnvironment(host, [], uvVariables)` (REQ-SEC-e0567486, REQ-FUNC-c12941f3). Spawns use `group: true`, a timeout (install 15 min, probe 30 s) and `killProcessTree`; output is decoded with `OutputDecoder` and its tail kept for `detail`.
- Errors never throw out of `install` for one program: each program ends with a status (`problem` per the spec table); store errors (NOT_FOUND, INVALID, CONFLICT) throw (REQ-FUNC-86daf060). Platform and launcher exclusions are decided before any spawn or fetch (REQ-FUNC-5491d410, REQ-FUNC-06eaa9a5); a missing uv is `unavailable uv`.
- Desktop: production composes the provisioner (runtime `<userData>/plugins/runtime`, uv `<resources>/uv/` when packaged or `src/uv/<platform>/` in development, `net.fetch`, settings, the main store); instrumented builds keep `testProgramResolver` only when `VERA_TEST_PROGRAMS` is set (REQ-FUNC-565e908d). `SessionsHost` caches the entries by workbench id, generation and plugin skill list; `invalidatePrograms()` runs after plugins.install, uninstall, toggle and provision (REQ-NFR-a881a281).
- CLI: `vera plugin install --path <p> --data <dir>` (REQ-FUNC-c44675ed); `vera run` composes the provisioner with uv from `05_Software/src/uv/<platform>/` relative to the CLI build and global `fetch` (REQ-FUNC-565e908d).
- Packaging: `src/uv/uv-manifest.json` (schema 1, version, per platform `{url, sha256, member, binary, binarySha256}`); `scripts/prepare-uv.mjs` exports `prepareUv(manifest, destination, {fetchImpl, platform})` and `checkUvBinary(file, entry)`; `package.mjs` prepares, stages `resources/uv/` and checks the packaged binary; electron-builder `extraResources` maps `resources/uv` to `uv` (REQ-PLAT-c99d7918, REQ-SEC-1a151052, REQ-PLAT-1ecf3d4f).

**Files and test seams**
- shared: `plugins.ts` (+ `plugins.test.ts`, `plugins-ipc.test.ts`), `settings.ts` (+ settings test), `ipc.ts`.
- core: `plugins/archive.ts` + `archive.test.ts` (zips built with fflate), `plugins/provisioning.ts` + `provisioning.test.ts` (scripted `FakeHost` whose uv handler creates entry points, real temp folders, fake fetch), `plugins/store.ts` (+ recordPrograms test), `plugins/program-tools.ts` (+ env and version tests), `index.ts`.
- integration: `tests/integration/provisioning.test.ts` (real `NodeProcessHost`: tar.gz and tar.xz through the system tar, find and probe of node, a tar with an outside link); `tests/integration/cli.test.ts` (plugin install, a run of a found program).
- desktop: `main/index.ts`, `main/sessions.ts` (+ `sessions.test.ts` cache), renderer `mocks/mockApi.ts` (+ test).
- CLI: `args.ts`, `plugin.ts`, `index.ts`, `run.ts`.
- packaging: `scripts/prepare-uv.mjs`, `scripts/package.mjs`, `src/uv/uv-manifest.json`, `electron-builder.yml`, `.gitignore`, `package.json` script; `tests/packaging/packaging.test.ts`.

**Risks and open decisions**
- Network: tests never reach the internet; fetch is injected and uv is a scripted host; the real uv run is manual (REQ-PLAT-8b3408cb).
- Linux branches (GNU tar, exec bits, `$PATH`, AppImage mode) run here only in unit tests with `platform` inputs; a native Linux run is owed (DEVIATION at validate).
- Tar bombs: extraction is bounded only by the pinned download size (2 GiB); the archive is pinned by SHA-256 in a reviewed manifest.
- A found program's version is probed once per cache lifetime; an upgrade shows after a restart or an install or enable change.
- No format version changes; install.json keeps format 1 with `programs` filled.

**Requirement map**
REQ-PLAT-c99d7918, REQ-SEC-1a151052, REQ-PLAT-1ecf3d4f -> prepare-uv and package.mjs (packaging tests). REQ-SEC-e0567486, REQ-FUNC-c12941f3 -> uv environment (provisioning tests). REQ-FUNC-714e26bc, REQ-REL-e27cda96 -> pip install. REQ-FUNC-e7cb0626, REQ-FUNC-edbe037c -> script install and resolve. REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c, REQ-SEC-cde8b481, REQ-SEC-e51bc0d8, REQ-REL-e068dcd7 -> download and archive.ts (unit and integration). REQ-FUNC-c9dde429, REQ-UX-46085ddf -> find. REQ-FUNC-514708b5, REQ-SEC-ba78d876 -> probe and range. REQ-SEC-49ff111b -> resolve without installs. REQ-FUNC-5491d410, REQ-FUNC-06eaa9a5 -> exclusions before any spawn. REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060 -> statuses and install, IPC and mock. REQ-FUNC-c44675ed -> CLI plugin command. REQ-SEC-0bc97768 -> settings schema. REQ-FUNC-565e908d -> desktop and CLI composition, env merge. REQ-NFR-a881a281 -> SessionsHost cache. REQ-PLAT-8b3408cb -> manual clean-machine run. REQ-DATA-4d4471f9 -> manifest schema. REQ-FUNC-fa6222a5 -> prompt version from resolution.

Diagrams: [diagram_TASK-e68d92ee.md](diagram_TASK-e68d92ee.md)

## Log

- 2026-11-02 frame: journal opened
- 2026-11-02 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-02 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-02 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-02 build: red: npx vitest run shared plugin-provisioning.test.ts plugins.test.ts exit 1, 5 failed - no range/pip/find/archive-path rules, no downloadForm/downloadName/versionInRange, no program status schema or plugins.programs/provision channels, no plugins settings (REQ-DATA-4d4471f9, REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c, REQ-FUNC-514708b5, REQ-SEC-ba78d876, REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060, REQ-FUNC-c12941f3, REQ-SEC-0bc97768)
- 2026-11-02 build: green: npx vitest run src/libraries/shared exit 0, 51 files 303 tests (REQ-DATA-4d4471f9, REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c, REQ-FUNC-514708b5, REQ-SEC-ba78d876, REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060, REQ-FUNC-c12941f3, REQ-SEC-0bc97768 shared schemas)
- 2026-11-02 build: red: npx vitest run core provisioning.test.ts archive.test.ts store.test.ts exit 1 - provisioner and archive modules absent, PluginStore.recordPrograms missing (REQ-FUNC-714e26bc, REQ-REL-e27cda96, REQ-FUNC-e7cb0626, REQ-FUNC-edbe037c, REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c, REQ-SEC-cde8b481, REQ-SEC-e51bc0d8, REQ-REL-e068dcd7, REQ-FUNC-c9dde429, REQ-UX-46085ddf, REQ-FUNC-514708b5, REQ-SEC-ba78d876, REQ-SEC-49ff111b, REQ-FUNC-5491d410, REQ-FUNC-06eaa9a5, REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060, REQ-SEC-e0567486, REQ-FUNC-c12941f3)
- 2026-11-02 build: red: npx vitest run desktop main/sessions.test.ts renderer/mocks/mockApi.test.ts exit 1 - prompt entries resolved on every session call (3 of 1), mock has no plugins.programs/provision (REQ-NFR-a881a281, REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060)
- 2026-11-02 build: green: npx vitest run core src/plugins provisioning/archive/store exit 0 (19 + 3 + 12 tests) after Provisioner, archive.ts and PluginStore.recordPrograms (REQ-FUNC-714e26bc, REQ-REL-e27cda96, REQ-FUNC-e7cb0626, REQ-FUNC-edbe037c, REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c, REQ-SEC-cde8b481, REQ-SEC-e51bc0d8, REQ-REL-e068dcd7, REQ-FUNC-c9dde429, REQ-UX-46085ddf, REQ-FUNC-514708b5, REQ-SEC-ba78d876, REQ-SEC-49ff111b, REQ-FUNC-5491d410, REQ-FUNC-06eaa9a5, REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060, REQ-SEC-e0567486, REQ-FUNC-c12941f3)
- 2026-11-02 build: red: npx vitest run tests/integration/cli.test.ts -t plugin exit 1, 2 failed - CLI resolves no program (run_program not available) and has no plugin install command (REQ-FUNC-565e908d, REQ-FUNC-c44675ed, REQ-UX-46085ddf)
- 2026-11-02 build: green: npx vitest run tests/integration/cli.test.ts exit 0, 29 passed 4 skipped - vera run resolves echo-tools through the provisioner (find via VERA_TEST_NODE) and run_program runs node echo.mjs with exitCode 0; vera plugin install prints ready/missing statuses with hint and link, exit 1, usage errors exit 2 (REQ-FUNC-565e908d, REQ-FUNC-c44675ed, REQ-UX-46085ddf). Finding: integration tests import @vera/shared from its compiled dist, so run typecheck (tsc -b) before them
- 2026-11-02 build: green: npx vitest run tests/integration/provisioning.test.ts exit 0, 3 passed - real NodeProcessHost: .tar.gz and .tar.xz extracted by the system tar into downloads/<sha256>, a tar with a link to ../../../../outside refused (archive, nothing kept), a found node probed in and out of range (REQ-FUNC-aa09d82e, REQ-SEC-e51bc0d8, REQ-FUNC-c9dde429, REQ-FUNC-514708b5, REQ-SEC-ba78d876)
- 2026-11-02 build: green: npx vitest run core program-tools.test.ts exit 0, 27 passed - resolver env applied after the manifest env, prompt entries take the resolver's version (REQ-FUNC-565e908d, REQ-FUNC-fa6222a5)
- 2026-11-02 build: DEVIATION build: the resolver env merge and the resolver version in prompt entries were implemented with the ResolvedProgram change before their two program-tools tests, so those tests have no separate red run - both are small edits in code already covered; the tests now pin them
- 2026-11-02 build: red: npx vitest run tests/packaging/packaging.test.ts -t uv exit 1 - no resources/uv extraResources entry and no stageUv (REQ-PLAT-1ecf3d4f); the prepare-uv test passed on its first run because scripts/prepare-uv.mjs was written before it (REQ-PLAT-c99d7918, REQ-SEC-1a151052)
- 2026-11-02 build: manual (REQ-PLAT-8b3408cb, Windows x64 part): with the pinned uv 0.13.1 prepared by npm run prepare:uv (offline, from the verified archive) and real network outside the tests, vera plugin install installed esptool>=5,<6 (pip, 19.5 s, ready 5.6.0 in range >=5,<6) and a PEP 723 pyserial script (3.7 s, ready 1.0); vera run --provider replay then ran run_program esptool version (exitCode 0, 'esptool v5.6.0') and the script (exitCode 0, listed COM3/4/7/8, interpreter under runtime/cache/environments-v2); no new file in ~/.local/bin, no HKCU\Software\Python key added. Sizes (apparent bytes): uv.exe 30.6 MiB (32 095 024 B), Linux uv 36.1 MiB (37 853 280 B), managed CPython 3.13.16 59.9 MB, esptool tool env 24.6 MB, uv cache 11.9 MB. This machine has its own Python, which uv never used (UV_MANAGED_PYTHON). Ubuntu run owed.
- 2026-11-02 build: green: npx vitest run tests/packaging/packaging.test.ts exit 0, 12 passed (REQ-PLAT-1ecf3d4f stageUv + extraResources, REQ-PLAT-c99d7918, REQ-SEC-1a151052); npm run prepare:uv -- --offline verified the real pinned windows-x64 binary and prepareUv verified the real linux-x64 tarball member; desktop main/sessions.test.ts + mocks/mockApi.test.ts exit 0, 20 passed (REQ-NFR-a881a281, REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060); npx vitest run exit 0, 204 files 1606 passed 11 skipped; npm run typecheck exit 0; npm run lint exit 0 (0 errors; the one warning in a touched file, bridge.test.ts:45 non-null assertion, predates this task); npm run check:i18n exit 0; VERA_TEST=1 npm run test:e2e program-runs, program-approvals, skills, workbench-tools exit 0, 6 passed; evolution reviewed against the design (extra: echo-tools fixture find entries, probe-upgrade.mjs prepares uv, git.md range example)
- 2026-11-02 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-02 validate: DEVIATION validate: Linux-only branches (GNU tar extraction, mode 0755 on single files and archive executables, $PATH/$NAME expansion, linux-x64 uv tarball) run here only as unit tests with platform inputs and one prepareUv run on the real Linux archive; the Ubuntu clean-machine run of REQ-PLAT-8b3408cb and its sizes are owed - this machine is Windows x64
- 2026-11-02 validate: review round 1: spec changes_required - spec says Linux find needs an executable file (code does not check), spec shows --data optional, manifest spec lacks the find anchor rule, missing DEVIATIONs (Windows test machine has its own Python; prepare-uv test written after the code), REQ-FUNC-fa6222a5 omits the recorded-version fallback, REQ-SEC-e0567486 assertions narrower than its verification, REQ-FUNC-d30d568c ordering test unnamed, design wording of platform/fetch; quality changes_required - desktop provisioning has no lifetime abort or overall deadline (stalled download blocks every later install, uv outlives quit, staging left), a shared cached inspection fails for all callers when the first caller aborts, Linux find accepts non-executable files, find globs with many * segments can walk whole drives, versions installed before a later failure are not recorded, cliUv climbs to the filesystem root
- 2026-11-02 validate: returned to build - review round 1 findings: lifetime abort and per-program deadline, cache independent of caller signals, Linux X_OK, at most two * segments in find patterns, record each version at once, fixed CLI uv path, spec/journal/requirement wording, DEVIATIONs
- 2026-11-02 build: red: npx vitest run core provisioning.test.ts, shared plugin-provisioning.test.ts, cli provisioning.test.ts exit 1, 5 failed - stalled download never ends, close() missing, cached inspection fails for every caller on one abort, versions lost before a later failure, find pattern with three * segments accepted, cliUv climbs to ancestors (REQ-REL-e068dcd7, REQ-FUNC-86daf060, REQ-FUNC-13ef1c0c, REQ-FUNC-c9dde429, REQ-DATA-4d4471f9, REQ-FUNC-565e908d); Linux X_OK test skipped on Windows
- 2026-11-02 build: DEVIATION build: scripts/prepare-uv.mjs was written before its packaging test, so REQ-PLAT-c99d7918 and REQ-SEC-1a151052 have no separate red run - the test asserts both success paths and every refusal (archive hash, binary hash, foreign URL) and the real pinned archives were verified through the same code
- 2026-11-02 build: DEVIATION validate: the Windows x64 run of REQ-PLAT-8b3408cb used this development machine, which has its own Python 3.11-3.14, not a clean machine - UV_MANAGED_PYTHON=1 and the isolated runtime were verified (interpreter under runtime/cache, no ~/.local/bin or registry change), but a run on a machine without any Python is still owed on Windows as on Ubuntu
- 2026-11-02 build: round-1 fixes: red: core provisioning.test.ts, shared plugin-provisioning.test.ts, cli provisioning.test.ts exit 1 (5 failed) -> green: Provisioner.close() aborts a lifetime signal (desktop before-quit calls it), one deadline per program over fetch, body reads, extraction, uv and probe, staging swept before each install, each version recorded once probed, cached inspections run under the lifetime signal with callers racing their own, Linux find requires X_OK, find patterns allow * in at most two segments (also with backslashes), cliUv only resolves 05_Software/src/uv/<platform> from the CLI build; uv-environment test now compares the exact UV_* set of the sync, probe and resolved run with host UV_ variables present; spec REQ-FUNC-714e26bc (deadline, close, sweep, X_OK, two * segments, --data required, limits), spec REQ-DATA-4d4471f9 (find anchor and segment rule), REQ-FUNC-fa6222a5 (recorded-version fallback), REQ-FUNC-d30d568c (names the ordering test), REQ-SEC-e0567486, REQ-FUNC-c9dde429, REQ-FUNC-86daf060, REQ-REL-e068dcd7, REQ-FUNC-565e908d, REQ-FUNC-edbe037c, journal Frame/Design wording, architecture.md, plugins.md, headless-cli.md updated. Proof: npx vitest run shared, cli src, core plugins, desktop main, integration provisioning+cli, packaging exit 0, 98 files 688 passed 7 skipped
- 2026-11-02 build: green: npm run typecheck exit 0, npm run lint 0 errors, check:i18n exit 0, VERA_TEST=1 test:e2e program-runs + program-approvals exit 0, 3 passed
- 2026-11-02 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-02 validate: review round 2: spec approved (optional: name the X_OK check among owed Linux branches, one stage label per DEVIATION line, closing comment names both owed clean-machine runs); quality approved (optional: shared-cache test waits a fixed 20 ms before release and can hang; the staging sweep can delete another process's download in progress when two processes share one runtime). Applying the two quality options as round-3 fixes.
- 2026-11-02 validate: returned to build - round-2 optional findings: deterministic shared-cache test; sweep only staging entries older than the install deadline
- 2026-11-02 build: round-2 optional fixes: red: core provisioning.test.ts exit 1 (sweep removed a younger staging folder) -> green: sweepStaging removes only staging folders older than the install deadline; the shared-cache test waits until the probe exists instead of 20 ms; spec, plugins.md and REQ-REL-e068dcd7 updated. Proof: npx vitest run core provisioning.test.ts exit 0 three runs (22 passed 1 skipped); typecheck exit 0
- 2026-11-02 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-02 validate: DEVIATION validate: owed native Linux x64 proof, in full - GNU tar extraction and its outside-link refusal, mode 0755 on downloads, $PATH/$NAME expansion, the X_OK find check (its test is skipped on Windows), and the Ubuntu clean-machine run with its sizes; plus a Windows run on a machine without any Python - accepted by the delegating brief (Windows x64 host; Linux gaps stated as deviations)
- 2026-11-02 validate: review round 3: spec approved, quality approved, no new findings
- 2026-11-02 validate: final: python .agentic/aegis.py check --task TASK-e68d92ee --strict --run exit 0 (errors=0; lint, typecheck, i18n ok; tests not in the [check] run list) and npx vitest run exit 0, 205 files 1610 passed 12 skipped (skips include the Linux-only X_OK test); e2e program-runs/program-approvals/skills/workbench-tools passed on the round-1 candidate (round 2-3 changed only core provisioning and its tests). 60 warnings: uncovered-source on the four new test files (linked_tests of their requirements, classified as source by the tool) and outside-layout on src/uv/uv-manifest.json (a pinned data file); the rest (journal-header, stale-paths, ticket-ref, no-linked-tests, other uncovered-source) belong to other areas and predate this task; REQ-PLAT-8b3408cb is manual (Windows part done, Ubuntu owed)
- 2026-11-02 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e68d92ee.md
changed: PLG-05 provisioning: 28 requirements created, REQ-DATA-4d4471f9 and REQ-FUNC-fa6222a5 revised
evidence: check --task TASK-e68d92ee --strict --run exit 0; npx vitest run exit 0 (1610 passed)
issues: owed native Linux x64 proof (GNU tar, 0755, $PATH expansion, X_OK, Ubuntu clean run and sizes) and a Windows run without any Python; Settings UI calling plugins.provision is PLG-06
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-02)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-PLAT-c99d7918 - Prepare the pinned uv binary for the build platform
  - REQ-SEC-1a151052 - Refuse a uv archive or binary with the wrong hash
  - REQ-PLAT-1ecf3d4f - Ship the uv binary in the package resources
  - REQ-SEC-e0567486 - Run uv only inside the VERA plugin runtime
  - REQ-FUNC-714e26bc - Install a pip program with the bundled uv
  - REQ-REL-e27cda96 - Report a failed uv install
  - REQ-FUNC-e7cb0626 - Install a PEP 723 script program
  - REQ-FUNC-edbe037c - Run an installed script program offline through uv
  - REQ-FUNC-aa09d82e - Install a download archive program
  - REQ-FUNC-d30d568c - Install a single-file download program
  - REQ-SEC-cde8b481 - Refuse a download with the wrong hash
  - REQ-SEC-e51bc0d8 - Refuse an archive that leaves its folder
  - REQ-REL-e068dcd7 - Report a failed download
  - REQ-FUNC-c9dde429 - Locate a find program on the machine
  - REQ-UX-46085ddf - Show the hint of a missing find program
  - REQ-FUNC-514708b5 - Probe a program's version and check its supported range
  - REQ-SEC-ba78d876 - Make out-of-range or unreadable versions unavailable
  - REQ-SEC-49ff111b - Never install programs while resolving
  - REQ-FUNC-5491d410 - Report programs the current platform cannot run
  - REQ-FUNC-06eaa9a5 - Report launcher programs as unavailable
  - REQ-FUNC-13ef1c0c - List a plugin's program statuses over IPC
  - REQ-FUNC-86daf060 - Install a plugin's programs on the user's request
  - REQ-FUNC-c44675ed - Install a plugin and its programs from the CLI
  - REQ-FUNC-c12941f3 - Pass the package index and proxy settings to uv
  - REQ-SEC-0bc97768 - Refuse plugin index and proxy settings with credentials
  - REQ-FUNC-565e908d - Resolve plugin programs through provisioning in the apps
  - REQ-NFR-a881a281 - Cache the program prompt entries of the desktop sessions
  - REQ-PLAT-8b3408cb - Install esptool and a script on clean machines
  - REQ-DATA-4d4471f9 - Validate plugin manifest format 1
  - REQ-FUNC-fa6222a5 - List only enabled and resolved programs for the prompt
- deviations: 5 recorded
  - build: the resolver env merge and the resolver version in prompt entries were implemented with the ResolvedProgram change before their two program-tools tests, so those tests have no separate red run - both are small edits in code already covered; the tests now pin them
  - validate: Linux-only branches (GNU tar extraction, mode 0755 on single files and archive executables, $PATH/$NAME expansion, linux-x64 uv tarball) run here only as unit tests with platform inputs and one prepareUv run on the real Linux archive; the Ubuntu clean-machine run of REQ-PLAT-8b3408cb and its sizes are owed - this machine is Windows x64
  - build: scripts/prepare-uv.mjs was written before its packaging test, so REQ-PLAT-c99d7918 and REQ-SEC-1a151052 have no separate red run - the test asserts both success paths and every refusal (archive hash, binary hash, foreign URL) and the real pinned archives were verified through the same code
  - validate: the Windows x64 run of REQ-PLAT-8b3408cb used this development machine, which has its own Python 3.11-3.14, not a clean machine - UV_MANAGED_PYTHON=1 and the isolated runtime were verified (interpreter under runtime/cache, no ~/.local/bin or registry change), but a run on a machine without any Python is still owed on Windows as on Ubuntu
  - validate: owed native Linux x64 proof, in full - GNU tar extraction and its outside-link refusal, mode 0755 on downloads, $PATH/$NAME expansion, the X_OK find check (its test is skipped on Windows), and the Ubuntu clean-machine run with its sizes; plus a Windows run on a machine without any Python - accepted by the delegating brief (Windows x64 host; Linux gaps stated as deviations)
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base af4fbdf: 81 file(s) changed, 3863 line(s) added
- checks: errors=0 warnings=60 notes=4
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
