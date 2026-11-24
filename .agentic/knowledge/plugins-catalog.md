# Plugin catalog, channels and signing

## Routing

Select for the plugin catalog: catalog check and release build, channel indexes and their signatures,
index read with the bundled fallback, verified zip downloads, the review decision, installs with the
catalog tier, update marks, `plugins.catalog*` IPC, the catalog URL and channel settings and the 24 h
checks (spec `.agentic/specs/REQ-DATA-b40d3f9b.md`). Start at
`05_Software/src/libraries/core/src/plugins/catalog.ts` (catalog client), `catalog-source.ts` (catalog check and
build) or shared `plugin-catalog.ts` (formats). [Official plugins](official-plugins.md) owns the shipped
plugin packages in `05_Software/plugins/` (one folder per plugin) and that folder's catalog source files
(`packs.yaml`, `catalog.yaml`). [Plugins page and Runs tab](plugins-ui.md) owns the Plugins page library,
the catalog rows and the source settings form; [Plugin provisioning and dependency kits](plugins-provisioning.md)
owns the offline dependency kit; [Plugin store, trust and integrity](plugins-store.md) owns the package
reader and install. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

The plugin catalog (spec `.agentic/specs/REQ-DATA-b40d3f9b.md`, mechanism in `00_Planning/Plugins.md`): core `catalog-source.ts` checks a catalog
source (plugin folders, `packs.yaml`, `catalog.yaml`) with the store's own package reader and builds its release
(`<id>-<version>.zip` per plugin, `index.json` format 1 and the channel indexes `index-stable.json`, version 1.0.0
and higher, and `index-pre-release.json`, every plugin), and signs a release's channel indexes with a detached Ed25519
`<index>.sig`. The CLI's `vera catalog check|build|keygen|sign` are the catalog's CI and release steps
(`02_Tools/release/catalog-release.md`). Core `PluginCatalog` (`catalog.ts`) is the client. It reads the channel
index `index-<channel>.json` (settings `plugins.channel`, `stable` when unset) from the catalog folder URL (settings
`plugins.catalog`, else the build input `VERA_PLUGIN_CATALOG_URL`). It uses that index only when its `.sig`
verifies with the public key pinned in the build (`VERA_PLUGIN_CATALOG_KEY`, default
`02_Tools/release/catalog-signing-key.pub.pem`) and its signed `channel` field is the requested channel. A
404 on the `.sig` is `unsigned`, any other failed `.sig` read is `unreachable`, and a failed check is
`untrusted`. An older signed index of the same channel is not detected (no expiry). Else it reads
`index.json` from the bundled release of the official plugins, which needs no signature. It verifies each zip's size and SHA-256 against the index, keeps it for the review, decides whether the
review must be shown, and installs it bound to the reviewed integrity hash with the entry's tier and source
`catalog` (the zip URL, or the bundled zip's file path). Desktop main
composes it with `net.fetch`, serves `plugins.catalog`, `plugins.catalogReview` and `plugins.catalogInstall`, and its
`CatalogChecks` (`main/catalog-checks.ts`) reads the index after the window opens and every resolved Plugin catalog
check interval (application Advanced, 1-168 h, default 24); `settingsChanged()` restarts the wait without a check. The Plugins page
presents source/URL and channel settings and management controls above one library (filters left, list right). Test
builds take the pinned key from `VERA_TEST_CATALOG_KEY` when it is set.

Discovery metadata is maintained by plugin id in `catalog.yaml.metadata`: stable activities,
bounded unique keywords and optional real calendar-day addedAt/updatedAt publication facts.
Shared `catalogDiscoverySchema` validates the same fields on entries; source validation refuses
unknown plugin references. Empty classification is valid; unknown publication dates stay absent.
The source builder writes discovery data into deterministic format1 index entries. UTF-8 output
exceeding the client's4MiB index cap is refused before creating any release files. Existing
PluginCatalog entry spreading and CLI catalog build preserve it into remote/bundled client views
and packaged resources without execution, trust or schema-version changes. Real official packages
are classified, with dates omitted until a publication record is established.

## Public interface

- Catalog (shared `plugin-catalog.ts`): `catalogIndexSchema` (index.json format 1 `{format, plugins, packs}`),
  `catalogEntrySchema`, `catalogPackSchema`, `catalogPacksSchema` (packs.yaml), `catalogMaintainersSchema`
  (catalog.yaml `{format, official, reviewed}`), `CATALOG_LIMITS`, `DANGEROUS_TOKENS`, `dangerousToken(match)`,
  `compareVersions(a, b)` (semantic version precedence), `catalogUrl(value)` (normalised folder URL or undefined),
  `catalogUrlSchema`, `pluginCatalogViewSchema`, `pluginCatalogReviewSchema`, `CATALOG_CHANNELS`,
  `catalogChannelSchema`, `catalogChannelIndex(channel)`; `ruleNamesProgram(match, program)` in `program-rules.ts`;
  settings `plugins.catalog?` and `plugins.channel?` (`stable` | `pre-release`).
- Catalog (core): `checkCatalogSource(folder)` -> `CatalogIssue[] {where, code, detail}`;
  `buildCatalogRelease(folder, out)` -> `{issues, index?}`; `catalogChannel(index, channel)`;
  `generateCatalogKeys(privatePath, publicPath)` (no overwrite); `signCatalogRelease(folder, privatePem, publicPem?)`
  -> signed index names; `readCatalogSource(folder)` -> `{issues, packages, official}`;
  `new PluginCatalog({store, root, location, channel?, publicKey?, bundled?, fetch,
  now?, uuid?})` with `view({refresh?, signal?})`, `review(id, signal?)`, `install(id, sha256)`; store
  `readPluginPackage(path)` and `install(path, sha256?, origin?: {tier, url})` (source kind `catalog`).
- IPC: `plugins.catalog {refresh}` -> view `{source: remote|bundled|none, url?, problem?: unreachable|invalid|unsigned|untrusted,
  checkedAt?, plugins (entries + installed? + update), packs}`; `plugins.catalogReview {id}` -> `{review, id, version,
  tier, required}`; `plugins.catalogInstall {id, sha256}` -> installed summary; app event `plugins.catalog`. The
  browser mock serves an ESP32 pack and a community plugin.

## Invariants

- Catalog check: every plugin folder (not starting with `.`) must pass the store's import checks and examination
  (folder name = id, so ids are unique); every program needs a rule whose first pattern token names it; a `safe` or
  `device-read` rule or an exact help invocation classified safe that contains a dangerous token as a
  case-insensitive substring is an issue unless `catalog.yaml` lists the exact `{plugin, match}` under
  `reviewed`. Packs, `requires` and `official` name existing plugins. Reviewed marks name existing rules
  or applicable exact help forms. The build writes nothing with any issue or a non-empty output folder; zips are
  deterministic (sorted entries under `<id>/`, dated 1980-01-01).
- Catalog URL: https, or http on localhost/127.0.0.1/[::1], no credentials, query or fragment; an invalid setting
  counts as none. A read whose final redirected URL is neither https nor loopback http is unreachable. A failed or
  invalid remote index falls back to the bundled release with `problem`; the bundled release's own failures leave
  the view `none`. The view is cached per location; `refresh` or a changed location reads again.
- Catalog downloads: an index above 4 MiB is invalid; a zip is read with its entry's `bytes` as the cap and refused
  INVALID `plugins.catalogError.sha256` unless its size and SHA-256 match; a transfer failure is OFFLINE
  `plugins.catalogError.download`; a package whose id or version differs from its entry, or with any issue, is
  INVALID `plugins.catalogError.mismatch`; a lower version than the installed one is CONFLICT
  `plugins.catalogError.downgrade`. A review empties `<userData>/plugins/catalog/` first and keeps only its verified
  zip; install re-hashes it against the entry (CONFLICT when missing or changed) and removes it.
- Catalog reviews and installs run one at a time per `PluginCatalog`, since they share the kept-zip folder. The catalog
  URL form saves only after the settings have loaded: its patch replaces the whole `plugins` object (index, proxy).
- `npm run prepare:plugins` builds a private CLI bundle in `node_modules/.cache` and never rewrites `src/apps/cli/dist`.
- A catalog review is required for a plugin that is not installed, an installed plugin with an issue, or a manifest
  whose `programs` or `rules` (canonical JSON) differ from the installed one; otherwise the page installs at once.
- Catalog checks run at start and every resolved interval (default 24 h) only while a catalog location is set and
  the update mode is not Off; a changed interval restarts the wait without a check (REQ-FUNC-ce542246);
  they read the index only and never install. Install selected reviews the checked groups' plugins that are not
  installed, each after its catalog requirements, one by one; Cancel drops the rest.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Catalog formats, token lint, URL rule, version order | shared `plugin-catalog.ts` | `plugin-catalog.test.ts` |
| Catalog check, release build, channel indexes, keygen and sign, `vera catalog` | core `catalog-source.ts`, CLI `catalog.ts`, `args.ts`; procedure `02_Tools/release/catalog-release.md` | `catalog-source.test.ts`, `tests/integration/cli.test.ts`, `tests/packaging/prepare-plugins.test.ts` |
| Catalog client: sources, channel, signature, downloads, review decision, install | core `catalog.ts`, store `install` origin | `catalog.test.ts` (loopback server, throwaway keys) |
| Catalog IPC, checks, build-time URL and pinned key | main `index.ts`, `catalog-checks.ts`, `electron.vite.config.ts`, `02_Tools/release/update-config.mjs`, `catalog-signing-key.pub.pem` | `catalog-checks.test.ts`, `plugins-ipc.test.ts`, `tests/packaging/updates.test.ts` |

## Key behaviors

- `REQ-DATA-b40d3f9b` — catalog source and release formats (spec REQ-DATA-b40d3f9b.md).
- `REQ-FUNC-3b9f62f8` / `REQ-SEC-dfc6a26d` / `REQ-SEC-5fa5cd5e` / `REQ-FUNC-f4381792` — catalog check, programs without
  rules, dangerous tokens, release build.
- `REQ-FUNC-98ded47a` / `REQ-SEC-a3c31442` — catalog location with the bundled fallback; URL rule.
- `REQ-SEC-449e334b` / `REQ-SEC-6305d7b7` / `REQ-SEC-69f9d44d` — wrong size or hash, entry mismatch, downgrade refused.
- `REQ-FUNC-f244f8f6` / `REQ-FUNC-46079512` / `REQ-FUNC-ce542246` — install with tier, review decision, interval checks.
- `REQ-PLAT-720aa4f2` — official plugins shipped as a bundled catalog release.
- `REQ-DATA-defb1bf4` / `REQ-DATA-dbeebbbe` / `REQ-FUNC-60329be6` — index dependency summary, declared download size,
  vendor guide required by catalog check.

## Files

- `05_Software/src/libraries/shared/src/plugin-catalog.ts`, `plugin-catalog.test.ts` — catalog formats and rules.
- `05_Software/src/libraries/core/src/plugins/catalog-source.ts`, `catalog-source.test.ts` — catalog check and build.
- `05_Software/src/libraries/core/src/plugins/catalog.ts`, `catalog.test.ts` — catalog client.
- `05_Software/src/apps/cli/src/catalog.ts` — `vera catalog check|build|keygen|sign`.
- `02_Tools/release/catalog-signing-key.pub.pem` — the catalog signing public key the desktop build pins; `catalog-release.md` — the release procedure.
- `05_Software/src/apps/desktop/src/main/catalog-checks.ts`, `catalog-checks.test.ts` — start, interval and changed-interval checks.
