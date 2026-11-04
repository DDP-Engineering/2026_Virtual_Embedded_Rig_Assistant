# Manual test plan — blocked, unknown target

## Target and objective

- Board, revision, unit, firmware: UNKNOWN; no target selected.
- Objective: prepare investigation of the captured I2C initialization failure, without assuming its target or cause.
- WORKBENCH.md explicitly says the capture alone does not identify the target. The run notes leave board, revision, unit and firmware unrecorded. [[WORKBENCH.md#L1-L3]] [[docs/runs.md#L1-L3]]
- Historical observation only: the capture contains an I2C initialization warning and failure. Its embedded board/revision/boot labels and supply/timing text are not verified target identity, setup instructions or acceptance limits; they do not resolve the missing run provenance. [[logs/boot-0413.log#L1-L4]] [[docs/runs.md#L1-L3]]

## Readiness

**blocked** — not ready for review or execution. No tests, flashing or capture have been performed by this plan.

Required questions:
1. What exact board/model, board revision, physical unit identifier and firmware build/version (preferably image hash) produced the failure, and are these the intended test target?
2. What approved operator setup and reproduction procedure apply, including power, connections, I2C peripheral and configuration, and capture method?
3. What authoritative requirement defines successful I2C initialization, including any required timing limit and measurement method?
4. Which release notes apply to that firmware? Is there a known-good baseline with recorded identity and matched conditions?

The setup notes require identity and operator setup before an evaluable case. The criterion document supplies no acceptance criterion; release notes supply no applicable firmware identity or change. [[docs/setup.md#L1-L3]] [[docs/boot-test.md#L1-L3]] [[docs/release-notes.md#L1-L3]]

## Setup and prerequisites

- Obtain and review the answers above before expanding this draft into an executable procedure. No pins, addresses, electrical limits, power sequence or timing requirements are established here. [[docs/setup.md#L1-L3]]
- Preserve the original failure capture and resolve its provenance against the target record. Do not use its embedded labels or observed numbers as authoritative setup. [[logs/boot-0413.log#L1-L4]] [[docs/runs.md#L1-L3]]
- No baseline is established by the inspected run notes. Do not silently designate a different capture or release as the control. [[docs/runs.md#L1-L3]] [[docs/release-notes.md#L1-L3]]
- Optional tooling requires separately verified port and capture settings. Flashing additionally requires verified image, device compatibility and flash mapping; none is supplied by the plugin metadata. [[docs/enabled-plugins.md#L1-L5]]

## Test cases

### TP-01 — Conditional I2C initialization observation

- Status: **observation-only; blocked**. This is a placeholder for a later sourced manual procedure, not authorization to operate the unidentified hardware.
- Rationale: the captured initialization warning followed by failure motivates checking initialization behavior on an identified target. Cause and reproducibility remain unknown; no release change can be implicated from the available release notes. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L3]]
- Setup/prerequisites: confirmed board, revision, unit and firmware; approved setup and reproduction procedure; authoritative criterion and capture method. These are missing. [[docs/setup.md#L1-L3]] [[docs/boot-test.md#L1-L3]]
- Ordered manual steps, conditional on resolving blockers and revising this plan:
  1. Operator records the confirmed target identity and checks it against the approved setup and applicable firmware documentation. Stop if any identity or setup remains ambiguous.
  2. Operator follows the supplied, reviewed reproduction procedure exactly. No hardware action is specified by this draft because that procedure is unavailable.
  3. Operator preserves the complete raw log and records setup, firmware identity, exact actions, initialization outcome and any measured timing with its measurement method. Compare against the original capture only after documenting compatible conditions.
- Capture: raw log, target identity, setup/procedure reference, timestamp, initialization warning/error sequence, and measurement method where applicable.
- Criterion: **none available; observation-only, blocked**. Obtain an authoritative initialization requirement before assigning pass/fail. The captured delay is an observation, not a limit. [[docs/boot-test.md#L1-L3]] [[logs/boot-0413.log#L1-L4]]
- Case stop conditions: unresolved identity, missing approved procedure, setup mismatch, or inability to capture required evidence. Electrical safety limits must come from the approved setup; this draft does not invent them.
- Optional future plugin step, only if separately requested after prerequisites are resolved: enabled `serial-monitor`, program `serial`, command `capture`, risk `device-read`; console opening/reset may restart the board. Verified port and capture settings are still required. Command name only, not a runnable invocation. [[docs/enabled-plugins.md#L1-L5]]

## Stop conditions and exclusions

- Do not operate hardware under this draft while identity, setup or acceptance requirements remain unresolved. The source explicitly requires target/setup information before an evaluable case. [[docs/setup.md#L1-L3]]
- Exclude electrical-margin, bus-timing, fault-injection and firmware-regression cases until applicable setup and requirements are supplied. No numerical thresholds are inferred from the captured log.
- Baseline control deferred: the inspected evidence does not identify a compatible known-good firmware/control. Do not assume another log is comparable. [[docs/runs.md#L1-L3]] [[docs/release-notes.md#L1-L3]]
- Flashing is not required or planned. If later separately requested, existing `esp32-esptool` uses program `esptool`, command `write-flash`, risk `device-write` (overwrites firmware/data); target, image, port and flash mapping must first be verified. No invocation, activation, installation or execution is included. [[docs/enabled-plugins.md#L1-L5]]

## Results to collect

The original capture is historical evidence, not a result of this plan. All future measurements and verdicts remain pending.

| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |
|---|---|---|---|---|---|---|---|---|
| TP-01 | pending | unknown; confirmation required | pending | I2C initialization outcome; timing only if defined by requirement | unmeasured | not established | pending; criterion missing | [[docs/boot-test.md#L1-L3]]; measured source pending |
