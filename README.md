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
- **Chat and files.** View an open document or Git diff beside the chat. Pin tabs, reopen a closed
  tab or search by title or path. Dictation with Whisper works offline.
- **Agent tools.** Read, search (`grep`, `glob`, `list`), write and edit files, read documents, parse
  logs, decode registers, keep a to-do plan, save artifacts and run shell commands, plus optional
  web search and parts search. Open plans from the chat and get an alert when a plan needs a decision
  while you are in another session or the app is in the background.
- **Permission modes.** Read-only, Ask, Auto-edit and Bypass. Every write and every program run
  follows the mode, and plugin rules give each command a risk level (safe, device-read,
  device-write, irreversible or blocked).
- **Plugins for bench tools.** 43 official plugins wrap tools such as esptool, STM32CubeProgrammer,
  probe-rs, PlatformIO, Zephyr, KiCad, ngspice, LTspice, Renode, sigrok and SCPI instruments. Install
  them from the bundled catalog or a local archive and enable the ones you need in each workbench.
- **Model providers.** Connect to hosted APIs, a ChatGPT subscription or a local server such as
  LM Studio or Ollama. Choose which models appear in chat and set a default.
- **Privacy controls.** Stored credentials are masked in what the agent sees, in program output, on
  screen and in exports, each area with its own switch.
- **Desktop and headless.** An Electron desktop application and a `vera` command-line interface that
  runs the same sessions.
- **Four languages.** The interface and the help pages are in English, German, Romanian and French.

## Status

VERA is **pre-release**. The current release is **0.3.0** (2026-11-25).
Stored formats can still change between versions, and no migrations are provided yet. See the
[changelog](CHANGELOG.md) for what changed and [00_Planning](00_Planning/Overview.md) for the product
definition.

## Quick start

### Install a release package

Download the package for your platform from the
[VERA 0.3.0 release](https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant/releases/tag/v0.3.0).

- **Windows x64.** Run the installer or extract the portable ZIP and open `vera.exe`.
- **Linux x64.** Install the `.deb` package or make the AppImage executable and run it.

The release also includes separate offline archives for Chromium, Whisper and plugin dependencies.
Download the archives you need from the release assets and follow the
[offline installation guide](07_Delivery/README.md#install-on-a-bench-without-network).

On first start, add a model provider in **Settings** → **Providers**, open a project folder as a
workbench and ask a question. For offline chat, use a model server running on the same computer.

### Run from source

Use Windows x64 or Linux x64 with Python 3.11.4 or later and Git. The setup script installs the pinned
Node.js 24 into `02_Tools/runtime/` and runs `npm ci` in `05_Software/`.

```bash
git clone https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant.git
cd 2026_Virtual_Embedded_Rig_Assistant
python 02_Tools/environment/setup.py
cd 05_Software
python ../02_Tools/environment/npmw.py run prepare:model
python ../02_Tools/environment/npmw.py run prepare:plugins
python ../02_Tools/environment/npmw.py run dev
```

On Ubuntu, use `python3`. The preparation scripts fetch the local embedding assets and build the
bundled plugin catalog. See the [tooling guide](02_Tools/README.md).

### Use the command line

```bash
cd 05_Software
python ../02_Tools/environment/npmw.py run vera -- run --workbench <folder> --prompt "Summarise the board" --model <model-id>
```

The CLI takes the OpenAI key from `OPENAI_API_KEY`, or any provider key from `--key-file <file>` or
`--key-env <NAME>`. All options: [05_Software/README.md](05_Software/README.md#headless-cli).

## Development

Run these from `05_Software/` with the pinned toolchain, for example
`python ../02_Tools/environment/npmw.py npm run verify`.

| Command | What it does |
|---|---|
| `npm run verify` | Static checks and the application test suite |
| `npm run verify:all` | Application verification and official plugin tests |
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
| [05_Software](05_Software/README.md) | VERA source, plugins, help pages, tests and evaluators |
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
evaluators/           Evaluation harnesses, cases and baselines
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
- **Evaluators:** [Methods and run commands](05_Software/evaluators/README.md).
- **Architecture:** [00_Planning/Overview.md](00_Planning/Overview.md) and the documents it lists.
- **Code style:** [01_Documentation/Code_Style.md](01_Documentation/Code_Style.md).
- **Releases and changelog:** [01_Documentation/Releases.md](01_Documentation/Releases.md) and
  [CHANGELOG.md](CHANGELOG.md).

## Contributing

1. Read [Code_Style.md](01_Documentation/Code_Style.md) and, for agents, [AGENTS.md](AGENTS.md).
2. Write code, comments and internal documents in English. Interface texts and help need all four
   languages; `npm run check:i18n` and `npm run check:help` check them.
3. Add one line per notable change to `CHANGELOG.md` under `## [Unreleased]`, at most 120 characters.
   For user-visible changes, also add a release note in `05_Software/release-notes/unreleased.yaml`.
4. Run `npm run verify` before you open a merge request.

## License

VERA is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.txt).
Noncommercial use is permitted. Commercial use needs a separate license; the contact is in
[LICENSE.txt](LICENSE.txt). Third-party components are listed in the application under
**Settings** → **About** and in `THIRD-PARTY-NOTICES.txt` of each installer.
