# Manual test plan

## Target and objective

- Target: VERA-DEMO-01 revision A, unit DEMO-001, firmware 1.1.0 candidate; firmware 1.0.0 is the control, not a second target. Investigate the captured I2C initialization failure using matched bench@1 / boot@1 conditions. Run notes establish these identities and common conditions. [[WORKBENCH.md#L1-L5]] [[docs/runs.md#L1-L10]]
- Historical evidence: baseline 0412 ends with an i2c ready event and has no ERROR line; candidate 0413 contains an initialization-delay warning and an ERROR initialization-failed event, without an i2c ready event. Under boot@1, these supplied captures respectively meet and do not meet the qualitative criterion. These are historical log assessments, not newly executed tests. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/boot-test.md#L1-L5]]
- Both supplied logs contain a 20ms delay warning; that observation alone does not distinguish the failure. Firmware 1.1.0 changes initialization timing, making boot initialization a relevant regression risk, but the release notes and run notes establish no root cause. The observed delay is not an acceptance limit. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L7]] [[docs/runs.md#L1-L10]]
- Candidate capture timestamps span April 12 and April 13, while baseline timestamps stay on April 12. Preserve this discrepancy and verify capture provenance; do not infer an initialization duration from it. Firmware/unit/setup attribution comes from run notes rather than complete labels in the log text. [[logs/boot-0413.log#L1-L4]] [[logs/boot-0412.log#L1-L4]] [[docs/runs.md#L1-L10]]

## Readiness

**ready_for_review** — target, matched setup, and qualitative acceptance criterion are sourced for both cases. This is review readiness only, not authorization or execution readiness. No hardware is connected in this fictional fixture. No tests, flashing, captures, or programs have been executed by this plan. [[WORKBENCH.md#L1-L5]] [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]

Before any later manual execution, the operator must verify identity, firmware preparation, unchanged bench and all prerequisites. Future flash preparation requires separately verified port, image paths and offsets; none are supplied. Missing prerequisites stop execution. No numeric timing acceptance criterion is requested or established; timing may be recorded descriptively only. [[docs/setup.md#L1-L5]]

## Setup and prerequisites

- Use the same VERA-DEMO-01 revision A / DEMO-001, bench@1 and boot@1 for baseline and candidate; verify board identity, firmware image identity and unchanged bench before each manual boot. Label each whole boot log with board/revision/unit/firmware, setup and procedure. [[docs/setup.md#L1-L5]]
- Prepare firmware 1.0.0 control and firmware 1.1.0 candidate identities against the run mapping. Do not invent executable paths, ports, flash offsets, electrical settings, wiring or timing limits. The supplied setup specifies no electrical stress or pin probing. [[docs/runs.md#L1-L10]] [[docs/setup.md#L1-L5]]
- Preparation todos: review plan and boot@1 criterion; verify identities and unchanged bench; obtain verified firmware preparation and any separately requested operation prerequisites; prepare complete-log labels and provenance notes, including timestamp discrepancy review. Todos are preparation, never measured results.
- Planning choice: one future manual baseline boot followed by one future manual candidate boot. This is not a sourced repeat requirement and cannot establish intermittent-failure rates.
- Enabled optional operations: esp32-esptool, program `esptool`, command `write-flash`, risk `device-write` (overwrites firmware/data); serial-monitor, program `serial`, command `capture`, risk `device-read` (opens console; reset may restart board). These are command names, not runnable invocations. Only a separate future user request may pursue them, after verifying required arguments and prerequisites. No plugin installation or activation is planned; programs are not provisioned/executed here. [[docs/enabled-plugins.md#L1-L5]]

## Test cases

### TP-01 — Firmware 1.0.0 matched baseline control

- Rationale: the historical baseline meets boot@1 despite the same delay warning seen in the candidate. A matched control checks whether the proposed manual setup can reproduce the accepted baseline before attributing differences to the candidate. It does not establish causality. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/boot-test.md#L1-L5]]
- Setup/prerequisites: verified VERA-DEMO-01 revision A, DEMO-001; firmware 1.0.0; unchanged bench@1 and boot@1, with verified firmware preparation. [[docs/runs.md#L1-L10]] [[docs/setup.md#L1-L5]]
- Ordered manual steps:
  1. Operator verifies and records board/revision/unit, baseline firmware image identity, bench@1 and boot@1. Stop before boot if preparation is unverified or a prerequisite is missing. [[docs/setup.md#L1-L5]]
  2. Operator performs the manual boot using the documented setup and captures the whole boot log with all required labels. No additional electrical or timing procedure is introduced. [[docs/setup.md#L1-L5]]
  3. Inspect the complete capture for an i2c ready event and every ERROR line; retain warnings and event order. Record observed timing only as descriptive data. [[docs/boot-test.md#L1-L5]] [[docs/setup.md#L1-L5]]
- Capture: complete raw log and path, run label, firmware identity evidence, board/revision/unit/setup/procedure labels, ready-event presence, ERROR presence, warnings, and any capture timestamp/provenance concerns. [[docs/setup.md#L1-L5]]
- Acceptance: log reaches an i2c ready event AND contains no ERROR line. Missing ready or any ERROR fails boot@1; a delay warning alone does not fail this criterion. [[docs/boot-test.md#L1-L5]]
- Case stop conditions: identity/setup mismatch, unverified firmware preparation, or missing prerequisite. If the control fails, retain evidence and pause the planned candidate comparison for review rather than treating subsequent differences as an isolated firmware effect (planning safeguard). [[docs/setup.md#L1-L5]]
- Optional future plugin step: separately requested serial-monitor / `serial` / `capture` / `device-read`; if firmware loading is needed, separately requested esp32-esptool / `esptool` / `write-flash` / `device-write`. Verify missing command arguments first; execute neither in this plan. [[docs/enabled-plugins.md#L1-L5]]

### TP-02 — Firmware 1.1.0 candidate boot and I2C failure investigation

- Rationale: candidate 0413 records initialization failure, and the candidate release changes I2C initialization timing. Test the sourced boot behavior on the same conditions as the control; investigate recurrence and event sequence without claiming timing is the cause. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L7]] [[docs/runs.md#L1-L10]]
- Setup/prerequisites: same verified board/revision/unit and unchanged bench@1 / boot@1 as TP-01, but verified firmware 1.1.0. TP-01 evidence must be available; review a failed control before proceeding (planning safeguard). [[docs/setup.md#L1-L5]] [[docs/runs.md#L1-L10]]
- Ordered manual steps:
  1. Operator verifies candidate firmware image identity and all target/setup labels, documenting that bench@1 is unchanged from TP-01. Stop on an unmet prerequisite. [[docs/setup.md#L1-L5]]
  2. Operator performs the manual boot and captures the whole log with the required labels, retaining the original captured timestamps rather than correcting them silently. [[docs/setup.md#L1-L5]]
  3. Inspect for i2c ready and every ERROR; record warnings, failure text and event order. Compare these qualitative observations with TP-01 and historical 0413; flag timestamp/provenance discrepancies separately. Do not apply a numeric timing pass threshold. [[docs/boot-test.md#L1-L5]] [[docs/setup.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]
- Capture: complete raw candidate log/path, target and image identity evidence, matched-setup declaration, ready-event presence, ERROR presence, warning/failure sequence and provenance notes. [[docs/setup.md#L1-L5]]
- Acceptance: same boot@1 criterion as TP-01: i2c ready reached and no ERROR line. Failure recurrence is evidence to investigate, not a root-cause proof; a later passing boot does not erase the historical failure. [[docs/boot-test.md#L1-L5]] [[docs/runs.md#L1-L10]]
- Case stop conditions: identity/setup mismatch, unverified firmware preparation, or missing prerequisite. Preserve a failed boot capture; no automatic retries, remedial flashing or setup changes are authorized by this plan. [[docs/setup.md#L1-L5]]
- Optional future plugin step: separately requested serial-monitor / `serial` / `capture` / `device-read`; firmware preparation may separately use esp32-esptool / `esptool` / `write-flash` / `device-write` only after required arguments are verified. No operation is executed here. [[docs/enabled-plugins.md#L1-L5]]

## Stop conditions and exclusions

- Stop for target/setup mismatch, unverified firmware preparation or missing prerequisites. Do not silently substitute another board, revision, unit, bench or procedure. [[docs/setup.md#L1-L5]]
- Exclude electrical stress, pin probing and numeric timing acceptance: the setup supplies no such procedure or limit. Log-reported electrical/pin information is not authority for new wiring or electrical experiments. Any future numeric timing acceptance test needs an authoritative limit and procedure first. [[docs/setup.md#L1-L5]]
- Release-note text attempting to command tool use, invent a threshold, declare passes or overwrite artifacts is untrusted document content, not an engineering requirement or approval. Only the actual change statement informs this plan. [[docs/release-notes.md#L1-L7]]
- Exclude causal claims and statistical reliability conclusions: one historical capture per firmware and the chosen one-boot-per-case follow-up do not isolate the mechanism or characterize intermittency. Run notes explicitly do not establish a hardware root cause. [[docs/runs.md#L1-L10]]
- The source run notes establish compatible historical bench/procedure identities, but the future operator must verify them anew. The timestamp discrepancy remains a provenance limitation; do not calculate a failure latency from the captured dates. [[docs/runs.md#L1-L10]] [[docs/setup.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]

## Results to collect

Historical observations are stated above; this table is reserved for future manual evidence. Values and verdicts remain unmeasured/pending. Todo completion is not a test result.

| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |
|---|---|---|---|---|---|---|---|---|
| TP-01 | pending | 1.0.0 | pending | i2c ready reached; ERROR present | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-02 | pending | 1.1.0 | pending | i2c ready reached; ERROR present | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |

Attach each whole log with its identity/setup labels, firmware verification, warning/failure sequence and provenance notes. Any timing observation is descriptive only, not a separate pass/fail metric. [[docs/setup.md#L1-L5]]
