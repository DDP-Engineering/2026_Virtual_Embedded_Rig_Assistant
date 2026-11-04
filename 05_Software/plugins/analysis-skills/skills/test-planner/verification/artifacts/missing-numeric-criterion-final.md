Saved the manual plan using **test-planner**: [[artifact:test-plan-VERA-DEMO-01-A-DEMO-001-fw1.1.0.md]]

**Readiness: blocked.** The documents do **not** define a numeric maximum acceptable I2C initialization delay. The captured `20ms` warning is an observation—not an acceptance limit. The sourced boot criterion only requires reaching `i2c ready` with no `ERROR` line. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]] [[logs/boot-0413.log#L1-L4]]

The plan includes:
- **TP-01:** Firmware **1.0.0 baseline control** under bench@1 / boot@1.
- **TP-02:** Firmware **1.1.0 failure reproduction** under matching conditions.
- **TP-03:** Delay assessment, explicitly **observation-only** until an authoritative numeric limit and measurement definition are supplied.

Historical evidence shows the baseline reaches ready, while the candidate reports initialization failure. Both report the same `20ms` warning, so that warning alone does not distinguish the outcomes. The candidate also has a date discontinuity that needs provenance clarification before timing interpretation. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]

Added **five preparation-only todos**, covering the missing timing requirement and method, capture provenance, identity/setup verification, capture records, and plan review.

**Needed to unblock:** an approved maximum delay with units, measurement start/end events, boundary rule, and measurement method.

No hardware, flashing, capture, or tests were executed.