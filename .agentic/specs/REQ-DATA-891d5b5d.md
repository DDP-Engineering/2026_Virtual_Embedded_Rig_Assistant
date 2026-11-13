# kicad-layout: candidate boards, operations, checks and the apply tool

Spec for the `kicad-layout` plugin and VERA's `apply_candidate` tool (TASK-6101faa4, ELEC-06). Units are millimetres
and degrees everywhere; KiCad's nanometres are converted at the API boundary. Formats stay at version 1.

## 1. Programs

- `kicad-cli`: found as the `kicad` plugin finds it (`%ProgramFiles%/KiCad/*/bin/kicad-cli.exe`, `/usr/bin/kicad-cli`,
  PATH), version range `>=10.0,<11`. Every direct `kicad-cli` command except version and help is blocked.
- The PCB editor is `pcbnew` (`pcbnew.exe` on Windows) in the folder of that kicad-cli; it is never a program of its own.
- `kicad-layout-tool`: the script `scripts/kicad_layout_tool.py`, `uses: [kicad-cli]`, `gui: true` (it starts KiCad's
  PCB editor window, so VERA's runner passes it the desktop's display variables, which other programs never get), with
  the PEP 723 dependencies
  `kicad-python==0.8.0`, `protobuf==5.29.6`, `pynng==0.9.0`. kicad-python's version check is not called (it refuses
  any KiCad newer than its 10.0.6 build; KiCad keeps existing API messages stable).
- Rules: `kicad-layout-tool {--version,--help,-h}` and `kicad-layout-tool {open,edit,close} *` are `safe`: they
  change only the run folder and the candidate window the helper opened, never the source board.
- Platforms: windows-x64 and linux-x64.

## 2. The API connection

- Socket: `ipc://<temp>/kicad/api.sock` (Windows: the user's temporary folder, a named pipe; Linux: `/tmp/kicad`).
  Only that socket is used: on Windows only the first KiCad process serves the API (probe 2026-11-13).
- Binding: an operation is bound when the API's open PCB documents include one whose project folder and board file
  name are the candidate's (paths compared after resolving, case-insensitively on Windows). Any other document set
  is a `binding` refusal.
- Every request retries while KiCad answers "busy" or "not ready", for at most 30 s per request; the connection is
  established within 60 s of starting pcbnew (`open`) or 10 s (`edit`, `close`). At `open`, while the API answers
  with no PCB document (the editor still loading the copy), the binding waits up to 60 s more; an API that answers
  with another document is a `binding` refusal at once.
- The binding is checked when an operation connects and again right before an edit saves.
- One operation is one client: the token learned from KiCad's first reply is sent with every later request, so a
  KiCad restart during the operation is refused by KiCad ("token did not match") and reported as `connection`.

## 3. Run folder

`open` creates `<results-dir>/<run-id>/` exclusively (results dir default `electronics-results`, inside the
workbench; run id as in `kicad-tool`: `[A-Za-z0-9._-]{1,64}`, default UTC time plus 8 hex digits):

| Path | Content |
|---|---|
| `candidate/` | copy of the board, `<stem>.kicad_pro`, and when present `<stem>.kicad_dru`, `fp-lib-table` and the `.kicad_sch` files of the board's folder |
| `state.json` | the candidate state (§4); rewritten after every operation that saves |
| `board.json` | the inventory (§5) of the candidate as KiCad last saved it |
| `board-open.json` | the inventory right after `open`: changes and nets are compared with it |
| `result.json`, `report.md` | the latest report (§7, §8) |
| `created.json` | the items created by every saved edit, in order (the report's `changes.created`) |
| `drc-before.json` | kicad-cli DRC of the candidate right after `open` (the source as KiCad reads it) |
| `drc-after.json` | kicad-cli DRC after the last `edit` |
| `previews/before-<layer>.svg`, `previews/after-<layer>.svg` | per-layer SVG previews with the outline: before for every copper layer at `open`, after for the copper layers the last edit touched |
| `requests/NNN.json` | the request of each saved edit, numbered by the edit (`edits` in state.json) |

The source board and its project are never written. A failure of `open` removes the run folder and stops the pcbnew
it started.

## 4. state.json

```json
{ "format": 1, "kind": "kicad-layout-state", "runId": "...", "tool": "kicad-layout-tool", "toolVersion": "1.0.0",
  "kicad": "10.0.8",
  "source": { "path": "boards/main.kicad_pcb", "sha256": "...", "bytes": 12345 },
  "candidate": { "path": "candidate/main.kicad_pcb", "sha256": "...", "memorySha256": "..." },
  "editor": { "pid": 1234 },
  "edits": 2,
  "objectives": { "status": "pass" }
}
```

- `source.path` is workbench-relative; `candidate.path` is relative to the run folder.
- `candidate.sha256` is the file KiCad saved last; `memorySha256` is the SHA-256 of KiCad's in-memory board text
  (the API's `SaveDocumentToString`) right after that save and a reload from the file (KiCad's revert), so a
  later revert gives the same text. KiCad's in-memory text never equals the file, so the two
  are kept apart.
- `objectives.status` is `pass`, `fail` or `none` (no edit yet, or the last saved edit's checks did not finish).
- No API token is stored.

## 5. board.json (inventory)

Written from the API after `open` and after every `edit`: `footprints` (reference, uuid, value, library id, `at`
[x, y], `orientation`, `side` front/back, `locked`, `pads` with number, net and position), `nets` (names),
`copperLayers` (enabled copper layer names), `outline` (bounding box [x1, y1, x2, y2] of the Edge.Cuts items without
their stroke width, or null), `tracks`, `vias` and `zones` (counts), `routing` (per net: track length and via
count). The agent composes edit requests from it.

## 6. Edit requests

```json
{ "format": 1, "candidate": "<candidate.sha256 from state.json>", "units": "mm",
  "operations": [
    { "op": "place", "footprint": "C3", "uuid": "...", "at": [112.5, 80.0], "orientation": 90 },
    { "op": "align", "footprints": ["C1", "C2", "C3"], "y": 80.0, "pitch": 2.54 },
    { "op": "keepout", "layers": ["F.Cu"], "polygon": [[100, 70], [110, 70], [110, 75]], "forbid": ["tracks", "vias"] },
    { "op": "track", "net": "VCC", "layer": "F.Cu", "width": 0.25, "points": [[112.5, 80.0], [118.0, 80.0]] },
    { "op": "via", "net": "VCC", "at": [118.0, 80.0], "diameter": 0.6, "drill": 0.3 } ] }
```

- The request comes as `--json TEXT` or, for requests beyond the 4096-character argument limit, `--request FILE`
  (a UTF-8 file inside the workbench, at most 1 MiB; a file outside it, or unreadable, is refused `request`).
- Keys outside these are refused. `units` must be `"mm"`. 1..64 operations; numbers are JSON numbers.
- A footprint is moved by at most one `place` or `align` of a request (KiCad duplicates a footprint that one commit
  updates twice); one `place` sets `at` and `orientation` together.
- `place`: a footprint by reference, `uuid` optional (must match when given); `at` and/or `orientation` (absolute,
  normalized to [0, 360)).
- `align`: 2..64 distinct references and exactly one of `x` or `y`: every footprint gets that coordinate; with
  `pitch` (> 0) they are also spaced along the other axis in the listed order, starting at the first footprint's
  current position.
- `keepout`: a rule area on 1..32 enabled copper layers, a polygon of 3..64 points, `forbid` a non-empty subset of
  `tracks`, `vias`, `pads`, `footprints`, `zones`.
- `track`: an existing net, an enabled copper layer, `width` 0.05..10, 2..64 points; one segment per consecutive
  pair.
- `via`: an existing net, a through via at `at`, `drill` 0.1..6.35, `diameter` greater than `drill` and at most 10.
- Coordinates lie within [-1000, 1000].

## 7. Checks and outcomes

Before the API is used (exit 2, nothing changed, the problem names the operation index):

| Kind | Condition |
|---|---|
| `usage` | the command line itself (missing or unknown arguments, no operation) |
| `request` | not JSON, unknown keys or operations, wrong types, units, limits, a reference repeated in `align` or named by two operations |
| `run` | `--run` is not a kicad-layout run folder inside the workbench, or its state.json is not format 1 |
| `changed` | the request's `candidate` differs from `candidate.sha256`, or the candidate file's SHA-256 differs from it |

Against the bound live board (exit 2, nothing changed; a commit already begun is dropped):

| Kind | Condition |
|---|---|
| `binding` | no open document is the candidate (another KiCad window serves the API, or the candidate window was closed or switched) |
| `changed` | the in-memory board text's SHA-256 differs from `memorySha256` (unsaved or foreign edits in the candidate window) |
| `footprint` | an unknown or ambiguous reference, or a `uuid` that does not match |
| `locked` | a footprint to place or align is locked |
| `net` | an unknown net name; or KiCad gave a created track or via another net than requested (it connects new copper to the copper it touches, so a track across another net's copper takes that net: a short) |
| `layer` | a layer that is not an enabled copper layer |
| `outline` | after the operations, the bounding box (from KiCad) of a placed footprint or created item extends beyond the outline's bounding box |

The checks that need the operations' result (`net` for created items, `outline`, the unchanged check) run after the
commit is pushed; a refusal or failure there reverts the candidate to its last save (KiCad's revert).

Failures (exit 3): `connection` (no API within the wait, a lost connection, a token mismatch), `kicad` (KiCad refused
a request, kicad-cli is missing or failed, or an unexpected error), `output` (a run-folder file could not be read or
written). kicad-cli is checked before KiCad is touched, and the run-folder files the edit reads (board-open.json and
drc-before.json, whose structure must be what open wrote) right after the binding, before the commit; result.json is
never an input. Before the save the open commit is dropped when the connection allows, nothing is
saved and state.json is unchanged. A timeout or Stop is the runner's: it ends the helper's process tree (§3, last
save kept).

A successful edit runs all operations in one commit, checks that no item outside those named changed (other
footprints' positions and orientations, existing tracks, vias and zones by UUID, their counts so that a duplicated
item is seen, the net list) and saves the candidate through KiCad; a difference reverts the candidate and is a
`kicad` failure. Right after the save and KiCad's reload, state.json is written first (the saved candidate's hashes,
`edits` counted, objectives `none`), then `requests/NNN.json` and `created.json`. A failure after the save is
reported with exit 3 and a problem saying that the edit was saved, whatever the error, and result.json and report.md
become that failed report (KiCad's version, the request when it was recorded and the saved candidate's hash): a
failure of the checks or of writing their results (board.json, kicad-cli DRC, previews, result.json, report.md) leaves
the run usable, the next edit checks the candidate again; when KiCad's new state cannot be read back, or state.json,
the request or created.json cannot be written (`output`), the run cannot continue: the user closes the editor and
opens a new candidate. Every edit's previews start with open's before previews.

## 8. Objectives and report

After every successful edit kicad-cli runs DRC on the saved candidate (`--format json`, `--refill-zones`, and
`--schematic-parity` when the candidate folder holds `<stem>.kicad_sch`). A violation is new when no violation of
`drc-before.json` has the same type, description and item UUIDs. `objectives.status` is `pass` when there is no new
violation of severity error and the unconnected count is not greater than before; otherwise `fail`, listing the new
violations. The edit still exits 0; a failing candidate cannot be applied.

`result.json` (`format: 1`, `kind: "kicad-layout-result"`, tool, toolVersion, kicad version, runId, operation,
started, ended, status `completed|refused|failed`, `problems`) holds:
- `inputs` with SHA-256: for `open` the copied project files (`path` workbench-relative, `role` board or project,
  `bytes`); for `edit` the request (`requests/NNN.json`) and the candidate before the edit;
- `changes`: since `open` (board-open.json), each footprint whose position or orientation differs (reference, uuid,
  before and after `at`/`orientation`) and each created item of every edit (type, uuid, net, layer, width, length,
  position);
- `nets`: for each touched net, track length and via count before and after;
- `drc`: counts by severity before and after, and the new violations;
- `unconnected`: before and after;
- `unchanged`: the number of footprints, tracks, vias and zones verified unchanged;
- `previews`, `objectives`, `warnings` (notes on the candidate copy's DRC, such as footprint-library findings
  that come from the copy and are the same before and after), `artifacts` (paths relative to the run folder, with
  SHA-256: the candidate, board.json and, for `open`, board-open.json, drc-before.json and the before previews; for
  `edit`, created.json, drc-after.json, the request and the after previews).

`report.md` renders the same. Absolute paths never appear; paths are workbench- or run-relative. The documents the
helper prints are at most 11 000 characters (long lists are cut, result.json stays whole) and repeat a run id of at
most 64 characters.

## 9. close

`close --run` stops the pcbnew that `open` started (the PID in state.json, when that process still runs the PCB
editor) only when the bound document's in-memory text still matches `memorySha256`; otherwise it refuses
(`changed`) and leaves the window. It removes KiCad's lock files from `candidate/`. The run folder stays.

## 10. apply_candidate (VERA core)

A host tool, `{ "run": "<workbench-relative run folder>" }`, offered while the official `kicad-layout` plugin is
enabled in the workbench and never in read-only mode. It reads state.json and refuses (nothing written) when:
- the run folder or state.json is not a kicad-layout run inside the workbench, or the candidate is not a regular
  `.kicad_pcb` file inside the run folder starting with `(kicad_pcb` and at most 64 MiB;
- the target `source.path` is not a regular `.kicad_pcb` file inside the workbench that the agent may write;
- `edits` is 0 or `objectives.status` is not `pass`;
- the candidate's SHA-256 differs from `candidate.sha256` (changed after its check);
- the target's SHA-256 differs from `source.sha256` (the source changed since the candidate was made);
- KiCad's lock file `~<name>.kicad_pcb.lck` lies beside the target (the board is open in KiCad; the user saves or
  discards their changes there and closes it).

Otherwise it prepares a change (tool `apply_candidate`, path, before = source SHA-256, after = candidate SHA-256,
bytes, a unified diff of the board text cut to 2000 lines with a final line naming the lines left out). The existing
modes gate it: ask shows it for approval, auto-edit and bypass approve it. On apply, inside the write queue, it
checks again that the target still has the before hash, the candidate still has the approved after hash and no lock
file exists, then writes the candidate bytes atomically and records the change like a write. A declined approval
writes nothing.
