# Plugin catalog release

Each VERA version has one catalog release of the official plugins. It is a flat folder, published as it is
(for example as the assets of one Gitea release). A mirror is a plain copy of that folder. The format and the
client rules are in spec `.agentic/specs/REQ-DATA-b40d3f9b.md` (§3, §3.1, §5).

## What the folder holds

| File | Read by | Signed |
|---|---|---|
| `<id>-<version>.zip` | every channel; one zip per plugin, stored once | through the SHA-256 in the signed index |
| `index.json` | the bundled catalog in the installer (`<resources>/plugins/`), every official plugin | no: the installer is the trust anchor |
| `index-stable.json` | remote catalog, channel Stable: plugins of version `1.0.0` and higher | `index-stable.json.sig` |
| `index-pre-release.json` | remote catalog, channel Pre-release: every plugin, 0.x included | `index-pre-release.json.sig` |

The user chooses the channel on the Plugins page (Catalog settings, Channel); Stable is the default.
A remote index whose `.sig` is missing (404) is refused as `unsigned`. One whose signature does not verify
with the public key built into VERA, or whose signed `channel` field names another channel, is refused as
`untrusted`. In both cases the page names the problem and shows
the bundled plugins, which also works offline. Update checks read the remote index at start and every 24 h
while a catalog URL is set and updates are not Off. They never install anything. The signature proves the
key and the channel, not the release: a host could still serve an older signed index of the same channel.

## Signing key

- The **public key** is `02_Tools/release/catalog-signing-key.pub.pem` (Ed25519, SPKI PEM). The desktop build
  pins it; the build input `VERA_PLUGIN_CATALOG_KEY` (a PEM file path) replaces it, and the build fails when
  the file is not an Ed25519 public key.
- The **private key** lives outside every repository, on the maintainer's machine:
  `%USERPROFILE%\.vera-release\catalog-signing-key.pem` (Windows) or `~/.vera-release/catalog-signing-key.pem`.
  `.gitignore` refuses a file with that name. Never copy it into a repository, an issue, a log or a chat.
  keygen writes it with mode 0600 on Linux. Windows ignores that mode, and the file takes the ACL of its
  folder; under `%USERPROFILE%` that ACL gives access to the user, SYSTEM and administrators only.
- **Back up the private key** (for example, in a password manager or on an offline medium). Without it, no
  new catalog that existing VERA builds trust can be released. Losing it means a new key pair, a new public
  key in the repository and a new VERA build. Older builds then accept no new remote catalog, but their
  bundled plugins keep working.
- A new key pair (only to replace a lost or exposed key), from `05_Software`:

  ```
  npm run vera -- catalog keygen --private <outside-the-repo>/catalog-signing-key.pem --public ../02_Tools/release/catalog-signing-key.pub.pem
  ```

  keygen never overwrites an existing file, so move the old public key away first.

## Release procedure

From `05_Software` (`python ../02_Tools/environment/npmw.py run …` uses the local Node.js):

1. Build the release: `npm run prepare:plugins`. It writes `07_Delivery/plugins/`, the zips and the three
   indexes, and replaces the folder as a whole.
2. Sign it with the pinned public key checked against the private key:

   ```
   npm run vera -- catalog sign --release ../07_Delivery/plugins --key <path-to-private-key> --public ../02_Tools/release/catalog-signing-key.pub.pem
   ```

   It prints `signed 2 indexes in …`. With a key that does not match the public key it writes nothing and
   exits 1. Sign after every rebuild: a rebuilt index no longer matches the old signature.
3. Check it locally through a loopback mirror:
   `python -m http.server 8123 --bind 127.0.0.1 --directory ../07_Delivery/plugins`. In VERA, enter
   `http://127.0.0.1:8123/` as the catalog URL (Plugins, Catalog settings). The page lists the stable
   plugins with no problem, and Pre-release lists every plugin.
4. Publish: create one release per VERA version, for example tag `catalog-v<VERA version>`. Upload every file
   of `07_Delivery/plugins/` as its assets: the zips, the three indexes and both `.sig` files. Assets have no
   folders, which is why the release is flat.
5. Point the build at it: set the build input `VERA_PLUGIN_CATALOG_URL` to the release's download folder,
   for example `https://<host>/<owner>/<repo>/releases/download/catalog-v<VERA version>/`. Then build and
   package VERA (`npm run package`). The URL must be `https`. Plain `http` is accepted only on this computer
   (loopback), so a LAN server reached over `http://` needs an HTTPS front end first.
6. Mirrors: copy the whole folder, `.sig` files included, and serve it over https. Users enter the mirror's
   folder URL as the catalog URL.

The installer always carries `07_Delivery/plugins/` as its bundled catalog, whatever the channel.
