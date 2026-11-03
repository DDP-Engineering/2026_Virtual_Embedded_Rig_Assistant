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
   Vendor activation uses `launcher: [eim, run]` and an explicit `launcherMode: string` or `argv`.
   Verify the actual transport on both platforms and document the evidence in README. With a launcher,
   `find` locates its first token; version probes and runs invoke the declared program through it.
   String mode refuses quotes and shell metacharacters and generates platform quoting; never put
   shell syntax in program arguments. Vendor suites and drivers remain user-installed.
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

## Draft with the agent

Load the official `create-plugin` skill and provide the CLI manual (or its `--help` output) and the
operations you need. Drafts live in the workbench under `plugins/<id>/`; `plugin_validate` reports
schema errors and lint warnings. `plugin_install` asks you to review the manifest and installs its
exact bytes as **trial**, without enabling it or installing its programs. Enable it and install its
programs on the Plugins page. Every trial command asks for approval, including in bypass; irreversible
commands also need the typed word. Test with virtual fixtures before any real hardware.

Edit and reinstall the draft while it is trial. Only you can use **Promote to local** on the Plugins
page to trust the rules. After promotion the session mode applies normally, including unattended
bypass commands. The agent cannot enable, promote, change mode or edit installed files.

Use **Export zip** to share a healthy plugin. The zip omits `install.json`, resolved program versions
and machine-local runtime files. Include manual links, supported versions/platforms, command/risk
coverage, fixture tests and explicit hardware evidence or limitations with a catalog pull request.
An exported local/trial package does not carry catalog trust; maintainers still review it.

## Maintainer review

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
