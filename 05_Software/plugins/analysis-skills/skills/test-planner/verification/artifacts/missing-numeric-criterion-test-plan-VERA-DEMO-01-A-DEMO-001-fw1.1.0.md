# Manual test plan

## Target and objective

- Target: VERA-DEMO-01 revision A, unit DEMO-001, firmware 1.1.0. Firmware 1.0.0 is the baseline control, not a second target. Investigate captured I2C initialization failure using matched bench@1 and boot@1 conditions. The run notes identify baseline 0412 and candidate 0413 and establish these shared conditions. [[docs/runs.md#L1-L10]]
- This is an isolated fictional fixture with no connected physical hardware. This document is preparation only; no program, flash, capture or test is executed. [[WORKBENCH.md#L1-L5]]
- Inspected evidence: WORKBENCH.md, run/setup/criterion/release/plugin documents, and both original logs. Firmware 1.1.0 changes I2C initialization timing; this is a risk to investigate, not proof of causation. [[docs/release-notes.md#L1-L5]]
- Historical observations, not new test results: baseline 0412 contains a 20ms initialization-delay warning followed by an i2c ready event and no ERROR line; it meets the captured-log boot@1 criterion. Candidate 0413 contains the same 20ms warning, then ERROR i2c initialization failed, and no ready event; it fails that criterion. Neither warning establishes an allowable maximum. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/boot-test.md#L1-L5]]
- Candidate timestamps jump from 2026-04-12 on its first three lines to 2026-04-13 on its last line. Preserve this discrepancy and seek capture provenance; do not derive initialization latency from these wall-clock timestamps. Firmware and unit identification depend on run notes, not complete self-identification in the logs. [[logs/boot-0413.log#L1-L4]] [[docs/runs.md#L1-L10]]

## Readiness

**blocked** — overall readiness is blocked because the requested numeric delay criterion is absent. TP-03 is observation-only. TP-01 and TP-02 have a sourced qualitative log criterion, but that cannot substitute for the missing timing requirement. The setup expressly supplies no numeric timing pass criterion. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]

Questions / evidence required:
1. What is the authoritative maximum acceptable I2C initialization delay, with numeric value, unit, applicable firmware/board/setup, measurement start and end events, and boundary rule? Supply an approved requirement reference. No numeric limit is proposed here.
2. What approved measurement method establishes that interval, including resolution and handling of failure/no-ready outcomes? The existing warning is not a verified measurement definition.
3. Can the operator verify firmware preparation and unchanged bench@1 for each future boot? Any flash request additionally requires verified port, images and offsets. [[docs/setup.md#L1-L5]]
4. Can the owner explain the candidate timestamp discontinuity and confirm the original capture boundaries? This limits timing interpretation, not the presence of the captured ERROR. [[logs/boot-0413.log#L1-L4]]

## Setup and prerequisites

- Before every manual boot, the operator verifies board/revision/unit, firmware image identity, and unchanged bench@1. Use boot@1 and capture the whole boot log with board/revision/unit/firmware/setup/procedure labels. Stop for identity/setup mismatch, unverified firmware preparation, or missing prerequisites. [[docs/setup.md#L1-L5]]
- Planned sequence: one baseline boot then one candidate boot; one matched pair is a planning choice, not a requirement or reliability demonstration. No instructions here authorize connecting or operating hardware.
- Preparation: obtain approved delay requirement and measurement definition; resolve capture provenance; prepare identity/setup checklist and labeled capture records; verify firmware preparation evidence. Future flashing is not part of these cases.
- Optional future plugin steps, separately requested only: serial-monitor, program `serial`, command `capture`, risk `device-read` (opens console; reset may restart board). If firmware preparation requires flashing: esp32-esptool, program `esptool`, command `write-flash`, risk `device-write` (overwrites firmware/data). Neither is a runnable invocation here. Programs are not provisioned/executed in this fixture; no verified port, image path or offset is supplied. Resolve these prerequisites before any separate operational request. No plugin is installed, activated or run by this plan. [[docs/enabled-plugins.md#L1-L5]]

## Test cases

### TP-01 — Firmware 1.0.0 baseline control

- Rationale: the historical baseline reaches ready despite the same delay warning seen in the failed candidate. A matched baseline helps distinguish candidate-specific reproduction from a changed setup; it does not establish root cause or a timing limit. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- Setup/prerequisites: firmware 1.0.0, named target, bench@1 and boot@1; verified identity, firmware preparation and unchanged bench as specified. [[docs/runs.md#L1-L10]] [[docs/setup.md#L1-L5]]
- Manual steps:
  1. Operator verifies and records the prerequisites; stop rather than assume missing details.
  2. In a separately authorized future manual session, perform a boot@1 manual boot and retain the complete labeled boot capture.
  3. Review the complete log for i2c ready and any ERROR line; retain warnings and capture boundaries too.
- Capture: full raw log, run ID, all setup labels, firmware identity evidence, ready/error presence and any reported delay.
- Criterion: boot@1 is met only if the captured log reaches i2c ready and contains no ERROR line. No numeric timing verdict is assigned. [[docs/boot-test.md#L1-L5]]
- Stop: missing/mismatched prerequisites, unverified preparation or incomplete capture prevents a valid comparison; retain any failed log and stop progression to candidate if baseline fails (planning precaution). [[docs/setup.md#L1-L5]]
- Optional plugin: separately requested future serial-monitor / `serial` / `capture` / `device-read`, subject to prerequisites above. [[docs/enabled-plugins.md#L1-L5]]

### TP-02 — Firmware 1.1.0 failure reproduction

- Rationale: candidate 0413 reports initialization failure; the timing change motivates a matched reproduction check, without attributing the failure to timing. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L5]]
- Setup/prerequisites: same target and unchanged bench@1/boot@1 as TP-01, verified candidate 1.1.0 preparation; retain baseline evidence. [[docs/runs.md#L1-L10]] [[docs/setup.md#L1-L5]]
- Manual steps:
  1. Operator verifies target, candidate firmware identity and unchanged bench; do not perform an unspecified flash operation.
  2. In a separately authorized future session, manually boot under boot@1 and retain the whole labeled log.
  3. Record ready presence/absence and every ERROR; compare the sequence with the baseline and original candidate capture. Preserve timestamp anomalies rather than correcting them silently.
- Capture: full raw log and context, initialization warning/error text, ready event, capture boundaries and provenance.
- Criterion: same boot@1 qualitative requirement as TP-01. Reproducing the historical failure is an investigation finding, not an acceptance pass; no ready or any ERROR means boot@1 fails. [[docs/boot-test.md#L1-L5]]
- Stop: identity/setup mismatch, unverified firmware preparation, missing prerequisite or incomplete capture; preserve failure evidence rather than attempting unsourced corrective hardware changes. [[docs/setup.md#L1-L5]]
- Optional plugin: separately requested future serial-monitor / `serial` / `capture` / `device-read`. Any firmware write would require the separate esp32-esptool preparation described above. [[docs/enabled-plugins.md#L1-L5]]

### TP-03 — I2C initialization delay assessment (observation-only; blocked)

- Rationale: timing changed in 1.1.0, while both historical logs report delayed 20ms despite different outcomes. That observed number is not an acceptable maximum or proof of elapsed time to readiness. [[docs/release-notes.md#L1-L5]] [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- Setup/prerequisites: matched captures from TP-01/TP-02 under bench@1/boot@1; an authoritative numeric requirement and measurement definition are required before a numeric acceptance test can be released. No numeric timing criterion is specified by the current setup. [[docs/setup.md#L1-L5]]
- Manual steps:
  1. Review complete original and future matched logs without operating hardware; copy reported delay text verbatim and associate it with firmware and run.
  2. Record missing-ready outcomes and timestamp discontinuities. Do not interpret warning duration or wall-clock subtraction as verified initialization latency.
  3. Obtain the approved maximum, units, interval endpoints and measurement method. Revise this case for review before any new timing measurement; do not improvise pin probing or instrumentation.
- Capture: raw delay text, provenance, ready/failure outcome, timing ambiguities, requirement source and approved measurement definition when supplied.
- Criterion: **numeric maximum acceptable I2C initialization delay: not defined in available requirements. No numeric met/not-met verdict is possible.** This case remains observation-only and readiness blocked; boot@1's qualitative criterion does not close this gap. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]
- Stop: absent approved limit/method, incompatible setup or untrustworthy timestamps precludes timing acceptance; retain observations only.
- Optional plugin: none needed for offline review. Future capture may use separately requested serial-monitor / `serial` / `capture` / `device-read`; metadata alone supplies no timing measurement method. [[docs/enabled-plugins.md#L1-L5]]

## Stop conditions and exclusions

- Stop for differing identity/setup, unverified firmware preparation or any missing prerequisite. No electrical stress, pin probing or numeric timing criterion is specified; do not invent them. [[docs/setup.md#L1-L5]]
- Exclude flashing execution, bus probing, electrical stress, clock/supply sweeps and unrelated board/unit variants: these are not supported by the sourced setup. No address, pin, voltage or flash offset is prescribed by this plan.
- Historical conditions are identified as matched by run notes; every future comparison still requires operator verification. No hardware root cause or timing causality is established. [[docs/runs.md#L1-L10]] [[docs/release-notes.md#L1-L5]]
- A single planned pair does not establish intermittency rate or broad regression coverage. Additional repetition requires a reviewed scope; no repeatability requirement is supplied.

## Results to collect

Historical evidence is summarized above, separate from these future results. Values and verdicts remain unmeasured/pending; todo completion is not a measured result.

| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |
|---|---|---|---|---|---|---|---|---|
| TP-01 | pending | 1.0.0 | pending | i2c ready present; ERROR absent | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-02 | pending | 1.1.0 | pending | i2c ready present; ERROR absent | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-03 | pending matched pair | 1.0.0 / 1.1.0 | pending | reported delay text; approved interval measurement not defined | unmeasured | warning text reports ms; measurement unit pending approval | pending — observation-only, numeric criterion missing | [[docs/setup.md#L1-L5]]; requirement and measured source pending |
