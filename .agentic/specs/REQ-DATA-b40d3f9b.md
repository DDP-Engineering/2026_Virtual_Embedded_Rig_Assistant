# Plugin catalog: source, release and client rules

Governs REQ-DATA-b40d3f9b and the catalog requirements that cite this spec. Implemented in
`05_Software/src/libraries/shared/src/plugin-catalog.ts` (schemas, token lint, version order, URL rule),
`05_Software/src/libraries/core/src/plugins/catalog-source.ts` (check and build) and
`05_Software/src/libraries/core/src/plugins/catalog.ts` (client).

## 1. Catalog source

A catalog source is one folder:

| Entry | Meaning |
|---|---|
| `<id>/` | one plugin package (architecture §2 format); the folder name is the manifest id |
| `packs.yaml` | the ecosystem packs (§1.1) |
| `catalog.yaml` | maintainer file (§1.2); maintainers own it (CODEOWNERS in the hosted repository) |
| any other file, and folders whose name starts with `.` | ignored (`CONTRIBUTING.md`, README, CI templates) |

The official plugins in `05_Software/plugins/` are such a source.

### 1.1 packs.yaml

A YAML list of packs, strict keys:

```yaml
- id: esp32                      # [a-z0-9-]{1,64}, unique
  name: ESP32 (Espressif)        # 1..80 characters
  groups:                        # 1..32
    - { name: Core, plugins: [serial-monitor, esp32-esptool], default: true }
    - { name: Security (irreversible), plugins: [esp32-efuse] }   # default: false
```

Group names are 1..80 characters and unique in their pack; `plugins` lists 1..64 distinct plugin ids.
At most 64 packs.

### 1.2 catalog.yaml

```yaml
format: 1
official: [serial-monitor, esp32-esptool]   # every other catalog plugin is community
reviewed:                                   # rules a maintainer accepted despite a dangerous token
  - { plugin: esp32-esptool, match: "esptool * read-flash-status *" }
metadata:
  serial-monitor:
    activities: [communication, debug]
    keywords: [UART, console]
    # addedAt and updatedAt are omitted when publication days are genuinely unknown.
```

`official` lists distinct plugin ids (default `[]`); `reviewed` entries name a plugin and the exact `match`
string of one of its rules (default `[]`).

`metadata` is a strict record keyed by plugin ids, at most1024 entries (default `{}` for an
unclassified current source). Its values are strict discovery objects: `activities` is a distinct
list of at most nine stable ids (`communication`, `flash`, `build`, `debug`, `firmware-analysis`,
`measurement`, `security`, `version-control`, `testing`); `keywords` is at most32 distinct trimmed
1..80-character strings. Both lists default to empty for genuinely unclassified entries. Keyword
uniqueness is case-sensitive after trimming. `addedAt` and `updatedAt` are optional real calendar
dates `YYYY-MM-DD`, first catalog publication and publication of the currently listed version.
Impossible dates, datetimes and extra keys are invalid. No dates are synthesized from file/commit/
build/cache/install time. Unknown dates stay omitted. These valid unknown states are not legacy
layout detection or conversion. All formats remain1.

## 2. Check (`vera catalog check --source <dir>`)

Every issue is one line `<where>: <code>: <detail>` on standard output; the exit code is 1 when there is
an issue and 0 otherwise. `<where>` is the plugin id (folder name) or the file name.

| Code | Raised when |
|---|---|
| `source` | `packs.yaml` or `catalog.yaml` is missing, is not UTF-8 YAML, or fails its schema (detail: the dotted field path and zod issue code, or the YAML line) |
| `package` | a plugin folder cannot be read with the store's import checks (links, unsafe names, limits, a root `install.json`) |
| `manifest` | the store's examination reports an issue (`manifest`, `yaml`, `field`, `id`); detail: the issue code, path and issue. A folder whose manifest id differs from the folder name (so two folders cannot carry one id) is `id` |
| `rules` | a declared program has no rule whose first pattern token matches the program name (rule grammar of REQ-FUNC-80b2033a) |
| `token` | a rule at `safe` or `device-read` whose `match`, lowercased, contains `burn`, `efuse`, `fuse`, `otp`, `rdp`, `lock`, `protect`, `secure`, `encrypt`, `transmit` or `send` as a substring, unless `catalog.yaml` lists `{plugin, match}` of that rule under `reviewed`; detail: the token and the match |
| `reference` | a pack, `requires`, `official`, `metadata` or `reviewed` entry names a plugin that is not in the source, or a `reviewed` entry names no rule of its plugin |
| `output` | build only: the output folder is not empty |

`blocked` rules are never flagged: they never run. Substring matching flags `block` and `clock` too
(they contain `lock`); a maintainer marks such rules reviewed.

## 3. Release (`vera catalog build --source <dir> --out <dir>`)

The build runs the check first; with any issue it prints them, writes nothing and exits 1. Otherwise it
creates `--out` (which must not exist or be empty, else the issue `<out>: output: the folder is not empty`
and exit 1) and writes:

- `<id>-<version>.zip` per plugin: the package files under one top folder `<id>/`, in ascending path
  order, deflated, every entry dated 1980-01-01 00:00, so the same source gives the same bytes;
- `index.json` (§4), in id order, with `bytes` and `sha256` of each zip. Should the plugins break an index
  limit of §4 (more than 1024), the build reports `index.json: source: <path> <zod code>` and writes nothing.

The exact serialized UTF-8 index (indentation and final newline included) must be at most4MiB.
Above this existing client limit, build reports `index.json: source: index exceeds 4194304 bytes`,
writes no output directory/files and exits1. Measure bytes, not JavaScript string length, because
valid discovery terms may be multibyte. Serialization is reused for the actual write.

The release job of the hosted repository runs the build on a tag and publishes the folder's files as
one release; a mirror is a plain copy of that folder.

## 4. index.json format 1

```json
{
  "format": 1,
  "plugins": [
    {
      "id": "serial-monitor", "version": "1.0.0", "tier": "official", "ecosystem": "serial",
      "platforms": ["windows-x64", "linux-x64"], "name": "Serial monitor", "description": "…",
      "requires": [], "url": "serial-monitor-1.0.0.zip",
      "activities": ["communication", "debug"], "keywords": ["UART", "console"],
      "sha256": "<64 lowercase hex>", "bytes": 12345
    }
  ],
  "packs": [ { "id": "esp32", "name": "ESP32 (Espressif)", "groups": [ { "name": "Core", "plugins": ["…"], "default": true } ] } ]
}
```

Strict keys. `tier` is `official` or `community`; `id`, `version`, `name`, `description`, `ecosystem`,
`platforms` and `requires` follow the manifest schema; `url` is a bare file name
(`[A-Za-z0-9][A-Za-z0-9._+-]*\.zip`, at most 255 characters, no `/`), resolved against the catalog folder
URL; `bytes` is 1..64 MiB (the zip import limit). At most 1024 plugins with distinct ids and 64 packs. An
index larger than 4 MiB is invalid.

Every released entry includes `activities` and `keywords` arrays and preserves supplied optional
`addedAt`/`updatedAt` dates using the same discovery schema as the maintainers' map. Generation is
deterministic and never adds a date. Discovery metadata does not change the package's manifest,
identity, trust tier or zip hash. `PluginCatalog.view` includes these entry fields unchanged in
both remote and bundled views, including when installed state/update markers are attached.
`vera catalog build` writes them into its output `index.json`; the CLI's existing summary line stays
`<count> plugins written to <out>`. `prepare:plugins` uses that same CLI path for packaged resources.

## 5. Client

- **Location.** The catalog is the folder URL in settings `plugins.catalog`, else the build-time default
  `VERA_PLUGIN_CATALOG_URL` (empty in every build until the official hosting exists). The URL rule: an
  absolute `https:` URL, or `http:` on `localhost`, `127.0.0.1` or `[::1]`, with no user name, password,
  query or fragment; a missing trailing `/` is added. The index is `<folder>index.json`; a zip is
  `<folder><url>`. A read whose final redirected URL is neither https nor http on a loopback host counts as
  a failed read (a query is fine there: release hosts redirect to signed storage links). A configured value
  that breaks the rule counts as no catalog.
- **Bundled catalog.** `<resources>/plugins/` in a package, `05_Software/src/bundled-plugins/` in
  development (`npm run prepare:plugins`): a release folder of the official plugins. The client reads it
  with the same index and zip checks.
- **View.** `plugins.catalog {refresh}` returns `{source: remote|bundled|none, url?, problem?:
  unreachable|invalid, checkedAt?, plugins, packs}`. With a remote location the client reads its index;
  when that read fails (transfer, HTTP status, redirect) the view is the bundled catalog with
  `problem: unreachable`; when the index is larger than 4 MiB or not valid JSON of §4, with `problem: invalid`. Without a
  remote location the view is the bundled catalog, or `none` (empty) without one. Each plugin carries
  `installed {version?, tier?}` when installed and `update: true` when its index version is higher than
  the installed one (semantic version precedence). `refresh: false` returns the last view, reading one
  when there is none.
- **Download.** `plugins.catalogReview {id}` reads the entry's zip from the view's source, streamed with a
  64 MiB cap. A size different from `bytes`, or a SHA-256 different from `sha256`, is refused with
  INVALID `plugins.catalogError.sha256` and nothing is kept. A failed transfer is OFFLINE
  `plugins.catalogError.download`. The verified zip is kept as `<userData>/plugins/catalog/<sha256>.zip`
  (written through a temporary file and a rename). A review first empties that folder, so only the zip
  of the latest review waits for install; a cancelled review leaves nothing once the next one starts.
- **Entry match.** The store reviews the kept zip. A manifest whose id or version differs from the entry,
  or a review with issues, is refused with INVALID `plugins.catalogError.mismatch` (issues: the store's
  first issue code) and the zip is removed.
- **Downgrade.** A review or install of an entry whose version is lower than the installed plugin's is
  refused with CONFLICT `plugins.catalogError.downgrade`.
- **Review decision.** The review result carries `required: true` when the plugin is not installed, the
  installed plugin has an issue, or the canonical JSON (keys sorted) of the manifest's `programs` or
  `rules` differs from the installed manifest's; otherwise `false`.
- **Install.** `plugins.catalogInstall {id, sha256}` re-hashes the kept zip of the current entry
  (CONFLICT when it is missing or differs), installs it bound to the reviewed integrity `sha256`
  (existing CONFLICT) with `tier` from the entry and `source {kind: catalog, path: <zip URL, or the bundled zip's file path>}`, then
  removes the kept zip.
- **Checks.** Desktop main reads the remote index after the window opens and every 24 h while a remote location
  is set and the VERA update mode is not `off`; it never installs. Each finished read emits the app event
  `plugins.catalog`. A failed scheduled read changes nothing visible but the view's `problem`.
