# Raspberry Pi Linux projects

This plugin lets the agent work on a Raspberry Pi that VERA reaches over SSH: deploy a project, run its tasks and see their output, run a command, install Python and system packages, manage services that start at boot, read the board's health and bring files back. VERA connects the way `ssh` does, with the key you already use.

## What it needs

- **pi-tool**, a Python script that VERA installs itself with **Install dependencies**.
- **A Raspberry Pi** with Raspberry Pi OS 12 (Bookworm) 64-bit, SSH enabled and Python 3.9 or newer.
- **The bench registry** `lab/resources.json` in the workbench (required), which declares the board as a `linux-board`. The host and the user are enough; the agent writes the entry when you name them.
- **An SSH key**: a key in the SSH agent, or a private key in `~/.ssh` that needs no passphrase, whose public half is authorized on the board. VERA never handles a password or a passphrase.
- **A project manifest** `vera-pi.json` in a project folder (optional): the files to deploy, the Python requirements, the tasks and the services.

The plugin page's **Configuration** section shows the state of each.

## How to use it

The agent uses the `raspberry-pi-projects` and `raspberry-pi-tasks` skills.

- "My Pi is raspberrypi.local, user pi. Connect to it and tell me how it is doing."
- "Run the blink project on pi."
- "Install i2c-tools on pi and scan the I2C bus."
- "Make blink start at boot and show me its logs."

The first connection saves the board's host key. If you install the board's system again, the key changes and VERA refuses it until you tell the agent to trust the new one.

## Risk and approvals

- **Safe** (runs without asking): offline manifest checks and reports.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): checking the host key, identity and health, comparing a project with the board, task and service status, logs, and fetching a file.
- **Device write** (asks in **Ask** and **Auto-edit**): deploying files (none is deleted), running a task or a command, starting or stopping a service, trusting a new host key, and VERA's cleanup. Project code and commands may drive hardware attached to the board. **Always allow** on the card lets a command such as `pi-tool run-task` run without asking in **Auto-edit**.
- **Irreversible** (asks, and you type the confirmation word shown on the card): deploying with `--overwrite`, which replaces files edited on the board; those edits are lost. In **Bypass — full access** this runs without asking.

## Limits

- VERA runs on Windows x64 or Linux x64; boards other than a Raspberry Pi are not claimed.
- A command that needs `sudo` works only where the board allows it without a password, as the default user of Raspberry Pi OS does.
- `~/.ssh/config` is not read: name the board's real host and user in the registry.
- The plugin has not yet run against a real Raspberry Pi.
