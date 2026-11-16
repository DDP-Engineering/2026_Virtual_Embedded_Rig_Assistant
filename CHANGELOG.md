# Changelog

Notable changes to VERA. Format: Keep a Changelog; versions: Semantic Versioning. Every version below
1.0.0 is a pre-release with no upgrade path from earlier builds. Rules: `01_Documentation/Releases.md`.
Older releases: `06_SoftwareDocu/CHANGELOG-archive.md`.

## [Unreleased]

### Added

- qelectrotech 0.1.0: read QElectroTech projects, draft DOL, reversing and star-delta schematics, check cross-references.
- panel-engineering 0.1.0: check control panels - BOM, terminals, 24 V budget, rail layout, heat, verification report.
- electrical-documentation 0.1.0: material, wire, cable, terminal, label and I/O lists, cross-checks, change report, CSV/XLSX/PDF.
- eplan 0.1.0: compare EPLAN Electric P8 2025 exports with the documentation, import part data into a copy (not yet run on EPLAN).

### Fixed

- The motor_drives scheme of a reversing starter with an overload relay now records the phase swap at the relay.

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
