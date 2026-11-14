# lab-validation

Offline, reproducible validation of measurements against requirements and simulations for VERA.

- **`lab-validate`** (`scripts/lab_validate.py`, standard library only, Python 3.11 or newer) - `inspect`,
  `normalize`, `measure`, `align`, `compare`, `report`. A format 1 JSON request names its sources, signals,
  measurements over declared windows, comparisons with a declared alignment, criteria, the decision rule (`simple` or
  `guarded`) and the handling of missing data. Every operation is a safe offline analysis: it reads files in the
  workbench, never changes them, opens no network connection, starts no program and writes a new run folder
  `embedded-lab-results/<run-id>/` with `result.json` (kind `lab-validation-result`), `report.md` and the series and
  comparison files (`compare-<id>.csv`, `compare-<id>.svg`). Exact contract: spec REQ-DATA-53797d16 in VERA's
  `.agentic/specs/`, and `lab-validate --help`.
- **Importers**: scpi-instruments capture folders (through their result.json contract, hash-checked, with clipping
  from the raw block), CSV with a declared mapping, sigrok-cli CSV exports, and ngspice-tool/ltspice-tool transient
  run folders - neither SPICE plugin needs to be installed. Raw proprietary formats (`.sr`, `.raw`, scope binaries) are
  not read: convert them with their own tool.
- **Results**: criteria are `pass`, `fail` or `incomplete`; gaps, clipping, evident aliasing, an unknown or
  insufficient bandwidth and missing or differing conditions make a criterion incomplete. This is not a calibration
  or a metrological certification.
- **Skills** `validation-planning` and `difference-explanation`.
- **Extending**: importers and metrics are registries (`importers.register`, `metrics.register`); further metrics and
  importers are added there, not as a second engine.
