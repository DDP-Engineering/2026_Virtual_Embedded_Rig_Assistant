# Plugin mechanism

A plugin gives the agent the programs of a bench (flashers, debuggers, bus tools, simulators,
instrument drivers). It declares the programs, how VERA obtains them, a risk level for every command
line, and skills that teach the agent to use them. It carries no per-command code. The agent runs
programs only through generic tools, with an argument array and never a shell. VERA ships 43
official plugins in `05_Software/plugins/`.

## What a plugin is

```
<id>/
  plugin.yaml              manifest, format 1; the folder name is the id
  skills/<name>/SKILL.md   Agent Skills; they join the skill catalog as source `plugin`
  scripts/*.py             optional helpers with PEP 723 inline dependencies
  help/{en,ro,de,fr}.md    user help shown in Help and on the plugin card
  README.md                technical reference
```

Other files (profiles, data sets) ship as package data. On a skill name clash the workbench skill
wins, then the user skill, then the enabled plugin with the lowest id. A plugin without programs is
skills-only: it runs nothing and needs no approval.

| Tier | Origin |
|---|---|
| `official` | catalog plugin listed under `official` in the maintainers' `catalog.yaml` |
| `community` | any other catalog plugin, merged after a maintainer's review |
| `local` | installed from a folder or zip, a promoted trial, or a trusted workbench package |
| `trial` | installed by the agent from a draft; every command needs the user's approval |

Maturity comes from the version alone: `0.x.y` or a semver pre-release tag is **pre-release**;
any other version, from `1.0.0` up, is **stable**.

## Manifest

Every object is strict: an unknown key is an error. Schema:
[`plugins.ts`](../05_Software/src/libraries/shared/src/plugins.ts).

| Field | Rule |
|---|---|
| `format` | `1` |
| `id` | `[a-z0-9-]{1,64}`, equal to the folder name |
| `version` | Semantic Versioning, at most 128 characters |
| `license` | optional SPDX id or `LicenseRef-…` |
| `name`, `summary`, `description` | 1-80, 1-160 and 1-1024 characters; summary on the catalog card, description in the review |
| `translations` | optional `summary` and `description` in `ro`, `de`, `fr`; English otherwise |
| `ecosystem` | grouping tag `[a-z0-9-]{1,64}` |
| `platforms` | non-empty subset of `windows-x64`, `linux-x64`, `linux-arm64`; VERA has no `linux-arm64` build and no dependency kit for it |
| `requires` | at most 64 plugin ids installed with this one |
| `programs` | at most 64, names `[a-z0-9._-]{1,64}` |
| `rules` | at most 512 `{match, risk, note?, timeout?}`; match ≤ 1024 and note ≤ 512 characters, timeout 1-3600 s |
| `docs` | at most 64 URLs or package files offered as workbench documents |
| `settings` | at most 32 declared parameters (see Configuration) |

Each program has `install` (below) and `version`: probe `args`, a `match` regex with one capture
group and an optional `range` such as `>=5,<6`. Optional fields: `timeout` (≤ 3600 s), `env`
(literals, `${workbench}`, `${pluginDir}`), `prefix` (fixed leading arguments), `uses` (up to 8
other programs, passed as `VERA_PROGRAM_<NAME>`), `launcher` with `launcherMode` (`argv` or
`string`, for vendor activation tools), `optionSyntax`, `gui`, `file` (a pinned download never run),
`resources`, `credentials`, `sshAgent`. Argument lists hold at most 64 strings of 1-4096
characters without NUL or line breaks.

### Provisioning (`install`)

| Kind | VERA does |
|---|---|
| `pip` | `uv tool install <requirement>` into `<userData>/plugins/runtime/tools/<id>/` |
| `script` | `uv sync --script` at install; runs use `uv run --quiet --offline --script`, so a run never installs |
| `download` | per platform `{url, sha256, path?, prefix?, bytes?}`; https, at most 2 GiB, SHA-256 checked; zip extracted by VERA without links, tar archives by the system tar, `.7z` by Windows' bsdtar (windows-x64 only), anything else kept as one executable file |
| `find` + `hint` | searches PATH or absolute globs (`*` in at most two segments); a missing program shows the hint as vendor guide; optional `download` fallback and `preferDownload` |

`uv` ships inside VERA (pinned in `05_Software/src/uv/uv-manifest.json`) and installs one managed
CPython 3.13 shared by all plugins, with every folder under `<userData>/plugins/runtime/`; the
user's Python and uv configuration are never used. Settings `plugins.index` and `plugins.proxy`
reach uv as `UV_DEFAULT_INDEX` and `HTTPS_PROXY`/`HTTP_PROXY`.

Only the user installs programs (**Install dependencies**, or `vera plugin provision`). Listing,
the prompt and `run_program` never download or install. A program is ready when its version probe
(30 s, first 64 KiB) matches and lies in `range`; each install has a 15-minute deadline.
**Install from dependency archive…** accepts a file the user fetched, checked against the pinned
SHA-256. VERA never runs vendor installers or elevation: find programs are **Managed externally**.

## Programs and rules

The agent names a declared program; VERA resolves the executable. Refused before any rule: a program
no enabled plugin declares, one that two enabled plugins declare, more than 64 arguments, an
argument over 4096 characters or with NUL or a line break, and an argument starting with `@` (an
argument file would hide the command). Git reads no argument files and takes a commit message with a
body as one argument: for the `git` option syntax a leading `@` and line breaks pass.

Matching ([`program-rules.ts`](../05_Software/src/libraries/shared/src/program-rules.ts)):

- The command line is the program name plus the agent's arguments, without launcher or `prefix`.
  Tokens are lowercased, `_` becomes `-`, and `--name=value` splits into two tokens.
- Pattern tokens: `*` matches zero or more arguments, `{a,b}` either choice, `word*` a prefix.
- Every ordinary matching rule applies and the highest risk wins. A command no rule matches is
  `device-write`. A direct program can declare `subcommandHelp: { flag: --help, commands: [capture] }`
  for a documented parser exit. With exactly the declared subcommand and flag in raw argv, a
  matched command is safe unless a blocked rule matches. It uses the program timeout or session
  ceiling and the usual trial and trust policy.
- `optionSyntax` (`git`, `sigrok-cli`, `tshark`, `pymcuprog`, `stm32cubeprog`) projects arguments
  into role tokens such as `<write>` following that program's option parsing (STM32CubeProgrammer's
  ignores case). Only matching sees the projection; approvals show and run the raw arguments.
- The confirmation word of an irreversible command is the token matched by the first non-wildcard
  pattern token after the program in the first matching irreversible rule; for a role a syntax
  projects (`<discard>`) it is the command's name. The typed text is trimmed and normalised like a
  token.

| Risk | Meaning |
|---|---|
| `safe` | no effect on hardware |
| `device-read` | touches hardware without changing stored state; may reset or halt the target |
| `device-write` | changes stored state that a reflash restores |
| `irreversible` | permanent device change or physical actuation |
| `blocked` | never runs (for example interactive interfaces) |

| Mode | `safe` | `device-read` | `device-write` | `irreversible` | trial plugin |
|---|---|---|---|---|---|
| `read-only` | runs | refused | refused | refused | refused |
| `ask` | runs | approval | approval | typed word | approval; irreversible typed word |
| `auto-edit` | runs | runs | approval; a saved prefix runs | typed word | as `ask` |
| `bypass` | runs | runs | runs | runs | as `ask` |

Runs by mode are recorded as decided by mode. A typed-word approval is used once; a wrong word
leaves it pending. Switching to `bypass` lists the enabled plugins' irreversible rules. An approval
binds plugin hash, trial status, executable and version, arguments, working directory, risk, word,
notes and the SHA-256 of every argument that names a workbench file (plus reserved resources). The
request is prepared again when consumed and files are hashed again before the start; a change is
CONFLICT.

## Running

Tools ([`program-tools.ts`](../05_Software/src/libraries/core/src/plugins/program-tools.ts)):
`run_program {program, args, cwd?, timeout?, background?}`, `program_output {handle, waitMs ≤ 30000,
until?}`, `program_stop {handle}`. Runner:
[`runner.ts`](../05_Software/src/libraries/core/src/plugins/runner.ts).

- Spawn without shell, hidden window, stdin closed (an interactive program fails instead of
  hanging); the credential hand-off is the only stdin use.
- Environment: managed tool folders before the system `PATH`, a short allowlist (`SystemRoot`,
  `HOME`, `USERPROFILE`, temp folders, `LANG`, `LANGUAGE`, `LC_*`), display variables only for `gui`,
  `SSH_AUTH_SOCK` only for an official `sshAgent` program, the program's `env`, `PYTHONUTF8=1`,
  `NO_COLOR=1`. VERA's own environment and credentials never enter it.
- `cwd` is a folder inside the workbench (outside folders only in `bypass` with full file access).
  Programs are not sandboxed: rules and approvals are the control.
- Timeout cap: the largest matching rule timeout, else the program's, else 600 s; a background run
  without a value has none.
- Output is decoded as UTF-8 without ANSI escapes; results carry at most 12 000 characters: all of
  it, or its first lines (3 000 characters), a line counting what is left out, and its end.
- The working directory is a workbench folder or a folder added to the workbench; other outside
  folders need Bypass.
- Each run writes `.vera/runs/<ULID>.log` (64 MiB cap, then a truncation marker while the run
  continues) and a run record `<ULID>.json`. The newest 200 runs per workbench are kept; the
  **Runs** tab lists 50, shows the last 1 MiB of a log and stops a running run.
- At most 4 background runs and 32 kept handles per session.
- Stop, timeout and abort kill the process tree: Windows `taskkill /T /F` plus a sweep for late
  children; Linux SIGTERM to the process group, SIGKILL after 3 s.
- Cancellation: a session stop ends its foreground and background runs; creating, opening or
  closing a workbench and quitting the app stop the workbench's runs; the CLI stops all at its end.

**Serial ports and bench resources.** A run naming a serial port (`COMn`, `/dev/tty*`,
`/dev/serial/by-id/*`) that another unfinished run uses gets BUSY. A program declaring `resources`
reserves the resource a call names by its alias in `lab/resources.json` (instrument, debug probe,
power monitor). Leases are files in a per-user folder (`%LOCALAPPDATA%\VERA\leases`,
`$XDG_RUNTIME_DIR/vera-leases`) shared by the desktop app and the CLI, so two VERA processes never
drive one declared resource at once. A stop signals the run first and kills it after `grace`
seconds; an actuating run that ends without confirming the resource state triggers the declared
`cleanup` once, and an unconfirmed state is passed to the next run as `unknown`. Not covered:
programs outside VERA.

## Store, trust and integrity

Installed plugins live in `<userData>/plugins/installed/<id>/` with `install.json` (format 1: id,
version, tier, source, SHA-256, install time, probed program versions). Code:
[`store.ts`](../05_Software/src/libraries/core/src/plugins/store.ts).

- Sources: the catalog, **Install from folder…**, **Install from zip…** (`vera plugin install`). A
  folder is named as the id; a zip holds the package at its root or in one top folder named as the id.
- Refused: links, special files, unsafe or case-colliding names, a root `install.json`, more than
  4096 files, a manifest over 256 KiB, a zip entry over 128 MiB or 512 MiB inflated, an invalid
  manifest.
- The desktop app shows a review first: programs and sources, skills, data files, documents and the
  rules grouped by risk. The install names the reviewed SHA-256; a changed package is CONFLICT.
- Integrity: SHA-256 over all files in path order (path, NUL, length, NUL, bytes; `install.json`
  excluded), recomputed at every list and load. A mismatch marks the plugin changed; a plugin with
  any issue never loads.
- Workbench packages in `.vera/plugins/<id>/` load only after the user trusts that exact hash
  (**Trust this package**, or `vera plugin review` and `vera plugin trust`). Trust is stored on this
  computer; any change needs a new review. An id also installed globally is a collision.
- **Export zip** writes the verified package without `install.json`.

## Catalog and channels

A catalog release is a flat folder: `<id>-<version>.zip` per plugin, `index.json` (bundled, not
signed), and `index-stable.json` and `index-pre-release.json` with detached `.sig` files. An entry
holds the manifest identity and texts, tier, highest risk, `requires`, program dependencies,
discovery metadata, the bare zip name, its SHA-256 and size (index ≤ 4 MiB, ≤ 1024 plugins).
Code: [`catalog.ts`](../05_Software/src/libraries/core/src/plugins/catalog.ts).

- Ed25519 signs each channel index's bytes, which name their channel. The build pins
  `02_Tools/release/catalog-signing-key.pub.pem` (input `VERA_PLUGIN_CATALOG_KEY`). A missing `.sig`
  is `unsigned`; a failing signature or another channel's index is `untrusted`. Then, and when the
  catalog is unreachable, the page names the problem and shows the plugins bundled with VERA.
- **Stable** (default) lists stable plugins, **Pre-release** every plugin.
- Catalog URL: build input `VERA_PLUGIN_CATALOG_URL` or the user's setting; https, or http on
  loopback, without credentials. A mirror is a plain copy of the release folder.
- Limit: there is no default remote catalog address. The build input is empty unless a release build
  sets it, so without a configured URL VERA shows the catalog bundled in the package.
- Install checks size and SHA-256 against the index and refuses another id or version and any
  downgrade. The review shows on first install and when programs, sources or rules change. Update
  checks run at start and every 24 h while updates are not Off and a catalog URL is set; they never
  install.
- Packs (`packs.yaml`) group plugins, some groups checked by default. **Install a pack** shows one
  review with dependencies and risk, leaves out installed plugins, other platforms and plugins
  missing from the catalog, then installs and provisions the rest.
- Offline dependency kit per platform, `windows-x64` or `linux-x64` (`vera catalog kit`): pinned
  files, wheels of every pip and script program, the CPython archive, indexed by `kit.json`. With `plugins.kit` set, files must
  match the manifest SHA-256, wheels their `kit.json` hashes, and uv runs offline. Vendor programs
  are never in a kit.

Release: `npm run prepare:plugins` writes `07_Delivery/plugins/`, `vera catalog sign` signs both
channel indexes with a private key kept outside every repository, and the folder is published; the
installer carries it as the bundled catalog. `vera catalog check` rejects schema errors, a folder
not named as its id, unknown or circular `requires`, unknown pack or maintainer references, a
program without rules, `find` without `hint`, and a `safe` or `device-read` rule containing `burn`,
`efuse`, `fuse`, `otp`, `rdp`, `lock`, `protect`, `secure`, `encrypt`, `transmit` or `send` unless
`catalog.yaml` marks it reviewed. Procedure: [catalog-release.md](../02_Tools/release/catalog-release.md).

## Configuration and credentials

| `settings` kind | Fields | State |
|---|---|---|
| `secret` | `scope`: `mqtt`, `wokwi`, `parts` | stored, missing |
| `workbench-file` | workbench-relative `path` (`*` = one name), optional `format` (`lab-resources`, `json`), `optional` | present, missing, invalid, unchecked |
| `value` | read-only `value` | value |

Each entry has a `description`. A missing secret or a missing required or invalid file marks the
plugin **Needs configuration**; its Configuration section holds the forms for MQTT logins, Wokwi
tokens and parts supplier keys. Secrets live in `<userData>/credentials.json`, encrypted by the
operating system's secure storage (unprotected only with the user's consent); the renderer sees
references only. A program declaring `credentials {option, scope}` (`mqtt` or `wokwi`, official
plugins only) receives the credential a call names as one JSON line on stdin; the CLI reads
`VERA_MQTT_PASSWORD_<REF>` and `VERA_WOKWI_TOKEN_<REF>`. Parts keys serve VERA's parts search tool.

## Activation and the Plugins page

Installing never enables, provisions or runs anything. Enabling is per workbench
(`.vera/workbench.yaml` → `plugins.enabled`) in **Edit workbench → Plugins**, Save and Cancel at the
top. Only enabled, issue-free plugins reach the agent: resolved programs in the prompt's
`<programs>` block, skills in the skill catalog. A few VERA tools are offered only while their
official provider plugin is enabled.

The **Plugins** page puts management actions on top (install from folder or zip, check all
dependencies, refresh, check for updates, catalog URL and channel), then the tabs **Available**
(catalog) and **Installed** (this machine, including trial and workbench packages) with search,
filters (ecosystem, activity, provenance, maturity, state), sorting and pages of 6, 12 or 24. An
installed plugin's status says **Ready** only when dependencies and configuration are ready.

**Install with dependencies** installs missing required catalog plugins first and provisions what
VERA can install itself. Folder and zip installs and enabling do not enforce `requires`; a missing
required plugin shows in the status.

## Authoring

The built-in `create-plugin` skill guides the agent: research the CLI manual, write `plugins/<id>/`
in the workbench under normal approvals, then `plugin_validate` (schema errors; warnings for
dangerous tokens in low-risk rules, programs without rules, `find` without `hint`).
`plugin_install` always waits for the user's review, also in `bypass`, and installs the reviewed
files as `trial`; it never replaces a non-trial plugin. Only the user enables a trial, installs its
programs and selects **Promote to local**, after which the mode matrix applies. The agent cannot
promote, enable, change the mode or edit installed files. Code:
[`authoring.ts`](../05_Software/src/libraries/core/src/plugins/authoring.ts).

[`CONTRIBUTING.md`](../05_Software/plugins/CONTRIBUTING.md) is the rule set for catalog plugins:
layout, four-language help, reproducible install sources with sizes, rules for every program,
settings, the catalog check and maintainer review. User help:
[plugins.md](../05_Software/help/en/plugins.md).
