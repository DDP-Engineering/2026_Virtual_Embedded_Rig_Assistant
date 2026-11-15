# Delivery

Three independent deliverables: VERA for Windows, VERA for Linux, and the plugins with their offline
dependency kits. A plugin fix never needs a new installer. Everything here except this README is git-ignored.

```
07_Delivery/
  plugins/                   working catalog release, built by npm run prepare:plugins
  vera-<version>/
    vera-windows-x64/        VERA-<v>-win-x64.exe (installer), VERA-<v>-win-x64.zip (portable), RELEASE-NOTES.md, SHA256SUMS
    vera-linux-x64/          VERA-<v>-linux-*.AppImage, VERA-<v>-linux-*.deb, RELEASE-NOTES.md, SHA256SUMS
    plugins/                 <id>-<version>.zip, index.json, index-stable.json, index-pre-release.json,
                             (*.sig when signed), vera-plugins-<version>.zip, LICENSE.txt, SHA256SUMS
    plugin-deps/             vera-plugin-deps-<version>-windows-x64.zip, …-linux-x64.zip, SHA256SUMS
    delivery.json            version, commit and host per part, files with SHA-256 and size
```

`<version>` is the desktop package version; while it is `0.0.0` the folder is `vera-0.0.0-<short commit>`.

## Building a delivery

From `05_Software`, each with `python ../02_Tools/environment/npmw.py npm run …`:

| Part | Command | Host |
|---|---|---|
| `plugins/` | `npm run delivery:plugins [-- --signing-key <private-key-file>]` | any |
| `vera-windows-x64/` | `npm run delivery:vera -- --platform windows-x64` | Windows x64 |
| `vera-linux-x64/` | `npm run delivery:vera -- --platform linux-x64` | Linux x64 |
| `plugin-deps/` | `npm run delivery:plugin-deps -- --platform windows-x64` or `linux-x64` (~1 GB download) | that platform |
| check | `npm run delivery:verify [-- <folder>]` | any |

A part that exists is refused; `--replace` rebuilds only that part. `delivery:verify` checks the checksums,
`delivery.json`, the version, the expected files, the plugin zips against the indexes and the index
signatures, lists the missing parts, and exits 1 on a mismatch. It publishes nothing. The scripts are
described in [02_Tools/README.md](../02_Tools/README.md#delivery); signing and publishing the catalog in
[catalog-release.md](../02_Tools/release/catalog-release.md).

The installer already contains the model, uv, the VC++ runtime (Windows) and the official plugin catalog
(manifests, skills and scripts). It needs no network to install or start. The plugins' programs are not in the
installer or the plugin zips; the dependency kit carries them.

`plugins/` at the top is the working catalog release that development runs read and `npm run package` ships
as `<resources>/plugins/`. Delivery scripts copy it; they never change it.

## INSTALL on a bench without network

Copy the parts you need: `vera-<platform>/`, and for plugin programs `plugin-deps/` (the zip of your
platform). `plugins/` is needed only for plugins newer than the installer.

1. **Check the files.** Linux: `sha256sum -c SHA256SUMS` in each folder. Windows (PowerShell):
   `Get-FileHash <file> -Algorithm SHA256` and compare with the line in `SHA256SUMS`.
2. **Install VERA.**
   - Windows: run `VERA-<v>-win-x64.exe` (per user, no administrator rights). Portable: extract
     `VERA-<v>-win-x64.zip` and start `vera.exe`; its data stays in `data\` beside it.
   - Linux: `sudo apt install ./VERA-<v>-linux-amd64.deb`, or `chmod +x` the AppImage and run it.
3. **Install plugins.** The Plugins page lists the official plugins of this version from the catalog inside
   the installer; install them from there. For a newer plugin from this delivery, choose
   **Install from zip…** and pick `plugins/<id>-<version>.zip`.
4. **Make their programs ready offline.** Extract `vera-plugin-deps-<version>-<platform>.zip`. Set
   `plugins.kit` in VERA's `settings.json` to the extracted folder (the one with `kit.json`), for example
   `"plugins": { "kit": "D:\\vera-plugin-deps-<version>-windows-x64" }`. `settings.json` is in
   `%APPDATA%\VERA\` (Windows), `~/.config/VERA/` (Linux) or `data\` of the portable folder. Then choose
   **Install dependencies** on the plugin page, or run `vera plugin provision`.
5. **Vendor programs** such as KiCad, LTspice or STM32CubeProgrammer are never in the kit; the kit's
   `README.md` lists each one with its download page. Install them separately.

Every file from the kit is checked against the SHA-256 in the installed plugin's manifest; a changed file is
refused. Remove `plugins.kit` to install from the network again.
