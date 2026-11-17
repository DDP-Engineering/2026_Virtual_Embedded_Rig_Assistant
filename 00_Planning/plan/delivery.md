# DEL — Delivery packages

PURPOSE: one command per deliverable that builds VERA for Windows and Linux and the plugins as a
separate deliverable, and collects them, with checksums, in `07_Delivery`.
STATE: implemented 2026-11-15 (`02_Tools/delivery/`); repository tooling, without AEGIS at the user's
request.

## Decisions (agreed with the user, 2026-11-15)

- **Three independent deliverables:** VERA Windows, VERA Linux, plugins. Plugins have their own
  version cadence (ADR-0019); a plugin fix never needs a new installer.
- **The installer stays self-contained for the app itself** and needs no network to install or start:
  model, uv, VC++ runtime and the official plugin catalog (manifests, skills and scripts only,
  ~1 MB) are already inside it (`electron-builder.yml` `extraResources`). The catalog stays inside so a
  first plugin install works offline.
- **Plugin programs are not inside the installer or the plugin zips.** Plugins declare them (`find`,
  pinned `download`, pip, script) and `requires:` other plugins for shared tools. The offline
  dependency kit (`vera catalog kit`, PLG-08) carries the pinned files once per SHA-256.
- **Plugins ship both ways:** one zip per plugin with the signed index (install, update and review one
  at a time; Install from zip…), and one archive of the whole catalog for an offline machine.
- **Kit size, from the manifests (unique SHA-256):** windows-x64 9 files ~1.07 GB, linux-x64 8 files
  ~0.98 GB, plus wheels and CPython. The binutils RISC-V and ARM toolchains are ~760 MB / ~705 MB of
  that. One kit per platform; no split for now.
- **Scripts are Node.js `.mjs`** like the rest of `02_Tools`, run with the local toolchain
  (`npmw.py`), import packages through `environment/software.mjs`, and are linted with the other
  tool folders.
- **Each platform is built on its own host.** Native modules and the compiled `can-python` wheel need
  it. A script refuses another host platform.

## Layout of 07_Delivery

Everything below `07_Delivery/` except `README.md` is git-ignored.

```
07_Delivery/
  README.md
  vera-<version>/
    vera-windows-x64/   VERA installer (.exe), portable zip, RELEASE-NOTES.md, SHA256SUMS
    vera-linux-x64/     AppImage, deb, RELEASE-NOTES.md, SHA256SUMS
    plugins/            <id>-<version>.zip, index.json, index-stable.json, index-pre-release.json
                        (+ signatures when signed), vera-plugins-<version>.zip, LICENSE.txt, SHA256SUMS
    plugin-deps/        vera-plugin-deps-<version>-windows-x64.zip, …-linux-x64.zip, SHA256SUMS
    delivery.json       what was built: version, commit, host per part, files with SHA-256 and size
```

`<version>` is the desktop package version (`src/apps/desktop/package.json`, `0.2.0`). For version
`0.0.0` the folder is `vera-0.0.0-<short commit>` so two builds never collide. A script refuses to overwrite
an existing part folder; `--replace` replaces only the part it builds.

The existing working folders stay as they are: `07_Delivery/plugins/` (built by
`npm run prepare:plugins`, read by development runs and packaged into the installer) and
`05_Software/release_tmp/` (packaging staging). Delivery scripts copy from them and never edit them by
hand.

## Work packages

| WP | Script (02_Tools/delivery/) | npm script (05_Software) | Result |
|---|---|---|---|
| DEL-01 | `delivery-common.mjs` | — | shared helpers: version and folder name, host platform check, SHA-256 of a file, `SHA256SUMS` writer, `delivery.json` merge, refuse or replace a part folder |
| DEL-02 | `build-vera-installers.mjs --platform windows-x64\|linux-x64 [--replace]` | `delivery:vera` | runs `npm run package` (release mode, never the instrumented build), copies the installers named in `release_tmp/release/package-report.json` (or the built files) into `vera-<platform>/`, writes `SHA256SUMS` |
| DEL-03 | `build-plugin-packages.mjs [--signing-key <pem>] [--replace]` | `delivery:plugins` | runs `npm run prepare:plugins`, signs the indexes with `vera catalog sign` when a key is given (otherwise records `signed: false`), copies the catalog into `plugins/`, zips the whole catalog as `vera-plugins-<version>.zip`, writes `SHA256SUMS` |
| DEL-04 | `build-plugin-deps-kit.mjs --platform windows-x64\|linux-x64 [--skip <ids>] [--replace]` | `delivery:plugin-deps` | runs `vera catalog kit` into a temporary folder (default `--skip sigrok`, as `catalog-release.md` documents), zips it as `vera-plugin-deps-<version>-<platform>.zip`, writes `SHA256SUMS`; needs network and the pinned uv |
| DEL-05 | `verify-delivery.mjs [<folder>]` | `delivery:verify` | checks every `SHA256SUMS` and `delivery.json` entry against the files, the same version in every part, the expected files per part, and the plugin zips against the index; prints what is present, missing or unsigned; exit 1 on a mismatch; publishes nothing |
| DEL-06 | docs | — | `02_Tools/README.md` gets a Delivery section and the folder tree; `07_Delivery/README.md` is rewritten for the new layout, with an `INSTALL` section for a bench without network (install VERA, install plugins from the catalog, set `plugins.kit` to the extracted kit, Install dependencies); `.gitignore` ignores `/07_Delivery/vera-*/`; the `lint` script includes `../02_Tools/delivery` |

Each script prints the part folder, the files with their sizes and the next step, and leaves no
half-written part on failure (build in a temporary folder, rename at the end).

## Verification

- `npm run lint` passes with the new folder included.
- On Windows: `delivery:plugins`, `delivery:vera -- --platform windows-x64`, then `delivery:verify`
  pass; a changed byte in any delivered file makes `delivery:verify` fail.
- `delivery:plugin-deps -- --platform windows-x64` downloads ~1 GB; run it once and verify the zip.
- On Linux (WSL is enough for the build): the same with `linux-x64`. Not running it is stated, not
  implied.
- Focused tests for the shared helpers in `05_Software/tests/tooling/` (version naming, checksum
  writer and verifier, refusal to overwrite).

## Later, separate (product code, AEGIS)

- VERA finds a kit by itself (for example a `kit.json` next to the installer, or a folder chosen in
  Settings → Plugins) instead of a hand-written `plugins.kit` in `settings.json`.
- A local catalog folder or zip as a catalog source, so an offline machine can update plugins from
  `vera-plugins-<version>.zip`; today the catalog URL accepts only HTTPS or loopback.
- `gdb-debug` could `requires: [binutils]` and use the `arm-none-eabi-gdb` in the xPack binutils
  already downloads, instead of asking the user to install it.
- Windows code signing (not configured; SmartScreen warns).
