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

Packs remain validated catalog data. The global library uses one filterable list (state buttons All/Not installed/Installed/New/Updates/Needs configuration) and
individual prerequisite-aware review, without pack-selection controls (REQ-UX-28a74094.md).

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
list of at most ten stable ids (`communication`, `flash`, `build`, `debug`, `firmware-analysis`,
`measurement`, `security`, `version-control`, `testing`, `design`); `keywords` is at most32 distinct trimmed
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
| `dependency` | a `find` program declares no `hint` (the index lists the hint as its vendor guide); detail: `program <name> has no vendor guide` |
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

It also writes the two channel indexes, in the same format and serialization:

- `index-pre-release.json`: every plugin of `index.json`, with its packs unchanged;
- both channel indexes carry `"channel": "<channel>"` (optional in the §4 schema, absent from `index.json`), so
  the signature covers the channel;
- `index-stable.json`: only the plugins whose version is stable (shared `pluginMaturity`: major version
  1 or higher and no pre-release tag). Each pack group keeps only plugins of the channel. A group left
  empty is dropped, and so is a pack left without groups.

The zips are stored once; the channel entries name the same files. A release is one flat folder, so it
can be uploaded as the assets of one release (release assets have no folders), and a mirror is a plain
copy of that folder. `npm run prepare:plugins` builds it into `07_Delivery/plugins/`.

## 3.1 Signing (`vera catalog keygen`, `vera catalog sign`)

- `vera catalog keygen --private <file> --public <file>` writes a new Ed25519 key pair: the private key as
  PKCS#8 PEM (file mode 0600 on Linux; Windows ignores the mode, and the file takes its folder's ACL) and the public key as SPKI PEM. If either file
  already exists, nothing is written and the exit code is 1.
- `vera catalog sign --release <dir> --key <private.pem> [--public <public.pem>]` signs
  `index-stable.json` and `index-pre-release.json` of the release. For each, it writes `<index>.sig`: the
  base64 Ed25519 signature of the index file's exact bytes and a final newline. When `--public` is given
  and it is not the private key's public key, nothing is written and the exit code is 1. A missing
  channel index is also exit 1, with nothing written. It prints `signed <n> indexes in <dir>`.
- `index.json`, which only the bundled catalog reads, is not signed: the installer carries it.
- The real private key lives outside every repository (see `02_Tools/release/catalog-release.md`). The repository
  holds only the public key, `02_Tools/release/catalog-signing-key.pub.pem`.

## 4. index.json format 1

```json
{
  "format": 1,
  "plugins": [
    {
      "id": "serial-monitor", "version": "1.0.0", "tier": "official", "ecosystem": "serial",
      "platforms": ["windows-x64", "linux-x64"], "name": "Serial monitor", "summary": "…", "description": "…",
      "risk": "device-write", "requires": [], "url": "serial-monitor-1.0.0.zip",
      "dependencies": [ { "name": "serial", "kind": "script", "automatic": true, "script": "scripts/serial_monitor.py" } ],
      "activities": ["communication", "debug"], "keywords": ["UART", "console"],
      "sha256": "<64 lowercase hex>", "bytes": 12345
    }
  ],
  "packs": [ { "id": "esp32", "name": "ESP32 (Espressif)", "groups": [ { "name": "Core", "plugins": ["…"], "default": true } ] } ]
}
```

Strict keys. `tier` is `official` or `community`; `id`, `version`, `name`, `summary`, `description`,
`ecosystem`, `platforms` and `requires` follow the manifest schema; `risk` is the highest rule risk of the
manifest below `blocked` (`safe`, `device-read`, `device-write` or `irreversible`), `safe` when it has none; `url` is a bare file name
(`[A-Za-z0-9][A-Za-z0-9._+-]*\.zip`, at most 255 characters, no `/`), resolved against the catalog folder
URL; `bytes` is the zip's exact size, at least 1 (no upper limit). `dependencies` (at most 64) is shared
`pluginDependencies(manifest)`, one item per program in name order: `{name, kind: pip|script|download|find, automatic
(kind is not find), pip?, script?, downloads?: [{platform, sha256, bytes?}] in platform order, find?: [windows|linux],
range?, guide? (the manifest hint)}`. At most 1024 plugins with distinct ids and 64 packs. An
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
  query or fragment; a missing trailing `/` is added. The remote index is the channel's
  `<folder>index-<channel>.json`, where the channel is settings `plugins.channel` (`stable` or
  `pre-release`, `stable` when unset); a zip is `<folder><url>`. A read whose final redirected URL is
  neither https nor http on a loopback host counts as a failed read (a query is fine there: release hosts
  redirect to signed storage links). A configured value that breaks the URL rule counts as no catalog.
- **Signature.** A remote channel index is used only when `<folder>index-<channel>.json.sig` is read and
  its base64 Ed25519 signature verifies the index bytes with the public key pinned in the build (build
  input `VERA_PLUGIN_CATALOG_KEY`, a PEM file path, default `02_Tools/release/catalog-signing-key.pub.pem`;
  the build fails when it is not an Ed25519 public key). A signature file the server answers 404 for gives
  the problem `unsigned`; any other failed signature read is `unreachable`. A signature that does not
  verify, a client with no pinned key, or a verified index whose `channel` is not the requested channel
  gives the problem `untrusted`. In each case the bundled catalog stands in. The signature is checked
  before the index is parsed. There is no path for unsigned remote catalogs. Limit: the signature proves
  the release key and the channel, not the release; a host can serve an older signed index of the same
  channel (no expiry or rollback check).
- **Bundled catalog.** `<resources>/plugins/` in a package, `07_Delivery/plugins/` in
  development (`npm run prepare:plugins`): a release folder of the official plugins. The client reads it
  with the same index and zip checks. It reads `index.json` (every official plugin) whatever the channel,
  and it needs no signature: the installer that carries it is the trust anchor, and it works offline.
- **View.** `plugins.catalog {refresh}` returns `{source: remote|bundled|none, url?, problem?:
  unreachable|invalid|unsigned|untrusted, checkedAt?, plugins, packs}`. With a remote location the client reads its index;
  when that read fails (transfer, HTTP status, redirect) the view is the bundled catalog with
  `problem: unreachable`; when the index is larger than 4 MiB or not valid JSON of §4, with `problem: invalid`. A signature problem gives `unsigned` or `untrusted` (Signature above). Without a
  remote location the view is the bundled catalog, or `none` (empty) without one. Each plugin carries
  `installed {version?, tier?}` when installed and `update: true` when its index version is higher than
  the installed one (semantic version precedence). `refresh: false` returns the last view, reading one
  when there is none.
- **Download.** `plugins.catalogReview {id}` reads the entry's zip from the view's source, streamed and
  stopped past `bytes`. A size different from `bytes`, or a SHA-256 different from `sha256`, is refused with
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
- **Checks.** Desktop main reads the remote index after the window opens and every resolved Plugin catalog check interval
  (default 24 h, REQ-FUNC-ce542246) while a remote location
  is set and the VERA update mode is not `off`; it never installs. Each finished read emits the app event
  `plugins.catalog`. Changing the channel changes the location key, so the next view reads the new channel's index. A failed scheduled read changes nothing visible but the view's `problem`.
