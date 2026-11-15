# Wokwi cloud simulation

This plugin lets the agent run firmware simulations and finite test scenarios in Wokwi's cloud with the pinned wokwi-cli 0.29.1. The agent inspects a project, validates its diagram offline, prepares a job of exact copies with the send list, account, limits and time budget, runs it once in the cloud after your approval, then collects the outcome with serial output, VCD and screenshots. Results go to `arduino-iot-results/`. A cloud simulation is not an electrical test or a test on the real board.

## What it needs

- **wokwi-cli 0.29.1**, which **Install dependencies** downloads from its GitHub release (https://github.com/wokwi/wokwi-cli/releases/tag/v0.29.1) and checks by SHA-256, and **wokwi-tool**, a Python script in the plugin that VERA installs itself.
- **A Wokwi CI token** (`wokwi-token`) from your Wokwi dashboard, stored under a reference such as `ci`. Set it in the plugin page's **Configuration** section. The token stays in VERA's credential store and only reaches an approved run of this plugin; the agent never sees it.
- A Wokwi project with a built firmware (`.hex`, `.bin`, `.uf2`, `.elf` or ESP-IDF `flasher_args.json`) and a diagram with exactly one board. The plugin never builds.
- No hardware and no other plugins are required.

## How to use it

The agent uses the `wokwi-simulation` and `wokwi-scenarios` skills. Before the cloud run it shows you the files that will be sent, the account, the board and the time limits, and waits for you.

- "Inspect the Wokwi project in sim/blink and validate its diagram."
- "Write a scenario that presses btn1 and expects led1 to light."
- "Prepare a job for sim/blink with account ci and a 5 second virtual timeout, run it, then write a report."
- "Simulate the firmware until it prints ready; fail if it prints panic."

## Risk and approvals

- **Safe** (runs without asking): inspecting the project, validating the diagram, preparing a job, collecting results and reports. These are offline; nothing is sent and the project is never changed.
- **Irreversible** (asks, and you type the confirmation word shown on the card): running a job, because it sends the diagram, firmware and ELF to Wokwi's servers, which cannot be recalled, and the run counts against your Wokwi plan. In **Bypass — full access** this runs without asking.
- **Blocked**: running wokwi-cli directly, because it would upload whatever its project folder holds and offers an MCP server.

## Limits

- Windows x64 and Linux x64.
- Custom chips, SD cards, GDB and RFC 2217 servers are refused.
- VERA cannot read your Wokwi quota. After Stop, Wokwi's end of the job is not confirmed.
- No live cloud run has been made with this plugin yet.
