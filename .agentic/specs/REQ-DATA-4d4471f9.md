# REQ-DATA-4d4471f9 — Plugin manifest, package and store format

## Behavior

A plugin package is a folder (or a zip of one) holding `plugin.yaml`, Agent Skills and optional
helper files. The plugin store validates the manifest, copies the package into
`<userData>/plugins/installed/<id>/`, writes `install.json` next to the package files and later
lists, loads and uninstalls installed plugins. Every listing re-reads the files from disk and
recomputes the integrity hash, so the result survives a restart and reflects any later edit.

## Data / interface

### plugin.yaml, format 1

YAML with unique keys and no aliases; every object is strict (an unknown key is an issue).

| Field | Rule |
|---|---|
| `format` | `1` |
| `id` | `^[a-z0-9-]{1,64}$`; equals the package folder name |
| `version` | Semantic Versioning 2.0.0 (`1.2.0`, `1.2.0-rc.1+b5`), at most 128 characters |
| `name` | 1–80 characters after trimming |
| `description` | 1–1024 characters after trimming |
| `ecosystem` | `^[a-z0-9-]{1,64}$` |
| `platforms` | non-empty, unique subset of `windows-x64`, `linux-x64`, `linux-arm64` |
| `requires` | optional, at most 64 unique plugin ids, default `[]` |
| `programs` | optional map; key `^[a-z0-9._-]{1,64}$`, at most 64 programs |
| `programs.*.install` | one of `{pip}`, `{script}`, `{download}`, `{find, hint?, download?, preferDownload?}`; `preferDownload: true` requires both find and download |
| `install.pip` | requirement string, 1–256 characters after trimming, starting with a letter or digit |
| `install.script` | plugin-relative `.py` path that exists in the package |
| `install.download` | map of platform → `{url: https URL ≤ 2048 characters, sha256: 64 hex, path?: relative path, prefix?: args}`, at least one platform; a URL whose path ends in `.zip`, `.tar.gz`, `.tgz` or `.tar.xz` (any case) needs `path`; any other URL without `path` needs a last path segment that is a valid relative path |
| `install.find` | `{windows?: globs, linux?: globs}` with at least one list of 1–64 entries of 1–1024 characters without control characters; each entry is `%PATH%`, `$PATH`, or an absolute local path (`/x`, not `//x`; `X:/` or `X:\`), possibly starting with `~`, `%NAME%`, `$NAME` or `${NAME}`; `*` may appear in at most two `/`- or `\`-separated segments and `**` never; optional `hint` 1–1024 characters |
| `programs.*.version` | `{args: args, match: regex, range?}`; the JavaScript regex, 1–512 characters, compiles and has exactly one capture group; `range` is 1–128 characters of comma-separated comparators `>=`, `>`, `<=`, `<`, `==`, `!=` each followed by dotted decimal numbers (`>=5,<6`), spaces allowed around commas |
| `programs.*.launcher` | optional non-empty args; only with find without download fallback, whose search locates launcher[0] |
| `programs.*.launcherMode` | argv or string, required iff launcher is present; string uses the verified Bash/PowerShell command transport |
| `programs.*.optionSyntax` | optional `sigrok-cli`, `git`, `tshark`, `pymcuprog` or `stm32cubeprog`; projects command-specific option roles for matching; Git additionally inserts a mandatory execution-only no-ext-diff guard at its read-command boundary, preserving original approval/log arguments |
| `programs.*.prefix` | optional args; `${pluginDir}` is the only placeholder |
| `programs.*.env` | optional map `^[A-Za-z_][A-Za-z0-9_]{0,127}$` → value ≤ 4096 characters; placeholders `${workbench}`, `${pluginDir}` only |
| `programs.*.timeout` | optional integer seconds, 1–3600 |
| `programs.*.uses` | optional, 1–8 unique program names of the same plugin; their resolved paths reach the run as `VERA_PROGRAM_<NAME>` |
| `programs.*.gui` | optional, only `true`: the program opens windows, and only its runs receive `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY` and `XDG_RUNTIME_DIR` (REQ-PLAT-e0d8f3cf) |
| `programs.*.file` | optional, only `true`, with a download-only install: never run; the version is `version.match` applied to the downloaded file's name; run_program refuses it (REQ-PLAT-e093fdbd) |
| `rules` | optional, at most 512; `{match: 1–1024 characters without control characters, risk, note?: 1–512 characters, timeout?: 1–3600}` |
| `rules[].risk` | `safe`, `device-read`, `device-write`, `irreversible`, `blocked` |
| `docs` | optional, at most 64 entries of at most 2048 characters; an `https://` or `http://` URL, or a plugin-relative path that exists in the package |

"args" is an array of at most 64 strings, each 1–4096 characters without NUL, CR or LF. Relative
paths are at most 1024 characters, use `/`, have no empty, `.` or `..` segment, no control character or
`\ : * ? " < > |`, and no Windows device name (including `CONIN$`, `CONOUT$`) or trailing dot or space in a
segment. Rule pattern syntax is not interpreted here.

### Issues

`{code, path?, issue?, line?}`, at most 64 per plugin. `code`:

| Code | Meaning |
|---|---|
| `manifest` | `plugin.yaml` is missing, over 256 KiB, not a regular file or not UTF-8 |
| `yaml` | YAML syntax error, duplicate key or alias; `line` is 1-based |
| `field` | schema issue; `path` is the dotted field path (`programs.esptool.timeout`), `issue` the zod issue code, or `missing_file` for a `script` or `docs` path absent from the package |
| `id` | the manifest id differs from the folder name |
| `record` | `install.json` is missing or fails its schema, or its id differs from the folder name or its version from the manifest |
| `changed` | the recomputed integrity hash differs from `install.json` ("changed since review"), or the installed folder holds a link or another non-regular entry |
| `unavailable` | the installed folder cannot be read within the limits |

### install.json, format 1

`{format: 1, id, version, tier, source: {kind: "folder" | "zip", path}, sha256, installedAt, programs}`.
`tier` is `official`, `community`, `local` or `trial`; folder and zip installs record `local`.
`installedAt` is an ISO 8601 UTC timestamp. `programs` maps a program name to the version probed
when provisioning installed it; it is `{}` after every (re)install of the plugin. Provisioning rewrites
the file atomically and only while its `sha256` still equals the installed plugin's.

### Integrity hash

SHA-256 over every regular file of the package except the root `install.json`, in ascending order of
the relative `/`-separated path compared by UTF-16 code units. Each file contributes
`utf8(path) 0x00 ascii(decimal byte length) 0x00 bytes`.

### Import limits

At most 4096 files and 64 MiB of file content; a zip file of at most 64 MiB; `plugin.yaml` at most
256 KiB. Directory entries in a zip are ignored. Each zip entry counts the larger of its compressed and
declared size, and a stored entry whose declared size differs from its stored size is refused. Two file or
folder names that are equal after lowercasing, or a file and a folder of the same name, are a collision.
Files of a folder are read through a handle that does not follow links and must be the entry first seen. A root `install.json` in a package is reserved. Symbolic links, junctions and other
non-regular entries of a source folder are refused with DENIED; every other defect with INVALID.

### Zip layout

`plugin.yaml` at the archive root, or every entry inside one top-level folder that holds
`plugin.yaml` and is named as the manifest id. The top folder is stripped.

### Store operations

- `install(path)` → summary. Refuses with INVALID and `params {issue, path?}` (first issue) when the
  manifest has an issue. Stages under `plugins/staging/`, then replaces `installed/<id>` as a whole.
- `list()` → summaries sorted by id: `{id, issues[], version?, name?, description?, ecosystem?,
  platforms?, tier?, source?, sha256?, installedAt?}`.
- `load(id)` → `{manifest, folder, record}` only without issues; INVALID otherwise; NOT_FOUND when
  the id is not installed.
- `uninstall(id)`; NOT_FOUND when the id is not installed.
- `install` and `uninstall` reject with BUSY when the system refuses to rename the plugin folder (a file
  in it is open); the previous installation stays in place.
- `ids()` → installed folder names (used for UNKNOWN_NAME warnings).

## Examples

The canonical esp32-esptool manifest of architecture §2.1 is valid. `timeout: 3601` gives
`{code: field, path: programs.esptool.timeout, issue: too_big}`. `install: {pip: x, find: {...}}`
gives a `field` issue at `programs.esptool.install`. Appending one byte to
`skills/esp32-flash/SKILL.md` after install lists `{code: changed}`.

## Acceptance

The linked requirements' verification passes in `core/src/plugins/store.test.ts` and
`shared/src/plugins.test.ts`.

## Current limits

`requires` is validated as a
list of plugin ids but is not checked against the installed plugins at install, list or enable.
Staging folders left by a crash during install are not removed automatically.
