# power-profiler

Power, energy and charge profiling of embedded boards for VERA, with a Joulescope JS220.

- **`power-profile`** (`scripts/power_profile.py`, PEP 723, Python 3.12 or newer, `pyjoulescope_driver==2.5.5` from
  PyPI) - `tools [--list]`, `identify`, `capture`, and `release` (VERA's cleanup). The meter is declared in
  `lab/resources.json` (`kind: power-monitor`, `resource: u/js220/<serial>`) and reserved for the run. It is opened
  without its defaults; its current path is never switched (a meter whose current range mode is off is refused);
  only the sample rate, the current/voltage range and the signal streams are set, then the previous settings are
  restored and read back (`lifecycle.physical` `confirmed` or `unknown`). A capture streams current, voltage, power,
  the current range and up to four GPI markers on the meter's sample clock into `embedded-lab-results/<run-id>/`
  (`result.json` kind `power-result` and `samples.csv`). Sample-id skips and NaN samples stay empty cells and a gap
  list; samples beyond the range limit are flagged overflow; neither ever becomes zero.
- **`power-analyze`** (`scripts/power_analyze.py`, standard library, Python 3.11 or newer) - `acquisition`
  (configure-acquisition: the plan checked offline against the profile), `import` (a CSV export as a capture
  folder, uniform or not), `inspect`, `measure-energy` (mean/min/max current, voltage and power, energy = integral
  of v x i, charge = integral of i, withheld over gaps and overflow), `segment` (events by GPI markers, timestamps on
  the capture's clock, or a current threshold; time and energy per state; energy per event; periods), `compare`
  (firmware A/B: build identities kept, setup differences classified, a lab-validate request written), `battery`
  (a life interval with its assumptions; refuses missing efficiency, voltages or events) and `report`.
- **Numbers**: `power_support/series.py` is a byte-identical copy of lab-validation's series module; criteria are
  decided by lab-validate (`integral` metric, `power-capture` importer), never here. In HIL plans the steps
  `power.identify` and `power.capture` run the same programs with the plan's firmware attached.
- **Profile** `joulescope-js220` is `unverified`: written from pyjoulescope_driver 2.5.5's topics and host
  parameters, not yet checked against a real meter. Exact contract: spec REQ-DATA-dd3e4fe1 in VERA's `.agentic/specs/`.
- **Not provided**: a meter console, DUT power-path control, the JS220's general-purpose outputs, its firmware
  update, JLS files, other models (PPK2, Otii). VERA never installs drivers, WinUSB bindings or udev rules.
- **Skills** `power-measurement` and `energy-analysis`.
