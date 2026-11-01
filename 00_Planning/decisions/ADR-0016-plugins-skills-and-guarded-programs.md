# ADR-0016: Plugins are skills plus declared programs under risk rules

Date: 2026-11-01
Status: Accepted by the user on 2026-11-01, including agent authoring with trial installs.
Supersedes ADR-0007 for process execution; ADR-0007's file-tool confinement and gated writes still
apply.

## Context
VERA needs a large and growing library of wrappers around embedded tools: ESP32, STM32 and
Microchip flashers, debuggers, CAN loggers, Wireshark. Users must be able to add one without waiting
for a VERA release, often with the agent's help. The solution has to be simple to build and to
maintain, because the library's size depends on the cost of each wrapper. Wrong commands can damage
hardware permanently (ESP32 eFuses, STM32 RDP level 2). Today VERA cannot run any external process.

## Decision
A plugin is a folder with `plugin.yaml`, Agent Skills and optional helper scripts. The manifest
declares programs (how to find or install each executable) and rules that map command-line patterns
to risk levels (ADR-0018). The agent gets generic tools, `run_program`, `program_output` and
`program_stop`. They start only programs declared by plugins enabled for the workbench, take an
argument array, never use a shell, and resolve the executable path themselves. Skills carry the
knowledge of how to use each program. Approvals bind to the exact command line and the hashes of the
workbench files it names. The agent may draft plugins (manifest, skills, scripts) and install them
as `trial` after the user's review. Every command of a trial plugin waits for the user's approval in
every mode, `bypass` included. Only the user promotes a trial plugin to trusted. MCP servers inside
plugins are deferred until a server offers something `run_program` cannot.

Specification: `00_Planning/plugins/architecture.md`.

## Alternatives considered
- A typed template per command (each subcommand a tool with a schema and an argv template):
  structured approvals, but every command must be written, tested and kept in step with tool
  versions (esptool v5 renamed its commands). The tool count also grows with every plugin and floods
  the model's context.
- MCP servers as the only plugin form: reuses an ecosystem (Espressif ships `idf.py mcp-server`),
  but every wrapper becomes code. Hardware effects hide behind tool names, so VERA cannot show what
  will actually run.
- A free shell tool with per-command approval: simplest, but each approval asks the user to judge an
  arbitrary command line, and pipes and shell expansion defeat any classification.

## Consequences
- A wrapper costs a manifest and a skill; the agent can write both.
- Approval cards show command lines, not structured fields; rule notes and file hashes make them
  readable.
- Risk classification is pattern-based. The defaults "highest risk wins" and "unmatched is
  `device-write`" bound the damage of a missing rule.
- External programs are not sandboxed; they run with the user's rights (threat model:
  architecture §10).
