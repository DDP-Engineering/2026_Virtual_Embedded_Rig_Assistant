# Changelog

Notable changes to VERA. Format: Keep a Changelog; versions: Semantic Versioning. Every version below
1.0.0 is a pre-release with no upgrade path from earlier builds. Rules: `01_Documentation/Releases.md`.
Older releases: `06_SoftwareDocu/CHANGELOG-archive.md`.

## [Unreleased]

## [0.2.0] - 2026-11-15

### Added

- Session sizes in the workbench overview's sessions table.
- Electrical project model with units, provenance and stale results, shared by the electrical plugins.
- electrical-network 0.1.0: radial LV load balance, cable sizing, voltage drop and short circuit.
- industrial-catalog 0.1.0: cited catalog items and documented component selection.
- protection-coordination 0.1.0: breaking capacity, disconnection times and table-based selectivity.
- motor-drives 0.1.0: motor starter and drive selection.
- power-quality-pfc 0.1.0: measurement import, compensation need, bank steps and resonance check.
- lighting-design 0.1.0: preliminary estimate, IES/LDT import and DIALux report check.

### Changed

- The conversation rail's preview shows only the message text, without its number.

### Fixed

- Disabling plugin skills was slow, left the workbench editor with false unsaved changes and reported the
  disabled skills as unresolved names.
