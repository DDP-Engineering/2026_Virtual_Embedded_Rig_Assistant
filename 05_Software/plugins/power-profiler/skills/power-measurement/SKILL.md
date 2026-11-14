---
name: power-measurement
description: Plan and run a power capture of a board with a Joulescope JS220 - identify the declared meter, check the acquisition plan (rate, current and voltage range, markers, burden), capture current, voltage, power and GPI markers tied to the firmware build, and know what the capture does and does not prove. Use when the user wants to measure a board's current, sleep current, wake-up energy or power on the bench.
---

Use `run_program` with programs `power-profile` (live) and `power-analyze` (offline). There is no meter
console, no output control and no firmware update of the meter.

## 1. Know the bench

- The meter must be in `lab/resources.json` as `{"alias": "js1", "kind": "power-monitor", "resource":
  "u/js220/<serial>", "profile": "joulescope-js220"}`. `power-profile tools --list` shows the connected
  device paths; never guess a serial. `power-profile tools` also checks the driver and USB access (WinUSB on
  Windows, the vendor's udev rule on Linux) - VERA never installs drivers or udev rules: pass the hint on.
- `power-profile identify --meter js1` reads versions and the range state. If the current path is `off`,
  the DUT is unpowered: captures are refused and VERA does not switch it on - ask the user.
- Ask how the DUT is wired: supply through IN/OUT, which firmware GPIOs reach GPI0...3, the supply
  voltage, and the board name and revision (`--board`, `--condition supply=3.3V`).

## 2. Check the plan offline (configure-acquisition)

`power-analyze acquisition --profile joulescope-js220 --duration 20 --rate 100000 --markers 0` prints the
effective settings, the sample budget (at most 1 000 000 samples per capture), the CSV size and the burden
note. Choose:

- rate: high enough for the shortest event (>= 10 samples per event), within the budget;
- current range `auto` unless the user knows the range; a too-small manual range saturates (overflow);
- markers: a GPIO the firmware toggles at event boundaries, wired to a GPI input. This is the precise
  synchronisation: the meter samples it on the current's own clock. A UART log's arrival time on the PC is
  never a synchronisation source.

## 3. Capture

`power-profile capture --meter js1 --duration 20 --rate 100000 --markers 0 --firmware build/app.elf
--board "sensor-node rev B" --condition supply=3.3V` (device-write: the range and rate change the burden).
The firmware file identifies the build by SHA-256 and ELF build id - always pass it. Read the result:

- `status`: pass, incomplete (gaps, overflow, stopped), blocked (nothing changed), error (device lost).
- `gaps` and `overflow`: missing samples stay empty, never zero; say so when you report numbers.
- `lifecycle.physical`: `confirmed` means the meter's previous settings were restored and read back, not
  that the DUT was undisturbed; `unknown` means they could not be checked.

## 4. Then analyse

Use the `energy-analysis` skill (measure-energy, segment, compare, battery, report). In a HIL plan, the steps
`power.identify` and `power.capture` (background) do the same with the plan's firmware attached.
