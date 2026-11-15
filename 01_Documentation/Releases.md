# Versions, changelog and release notes

## Versions

- VERA uses Semantic Versioning. Every version below `1.0.0` is a pre-release (`AGENTS.md`,
  "Pre-release policy"): no migration or compatibility with earlier builds. `1.0.0` is the first
  public release.
- While below 1.0.0: MINOR for new capabilities or any breaking change, PATCH for fixes. From 1.0.0:
  MAJOR for breaking changes to stored data, the CLI or the plugin manifest; MINOR for compatible
  capabilities; PATCH for fixes.
- A beta is `x.y.z-beta.n`; the updater's `beta` channel offers it, `latest` does not.
- The app version has one source, `05_Software/src/apps/desktop/package.json`. Never edit it by
  hand: `set-version` writes it to every workspace package and the lockfile.
- Stored format versions (settings, `workbench.yaml` `format`, the database `schema_version`, …) are
  not release versions and stay `1` before 1.0.0.
- Each plugin has its own version in `plugin.yaml`; any change to a plugin's files raises it.
  Below `1.0.0` a plugin is shown as pre-release.

## CHANGELOG.md

- Keep a Changelog: `## [Unreleased]` first, then the latest release. Sections `Added`, `Changed`,
  `Fixed`, `Removed`, only those that have entries.
- One line per change, at most 120 characters, saying what changed for VERA, not how. Plugin changes
  start with the plugin id and new version: `- kicad 0.3.1: …`.
- A breaking change to stored data adds one line saying what to delete before starting the new build.
- Older releases live in `06_SoftwareDocu/CHANGELOG-archive.md`; `set-version` moves them there.

## Release notes

User-facing notes shown in Settings → About → What's new and written into each delivery as
`RELEASE-NOTES.md`. One file per release in `05_Software/release-notes/`: `unreleased.yaml` for the
work in progress, `<version>.yaml` for each release.

```yaml
version: Unreleased        # or the release, for example 0.2.0
date: null                 # the release date, for example 2026-12-01
entries:
  - category: new          # new | improved | fixed
    topic: { en: Plugins, ro: Plugin-uri, de: Plugins, fr: Plugins }
    text:
      en: Install plugins from a local catalog without network.
      ro: …
      de: …
      fr: …
```

- Add an entry only for a change a user can see: interface, CLI behavior, settings, plugins. Tests,
  tooling, refactoring and internal documents get none.
- `topic` names an area the user knows, in the interface's own words; `text` is plain user language
  of at most 100 characters in all four languages, with no file names, paths, code identifiers, or
  REQ/TASK ids.
- At most 10 entries per category in one release; merge related entries instead.
- `npm run check:release-notes` (part of `npm run verify`) checks all of this and warns when
  `CHANGELOG.md` changed without the release notes.

## Cutting a release

From `05_Software`, with a clean working tree:

1. `python ../02_Tools/environment/npmw.py node ../02_Tools/release/set-version.mjs <x.y.z>`. It
   refuses a version that is not SemVer or not higher than the current one, then:
   - writes the version to the four workspace packages and the lockfile;
   - turns `## [Unreleased]` into `## [x.y.z] - <today>` with a new empty `[Unreleased]` above it, and
     moves older releases to the archive;
   - renames `release-notes/unreleased.yaml` to `<x.y.z>.yaml` with today's date and starts a new
     empty `unreleased.yaml`.
2. `npm run verify`, commit (`release: x.y.z`), tag `vx.y.z`.
3. Build the delivery (`02_Tools/README.md`, Delivery); it takes the version from the same source.
