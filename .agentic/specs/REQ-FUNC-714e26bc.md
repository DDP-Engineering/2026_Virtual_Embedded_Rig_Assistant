# REQ-FUNC-714e26bc — Program provisioning

## Behavior

Provisioning installs and locates the programs that plugins declare, so the agent's `run_program` can
start them. Installing is a user action (`plugins.provision` over IPC, `vera plugin install` in the
CLI); resolving, which `run_program` and the `<programs>` prompt use, never installs anything. Every
install writes only below `<userData>/plugins/runtime/`; VERA never uses or changes the user's own
Python, runs no vendor installer and never elevates.

## Data / interface

### Runtime layout

| Path under `<userData>/plugins/runtime/` | Holds |
|---|---|
| `cache/` | uv cache (`UV_CACHE_DIR`), including PEP 723 script environments |
| `python/` | the managed CPython (`UV_PYTHON_INSTALL_DIR`); `python/bin/` is `UV_PYTHON_BIN_DIR` |
| `tools/<plugin id>/` | uv tool environments of that plugin (`UV_TOOL_DIR`); entry points in `tools/<plugin id>/bin/` (`UV_TOOL_BIN_DIR`) |
| `downloads/<sha256>/` | one verified download: the extracted archive or the single file |
| `downloads/.staging/` | work folders of downloads in progress; removed when they end |

### uv environment

Every uv call (install, sync, probe, and the run of a script program) uses the minimal program
environment of the runner (PATH, SystemRoot, HOME, USERPROFILE, TEMP, TMP, TMPDIR, LANG, LANGUAGE,
LC_*, PYTHONUTF8=1, NO_COLOR=1) plus:

| Variable | Value |
|---|---|
| `UV_CACHE_DIR` | `runtime/cache` |
| `UV_PYTHON_INSTALL_DIR` | `runtime/python` |
| `UV_PYTHON_BIN_DIR` | `runtime/python/bin` |
| `UV_TOOL_DIR`, `UV_TOOL_BIN_DIR` | `runtime/tools/<plugin id>`, `runtime/tools/<plugin id>/bin` |
| `UV_MANAGED_PYTHON` | `1` (never a system Python) |
| `UV_PYTHON` | `3.13` (one managed CPython shared by all plugins) |
| `UV_PYTHON_INSTALL_BIN` | `0` |
| `UV_PYTHON_INSTALL_REGISTRY` | `0` |
| `UV_NO_CONFIG` | `1` |
| `UV_NO_PROGRESS` | `1` |
| `UV_DEFAULT_INDEX` | settings `plugins.index`, when set |
| `HTTPS_PROXY`, `HTTP_PROXY` | settings `plugins.proxy`, when set |

uv runs with the runtime folder as its working directory. Each program's install (transfer, extraction,
uv and probe) has one 15-minute deadline and each probe 30 seconds; a deadline kills the process tree and
ends a transfer. `close()` (desktop: when the app quits) stops running installs and probes and refuses new
ones. Each install first removes the folders in `downloads/.staging/` older than the install deadline,
which only a crash leaves; younger ones may belong to a running install of another VERA process.

### Install kinds

A program is **installed** when `install.json.programs` records its version. Reinstalling a plugin
writes a new `install.json` with `programs: {}`, so its programs install again.

| Kind | Install (user action) | Resolve (no install) |
|---|---|---|
| `pip: <requirement>` | `uv tool install <requirement>`; the entry point `tools/<id>/bin/<program>` (`.exe` on Windows) must exist | installed and the entry point exists → that file, no leading arguments |
| `script: <path>` | `uv sync --script <plugin folder>/<path>` | installed → uv with leading arguments `run --quiet --offline --script <plugin folder>/<path>` and the uv environment |
| `download: {<platform>: {url, sha256, path?, prefix?}}` | the entry of the current platform: reuse `downloads/<sha256>/` when it exists, else download, verify, extract or store, rename into place | installed and `downloads/<sha256>/<path>` is a file → that file with `prefix` as leading arguments |
| `find: {windows?, linux?}` | nothing to install; the statuses report it | the first file the search finds (below), probed |

After a pip, script or download install, VERA probes the version; a version that matches is recorded,
and the status then reports `range` when it is outside the supported range. Installs of one provisioner
run one at a time, and each version is recorded as soon as it is probed, so a later failure keeps it.

### Download rules

- The URL path decides the form: `.zip`, `.tar.gz`, `.tgz` and `.tar.xz` (any case) are archives and
  need `path`; any other URL is a single file stored as `path`, or as the URL's last path segment when
  `path` is absent (it must be a plugin-relative path either way).
- The body streams to a staging file while hashed; more than 2 GiB is refused (`download`).
- A different SHA-256 refuses the program (`sha256`); the staged bytes are deleted.
- Zip: methods stored and deflate, read as a stream; each entry path must be plugin-relative after
  `\` → `/` (no absolute, drive or `..` path); every entry is written as a plain file or folder, so a zip
  never creates a link.
- Tar archives: the system tar (`%SystemRoot%\System32\tar.exe` on Windows, `/usr/bin/tar` or
  `/bin/tar` on Linux) extracts into an empty staging folder; afterwards every entry must be a file,
  a folder or a link whose target resolves inside the staging folder.
- A single file and, outside Windows, the resolved `path` of an archive get mode `0755`.
- The staging folder is renamed to `downloads/<sha256>/`; any failure removes it.

### find search

For the current system's list (`windows` on Windows, `linux` on Linux), entry by entry:

- `%PATH%` (Windows) or `$PATH` (Linux): each directory of the host PATH, in order, for
  `<program>.exe` (Windows) or `<program>` (Linux).
- Any other entry: a leading `~` becomes the home folder; `%NAME%` (Windows) or `$NAME` / `${NAME}`
  (Linux) become host variables, and an unset variable skips the entry; `*` matches within one path
  segment, in at most two segments (`**` and more `*` segments are refused by the manifest schema); only
  absolute local patterns are searched; matches are tried highest name first by numeric-aware
  comparison (`tool-1.10` before `tool-1.9`). A folder match means `<match>/<program>[.exe]`.
- The first regular file is the program (on Windows it must end in `.exe`; on Linux the user must be
  allowed to execute it, else the search goes on). It is probed; a resolution is cached until an install or
  invalidation, and is shared by callers: one caller's abort never ends it for the others.

### Version probe and range

The probe runs the resolved executable with its leading arguments and `version.args`, reads at most
64 KiB of stdout and stderr with ANSI codes removed, and applies `version.match` (one capture group;
evaluation bounded to 100 ms). The exit code does not matter: a probe fails when the program cannot
start, runs past 30 seconds or prints no match. `version.range` is a comma-separated list of comparators `>=`, `>`,
`<=`, `<`, `==`, `!=`, each followed by dotted decimal numbers (`>=2.40`, `>=5,<6`); a version
satisfies it when its leading dotted numbers satisfy every comparator, comparing component by component
with missing components as 0. A version that does not start with dotted numbers fails any range.

For a find launcher, search locates launcher[0] and its remaining tokens are fixed leading arguments.
Both probe and run invoke the declared program through the selected launcherMode. The probe uses
the program prefix (pluginDir substituted) followed by version.args. String mode uses the platform
transport measured for EIM: quoted Bash tokens with escaped backslashes; PowerShell quoted tokens
with literal backslashes and a generated call operator. Metacharacters in input tokens are INVALID.

### Status

`{name, kind: pip | script | download | find, state: ready | missing | unavailable, version?, range?,
hint?, link?, problem?, detail?}`, one per declared program in name order.

| State | Problem | When |
|---|---|---|
| `ready` | — | resolves; `version` set |
| `missing` | none | pip, script or download not installed yet |
| `missing` | `notFound` | find program not found; `hint` and `link` (first `http(s)://` URL of the hint) |
| `missing` | `install` | uv failed or the entry point is missing; `detail` = last 2 000 characters of uv's output |
| `missing` | `download` | transfer failed, HTTP error status, over 2 GiB |
| `missing` | `sha256` | the downloaded bytes have another hash |
| `missing` | `archive` | unsafe or unreadable archive, or `path` is not a file |
| `unavailable` | `platform` | the plugin, the download or the find lists exclude this platform |
| `unavailable` | `uv` | pip or script program and no bundled uv |
| `unavailable` | `version` | the probe failed, timed out or did not match |
| `unavailable` | `range` | the version is outside `range`; `version` and `range` set |

### CLI

`vera plugin install --path <folder|zip> --data <dir>` (both required) installs the plugin into `<data>/plugins`,
then its programs, and prints one JSON status per line; exit 0 when every program is ready, 1 otherwise,
2 for a usage error.

## Examples

- `esptool: {install: {pip: "esptool>=5,<6"}, version: {args: [version], match: 'v(\d+\.\d+\.\d+)'}}`
  installs into `tools/esp32-esptool/`, records `5.6.0` and resolves to `tools/esp32-esptool/bin/esptool.exe`.
- `git` found at `/usr/bin/git` printing `git version 2.39.1` with `range: ">=2.40"` →
  `{state: unavailable, problem: range, version: "2.39.1", range: ">=2.40"}`.
- A download whose bytes hash to another value → `{state: missing, problem: sha256}`; nothing remains
  under `downloads/`.

## Acceptance

The linked requirements' verification passes in `core/src/plugins/provisioning.test.ts`,
`core/src/plugins/archive.test.ts`, `tests/integration/provisioning.test.ts`, the shared schema tests and
the CLI integration test; the clean-machine run is manual.

## Current limits

- Only Windows x64 and Linux x64 builds carry uv; on linux-arm64 pip and script programs are
  unavailable (`uv`) until VERA ships that build.
- The CLI takes uv only from `05_Software/src/uv/<platform>/` of the workspace it was built in.
- Two VERA processes installing into one `<userData>` at the same time are not coordinated beyond the
  staging sweep and the atomic rename of each download folder.
- A company mirror for CPython downloads is not configurable; the proxy setting applies to uv, while
  VERA's own downloads use the app's network stack (Electron honours the system proxy; the CLI does not).
- A pip program whose package is shared by two plugins installs twice, once per plugin; uv hard-links
  the files from its cache.
