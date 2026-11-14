# kicad-layout fixtures

Input data of `tests/integration/kicad-layout.test.ts`. Everything here is fictional.

## board/

`make_fixtures.py` writes `board/layout.kicad_pcb` (KiCad 10 format, deterministic UUIDs derived from names) with
the writers of `../kicad/make_fixtures.py`; `layout.kicad_pro`, `fp-lib-table` and `fixture.pretty/` are its
project and footprint library. Run `python make_fixtures.py` from this folder after changing it.

- Two copper layers (F.Cu, B.Cu), an Edge.Cuts rectangle from (100, 100) to (150, 130) mm, default rules (0.2 mm
  clearance, 0.25 mm tracks, 0.8/0.4 mm vias).
- A small regulator circuit: connector J1 (VIN, GND), regulator U1 (SOT-23: GND, VOUT, VIN), feedback divider R1/R2
  (VOUT, FB, GND), and a decoupling capacitor C1 (VIN, GND) placed far from U1 so that the tests can move it close
  and route it.
- R3 and R4 on net SENSE, unrouted, for `align`; a locked mounting hole H1 (a non-plated hole) for the locked-item
  refusals.
- Existing routes: VIN on F.Cu from J1 to U1 (0.5 mm), VOUT from U1 to R1, FB from R1 to R2, a locked GND track on
  B.Cu with a via and a GND track on F.Cu to R2, so that DRC, the unconnected count and the unchanged check have
  items to compare.

## hooks/

- `hook.py`: run inside the helper at named points (`KICAD_LAYOUT_TEST_HOOK`, `HOOK_POINT`, `HOOK_ACTION`): move an
  item the request did not name, sleep inside the commit (after the first operation) so that the test can stop the
  helper, or stop the PCB editor (a lost connection).
- `editor_stub.py`: a PCB editor that never serves the API (`KICAD_LAYOUT_TEST_EDITOR`).
- `nudge.py`: a second API client (`uv run --script`): unsaved moves, revert, whether an API answers, and the open
  documents with the in-memory text's SHA-256.

VERA never passes these test variables to plugin programs: its runner gives a program only an allowlisted
environment.
