# Changelog

Notable changes to VERA. Format: Keep a Changelog; versions: Semantic Versioning. Every version below
1.0.0 is a pre-release with no upgrade path from earlier builds. Rules: `01_Documentation/Releases.md`.
Older releases: `06_SoftwareDocu/CHANGELOG-archive.md`.

## [Unreleased]

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

## [0.1.0] - 2026-11-15

### Added

- First versioned pre-release of the VERA desktop app and CLI for Windows x64 and Linux x64.
- Workbenches, sessions with steering and compaction, approvals, document indexing and hybrid search.
- Providers: OpenAI API, ChatGPT subscription, LM Studio, Ollama and other OpenAI-compatible endpoints.
- 37 official plugins for electronics design, embedded development, lab automation, Arduino and IoT.
- Plugin catalog with review, dependencies, parameters, packs and an offline dependency kit.
- In-app help for VERA and every plugin in English, Romanian, German and French; a help tool for the agent.
- French interface.
- Release notes in Settings → About → What's new.
- Delivery scripts for installers, plugin packages and dependency kits in `07_Delivery`.
