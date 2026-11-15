# REQ-DATA-532b02f5 — Offline dependency kit per platform

## Behavior

`vera catalog kit --source <catalog source> --platform <windows-x64|linux-x64> --out <folder> [--skip <id>,...]`
reads the catalog source like `vera catalog build`. `--skip` leaves the named official plugins out, for example one
whose pinned files are not reachable from the build computer; an id that is not an official plugin of the source
exits 1 before anything is fetched. A source with any issue builds nothing. The kit covers the official plugins
(`catalog.yaml` `official`) whose `platforms` include the kit platform:

- **Download files.** Each program with a `download` entry for the platform (a `download` program, or a `find`
  program with a managed download). Each file is fetched from its pinned URL once per SHA-256 and checked against
  the manifest's `bytes` and `sha256`.
- **Wheels.** For each `pip` program (its requirement) and `script` program (its PEP 723 block), the pinned uv
  resolves the requirements for CPython 3.13 on the platform (`uv pip compile --python-platform`). pip 26.1.2
  on CPython 3.13, run through that uv, then downloads exactly the resolved files with `--prefer-binary
  --require-hashes` (the hashes come from that resolution and the package index). A requirement published only
  as source is built into a wheel during the kit build, so a bench never builds. A pure Python wheel
  (`-none-any`) is accepted on any build host. A compiled one is accepted only when the build host is the kit
  platform; otherwise the build fails and asks for that platform. Wheels shared by programs are stored once.
- **CPython.** The newest CPython 3.13 archive that the pinned uv lists for the platform
  (`uv python list --only-downloads --all-platforms`), when the kit has any pip or script program.
- **Vendor programs.** `find` programs without a download for the platform are not fetched. `kit.json` and
  `README.md` list them, with the manifest hint and its first link as the official download page.

The kit is written into a staging sibling of `--out`, which is renamed to `--out` only after every file is in place.
On any failure, or with an `--out` folder that exists and is not empty, the command exits 1. Its message names the
failing plugin program or file, and neither `--out` nor the staging folder remains. On success it prints
`kit <platform>: <n> downloads, <m> wheels, python <yes|no>, <bytes> bytes (<MiB> MiB) in <out>` and exits 0.

## Data / interface

Layout of a kit folder:

| Path | Content |
|---|---|
| `files/<sha256>/<name>` | a pinned download file. `<name>` is the URL's last path segment, decoded, or `download` when that is not a plain file name |
| `wheels/<wheel>.whl` | flat wheel folder, used as uv's find-links |
| `python/<release>/<archive>` | the CPython archive, laid out as uv's `UV_PYTHON_INSTALL_MIRROR`: the last two URL segments, decoded |
| `kit.json` | the index, below |
| `README.md` | what the kit holds, its size, how to use it, the vendor programs and their download pages |

`kit.json` format 1 is UTF-8 JSON with 2-space indentation. Lists are sorted, with no timestamps, so the same
manifests and the same resolved wheels give the same file:

```json
{
  "format": 1,
  "platform": "windows-x64",
  "plugins": [{ "id": "arduino-cli", "version": "0.2.0" }],
  "downloads": [
    { "file": "files/<sha256>/arduino-cli_1.6.0_Windows_64bit.zip", "sha256": "<sha256>", "bytes": 20404890,
      "url": "https://downloads.arduino.cc/...", "programs": ["arduino-cli/arduino-cli"] }
  ],
  "programs": [{ "program": "can-dbc/cantools", "kind": "pip" }],
  "wheels": [{ "file": "wheels/cantools-45.1.2-py3-none-any.whl", "sha256": "<sha256>", "bytes": 1 }],
  "python": { "file": "python/<release>/<archive>", "bytes": 1 },
  "vendor": [{ "program": "kicad/kicad-cli", "guide": "<manifest hint>", "link": "https://..." }],
  "skipped": ["sigrok"],
  "bytes": 1
}
```

`python` is omitted when no program needs it, `skipped` when nothing is skipped; `link` is omitted when the hint has none. `bytes` is the sum of all
files of the kit except `kit.json` and `README.md`.

The bench side reads only the layout, never `kit.json`. Trust comes from the manifests and the pinned uv, never from
the kit: download files must match the manifest SHA-256 on the bench; the CPython archive must match the SHA-256
built into the pinned uv; wheels come from the kit folder as from the package index the user configures.

## Examples

- Windows kit: `arduino-cli` (download `windows-x64`) gives `files/<sha>/arduino-cli_1.6.0_Windows_64bit.zip`;
  `kicad` (`find` only) appears under `vendor` with link `https://www.kicad.org/download/`.
- Linux kit: `ltspice` (platforms `windows-x64` only) is absent; a `script` dependency marked
  `sys_platform == 'win32'` has no wheel.
- Edge: two programs pinning the same SHA-256 give one `downloads` entry with both programs.
- Failure: a download whose served bytes hash differently exits 1 naming `<plugin>/<program>`, and no kit folder
  exists afterwards.

## Acceptance

The core tests and the CLI argument tests named in the requirement pass, and a real partial build of the official
plugins (PyPI wheels and arduino-cli) installs pip, script and download programs offline on Windows.
