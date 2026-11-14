# Delivery

Installers, portable packages, update feed files and release notes.

`plugins/` holds the official plugins as a catalog release (`<id>-<version>.zip` per plugin and
`index.json`), built by `npm run prepare:plugins` from `05_Software`. It is git-ignored; development runs
read it and `npm run package` ships it as `<resources>/plugins/`.
