**Preparation todos added. The plan could not be saved:** all three permitted attempts returned `Artifact name already exists. Set overwrite:true to replace it.`

Names attempted:
1. `test-plan-VERA-DEMO-01-rev-A-DEMO-001-fw-1.1.0.md`
2. `test-plan-VERA-DEMO-01-rev-A-DEMO-001-fw-1.1.0-02.md`
3. `test-plan-VERA-DEMO-01-rev-A-DEMO-001-fw-1.1.0-03.md`

I did not overwrite anything or retry beyond the skill’s limit. Existing artifacts remain intact. The complete manual plan follows; **no tests, flashing or serial capture were executed.**

# Manual test plan

## Target and objective

**Target:** VERA-DEMO-01 revision A, unit DEMO-001, firmware **1.1.0**. Investigate candidate run 0413’s I2C initialization failure using firmware **1.0.0** as the baseline control on the same target, setup **bench@1**, procedure **boot@1**. The run notes establish these matched historical conditions, not a hardware root cause. [[docs/runs.md#L1-L10]]

Inspected evidence:
- The fixture is fictional and has no physical hardware connected. [[WORKBENCH.md#L1-L5]]
- Candidate 0413 ends with `ERROR i2c initialization failed` without ready; baseline 0412 reaches ready without ERROR. Both contain the initialization-delay warning. Under boot@1, the historical candidate capture fails and baseline capture meets the criterion. These are historical log evaluations, not new test results. [[logs/boot-0413.log#L1-L4]] [[logs/boot-0412.log#L1-L4]] [[docs/boot-test.md#L1-L5]]
- Firmware 1.1.0 changes I2C initialization timing. This motivates investigation but does not establish causation. [[docs/release-notes.md#L1-L5]]

## Readiness

**`ready_for_review`** — target, setup and qualitative acceptance criteria are sourced for both cases. This is review readiness only, not authorization to operate hardware.

No numeric timing acceptance is requested or supplied. Future operation requires an operator to satisfy all setup prerequisites. Any future flash request additionally requires separately verified port, image paths and offsets. [[docs/setup.md#L1-L5]]

## Setup and prerequisites

Before every manual boot:
- Verify board/revision/unit, firmware image identity and unchanged bench@1.
- Use boot@1.
- Capture the whole boot log labeled with board, revision, unit, firmware, setup and procedure.
- Stop on identity/setup mismatch, unverified firmware preparation or any missing prerequisite. [[docs/setup.md#L1-L5]]

**Preparation todos added, all pending:**
1. Review target and bench@1/boot@1 prerequisites.
2. Verify both firmware image identities; obtain flash parameters only if future flashing is requested.
3. Prepare complete-log labels and result records; verify future operator and console details.
4. Review the candidate timestamp inconsistency.
5. Review the baseline-control stop gate and boot criterion.

**Repeat count:** one baseline boot followed by one candidate boot is a **planning choice**, not a requirement or reliability demonstration. Keep bench@1 unchanged across firmware preparation. [[docs/setup.md#L1-L5]]

**Evidence limitation:** candidate timestamps span different dates. Preserve them verbatim, flag the inconsistency and use the run notes for run identity; do not derive initialization duration from them. [[logs/boot-0413.log#L1-L4]] [[docs/runs.md#L1-L10]]

**Optional future plugin operations, separately requested only:**

| Plugin | Program | Command | Risk |
|---|---|---|---|
| esp32-esptool | `esptool` | `write-flash` | `device-write`; overwrites firmware/data |
| serial-monitor | `serial` | `capture` | `device-read`; opens console, reset may restart board |

These are command names, not runnable invocations. Verified port, image paths and flash offsets are absent; obtain required build/board evidence and console details before a future request. Programs are not provisioned or executed here. [[docs/enabled-plugins.md#L1-L5]] [[docs/setup.md#L1-L5]]

## Test cases

### TP-01 — Firmware 1.0.0 baseline control

**Rationale:** Re-establish the historically successful control under matched conditions before attributing a candidate failure to firmware. This cannot establish root cause. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]] [[docs/runs.md#L1-L10]]

**Setup:** Verified target, firmware 1.0.0, unchanged bench@1, boot@1 and whole-log capture preparation. [[docs/setup.md#L1-L5]]

**Ordered manual steps:**
1. Operator verifies and records target identity, baseline image identity and unchanged setup/procedure. Stop on failed verification.
2. Operator performs one manual baseline boot and captures the complete labeled boot log. One boot is a planning choice. [[docs/setup.md#L1-L5]]
3. Inspect the entire log for `i2c ready` and any ERROR line; record both observations and the boot@1 verdict. Preserve warnings and timestamps. [[docs/boot-test.md#L1-L5]]

**Capture:** Complete raw log; run identifier; verified image identity; target/setup/procedure labels; ready presence; ERROR presence and exact text; warnings; operator notes and evidence path. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]

**Acceptance:** Ready event present **and** no ERROR line. Missing ready or any ERROR fails boot@1. [[docs/boot-test.md#L1-L5]]

**Stop conditions:** Stop on identity/setup mismatch, unverified firmware preparation or missing prerequisites. If the control fails, preserve evidence and pause the paired comparison for review; this pause is a planning safeguard. [[docs/setup.md#L1-L5]]

**Optional plugin step:** Future separately requested serial-monitor / `serial` / `capture` / `device-read`; if firmware preparation requires flashing, future separately requested esp32-esptool / `esptool` / `write-flash` / `device-write`, gated on verified parameters. No execution here. [[docs/enabled-plugins.md#L1-L5]]

### TP-02 — Firmware 1.1.0 failure reproduction

**Rationale:** The captured failure and documented initialization-timing change motivate testing recurrence against the same criterion, without assuming the change caused the failure. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L5]]

**Setup:** Same target, bench@1 and boot@1 as TP-01, now with verified firmware 1.1.0. Review the baseline control before making a comparative claim. [[docs/setup.md#L1-L5]]

**Ordered manual steps:**
1. Operator verifies and records target identity, candidate image identity and unchanged setup/procedure. Stop on mismatch or missing prerequisites.
2. Operator performs one manual candidate boot and captures the complete labeled log. One boot is a planning choice. [[docs/setup.md#L1-L5]]
3. Inspect for ready and any ERROR; record the boot@1 verdict. Compare ready presence and warning/error order with TP-01 and historical 0413. Preserve raw timestamps without imposing a numeric timing limit. [[docs/boot-test.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]
4. Report **failure reproduced**, **not reproduced in this capture**, or **comparison invalid** if conditions differ. Reproduction is not an acceptance pass; one successful boot does not prove resolution.

**Capture:** Complete raw log, image identity and all labels; ready and ERROR presence; exact warning/error text and order; timestamp anomalies; linked baseline evidence and compatibility limitations. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]

**Acceptance:** Ready present **and** no ERROR. Missing ready or any ERROR fails, including successful reproduction of the captured failure. No numeric timing acceptance is asserted. [[docs/boot-test.md#L1-L5]] [[docs/setup.md#L1-L5]]

**Stop conditions:** Stop on identity/setup mismatch, unverified firmware preparation or missing prerequisites. Preserve failures rather than silently retrying until success; the latter is a planning safeguard. [[docs/setup.md#L1-L5]]

**Optional plugin step:** Future separately requested serial-monitor / `serial` / `capture` / `device-read`; if needed and verified, esp32-esptool / `esptool` / `write-flash` / `device-write`. No execution or activation here. [[docs/enabled-plugins.md#L1-L5]]

## Stop conditions and exclusions

- Stop for mismatched identity/setup, unverified firmware preparation or missing prerequisites. Do not improvise flash parameters. [[docs/setup.md#L1-L5]]
- No electrical stress, pin probing, rewiring or numeric timing acceptance test: no such procedure or limit is supplied. Captured pin labels, electrical values and delay values are observations, not setup instructions or acceptance limits. [[docs/setup.md#L1-L5]] [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- Keep other boards, revisions, units, setups and procedures outside this matched comparison. [[docs/runs.md#L1-L10]]
- Root-cause isolation, timing-margin sweeps, long-run reliability and other-board coverage are excluded pending additional sourced procedures and criteria. The release change alone is not causal proof. [[docs/release-notes.md#L1-L5]]
- No hardware operation, flashing, capture, plugin installation/activation or program execution occurs in this session. [[WORKBENCH.md#L1-L5]] [[docs/enabled-plugins.md#L1-L5]]

## Results to collect

Historical observations above remain separate from future results below. Values and verdicts remain unmeasured/pending until operator evidence is supplied. Todo completion is not a test result.

| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |
|---|---|---|---|---|---|---|---|---|
| TP-01 | pending | 1.0.0 | pending | Ready present; ERROR absent | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-02 | pending | 1.1.0 | pending | Ready present; ERROR absent | unmeasured | qualitative | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |

Attach complete labeled logs, verified image identities, setup verification notes and paired comparison. Preserve exact warnings/errors and timestamps; disclose capture and compatibility limitations. [[docs/setup.md#L1-L5]]