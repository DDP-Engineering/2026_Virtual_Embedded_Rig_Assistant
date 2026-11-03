# Contributing a plugin to the VERA catalog

This folder is a catalog source: every subfolder is one plugin package, `packs.yaml` groups plugins into
ecosystem packs, and `catalog.yaml` belongs to the maintainers. The hosted `vera-plugins` repository uses
the same layout under `plugins/`. Formats: plugin architecture §2 and §7; exact rules in the catalog spec
(`.agentic/specs/REQ-DATA-b40d3f9b.md` of the VERA repository).

## Adding or changing a plugin

1. Create `<id>/plugin.yaml` (format 1); the folder name is the plugin id. Add skills under
   `<id>/skills/<name>/SKILL.md` and helper scripts under `<id>/scripts/`, and a short `<id>/README.md`.
2. Declare every program with a reproducible install source: a pinned pip requirement range, a PEP 723
   script in the package, a download with its SHA-256 per platform, or a `find` search with a `hint`.
3. Give every program rules. Every command line the agent may run should match a rule with the right risk
   level: `safe` (no effect on hardware), `device-read`, `device-write`, `irreversible` or `blocked`. A
   command no rule matches runs as `device-write`, and the highest risk of all matching rules applies.
4. Add the plugin to a group in `packs.yaml` when it belongs to an ecosystem pack.
5. Run the check and fix every line it prints:

   ```bash
   vera catalog check --source plugins
   ```

The check rejects schema errors, a folder whose manifest id differs from its name, references to plugins
that do not exist, a program without any rule, and a rule at `safe` or `device-read` whose pattern contains
`burn`, `efuse`, `fuse`, `otp`, `rdp`, `lock`, `protect`, `secure`, `encrypt`, `transmit` or `send`.

## Review

A maintainer reviews every pull request before it merges: the programs and their install sources, every
rule and its risk level, and what the skills tell the agent to run. A rule that the token check flags but
that is safe at its level (for example `block` in a read command) is accepted by adding it to `reviewed`
in `catalog.yaml`; only maintainers change that file. Plugins listed under `official` are maintained by
the VERA maintainers; every other catalog plugin is `community`.

## Releases

A tag runs `vera catalog build --source plugins --out release`, which writes one
`<id>-<version>.zip` per plugin and `index.json` with each zip's size and SHA-256; the release publishes
those files together. VERA verifies every zip against the index before it shows the review screen. A
company mirror is a plain copy of a release folder.
