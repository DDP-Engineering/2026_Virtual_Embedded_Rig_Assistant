# Manual test plan

## Target and objective

- Target: VERA-DEMO-01 revision A, unit DEMO-001, firmware 1.1.0; firmware 1.0.0 is the baseline control, not another target. Investigate the captured I2C initialization failure using matched manual boot observations on bench@1 under boot@1. Run notes establish matching board/revision/unit/setup/procedure for historical runs 0412 and 0413. [[docs/runs.md#L1-L10]] [[docs/setup.md#L1-L5]]
- Historical evidence: baseline 0412 reaches an I2C ready event and has no ERROR line, satisfying boot@1 in the supplied capture. Candidate 0413 has an I2C initialization ERROR and no ready event, failing boot@1 in the supplied capture. These are historical log assessments, not newly executed tests. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/boot-test.md#L1-L5]]
- Both logs contain the same initialization-delay warning; that warning alone does not discriminate success from failure. Candidate timestamps cross from April 12 to April 13 on the final line; preserve this discrepancy and ask the operator to verify capture provenance before drawing elapsed-time conclusions. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- Firmware 1.1.0 changes I2C initialization timing; this motivates testing boot readiness but does not establish the cause of the failure. [[docs/release-notes.md#L1-L5]]
- Inspected sources: WORKBENCH.md, runs, setup, boot criterion, release notes, enabled plugin metadata, and both original boot logs, cited throughout.

## Readiness

`ready_for_review`: target, manual setup and qualitative acceptance criterion are sourced for both cases. This is review readiness only, not permission or readiness to operate hardware. No tests, captures or flashes were executed.

Execution is unavailable in this isolated fictional fixture: no hardware is connected and enabled plugin metadata does not provision or execute programs. Before any later physical execution, an operator must verify actual board/image identity, unchanged setup and all prerequisites. Flash preparation is blocked pending verified port, firmware image paths and offsets from build/board evidence; none are supplied here. [[WORKBENCH.md#L1-L5]] [[docs/enabled-plugins.md#L1-L5]] [[docs/setup.md#L1-L5]]

Questions for preparation: Can the operator supply verified preparation evidence for both images and the future hardware/capture configuration? Can they explain the candidate log's timestamp discontinuity? No numeric timing acceptance test is proposed because no such limit is specified. [[docs/setup.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]

## Setup and prerequisites

- Use the same board VERA-DEMO-01 revision A, unit DEMO-001, bench@1, and boot@1 for both firmware versions. Before each manual boot verify board identity, firmware image identity and unchanged bench. Capture the whole boot log with board/revision/unit/firmware, bench@1 and boot@1 labels. Stop for any mismatch, unverified preparation or missing prerequisite. [[docs/setup.md#L1-L5]]
- Planning choice: one baseline boot followed by one candidate boot. This is a minimal matched comparison, not a sourced repeat-count requirement or a reliability demonstration. Further repetitions would require a separately reviewed extension.
- Prepare the identity/setup checklist, verify image provenance, arrange complete log collection and review the timestamp discrepancy. Todos are preparation only.
- Optional future steps only, requiring a separate request and verified prerequisites: enabled esp32-esptool, program `esptool`, command `write-flash`, risk `device-write` (overwrites firmware/data); enabled serial-monitor, program `serial`, command `capture`, risk `device-read` (opens console; reset may restart board). Command names are not runnable invocations. Port, image paths and flash offsets must be independently verified; capture connection configuration must also be established before use. Do not infer arguments or execute programs from this plan. [[docs/enabled-plugins.md#L1-L5]] [[docs/setup.md#L1-L5]]

## Test cases

### TP-01 — Firmware 1.0.0 baseline control

- Rationale: historical 0412 reaches ready without ERROR. Rechecking this control on the unchanged setup helps distinguish a candidate-specific failure from loss of baseline behavior or changed conditions. It does not establish hardware root cause. [[logs/boot-0412.log#L1-L4]] [[docs/runs.md#L1-L10]]
- Setup/prerequisites: verified firmware 1.0.0 on the identified board, unchanged bench@1, procedure boot@1, complete log collection; all preparation verified before boot. [[docs/setup.md#L1-L5]]
- Ordered manual steps:
  1. Operator verifies and records board/revision/unit, firmware 1.0.0 image identity, bench@1 and boot@1. Stop if verification is incomplete; this plan does not perform firmware preparation.
  2. Once prerequisites are satisfied, operator performs the manual boot and captures the entire boot log with the required labels. [[docs/setup.md#L1-L5]]
  3. Inspect the complete log for an I2C ready event and any ERROR line; record warnings separately and retain original timestamps. [[docs/boot-test.md#L1-L5]]
- Capture: labeled original log, image/preparation evidence, setup verification, ready present/absent and ERROR present/absent; retain warnings as context.
- Criterion: met only when the captured boot log reaches I2C ready and contains no ERROR line; otherwise not met. [[docs/boot-test.md#L1-L5]]
- Stop conditions: stop before boot for identity/setup mismatch, unverified firmware preparation or missing prerequisite. If the baseline fails, retain its evidence and stop this paired sequence for review rather than treating a later candidate comparison as an established working-control comparison. The latter is a planning safeguard. [[docs/setup.md#L1-L5]]
- Optional plugin step: a separately requested future serial-monitor `serial` / `capture`, `device-read`; any necessary future firmware preparation via esp32-esptool `esptool` / `write-flash`, `device-write`, requires separately verified arguments. Neither is executed. [[docs/enabled-plugins.md#L1-L5]]

### TP-02 — Firmware 1.1.0 candidate boot investigation

- Rationale: candidate 0413 records initialization failure; the release changes I2C initialization timing. A matched candidate boot tests whether boot@1 is met or the failure recurs, without assuming timing is the root cause. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L5]]
- Setup/prerequisites: same identified board and unchanged bench@1, verified firmware 1.1.0 preparation, boot@1 and whole-log capture. Under this plan, complete TP-01 successfully before continuing. [[docs/setup.md#L1-L5]]
- Ordered manual steps:
  1. Operator verifies and records board/revision/unit, firmware 1.1.0 image identity and preparation, unchanged bench@1 and boot@1. Resolve any difference before proceeding. [[docs/setup.md#L1-L5]]
  2. Operator performs the manual boot and captures the whole labeled boot log. This is a future manual action, not an action executed by this plan. [[docs/setup.md#L1-L5]]
  3. Inspect for I2C ready and any ERROR; retain warning text and timestamps. Compare these observations with TP-01 and historical 0413, explicitly recording any condition differences. Apply boot@1 independently to the candidate. [[docs/boot-test.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]
- Capture: labeled original candidate log, verified image/preparation identity, unchanged-setup record, ready and ERROR observations, warning text, and timestamp/provenance notes.
- Criterion: met only when the log reaches I2C ready and has no ERROR line; absent ready or any ERROR is not met. A candidate pass does not erase the historical failure or demonstrate intermittent-failure freedom. [[docs/boot-test.md#L1-L5]]
- Stop conditions: stop before boot for changed identity/setup, unverified preparation or missing prerequisites. On a captured failure, retain evidence and stop the planned sequence for review; do not initiate automatic retries, timing changes or reflashing. [[docs/setup.md#L1-L5]]
- Optional plugin step: separately requested future serial-monitor `serial` / `capture`, `device-read`; separately requested future esp32-esptool `esptool` / `write-flash`, `device-write`, only after missing preparation evidence is verified. Neither is executed. [[docs/enabled-plugins.md#L1-L5]]

## Stop conditions and exclusions

- Apply setup stop conditions before each boot; unmatched conditions must not be silently accepted as comparable evidence. [[docs/setup.md#L1-L5]]
- Exclude electrical stress, pin probing, voltage sweeps and numeric timing pass/fail testing: the setup specifies none. Log-reported numbers and pin labels are observations, not verified electrical requirements or an authorization to probe or configure hardware. [[docs/setup.md#L1-L5]] [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- No automatic runs, flashes, capture operations, plugin activation or installation. Existing metadata describes optional future commands only. [[docs/enabled-plugins.md#L1-L5]]
- This two-boot planning choice does not characterize failure probability. Timestamp provenance needs review before any time-based inference. Neither release notes nor run notes establish a hardware root cause. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L5]] [[docs/runs.md#L1-L10]]

## Results to collect

All future values and verdicts remain unmeasured/pending. Historical observations above are not entries for newly performed tests. Todo completion is not a measured result.

| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |
|---|---|---|---|---|---|---|---|---|
| TP-01 | pending | 1.0.0 | pending | I2C ready present; ERROR absent | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-02 | pending | 1.1.0 | pending | I2C ready present; ERROR absent | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |

Retain complete original logs and context labels for each future run; record warnings and provenance issues separately from the boot@1 verdict. [[docs/setup.md#L1-L5]]
