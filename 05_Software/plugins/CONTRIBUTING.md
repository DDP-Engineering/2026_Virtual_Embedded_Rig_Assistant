# Contributing a plugin to the VERA catalog

This folder is a catalog source: every subfolder is one plugin package, `packs.yaml` groups plugins into
ecosystem packs, and `catalog.yaml` belongs to the maintainers. The hosted `vera-plugins` repository uses
the same layout under `plugins/`. Formats: plugin architecture §2 and §7; exact rules in the catalog spec
(`.agentic/specs/REQ-DATA-b40d3f9b.md` of the VERA repository).

## Adding or changing a plugin

1. Create `<id>/plugin.yaml` (format 1); the folder name is the plugin id. `summary` (at most 160
   characters) is the one line on the catalog card; `description` holds the details for the install review. Add skills under
   `<id>/skills/<name>/SKILL.md` and helper scripts under `<id>/scripts/`, and a short `<id>/README.md`.
2. Declare every program with a reproducible install source: a pinned pip requirement range, a PEP 723
   script in the package, a download with its SHA-256 per platform, or a `find` search with a `hint`.
   Give each published download its size in `bytes` (the catalog card shows it before any download; a longer
   transfer is refused as a hash mismatch). `vera catalog check` reports a `find` program without a `hint`: the hint
   is the vendor guide the card and the plugin page show, because VERA never installs a vendor program.
   Vendor activation uses `launcher: [eim, run]` and an explicit `launcherMode: string` or `argv`.
   Verify the actual transport on both platforms and document the evidence in README. With a launcher,
   `find` locates its first token; version probes and runs invoke the declared program through it.
   String mode refuses quotes and shell metacharacters and generates platform quoting; never put
   shell syntax in program arguments. Vendor suites and drivers remain user-installed.
   A program that opens windows on the user's desktop (an editor the helper drives, say) declares `gui: true`;
   only such a program receives the display variables (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, XDG_RUNTIME_DIR).
3. Give every program rules. Every command line the agent may run should match a rule with the right risk
   level: `safe` (no effect on hardware), `device-read`, `device-write`, `irreversible` or `blocked`. A
   command no rule matches runs as `device-write`, and the highest risk of all matching rules applies.
4. Declare what the user must provide in `settings`, one entry per parameter with a `description`:
   `kind: secret` with a `scope` (`mqtt`, `wokwi` or `parts`; the value stays in VERA's credential store),
   `kind: workbench-file` with a workbench-relative `path` (a `*` segment matches one folder level), an optional
   `format` (`lab-resources` validates it as `lab/resources.json`, `json` parses it) and `optional: true` when the
   plugin works without it, or `kind: value` with a read-only `value`. The plugin page shows each parameter's state, and a
   missing secret or a missing or invalid required file marks the plugin Needs configuration.
5. Add the plugin to a group in `packs.yaml` when it belongs to an ecosystem pack.
6. Run the check and fix every line it prints:

   ```bash
   vera catalog check --source plugins
   ```

The check rejects schema errors, a folder whose manifest id differs from its name, references to plugins
that do not exist, a program without any rule, and a rule at `safe` or `device-read` whose pattern contains
`burn`, `efuse`, `fuse`, `otp`, `rdp`, `lock`, `protect`, `secure`, `encrypt`, `transmit` or `send`.

## Electrical and automation plugins

Plugins with `ecosystem: electrical` or `ecosystem: automation` build on the workbench's electrical
project model, `electrical-automation-model.json` (kind `vera-electrical-model`, format 1). While such a
plugin is loaded, sessions offer `electrical_model` (read views and result freshness) and
`electrical_model_change` (validated operations and explicit-mapping imports, approved like a write).
A helper reads the model file and never writes it. It writes its result to a new run folder,
`electrical-automation-results/<run-id>/result.json` (kind `vera-electrical-result`, format 1), with the
method, engine version, assumptions, sources, conditions, intermediate values, limits, a status per run
and a verdict per criterion. `inputs` copies every model entity the run read (`{id, snapshot}`); VERA
marks the result stale when one of them changes. Entity IDs (`mot-p1`) are stable and differ from the
visible references (`ref`: M1, QF1); a quantity is `{value, unit, basis}` and `value: null` means
unknown. Units come from one table; the format is in `.agentic/specs/REQ-DATA-06c0bd54.md`.

Manufacturer data lives in industrial catalogs, `electrical-automation-catalogs/<id>.json` (kind
`vera-industrial-catalog`, format 1, spec `.agentic/specs/REQ-DATA-d7e27def.md`): an item is a manufacturer's order
code with an optional variant, accessories that are items of their own and distributor SKUs with their capture
time; each parameter is a quantity with conditions, a cited source (revision, page or table, licence terms) and the
status `confirmed` or `extracted`. VERA's `industrial_catalog` tool selects on firm requirements and answers
coordination questions for exact products and conditions; a result that used a catalog sets `catalog: {id,
version}` from the stamp the tool returns. A helper that reads a catalog file follows the same format and never
treats an extracted, absent or off-condition value as a pass.

Network calculations come from VERA's `electrical_network` tool (plugin `electrical-network`, spec
`.agentic/specs/REQ-DATA-42ce122f.md`): it reads the model and one cable table,
`electrical-automation-tables/<id>.json` (kind `vera-cable-table`, format 1, every value from one cited source with
its licence terms), and stores a result with stable intermediate names per subject - `designCurrent`,
`ik3MaxStart`, `peakCurrentStart`, `ik3MinEnd`, `ik1MinEnd` on circuits, `crossSection` and `currentCapacity` on
cables, `activePower:<scenario>` and `ik3Max` on boards. Protection, motor and power-quality helpers read those
values from the stored result (and check its freshness with `electrical_model` view `results`) instead of
recomputing them; `electrical_model` view `report` renders any stored result as Markdown.

Protective devices are checked by VERA's `protection_coordination` tool (plugin `protection-coordination`, spec
`.agentic/specs/REQ-DATA-a5673202.md`) against a current network result and one catalog. It reads catalog parameters
by name - `ultimateBreakingCapacity` (Icu), `serviceBreakingCapacity` or `serviceBreakingCapacityRatio` (Ics),
`ratedBreakingCapacity` (Icn, or a fuse's rated breaking capacity), `ratedCurrent` or `settingCurrentMin`/`Max`,
`conventionalTrippingCurrentRatio`, `magneticTripCurrent` or `magneticTripMultiple` with `magneticTripTolerance` and
`magneticTripTimeMax`, `tripCurrentMax` at condition `tripTime`, `letThroughEnergy` (A²s) - and coordination tables of
kind `selectivity`, `cascading`, `fuse coordination type 1|2` and `breaker coordination type 1|2`. Criteria are
`<criterion>:<orderCode>` per circuit (`breaking-capacity`, `rated-current`, `conventional-tripping`,
`disconnection-time`, `let-through-energy`, `selection`, ...); a motor helper reads the `selection` and starter
verdicts from the stored result. The generic `breakingCapacity` names no capacity kind and is never used.

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

Maintainers add discovery facts under `metadata.<plugin-id>` in `catalog.yaml`: `activities` uses
the stable ids `communication`, `flash`, `build`, `debug`, `firmware-analysis`, `measurement`,
`security`, `version-control`, `testing`, `design` (at most ten distinct values). `keywords` holds at most32
distinct trimmed 1..80-character search terms. Unclassified entries use empty lists.
Optional `addedAt` and `updatedAt` are real `YYYY-MM-DD` publication days: first catalog publication
and publication of the currently listed version. Omit genuinely unknown dates; never substitute
file, commit, build, download or install times. The checker rejects malformed discovery data and
metadata for nonexistent plugins. Discovery data belongs to the catalog, not the plugin zip.
No dates are asserted for the currently bundled plugins without a publication record.

A tag runs `vera catalog build --source plugins --out release`, which writes one
`<id>-<version>.zip` per plugin and `index.json` with each zip's size and SHA-256; the release publishes
those files together. VERA verifies every zip against the index before it shows the review screen. A
company mirror is a plain copy of a release folder.
