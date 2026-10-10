# REQ-DATA-6c54a48f — Window geometry storage

## Behavior

The Electron shell reads window geometry before creating its window and saves normal bounds on close.
The file is `<userData>/window-state.json`, separate from application settings. Bounds use Electron
display-independent integer pixel units. The user-data directory is selected before acquiring the
single-instance lock. The test harness uses Chromium's `--user-data-dir` argument.

## Data / interface

```json
{"schemaVersion":1,"bounds":{"x":20,"y":20,"width":1080,"height":680}}
```

`loadWindowState(path, displays)` returns `{ bounds, readOnly }`. Coordinates and sizes must be safe
integers; width is 1024–32768 and height is 640–32768. A saved rectangle requires at least 100×100
pixels of intersection with a connected display work area. Missing, malformed, unreadable, invalid,
or off-screen state returns centered defaults: 1200×800, limited to the first supplied work area
and bounded below by 1024×640. A numeric schema version greater than 1 returns read-only defaults.
The caller preserves that newer file by omitting save.

`saveWindowState(path, bounds)` validates bounds, creates the parent directory, writes the version-1
document to a sibling `.tmp` file and renames it over the destination. It cleans up the temporary
file. The single-instance lock provides one writer. A failed save reports to stderr and allows the
window to close. Closing waits for the save attempt before destroying the native window.

## Examples

The example above restores the same bounds on restart. A monitor at negative x coordinates supports
saved windows on that monitor. A saved x=9000 outside the current displays uses centered defaults.
A schemaVersion=2 document remains unchanged.

## Acceptance

Vitest verifies valid round-trip, malformed/invalid/off-screen/missing state, newer-version refusal
and negative-coordinate displays. Playwright changes real window bounds and verifies them after
closing and restarting Electron with the same temporary user data.
