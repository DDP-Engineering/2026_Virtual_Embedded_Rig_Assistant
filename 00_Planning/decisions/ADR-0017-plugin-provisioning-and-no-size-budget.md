# ADR-0017: Bundled uv, on-demand plugin installs, no package size budget

Date: 2026-11-01
Status: Accepted by the user on 2026-11-01 (no size budget, run-time downloads for plugins, `uv`
inside the package). Supersedes law L5 of `architecture/01-system.md` and the 250 MB budget of
`architecture/07-packaging-updates.md` §1. The budget checks were removed from
`02_Tools/release/package.mjs` and `tests/packaging/probe-upgrade.mjs` the same day.

## Context
Most embedded tools that plugins wrap are Python packages (esptool, espefuse, pymcuprog, python-can,
cantools, pyserial); others are vendor suites of several gigabytes (ESP-IDF, MPLAB X,
STM32CubeProgrammer) or drivers whose licences forbid redistribution (Npcap, PEAK, Vector). The
package size budget and the ban on run-time downloads would block plugins and the tools they need.
The user asked that such limits be removed.

## Decision
- The VERA package has no size budget. The packaging script stops failing above 250 MB.
- VERA ships a pinned `uv` binary per platform. uv installs one managed CPython, the plugins' PyPI
  programs and the dependencies of PEP 723 scripts, all under `<userData>/plugins/runtime/`. VERA
  never uses or changes the user's own Python.
- Portable binaries install from declared URLs, verified by SHA-256.
- Vendor suites and drivers are never bundled or installed by VERA. Plugins detect them and show
  install hints. VERA never elevates privileges.
- Installs happen only on a user action. Official plugins also ship inside the package, so a first
  install works offline; their programs still download on first use.
- Run-time network destinations added: the plugin catalog, PyPI or a configured package index, uv's
  CPython download host, and URLs declared by installed plugins.

## Alternatives considered
- Bundling CPython and wheels: a fully offline first use, but per-platform wheel management
  (native `cryptography` wheels, for one) becomes VERA's job on every release.
- Using the system or EIM Python: no download, but versions and installed packages differ on every
  machine and support becomes guesswork.
- Downloading `uv` on demand: a smaller package, but the bootstrap itself needs network and
  verification code that uv already replaces.

## Consequences
- The package grows by the uv binary. A Python-based plugin needs network on first install, or a
  configured company mirror.
- Disk use moves to `<userData>`: one CPython plus one environment per pip program (architecture §5).
- The egress list grows. The release egress check must allow the new destinations only after a
  plugin install action.
