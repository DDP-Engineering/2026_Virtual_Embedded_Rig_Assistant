# Raspberry Pi Linux projects

This plugin lets the agent deploy projects, run finite tasks and manage user services on a Raspberry Pi that VERA reaches over SSH. Every connection checks the board's pinned host key, identity, user and remote root. A small helper on the board applies only approved files, runs declared tasks with a time budget, and starts, stops and reads listed user services. There is no shell, sudo, system service, raw GPIO, I2C or SPI access or reboot.

## What it needs

- **pi-tool**, a Python script that VERA installs itself with **Install dependencies**.
- **A Raspberry Pi** with Raspberry Pi OS 12 (Bookworm) 64-bit, an unprivileged user with a systemd user manager and Python 3.9 or newer.
- **The bench registry** `lab/resources.json` in the workbench (required), which declares the board as a `linux-board`: host, user, pinned host key fingerprints, agent key, serial or machine id and remote root folder.
- **A project manifest** `vera-pi.json` in a project folder (optional): the files to deploy, the tasks and the user services.
- **The system SSH agent** holding your login key (on Windows the OpenSSH Authentication Agent or Pageant). VERA never handles a password or key file.

The plugin page's **Configuration** section shows the state of each.

## How to use it

The agent uses the `raspberry-pi-projects` and `raspberry-pi-tasks` skills. Compare the host key on the board's own console before you pin it.

- "Check the host key of the board pi, then install the helper and identify the board."
- "Stage blink/vera-pi.json on pi and show me which files change."
- "Run the selftest task of blink-demo on pi."
- "Start blink-demo.service and collect its logs."

## Risk and approvals

- **Safe** (runs without asking): offline manifest checks and reports.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): checking the host key, identifying the board, task and service status and logs.
- **Device write** (asks in **Ask** and **Auto-edit**): installing the helper, staging and applying files (none is deleted), running a task, starting or stopping a service, and VERA's cleanup. Project code may drive hardware attached to the board.
- **Irreversible** (asks, and you type the confirmation word shown on the card): applying with `--overwrite`, which replaces files edited on the board; those edits are lost. In **Bypass — full access** this runs without asking.

## Limits

- VERA runs on Windows x64 or Linux x64; other boards are not claimed.
- A changed host key is refused, never accepted.
- A service that keeps running after the session needs `loginctl enable-linger <user>` on the board, which VERA never runs.
- The plugin has not yet run against a real Raspberry Pi.
