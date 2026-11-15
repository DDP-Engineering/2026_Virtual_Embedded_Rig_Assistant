# Delivery

Installers, portable packages, update feed files and release notes.

`plugins/` holds the official plugins as a catalog release (`<id>-<version>.zip` per plugin, `index.json`
and the channel indexes `index-stable.json` and `index-pre-release.json`), built by `npm run prepare:plugins`
from `05_Software`. It is git-ignored; development runs read it and `npm run package` ships it as
`<resources>/plugins/`. Signing and publishing it: [02_Tools/release/catalog-release.md](../02_Tools/release/catalog-release.md).
