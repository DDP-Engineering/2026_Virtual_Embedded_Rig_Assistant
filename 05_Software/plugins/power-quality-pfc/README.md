# power-quality-pfc

Reactive power compensation (power factor correction) at one board of VERA's electrical project model, from stored
network results, imported measurements and an industrial catalog.

- **The tool `power_quality`** is VERA's own write tool, offered only while this plugin is loaded (never in read-only
  sessions). It reads `electrical-automation-model.json`, optionally one CURRENT `electrical_network` result (stale ones
  are refused), a measurement file in `electrical-automation-measurements/` and one catalog in
  `electrical-automation-catalogs/`. It stores a new `electrical-automation-results/<run-id>/result.json` after
  approval, like a file write, with copies of the board, what it feeds and its source, so a later model change marks it
  stale. It never changes the model, switches no capacitor step and sets no regulator.
- **Measurements**: `<id>.json` (kind `vera-power-measurements`, format 1) declares origin (measured or fictional),
  licensed source, board, averaging interval, sign conventions (load or generator, inductive- or capacitive-positive
  Q, fundamental, non-active or undeclared Q - an undeclared Q counts as Q1 only with the request's stated
  `reactiveAsFundamental` assumption - and signed or unsigned power factors), nominal voltage, frequency and typed
  columns (P, Q, S, U, I, PF, DPF, THD, harmonic orders); the rows are inline or in `<id>.csv` with the column names as
  header.
- **Per scenario and interval**: P, fundamental Q, displacement factor (lagging or leading) and total power factor
  P/S; the kvar need to the stated displacement target; the values after compensation with the distortion kept.
- **The bank**: a fixed bank only when it never exceeds Q1 (no capacitive operation at light load) and stays within the
  commonly applied 15 % of the transformer rating; otherwise an automatic bank of equal steps that reaches the target in
  every scenario and interval without leading operation, within the regulator's outputs, with a control-logic
  proposal (connect/disconnect rule, discharge delay) that is never applied.
- **Equipment** from cited catalog data: capacitor output at the network voltage and its rated voltage with tolerance
  and detuning, capacitor current with the measured harmonic voltages, non-linear share, capacitor-duty contactor kvar,
  step protection for the permissible current and the inrush; a capacitor/reactor pair only from a cited `detuned step`
  table.
- **Resonance**: the parallel resonance order of each bank state from the board's fault level against the measured
  harmonic orders; without fault level, margin or harmonic data the verdict stays unknown. The guide's Gh/Ssc rule
  classifies the installation; when it needs harmonic filtering, no filter is designed.
- **Skill**: `power-factor-correction`, the workflow from the data to a reviewed result.

Results are preliminary engineering support: no verified design, no conformity statement and no full power-quality
report. The exact formats are the specifications REQ-DATA-4dc5e2c7, REQ-DATA-42ce122f, REQ-DATA-d7e27def and
REQ-DATA-06c0bd54 in VERA's `.agentic/specs/`.
