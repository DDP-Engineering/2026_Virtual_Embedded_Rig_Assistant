# ADR-0019: One plugin catalog with official and community tiers

Date: 2026-11-01
Status: Accepted by the user on 2026-11-01 (community plugins allowed); mechanism proposed.

## Context
The plugin library should become as complete as possible, which needs contributions beyond VERA's
maintainers. Plugins run code with the user's rights, so where a plugin comes from must stay
visible, and what it does must be reviewable.

## Decision
One Git repository holds every catalog plugin and `packs.yaml`. CI validates each pull request; a
tagged release publishes `index.json` and one zip per plugin with its SHA-256. Tiers:
- `official`: maintained by VERA maintainers;
- `community`: merged by pull request after CI and a maintainer's review of programs, install
  sources and rules;
- `local`: installed from a folder or zip, outside the catalog.

VERA reads the index from a catalog URL setting (default: official; companies may set a mirror). It
verifies hashes, shows the tier, and opens a review screen before a first install and before any
update that changes programs, rules or install sources. It never updates plugins automatically.
Signing the index is deferred until review by maintainers no longer scales.

## Alternatives considered
- Official plugins only: easier to trust, but the library grows only at the maintainers' pace.
- An open registry without review: grows fastest, but leaves trust entirely to each user.

## Consequences
- Maintainers review rules and install sources, not only code.
- CI owns the dangerous-token lint (`burn`, `efuse`, `fuse`, `otp`, `rdp`, `lock`, `protect`,
  `secure`, `encrypt`, `transmit`, `send` at a level below `device-write`).
