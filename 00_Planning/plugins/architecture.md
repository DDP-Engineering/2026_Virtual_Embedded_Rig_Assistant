# Plugins — architecture

PURPOSE: how VERA gains embedded-tool capabilities (flashers, debuggers, bus loggers, packet
analysers) as installable plugins that the agent drives, that users author with the agent, and that
ship independently of VERA releases.
DONE-WHEN (for [plan.md](plan.md)): on Windows x64 and Linux x64 the agent identifies, flashes and
monitors an ESP32 board through the official ESP32 pack installed from the catalog; outside
`bypass`, an irreversible command never runs without a typed confirmation; a user-authored plugin
goes from draft to trusted without a VERA update.
STATUS: decisions D1–D7 accepted 2026-11-01. Grounded in `05_Software/src` at commit 33e72b8. Earlier `00_Planning`
specs are not authoritative where they conflict; ADR-0016…0019 record the changes.

## 1. Model

A plugin is a folder with a manifest (`plugin.yaml`), Agent Skills and optional helper scripts. The
manifest declares **programs** (external executables and how to obtain them) and **rules** that
classify every command line of those programs into a **risk level**. The agent gets three generic
tools, `run_program`, `program_output` and `program_stop`, which start only programs declared by
enabled plugins, with an argument array and never a shell. Skills teach the agent how to use the
programs. Approvals bind to the exact command line and to the hashes of the workbench files it
names. A plugin has no per-command wrapper code or template: it is mostly Markdown and patterns.

| ID | Decision | Status | ADR |
|---|---|---|---|
| D1 | Plugins = skills + declared programs + risk rules; generic guarded execution; no shell | accepted by the user 2026-11-01 | ADR-0016 |
| D2 | `uv` ships inside VERA; Python, packages and portable binaries install on demand | accepted by the user 2026-11-01 | ADR-0017 |
| D3 | No package size budget; run-time downloads allowed for plugins | accepted by the user 2026-11-01 | ADR-0017 |
| D4 | Risk levels `safe`, `device-read`, `device-write`, `irreversible`, `blocked`; irreversible needs a typed confirmation in `ask` and `auto-edit` and runs in `bypass` | accepted by the user 2026-11-01 | ADR-0018 |
| D5 | One catalog with `official` and `community` tiers | accepted by the user 2026-11-01 | ADR-0019 |
| D6 | Windows x64 and Linux x64 in the first plugin release | accepted by the user 2026-11-01 | — |
| D7 | The agent may author plugins (manifest, skills, scripts) through a trial install; every command of a trial plugin needs the user's approval in every mode, `bypass` included; MCP servers come later | accepted by the user 2026-11-01 | ADR-0016 |

## 2. Package format

```
esp32-esptool/
  plugin.yaml                  # manifest, §2.1
  skills/esp32-flash/SKILL.md  # Agent Skills format, as in core/src/skills/catalog.ts
  scripts/                     # optional; Python files with PEP 723 inline dependencies
  README.md                    # optional; shown in the catalog
```

### 2.1 Manifest — canonical example

```yaml
format: 1
id: esp32-esptool
version: 1.2.0
name: ESP32 esptool
description: Identify, flash, erase and read Espressif chips over a serial port. Use for any ESP32 programming task.
ecosystem: esp32
platforms: [windows-x64, linux-x64]
requires: [serial-monitor]
programs:
  esptool:
    install: { pip: "esptool>=5,<6" }
    version: { args: [version], match: 'v(\d+\.\d+\.\d+)' }
    timeout: 120
rules:
  - { match: "esptool version", risk: safe }
  - { match: "esptool * {merge-bin,image-info,elf2image} *", risk: safe }
  - match: "esptool * {chip-id,read-mac,flash-id,read-flash,verify-flash} *"
    risk: device-read
    note: Resets the chip into its bootloader.
  - match: "esptool * {write-flash,erase-flash,erase-region} *"
    risk: device-write
    note: Overwrites firmware or data stored on the chip.
docs:
  - https://docs.espressif.com/projects/esptool/en/latest/
```

| Field | Rule |
|---|---|
| `format` | `1` |
| `id` | `[a-z0-9-]{1,64}`; equals the folder name; unique in a catalog |
| `version` | Semantic Versioning |
| `name`, `description` | ≤ 80 and ≤ 1024 characters; the description says what and when, like a skill's |
| `ecosystem` | grouping tag: `esp32`, `stm32`, `microchip`, `can`, `wireshark`, `general`, … |
| `platforms` | subset of `windows-x64`, `linux-x64`; elsewhere the plugin is hidden |
| `requires` | plugin IDs installed together with this one |
| `programs.<name>` | `[a-z0-9._-]{1,64}`; the value the agent passes as `program` |
| `programs.*.install` | exactly one kind of §5 |
| `programs.*.version` | probe arguments and a regex with one capture group; shown in the UI and the prompt |
| `programs.*.launcher` | optional argument prefix for programs that need an activated vendor environment, for example `[eim, run]` (§3.3) |
| `programs.*.env` | extra variables; values are literals, `${workbench}` or `${pluginDir}` |
| `programs.*.timeout` | default seconds for a foreground run, ≤ 3600 |
| `rules[]` | `match`, `risk`, optional `note` (shown on approval cards and in the prompt), optional `timeout` |
| `docs[]` | URLs or plugin-relative files the UI offers to add to the workbench documents |

`programs` and `rules` are optional. A plugin without programs is a **skills-only plugin**: it
distributes Agent Skills through the catalog, runs nothing and needs no approval. Example: the
official `analysis-skills` plugin with `firmware-comparator` and `test-planner`
(`00_Planning/capabilities/`).

### 2.2 Rule matching

- The command line is the program name followed by its arguments. For matching only, each token is
  lowercased and `_` becomes `-`. Tools such as esptool and espefuse v5 accept both spellings, so one
  pattern covers both.
- A pattern is space-separated tokens. `*` matches zero or more arguments; `{a,b}` matches either;
  a token ending in `*` is a prefix (`burn-*`).
- All matching rules apply and the **highest risk wins**:
  `blocked` > `irreversible` > `device-write` > `device-read` > `safe`. A command with several
  subcommands (`idf.py build flash`) therefore takes the risk of the most dangerous one.
- An unmatched command is `device-write`.
- Refused before any rule: a program that no enabled plugin declares; any argument starting with `@`
  (an argparse argument file would hide the real command); arguments containing NUL or a newline;
  more than 64 arguments or one longer than 4096 characters.
- The agent names a declared program and never passes an executable path. VERA resolves the
  executable itself (§5).

## 3. Execution

### 3.1 Agent tools

| Tool | Class | Parameters | Returns |
|---|---|---|---|
| `run_program` | program | `program`, `args: string[]`, `cwd?` (workbench-relative), `timeout?` (seconds, ≤ the rule or program cap), `background?` | foreground: `{exitCode, durationMs, risk, output, log, truncated}`; `output` is the last 12 000 characters of interleaved stdout and stderr. Background: `{handle, risk}` |
| `program_output` | read | `handle`, `waitMs?` (≤ 30 000), `until?` (regex) | output since the previous read, `running`, `exitCode?` |
| `program_stop` | read | `handle` | final status and the log path |
| `plugin_validate` | read | `path` of a draft folder | schema errors and lint warnings (§8) |
| `plugin_install` | program | `path` of a draft folder | always waits for the user's review; installs the draft as `trial` (§8) |

`program` is a new tool class next to `read`, `write` and `session` in `core/src/tools/context.ts`.
Its permission comes from §4, not from the class.

### 3.2 Runner

A new host port `ProcessHost` in `core/src/ports.ts`, implemented by the desktop main process and by
the CLI. Core stays free of `child_process`.

- `spawn(executable, args, { shell: false, windowsHide: true, cwd, env, stdio: ["ignore", "pipe", "pipe"] })`.
  Stdin is closed, so an interactive program fails instead of hanging. `blocked` rules name the
  known interactive subcommands.
- Environment: a minimal base (`PATH` = managed tool directories + system `PATH`; `SystemRoot`,
  `HOME`, `TEMP`, locale variables), then the program's `env`, `PYTHONUTF8=1` and `NO_COLOR=1`.
  Credentials from the VERA store never enter it.
- `cwd` passes the workbench path guard. The program itself is not confined: it can reach any file
  the user can. Risk rules and approvals are the control; VERA does not sandbox programs.
- Timeout and Stop kill the whole process tree. On Windows: `taskkill /T /F /PID`. On Linux: the run
  starts in its own process group and receives SIGTERM, then SIGKILL after 3 s.
- The full output goes to `.vera/runs/<run-id>.log`; the newest 200 logs per workbench are kept.
  Output is decoded as UTF-8 with replacement characters and ANSI escape codes are removed. Output
  is untrusted data, like file and web content.
- Background runs: at most 4 per session. Session stop, workbench close and app exit kill them.
- Serial-port guard: if an argument names a serial port (`COM\d+`, `/dev/tty*`,
  `/dev/serial/by-id/*`) that a running background run uses, the call fails and names that handle.
  Windows opens COM ports exclusively, so without this a flasher would fail with an obscure error.

### 3.3 Launchers

Some vendor programs run only inside an activated environment; ESP-IDF's `idf.py` is one. A
`launcher` prefix such as `[eim, run]` runs the command through the vendor's activation tool.
When the launcher takes one command string, VERA quotes each argument and refuses any argument
that contains quotes, `& | ; < > ^ % $` or a backtick. Rules still match the program's own command
line, never the launcher's.

### 3.4 Prompt and skills

Plugin skills join the skill catalog as a third source, `plugin`
(`shared/src/skills.ts` `skillSourceSchema`). On a name clash, workbench and user skills win. The
system prompt gains one block for enabled programs and one rule:

```
<programs>
- esptool 5.1.0 (plugin esp32-esptool): Identify, flash, erase and read Espressif chips over a serial port. Skill: esp32-flash.
</programs>
```

Rule: "Run external programs only with run_program. Load the plugin's skill before its first use.
Never guess serial ports, chip types or flash offsets: list the ports and read the build output."

## 4. Risk levels and approvals (ADR-0018)

| Level | Meaning | Examples |
|---|---|---|
| `safe` | no effect on hardware | `esptool merge-bin`, `idf.py build`, `tshark -r capture.pcapng`, `cantools decode` |
| `device-read` | touches hardware without changing stored state; may reset or halt the target | `esptool chip-id`, `espefuse summary`, serial capture, CAN listen-only capture |
| `device-write` | changes stored device state that a reflash restores | `write-flash`, erase, NVS write, PIC/AVR programming |
| `irreversible` | a permanent change to the device, or physical actuation outside it | eFuse burn, secure boot or flash encryption enable, STM32 RDP level 2, OTP writes, CAN transmit on a live bus, power-supply output |
| `blocked` | never runs | interactive interfaces (`idf.py monitor`, `menuconfig`) |

| Session mode | `safe` | `device-read` | `device-write` | `irreversible` |
|---|---|---|---|---|
| `read-only` | runs | refused | refused | refused |
| `ask` | runs | approval | approval | typed confirmation |
| `auto-edit` | runs | runs | approval | typed confirmation |
| `bypass` | runs | runs | runs | runs |

Irreversible commands:
- in `ask` and `auto-edit`, show the full command, every rule note and the files' hashes, and ask
  the user to type the matched subcommand (for example `burn-key`). The renderer sends the typed
  text with the decision and core compares it. The approval is never remembered and is used once;
- in `bypass`, run without a prompt. The approval record says `decided_by: mode`, the transcript
  shows the risk level, and the run log is kept like any other;
- switching a session to `bypass` while an enabled plugin has irreversible rules shows a warning
  that lists those rules. Plugins whose main purpose is irreversible (`esp32-efuse`) are disabled by
  default, so enabling them is the user's opt-in.

Trial plugins (§8) override the matrix: every command of a `trial` plugin waits for a user approval
in `ask`, `auto-edit` and `bypass`, and is refused in `read-only`. Its irreversible commands also need
the typed confirmation, in `bypass` too. Their rules have not been reviewed by anyone yet.

Approval request: a new variant of `ChangeRequest` in `core/src/tools/changes.ts`, hashed by the
existing `requestSha256`:

```ts
{ tool: "run_program", sessionId, turnId, callId, pluginId, pluginSha256, program, executable,
  programVersion, args, cwd, risk, notes: string[], files: { arg: number; path: string; sha256: string }[] }
```

`files` lists every argument that resolves, through the path guard, to an existing workbench file.
Approving `write-flash 0x10000 build/app.bin` therefore approves those exact bytes. A rebuilt image
needs a new approval.

## 5. Provisioning (ADR-0017)

| `install` kind | For | VERA does |
|---|---|---|
| `pip: "<requirement>"` | Python CLIs on PyPI: esptool, pymcuprog, python-can, cantools | `uv tool install` into `<userData>/plugins/runtime/tools/`; records the resolved version |
| `script: scripts/<file>.py` | helper scripts shipped in the plugin | `uv run --script`; dependencies come from the PEP 723 header and stay in uv's cache |
| `download: { <platform>: { url, sha256, path } }` | portable binaries: OpenOCD-esp32, espflash, … | downloads, verifies SHA-256, extracts into `runtime/downloads/<sha256>/`, runs `path` inside it |
| `find: { windows: [...], linux: [...] }` + `hint` | vendor suites the user installs: EIM/ESP-IDF, Wireshark, STM32CubeProgrammer, MPLAB X, PEAK drivers | searches `PATH` and the listed globs; if missing, shows `hint` and its link |

- `uv` ships in the VERA package (`<resources>/uv/`, pinned, one binary per platform). VERA sets
  `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR` and `UV_TOOL_DIR` under `<userData>/plugins/runtime/` and
  never changes the user's own Python. uv fetches one managed CPython that all plugins share.
- Only the user installs. The agent cannot install programs; it can only propose a plugin.
- VERA never runs vendor installers, `sudo` or elevation. Driver and permission steps are hints.
- Settings: optional package index URL and proxy for company mirrors, passed to uv.

Approximate disk use, measured in PLG-05:

| Item | Location | Size |
|---|---|---|
| `uv` binary | VERA package | tens of MB |
| Managed CPython | `<userData>`, once | ≈ 50–120 MB |
| One pip program environment (esptool with dependencies) | `<userData>` | ≈ 20–50 MB; uv hard-links shared files from its cache |
| Plugin folders | `<userData>` | KB |
| ESP-IDF through EIM (user-installed) | EIM folders | ≈ 3–5 GB per version + 2–3 GB tools, outside VERA |

## 6. Storage and enablement

| Data | Location |
|---|---|
| Installed plugin | `<userData>/plugins/installed/<id>/`, plus `install.json`: version, tier, source, sha256, install time, resolved program versions |
| Runtime | `<userData>/plugins/runtime/{cache,python,tools,downloads}` |
| Draft | any workbench folder, for example `plugins/<id>/`; ordinary files the agent can write |
| Enabled for a workbench | `.vera/workbench.yaml` → `plugins: { enabled: [<id>…] }` |
| Run logs | `.vera/runs/` |

- Enablement is opt-in, unlike skills, because plugins execute programs.
- Integrity: `install.json.sha256` covers the sorted relative paths and bytes of every plugin file.
  VERA recomputes it at load. A mismatch disables the plugin with "changed since review", the same
  rule `SkillCatalog` applies to skills that change after being read.
- Portable mode keeps all of this under `<app folder>/data/`.

## 7. Catalog and packs (ADR-0019)

```
vera-plugins/                    # one Git repository
  plugins/<id>/…                 # §2 format
  packs.yaml                     # ecosystem packs
  CONTRIBUTING.md
  .github/workflows/             # validate on PR; on tag publish index.json and <id>-<version>.zip
```

- `index.json` entry: `{id, version, tier, ecosystem, platforms, name, description, requires, url, sha256, bytes}`.
- Tiers: `official` (VERA maintainers own it), `community` (merged by PR after CI and a
  maintainer's review of programs, install sources and rules). A plugin installed from a folder or
  zip is `local`.
- CI rejects schema errors and duplicate IDs. It also rejects a program without rules, and a rule
  whose pattern contains `burn`, `efuse`, `fuse`, `otp`, `rdp`, `lock`, `protect`, `secure`,
  `encrypt`, `transmit` or `send` at a level below `device-write`, unless a maintainer marks it
  reviewed.
- VERA reads the index from a catalog URL setting (default: the official one; companies may point
  to a mirror), verifies each zip's SHA-256 and shows a review screen before the first install and
  before any update that changes programs, rules or install sources. Update checks run at start
  and every 24 h when enabled; updates are never installed automatically.
- Official plugins also ship inside the VERA package, so a first install works offline. The catalog
  updates them later.

```yaml
# packs.yaml
- id: esp32
  name: ESP32 (Espressif)
  groups:
    - { name: Core, plugins: [serial-monitor, esp32-esptool], default: true }
    - { name: ESP-IDF build, plugins: [esp32-idf], default: true }
    - { name: JTAG debug, plugins: [esp32-openocd] }
    - { name: Security (irreversible), plugins: [esp32-efuse] }
```

The UI shows packs as checkable groups (pack → groups → plugins) and installs the selected
plugins. Pack contents: [packs.md](packs.md).

## 8. Authoring with the agent

| Step | Who | What happens |
|---|---|---|
| 1 Research | agent | loads the official `create-plugin` skill; reads the tool's manual with `search_docs`, `web_read` or files the user adds; asks which operations matter |
| 2 Draft | agent | writes `plugins/<id>/plugin.yaml`, skills and scripts with `write`, under normal approvals |
| 3 Validate | agent | `plugin_validate`: schema errors; warnings for dangerous tokens in low-risk rules, programs without rules, `find` without `hint` |
| 4 Trial | user approves | `plugin_install` shows the review screen and installs a `trial` plugin. Every command of a trial plugin waits for the user's approval in every mode, `bypass` included, and irreversible ones also need typing (§4). The agent runs `--help`, tries commands and fixes the draft; reinstalling replaces the trial |
| 5 Promote | user only | a button turns the trial into a `local` trusted plugin; its rules apply as written |
| 6 Share | user | export a zip, or open a PR to the catalog following `CONTRIBUTING.md` |

The agent cannot promote a plugin, enable a plugin for a workbench, change the session mode or edit
an installed plugin.

## 9. Linux (D6)

| Topic | Rule |
|---|---|
| Serial permission | the user must be in `dialout` (Debian, Ubuntu, Fedora) or `uucp` (Arch). `serial-monitor` reports EACCES with the command for the user to run |
| Stable port names | skills prefer `/dev/serial/by-id/*` over `/dev/ttyUSB*` and `/dev/ttyACM*` |
| USB JTAG | OpenOCD udev rules (`60-openocd.rules`); a plugin hint |
| SocketCAN | bringing up `can0` needs root and is a user step; python-can uses the `socketcan` backend |
| Packet capture | `dumpcap` capabilities or the `wireshark` group; a user step |
| Process tree | process groups; SIGTERM, then SIGKILL |
| Package | AppImage and deb carry the Linux `uv`; uv's CPython needs glibc on x64 |

## 10. Security model

| Threat | Controls |
|---|---|
| Agent misuse: prompt injection through documents, logs or web pages; model error | program allowlist from enabled plugins; argument arrays without a shell; risk rules with highest-wins and an unmatched default of `device-write`; approvals bound to the command line and file hashes; typed confirmation for irreversible commands outside `bypass`; dangerous plugins disabled by default; bypass warning. In `bypass` the user accepts unattended irreversible runs |
| Malicious or careless plugin: it runs code (pip packages, scripts) with the user's rights | catalog review and tiers; SHA-256 pinning; review screen on install and update; trial mode; integrity check at load. Same trust model as VS Code extensions or Claude Code plugins |
| Rule gaps: a vendor CLI with an undocumented side effect | first-party plugins are tested on real boards; unmatched commands default to `device-write` |

## 11. Deferred

| Item | Trigger |
|---|---|
| MCP servers in a plugin (`mcpServers`, the standard `.mcp.json` shape; one rule per tool name). Candidate: Espressif's `idf.py mcp-server` (ESP-IDF ≥ 6.0: `set_target`, `build_project`, `flash_project`, `clean_project`) | a server offers something `run_program` cannot |
| Workbench-scoped plugins in `.vera/plugins/`, trusted per machine by hash | phase 3 of the plan |
| Structured bench description (`bench:` in `workbench.yaml`) | after user feedback; `WORKBENCH.md` covers it now |
| Signed index (minisign) | when contributors outnumber the maintainers' review |
| Offline bundles (plugin + uv cache) for air-gapped labs | on request |
| macOS | with the app |

NOTES:
- Code anchors: tool interface `core/src/tools/context.ts:31`; registry `core/src/tools/registry.ts`;
  skills `core/src/skills/catalog.ts`; approvals `core/src/agent/approvals.ts`; `ChangeRequest`
  `core/src/tools/changes.ts:54`; modes `shared/src/session.ts:5`; workbench config
  `shared/src/workbench.ts`; ports `core/src/ports.ts`; prompt `core/src/agent/prompt.ts`.
- Spawn reference: `09_Others/benchpilot-reference/apps/server/src/tshark.ts` (argument array, no
  shell, timeout, output cap).
- Verify while implementing: how `eim run` takes its command (one string or argv); that esptool and
  espefuse v5 accept both `_` and `-`; espefuse `--virt` for tests without hardware; the sizes of §5.
