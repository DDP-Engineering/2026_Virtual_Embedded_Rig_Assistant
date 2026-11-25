# VERA — Virtual Embedded Rig Assistant

**An AI agent workbench for electronics and embedded engineering, on your desktop.**

![Version](https://img.shields.io/badge/version-0.3.0%20pre--release-orange)
![Platforms](https://img.shields.io/badge/platforms-Windows%20x64%20%7C%20Linux%20x64-blue)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-lightgrey)

VERA works like Claude Code, Codex or opencode, but for the bench. You open a project folder as a
**workbench**. VERA indexes its datasheets, manuals and notes on your computer. An agent answers
questions about the project, cites the pages it used, edits files with your approval and, through
plugins, runs the tools of your bench: flashing tools, serial monitors, debuggers, simulators and
instruments.

## Contents

- [Features](#features)
- [Status](#status)
- [Quick start](#quick-start)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Plugins](#plugins)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Workbenches.** A workbench is a local folder with the project's documents, skills and settings
  under `.vera/`. Workbenches can be pinned, edited or opened read-only.
- **Local document search.** PDF, Office, OpenDocument, HTML, Markdown and text files are indexed on
  the machine, with local embeddings. Answers cite pages, headings or lines, and a citation opens
  the built-in viewer at that place.
- **Agent tools.** Read, search (`grep`, `glob`, `list`), write and edit files, read documents, parse
  logs, decode registers, keep a to-do plan, save artifacts and run shell commands, plus optional
  web search and parts search.
- **Permission modes.** Read-only, Ask, Auto-edit and Bypass. Every write and every program run
  follows the mode, and plugin rules give each command a risk level (safe, device-read,
  device-write, irreversible or blocked).
- **Plugins for bench tools.** 43 official plugins wrap tools such as esptool, STM32CubeProgrammer,
  probe-rs, PlatformIO, Zephyr, KiCad, ngspice, LTspice, Renode, sigrok and SCPI instruments. They
  install from a signed catalog, also offline.
- **Model providers.** OpenAI, a ChatGPT subscription, and any OpenAI-compatible endpoint such as
  LM Studio or Ollama.
- **Privacy controls.** Stored credentials are masked in what the agent sees, in program output, on
  screen and in exports, each area with its own switch.
- **Desktop and headless.** An Electron desktop application and a `vera` command-line interface that
  runs the same sessions.
- **Four languages.** The interface and the help pages are in English, German, Romanian and French.

## Status

VERA is **pre-release**. The current release is 0.3.0 (2026-11-25). Download the Windows and Linux
packages from the [VERA 0.3.0 release](https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant/releases/tag/v0.3.0).
Stored formats can still change between versions, and no migrations are provided yet. See the
[changelog](CHANGELOG.md) for what changed and [00_Planning](00_Planning/Overview.md) for the product
definition.

## Quick start

### Requirements

- Windows x64 or Linux x64 (developed on Windows 11 and Ubuntu 24.04)
- Python 3.11.4 or newer
- Git

Node.js does not have to be installed. The setup script installs the pinned Node.js 24 into
`02_Tools/runtime/`.

### Set up

```bash
git clone https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant.git
cd 2026_Virtual_Embedded_Rig_Assistant
python 02_Tools/environment/setup.py
```

On Ubuntu, use `python3`. The script installs Node.js and runs `npm ci` in `05_Software/`. Details
are in [02_Tools](02_Tools/README.md).

### Run the desktop application

```bash
cd 05_Software
python ../02_Tools/environment/npmw.py run prepare:plugins
python ../02_Tools/environment/npmw.py run dev
```

`npmw.py` runs npm with the pinned Node.js, so no Node.js on `PATH` is needed. If Node.js 24 is on
`PATH`, `npm run dev` works the same. On first start, add a model provider in **Settings**, create a
workbench from a project folder and ask a question.

### Use the command line

```bash
cd 05_Software
python ../02_Tools/environment/npmw.py run vera -- run --workbench <folder> --prompt "Summarise the board" --model <model-id>
```

The CLI takes the OpenAI key from `OPENAI_API_KEY`, or any provider key from `--key-file <file>` or
`--key-env <NAME>`. All options: [05_Software/README.md](05_Software/README.md#headless-cli).

## Development

Run these from `05_Software/`, prefixed with `python ../02_Tools/environment/npmw.py` when Node.js is
not on `PATH`.

| Command | What it does |
|---|---|
| `npm run verify` | Lint, typecheck, text and help checks, and the unit tests |
| `npm run lint` / `npm run format` | Biome check, or apply formatting and safe fixes |
| `npm run typecheck` | `tsc -b` over all workspaces |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:plugins` | Plugin tests; suites that need a real tool report a named skip |
| `npm run test:e2e` | Builds, then runs the Playwright Electron and browser tests |
| `npm run build` | Builds the desktop application into `src/apps/desktop/out/` |
| `npm run package` | Windows NSIS installer and portable ZIP, or Linux AppImage and deb |

`npm run test:e2e` runs two lanes; use `-- --browser-only` or `-- --serial-only` to run one. On Linux
it uses `xvfb-run`. The test inventory and the commands for one project or one file are in
[05_Software/tests/README.md](05_Software/tests/README.md).

The code is TypeScript (strict) in four npm workspaces: `@vera/shared` (validated contracts),
`@vera/core` (product logic), `@vera/desktop` (Electron and React) and `@vera/cli`. Plugin helpers are
Python scripts run through a bundled `uv`. The main stack is Electron 44, React 19, zod 4,
better-sqlite3, Vitest, Playwright and Biome.

## Repository layout

| Folder | Content |
|---|---|
| [00_Planning](00_Planning/Overview.md) | Product definition: overview, architecture and decisions |
| [01_Documentation](01_Documentation/README.md) | Project-wide rules: code style, releases |
| [02_Tools](02_Tools/README.md) | Environment, build, release and delivery tooling |
| [03_Hardware](03_Hardware/README.md) | Hardware profiles and bench setups |
| [04_HardwareDocu](04_HardwareDocu/README.md) | Datasheets and hardware references |
| [05_Software](05_Software/README.md) | VERA source, plugins, help pages and tests |
| [06_SoftwareDocu](06_SoftwareDocu/README.md) | Software documentation and measurements |
| [07_Delivery](07_Delivery/README.md) | Packages and release deliveries |
| [09_Others](09_Others/README.md) | Supporting material |

Inside `05_Software/`:

```text
src/apps/desktop/     Electron application and React interface
src/apps/cli/         Command-line application
src/libraries/core/   Product logic: agent, tools, sessions, indexing, plugins
src/libraries/shared/ Validated contracts and data types
plugins/              The 43 official plugins and the catalog source
help/                 In-app help pages in four languages
tests/                e2e, integration, packaging, plugin and tooling tests
```

## Plugins

A plugin is a folder with a `plugin.yaml` manifest, optional skills and optional helper scripts. The
manifest declares the programs a plugin may run and a rule for each command form, and the rule's risk
level decides whether VERA runs it, asks first or refuses. Plugins are grouped into packs, such as
ESP32, STM32, Arduino, electronics, lab and electrical power.

To write or change a plugin, read
[05_Software/plugins/CONTRIBUTING.md](05_Software/plugins/CONTRIBUTING.md).

## Documentation

- **User help:** [05_Software/help/en](05_Software/help/en/index.md), also shown in the application
  (F1).
- **Developer guide:** [05_Software/README.md](05_Software/README.md).
- **Architecture:** [00_Planning/Overview.md](00_Planning/Overview.md) and the documents it lists.
- **Code style:** [01_Documentation/Code_Style.md](01_Documentation/Code_Style.md).
- **Releases and changelog:** [01_Documentation/Releases.md](01_Documentation/Releases.md) and
  [CHANGELOG.md](CHANGELOG.md).

## Contributing

1. Read [Code_Style.md](01_Documentation/Code_Style.md) and, for agents, [AGENTS.md](AGENTS.md).
2. Write code, comments and internal documents in English. Interface texts and help need all four
   languages; `npm run check:i18n` and `npm run check:help` check them.
3. Add one line per change to `CHANGELOG.md` under `## [Unreleased]`, at most 120 characters.
4. Run `npm run verify` before you open a merge request.

## License

VERA is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.txt).
Noncommercial use is permitted. Commercial use needs a separate license; the contact is in
[LICENSE.txt](LICENSE.txt). Third-party components are listed in the application under
**Settings** → **About** and in `THIRD-PARTY-NOTICES.txt` of each installer.
