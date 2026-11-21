# Offline installation

VERA can be installed and used on a bench computer without network. The installer contains everything the application needs: the local indexing model, the Python tool installer and the official plugin catalog. The programs that plugins run are delivered separately, in an offline dependency kit. AI models still need a provider: on a computer without network, use a local server such as LM Studio or Ollama (see [Providers and models](providers.md)).

## The delivery folder

A VERA delivery is one folder per version, `vera-<version>/`:

| Folder | Content |
|---|---|
| `vera-windows-x64/` | `VERA-<v>-win-x64.exe` (installer), `VERA-<v>-win-x64.zip` (portable), `SHA256SUMS` |
| `vera-linux-x64/` | `VERA-<v>-linux-*.AppImage`, `VERA-<v>-linux-*.deb`, `SHA256SUMS` |
| `plugins/` | One `<id>-<version>.zip` per plugin, the catalog indexes, `vera-plugins-<version>.zip` with the whole catalog, `SHA256SUMS` |
| `plugin-deps/` | `vera-plugin-deps-<version>-windows-x64.zip` and `…-linux-x64.zip`, `SHA256SUMS` |
| `delivery.json` | What was built: versions, files, sizes and SHA-256 |

Copy the folder of your platform, and `plugin-deps/` if you want to use plugin programs. `plugins/` is needed only for plugins newer than your VERA installer. The dependency kit is about 1 GB per platform.

## 1. Check the files

Compare each file with its line in `SHA256SUMS`:

- Linux: run `sha256sum -c SHA256SUMS` in each folder.
- Windows (PowerShell): run `Get-FileHash <file> -Algorithm SHA256` and compare the hash with the line in `SHA256SUMS`.

Do not install a file whose hash differs; copy it again.

## 2. Install VERA

- Windows installer: run `VERA-<v>-win-x64.exe`. It installs for your user and needs no administrator rights.
- Windows portable: extract `VERA-<v>-win-x64.zip` and start `vera.exe`. Its settings and data stay in the `data` folder beside it.
- Linux: `sudo apt install ./VERA-<v>-linux-amd64.deb`, or make the AppImage executable with `chmod +x` and run it.
- With network, add the VERA apt repository so that `sudo apt upgrade` also updates a `.deb` installation: see [Settings](settings.md), **Updates**.

## 3. Install plugins

The **Plugins** page lists the official plugins of your VERA version from the catalog inside the installer; install them from there as usual (see [Plugins](plugins.md)). For a newer plugin from the delivery, select **Install from zip…** and pick `plugins/<id>-<version>.zip`.

## 4. Make plugin programs ready offline

1. Extract `vera-plugin-deps-<version>-<platform>.zip` to a local folder. The extracted folder contains `kit.json`.
2. Close VERA.
3. Open VERA's `settings.json` in a text editor. It is in `%APPDATA%\VERA\` on Windows, `~/.config/VERA/` on Linux, or in the `data` folder of the portable version.
4. Add the setting `plugins.kit` with the absolute path of the extracted folder, for example:

   ```json
   "plugins": { "kit": "D:\\vera-plugin-deps-<version>-windows-x64" }
   ```

   If `settings.json` already has a `plugins` entry, add `kit` inside it. In JSON, write each backslash twice.
5. Start VERA, open the plugin on the **Plugins** page and select **Install dependencies**.

VERA checks every file from the kit against the SHA-256 in the plugin's manifest and refuses a changed file. To install from the network again, remove `plugins.kit`.

To install a single program from an archive you copied yourself, use **Install from dependency archive…** on the plugin's card instead.

## Vendor programs

Vendor programs such as KiCad, LTspice or STM32CubeProgrammer are never part of the kit. The kit's `README.md` lists each one with its download page. Install them with the vendor's installer, then select **Check dependencies** on the plugin.
