# Plugins

**Status:** decisions D1–D7 accepted 2026-11-01; nothing implemented yet. This package replaces the post-1.0 "wrapper
tools" and "serial" seams of the earlier planning documents. Where those documents conflict with
this package, ADR-0016…0019 decide.

Plugins wrap embedded tools (flashers, debuggers, bus loggers, packet analysers) so the agent can
drive them. A plugin is a folder with a manifest that declares programs and risk rules, plus Agent
Skills. Plugins ship from a catalog with official and community tiers, independently of VERA
releases. Users can draft their own plugins with the agent.

| File | Read it for |
|---|---|
| [architecture.md](architecture.md) | package format, rule matching, execution, risk levels and approvals, provisioning, storage, catalog, authoring, Linux, security |
| [packs.md](packs.md) | ecosystem packs: ESP32 in detail; CAN, Wireshark, Microchip and STM32 seeds |
| [probe-rs.md](probe-rs.md), [binutils.md](binutils.md), [sigrok.md](sigrok.md), [git.md](git.md) | the vendor-neutral bench-tool plugins: flashing and debug probes, firmware image analysis, signals and bench instruments (DDP sigrok fork), version control |
| [plan.md](plan.md) | work packages PLG-01…PLG-22, dependencies, verification, risks |
| [ADR-0016](../decisions/ADR-0016-plugins-skills-and-guarded-programs.md) | plugins = skills + declared programs + risk rules; no shell |
| [ADR-0017](../decisions/ADR-0017-plugin-provisioning-and-no-size-budget.md) | bundled `uv`, on-demand installs, no package size budget |
| [ADR-0018](../decisions/ADR-0018-hardware-risk-levels.md) | risk levels and the irreversible-operation policy |
| [ADR-0019](../decisions/ADR-0019-plugin-catalog-tiers.md) | one catalog, official and community tiers |

Reading order for an implementation agent: architecture.md, then the work package in plan.md, then
the ADR it cites.
