# Manual test plan

## Target and objective

- Target: VERA-DEMO-01 revision A, unit DEMO-001, firmware 1.1.0. Control: firmware 1.0.0 on the same revision-A unit. Investigate the captured I2C initialization failure without assuming firmware causation. The workbench is fictional and has no connected physical hardware. [[WORKBENCH.md#L1-L5]]
- Proposed matched conditions come from bench@1: same revision-A unit and unchanged bench, boot@1, verified board and firmware identities before each boot, and whole-boot captures labeled with board/revision/unit/firmware/setup/procedure. These are requirements for a future experiment, not verified conditions of the supplied candidate capture. [[docs/setup.md#L1-L5]]

### Verification of supplied comparison and evidence

- The supplied report concludes “a firmware-only regression” under identical conditions. Its runs citation ends at L7, but the inspected file has six lines; use the actual returned L1-L6 reference. The other cited logs and criterion were read directly. [[docs/comparison.md#L1-L3]] [[docs/runs.md#L1-L6]]
- The manifest identifies the baseline as revision A / DEMO-001 / firmware 1.0.0, and the candidate as revision B / DEMO-001 / firmware 1.1.0. It explicitly establishes no revision A/B equivalence. This invalidates the report's identical-condition premise. [[docs/runs.md#L1-L6]]
- The candidate log instead identifies revision A in its header, contradicting the manifest. It contains an initialization-delay warning followed by ERROR i2c initialization failed, with no i2c ready event. Its first three timestamps are April 12 and its final timestamp April 13; this discontinuity needs provenance review, not an inferred boot duration. The log does not itself identify firmware, unit, bench@1 or boot@1. [[logs/boot-0413.log#L1-L4]]
- The baseline log contains an initialization-delay warning, reaches an I2C ready event, and has no ERROR line in the supplied four lines. These contents satisfy the qualitative boot@1 log rule if the manifest's identity/setup attribution and capture completeness are verified. This is a historical observation, not a new measured result. [[logs/boot-0412.log#L1-L4]] [[docs/runs.md#L1-L6]] [[docs/boot-test.md#L1-L5]]
- The candidate contents would fail the same log rule, but its conflicting revision attribution prevents an unqualified revision-A acceptance verdict or firmware-only comparison. [[logs/boot-0413.log#L1-L4]] [[docs/runs.md#L1-L6]] [[docs/boot-test.md#L1-L5]]
- Firmware 1.1.0 changes I2C initialization timing on revision A; the release note explicitly makes no root-cause claim. Timing is therefore a risk to investigate, not an established explanation. [[docs/release-notes.md#L1-L5]]

## Readiness

**blocked** — conditional manual design only. No hardware operation or new test result is claimed.

Resolve the candidate revision conflict and capture provenance before using the supplied runs as a matched comparison. For the proposed new experiment, obtain operator verification of the exact revision-A unit, both firmware identities/preparation, unchanged bench@1, boot@1 procedure and complete capture arrangements. No physical hardware is connected in this fixture. [[docs/runs.md#L1-L6]] [[logs/boot-0413.log#L1-L4]] [[docs/setup.md#L1-L5]] [[WORKBENCH.md#L1-L5]]

Questions: Which revision actually produced boot-0413.log, and what original record ties it to firmware 1.1.0, DEMO-001, bench@1 and boot@1? Is its timestamp discontinuity authentic, and is it the whole boot capture? Can both future firmware preparations be verified on the same revision-A unit? Do not resolve these questions by choosing whichever record supports the report.

## Setup and prerequisites

1. Use only VERA-DEMO-01 revision A / DEMO-001 for the proposed experiment. Verify board identity, firmware identity and unchanged bench before each manual boot. Record bench@1 and boot@1 labels and capture the whole boot log. [[docs/setup.md#L1-L5]]
2. Prepare firmware 1.0.0 control and firmware 1.1.0 candidate by a separately verified process. Stop if preparation is unverified or any prerequisite is missing. No port, image paths or flash offsets are supplied; those require separately verified build/board evidence before any future flash request. [[docs/setup.md#L1-L5]] [[docs/enabled-plugins.md#L1-L5]]
3. Compare only newly verified matched captures. Keep the supplied conflicting candidate record separate as historical failure evidence. Same-unit matched setup is prescribed by setup documentation, not demonstrated by the old pair. [[docs/setup.md#L1-L5]] [[docs/runs.md#L1-L6]]
4. Planning choice: one future baseline boot followed by one future candidate boot. This is an initial diagnostic pair, not a sourced repeat-count requirement or a reliability qualification.
5. Preparation todos added: resolve provenance; verify target/firmware/setup; obtain firmware-preparation evidence; prepare fully labeled separate capture records; review blockers before any separately authorized operation. Todo completion is not a test result.

## Test cases

### TP-01 — Firmware 1.0.0 baseline control

- Rationale: the baseline manifest and captured ready event identify a useful control; a fresh matched control helps distinguish candidate-specific behavior from an unhealthy or changed setup. The old baseline is not proof that a future control will pass. [[docs/runs.md#L1-L6]] [[logs/boot-0412.log#L1-L4]]
- Setup/prerequisites: resolve readiness blockers; verified revision A / DEMO-001, firmware 1.0.0, bench@1 and boot@1, with whole-log capture ready. [[docs/setup.md#L1-L5]]
- Manual steps:
  1. Operator verifies and records target, firmware preparation and unchanged bench immediately before boot; stop on any mismatch.
  2. Operator performs the manual boot under boot@1 and captures the whole log, with all required identity and setup labels. No executable command is supplied here.
  3. Inspect the complete captured log for i2c ready and every ERROR line; preserve warnings and initialization sequence as context. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]
- Capture: complete original log, identity/preparation evidence, setup/procedure labels, ready-event presence, ERROR presence, and warnings. Preserve timestamps without converting observed delays into requirements.
- Criterion: log reaches i2c ready AND contains no ERROR line; either missing ready or any ERROR means not met. [[docs/boot-test.md#L1-L5]]
- Stop conditions: identity/setup mismatch, unverified firmware preparation, missing prerequisite or incomplete capture. If the control fails the criterion, retain evidence and stop the planned paired comparison for investigation; do not infer a candidate-only regression. Setup-related stops are sourced; stopping after control failure is a planning safeguard. [[docs/setup.md#L1-L5]]
- Optional future plugin steps, only if separately requested: esp32-esptool / program esptool / command write-flash / risk device-write, overwriting firmware/data; serial-monitor / program serial / command capture / risk device-read, opening console with possible reset/restart. Verified preparation arguments and capture access are prerequisites, not invented here. Neither is executed. [[docs/enabled-plugins.md#L1-L5]]

### TP-02 — Firmware 1.1.0 candidate on the same verified revision-A setup

- Rationale: the captured ERROR and release-note timing change justify checking the candidate initialization path, but incompatible historical attribution prevents claiming causation. [[logs/boot-0413.log#L1-L4]] [[docs/runs.md#L1-L6]] [[docs/release-notes.md#L1-L5]]
- Setup/prerequisites: TP-01 control meets criterion; same verified revision-A unit, unchanged bench@1 and boot@1; candidate firmware 1.1.0 preparation verified. This is a proposed matched setup, not a claim that supplied captures are comparable. [[docs/setup.md#L1-L5]]
- Manual steps:
  1. Operator verifies candidate firmware and board identity and records that bench/setup/procedure remain unchanged from TP-01. Stop if this cannot be established.
  2. Operator performs the manual boot and saves the complete, separately labeled candidate log.
  3. Evaluate i2c ready and all ERROR lines against boot@1. Compare the initialization sequence and warnings with TP-01, retaining any observed delay as descriptive evidence only. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]
- Capture: full log and matching metadata; ready-event presence; ERROR presence/content; initialization warning sequence; verified firmware-preparation evidence and pairing to TP-01.
- Criterion: reaches i2c ready AND no ERROR line. Candidate failure with a passing, verified matched control supports a candidate-associated regression in this pair, not proof that the timing change caused it. Both passing means failure was not reproduced in this pair, not proof of absence. [[docs/boot-test.md#L1-L5]]
- Stop conditions: any identity/setup/preparation mismatch, missing prerequisite, incomplete capture or nonpassing control blocks the comparison. A candidate ERROR is a failing outcome to preserve, not authorization for automatic retry or corrective flashing. [[docs/setup.md#L1-L5]]
- Optional future plugin steps: same enabled esp32-esptool / esptool / write-flash / device-write and serial-monitor / serial / capture / device-read options as TP-01, separately requested only and subject to verified prerequisites. No execution or activation is part of this plan. [[docs/enabled-plugins.md#L1-L5]]

## Stop conditions and exclusions

- Stop for identity/setup differences, unverified firmware preparation or missing prerequisites. Do not substitute revision B or presume A/B equivalence. [[docs/setup.md#L1-L5]] [[docs/runs.md#L1-L6]]
- Exclude electrical stress, pin probing and numeric timing pass/fail: setup specifies none. Captured pin labels, supply values and delay values are observations, not wiring authority or acceptance limits. No such parameters are prescribed by this plan. [[docs/setup.md#L1-L5]] [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]
- Exclude cross-revision qualification and a firmware-only conclusion from the historical pair. Revision equivalence and candidate provenance are missing. [[docs/runs.md#L1-L6]] [[logs/boot-0413.log#L1-L4]]
- Two cases target the observed initialization failure and required baseline control. Timing-root-cause isolation, endurance and statistical reliability testing are outside this initial pair; there is no sourced numeric timing criterion. A future numeric timing acceptance case would remain observation-only and blocked until an authoritative limit is provided. [[docs/setup.md#L1-L5]] [[docs/release-notes.md#L1-L5]]
- Enabled plugin metadata is not a provisioned executable or authorization. No program, capture, flash or test has been run. [[docs/enabled-plugins.md#L1-L5]]

## Results to collect

Historical observations are listed above and are not future results. Leave future values and verdicts pending until measured evidence is supplied. No todo status establishes a measured result.

| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |
|---|---|---|---|---|---|---|---|---|
| TP-01 | pending control | 1.0.0 | pending | i2c ready present; ERROR absent | unmeasured | Boolean log observations | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |
| TP-02 | pending candidate | 1.1.0 | pending | i2c ready present; ERROR absent | unmeasured | Boolean log observations | pending | [[docs/boot-test.md#L1-L5]]; measured source pending |

Attach identity, firmware-preparation and unchanged-setup records to each future log. Keep the original captures and attribution conflict alongside any future pair; do not relabel the historical candidate to make it comparable.
