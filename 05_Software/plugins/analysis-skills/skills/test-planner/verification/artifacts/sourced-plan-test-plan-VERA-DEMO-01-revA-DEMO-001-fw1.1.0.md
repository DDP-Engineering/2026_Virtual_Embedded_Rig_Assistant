# Manual test plan

## Target and objective

- Target: VERA-DEMO-01 revision A, unit DEMO-001, firmware 1.1.0. Firmware 1.0.0 is the explicit baseline control, not another target. Investigate reproducibility of the captured I2C initialization failure using setup bench@1 and procedure/criterion boot@1. Both historical runs are identified as having those conditions. [[docs/runs.md#L1-L10]]
- This is a fictional fixture with no connected physical hardware. This plan executes nothing and claims no new results. [[WORKBENCH.md#L1-L5]]
- Inspected sources: WORKBENCH.md, runs, setup, boot criterion, release notes, enabled-plugin metadata, and both original logs, cited below.
- Historical baseline 0412 / firmware 1.0.0 contains an I2C-ready event and no ERROR line, satisfying boot@1 in the supplied capture. Historical candidate 0413 / firmware 1.1.0 contains an I2C initialization ERROR and no ready event, failing boot@1 in the supplied capture. These are historical log assessments, not newly performed tests. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/boot-test.md#L1-L5]] [[docs/runs.md#L1-L10]]
- Both captures show the same initialization-delay warning; its reported 20ms is an observation, not an acceptance threshold. Firmware 1.1.0 changes initialization timing, making timing-related behavior a risk to investigate, not an established cause. The candidate log also crosses calendar dates between the warning and ERROR; do not derive a boot duration from that interval without provenance clarification. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L5]]

## Readiness

**ready_for_review** — target, setup, and qualitative acceptance criterion are sourced for both cases. This is review readiness only, not approval or readiness to operate hardware. No tests have been executed by this plan.

Before any future execution, an operator must verify board/image identities, unchanged bench@1, and complete capture preparation. Stop if these cannot be verified. Verified flash port, image paths and offsets are absent and must be supplied before a separate flashing request; no runnable flash command is provided. This host has no connected hardware, and enabled programs are not provisioned/executed. [[docs/setup.md#L1-L5]] [[WORKBENCH.md#L1-L5]] [[docs/enabled-plugins.md#L1-L5]]

Questions for preparation: Can the operator establish the documented bench@1 and verified firmware identities? Can the owner explain the mixed dates in candidate 0413? A numeric initialization-time acceptance limit is not requested and is not specified; any later numeric timing case requires an authoritative limit before it can be ready for review. [[docs/setup.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]

## Setup and prerequisites

- Use the same VERA-DEMO-01 revision A, DEMO-001 and unchanged bench@1 for both firmware versions. Verify board identity, firmware image identity and unchanged bench before each manual boot. Label each whole boot capture with board, revision, unit, firmware, bench@1 and boot@1. [[docs/setup.md#L1-L5]]
- Prepare verified firmware 1.0.0 baseline and 1.1.0 candidate identities consistent with the run mapping. No image filenames, programming offsets, port, electrical settings or numeric timing limits are inferred from logs. [[docs/runs.md#L1-L10]] [[docs/setup.md#L1-L5]]
- Planning choice: one complete manual boot per firmware, baseline first. This is a minimal controlled reproduction, not a reliability qualification or statistically sufficient sample. Repetition requires a reviewed extension with the same identity/setup controls.
- Preparation todos: review source/identity mapping; verify bench and image prerequisites; arrange separately verified capture/programming information if needed; review criteria and recordkeeping; clarify candidate timestamp provenance. Todo completion is not test completion.
- Historical conditions are matched according to runs.md, not independently verified hardware measurements. No hardware root cause is established. [[docs/runs.md#L1-L10]]

## Test cases

### TP-01 — Firmware 1.0.0 baseline control

- **Rationale:** Historical baseline reaches I2C ready despite a delay warning. Rechecking this control guards against attributing a shared setup/capture problem exclusively to firmware 1.1.0. [[logs/boot-0412.log#L1-L4]] [[docs/runs.md#L1-L10]]
- **Setup/prerequisites:** Same target hardware and bench@1; verified firmware 1.0.0 preparation and whole-log capture capability, with required labels. [[docs/setup.md#L1-L5]]
- **Ordered manual steps:**
  1. Operator verifies and records board/revision/unit, firmware 1.0.0 image identity and unchanged bench@1. Stop on a mismatch or unverified preparation. [[docs/setup.md#L1-L5]]
  2. Operator manually boots the verified baseline using boot@1 on bench@1 and captures the whole boot log with all required labels; this document supplies no hardware command. [[docs/setup.md#L1-L5]]
  3. Inspect the complete capture for an I2C-ready event and every ERROR line; record warnings and event ordering as supporting observations, not extra acceptance limits. Apply boot@1 and retain the raw capture. [[docs/boot-test.md#L1-L5]]
- **Capture:** Whole log, run identity, verified firmware identity, setup/procedure labels, ready presence, ERROR presence, warnings, and any departure from the historical baseline. [[docs/setup.md#L1-L5]] [[logs/boot-0412.log#L1-L4]]
- **Acceptance:** I2C-ready event present and no ERROR line. Either absence of ready or presence of ERROR fails boot@1. [[docs/boot-test.md#L1-L5]]
- **Stop conditions:** Identity/setup mismatch, unverified firmware preparation, or missing prerequisite: stop without proceeding. Planning rule: if the baseline fails, preserve the evidence and pause TP-02 pending review of control validity; do not assert a candidate-only regression. [[docs/setup.md#L1-L5]]
- **Optional future plugin steps, separate user request only:** serial-monitor, program `serial`, command `capture`, risk `device-read` (console opening/reset may restart the board). If firmware preparation requires flashing: esp32-esptool, program `esptool`, command `write-flash`, risk `device-write` (overwrites firmware/data). Verify connection/capture configuration and, for flashing, port, image path and offsets separately. These command names are not runnable invocations; no plugin/program is activated or executed. [[docs/enabled-plugins.md#L1-L5]] [[docs/setup.md#L1-L5]]

### TP-02 — Firmware 1.1.0 candidate failure reproduction under matched conditions

- **Rationale:** Candidate 0413 fails initialization while the identified baseline reaches ready. The release timing change motivates a controlled reproduction and event-order inspection, not a root-cause conclusion. [[logs/boot-0413.log#L1-L4]] [[logs/boot-0412.log#L1-L4]] [[docs/release-notes.md#L1-L5]]
- **Setup/prerequisites:** Same target and bench@1 as TP-01, verified firmware 1.1.0 preparation and capture readiness. Review TP-01 first; a failed control pauses this case by planning choice. [[docs/setup.md#L1-L5]]
- **Ordered manual steps:**
  1. Operator verifies and records target identity, firmware 1.1.0 image identity and unchanged bench@1; record any preparation change and stop if compatibility cannot be established. [[docs/setup.md#L1-L5]]
  2. Operator manually boots the verified candidate using boot@1 and captures the whole boot log with required labels. [[docs/setup.md#L1-L5]]
  3. Inspect for I2C ready and all ERROR lines, recording whether the captured initialization failure recurs. Compare warnings and event order with TP-01, keeping timestamp irregularities explicit rather than deriving a timing limit or causal claim. [[docs/boot-test.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]
  4. Record the boot@1 verdict separately from failure reproduction: recurrence of an initialization ERROR is a reproduced failure, not a passing acceptance test. Absence of recurrence in this single planned boot does not establish a fix.
- **Capture:** Whole candidate log; identity/setup/procedure labels; ready and ERROR presence; exact initialization error text if present; warning/event order comparison; timestamp provenance issues. [[docs/setup.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]
- **Acceptance:** Same boot@1 criterion as TP-01: ready present and no ERROR line. No numeric timing acceptance is applied. [[docs/boot-test.md#L1-L5]] [[docs/setup.md#L1-L5]]
- **Stop conditions:** Stop on identity/setup mismatch, unverified firmware preparation, or missing prerequisite. Retain a failed capture and stop before adding changes or extra experiments outside the reviewed plan. [[docs/setup.md#L1-L5]]
- **Optional future plugin steps, separate user request only:** serial-monitor / `serial` / `capture` / `device-read`; if independently verified preparation requires it, esp32-esptool / `esptool` / `write-flash` / `device-write`. The same connection, image and offset prerequisites as TP-01 apply. No execution or runnable invocation is included. [[docs/enabled-plugins.md#L1-L5]] [[docs/setup.md#L1-L5]]

## Stop conditions and exclusions

- Mandatory setup stops: identity/setup differs, firmware preparation is unverified, or a prerequisite is missing. Do not substitute another board, revision, unit, firmware or bench while calling results matched. [[docs/setup.md#L1-L5]]
- No electrical stress, pin probing, electrical-limit test or numeric timing pass/fail test: setup specifies none. Captured supply values, pin strings and delay values are not authorization, wiring instructions or requirements. [[docs/setup.md#L1-L5]] [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- No timing sweep, bus fault injection, instrumentation or firmware modification: the inspected setup does not establish these procedures. The scoped cases test boot behavior only; they cannot isolate the hardware or firmware mechanism responsible for failure. [[docs/setup.md#L1-L5]] [[docs/release-notes.md#L1-L5]]
- No flashing, console capture, plugin installation/activation or physical operation is performed by this plan. Enabled metadata is an option for a separate future request, not authorization. [[docs/enabled-plugins.md#L1-L5]]
- Candidate date discontinuity limits elapsed-time interpretation; request provenance clarification before quantitative timing analysis. [[logs/boot-0413.log#L1-L4]]

## Results to collect

All rows below describe future evidence and remain unmeasured/pending. Historical observations are stated separately above. No todo status is a measured result.

| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |
|---|---|---|---|---|---|---|---|---|
| TP-01 | pending | 1.0.0 | pending | I2C ready present; ERROR absent | unmeasured | Boolean observations | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-02 | pending | 1.1.0 | pending | I2C ready present; ERROR absent | unmeasured | Boolean observations | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-02 | pending | 1.1.0 | pending | Initialization failure recurrence; warning/event-order comparison to TP-01 | unmeasured | qualitative | pending — supporting observation, not separate acceptance | [[logs/boot-0413.log#L1-L4]]; measured source pending |

For each future run attach the complete raw log and identity/setup/procedure labels, preparation verification, operator observations, and exact evidence references. Report acceptance and recurrence separately; do not infer a root cause from the release note or a single paired reproduction. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]] [[docs/release-notes.md#L1-L5]]
