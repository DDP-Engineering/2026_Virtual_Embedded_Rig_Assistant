# Changelog

Notable changes to VERA. Format: Keep a Changelog; versions: Semantic Versioning. Every version below
1.0.0 is a pre-release with no upgrade path from earlier builds. Rules: `01_Documentation/Releases.md`.
Older releases: `06_SoftwareDocu/CHANGELOG-archive.md`.

## [Unreleased]

### Changed

- Program runs and user terminal output follow live app/workbench masking, defaulting off; agent reads stay masked.

- Display masking follows app and workbench choices while keeping secret-named files visible and openable.

- Auto-edit uses saved command prefixes; destructive shell commands always ask outside Bypass.

- lab-validation 0.3.0: HIL validation reads host-approved outside inputs with workbench-owned output.

- Bypass extends to analysis, plugin drafts, HIL plans, bench resources and electrical inputs.

- Bypass runs declared programs in outside folders, binds outside files and stops its runs when Bypass ends.

- Bypass confirms each mode change; agent file access refuses VERA application data in every mode.
- Delete settings.json from earlier pre-releases after removal of the Bypass warning suppression preference.

### Added

- Masking configuration contracts and a shared resolver prepare per-area app defaults and workbench choices.

- User terminal tabs support interactive shells, resizing and explicit per-terminal consent for agent output reads.

- Runs shows shell commands, folders, live output and durations, with Stop and complete logs in the viewer.

- Workbenches grant file tools and shell working directories access to user-selected additional folders.

- The agent runs approved shell commands with configurable shells, full logs and monitored background runs.

- Bookmarked rail markers stand out, with configurable next and previous bookmark shortcuts.

- User messages and rail previews share bookmark controls; previews show the first prompt line and reply start.

- Per-session user-message bookmarks persist across restarts and remain in session exports.
- The document selection, its preview and the Files tab honor the workbench's .gitignore files (switch on by default).
- Per-workbench maximum file size (lowers the fixed limits) and maximum indexed files settings in Documents & RAG.
- Count guard: a selection above the maximum indexed files is not indexed until Index anyway or narrower exclusions.
- Documents preview in New workbench and the editor counts with the indexer's selection (ignore files, size and count limits), says "at least" when its 5-second limit stops it, and shows the count guard before saving.

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
