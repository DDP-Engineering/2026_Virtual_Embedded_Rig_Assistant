Saved the manual plan: [[artifact:test-plan-VERA-DEMO-01-revA-DEMO-001-fw1.1.0.md]]

**Status: ready for review—not execution approval.**

The plan contains two matched-condition cases:
- **TP-01:** Firmware **1.0.0 baseline control** on VERA-DEMO-01 revision A, DEMO-001.
- **TP-02:** Firmware **1.1.0 candidate**, investigating recurrence of the captured I2C initialization failure.

Both use the documented **boot@1** criterion: the complete boot log must reach `i2c ready` and contain **no ERROR line**. No numeric timing threshold is introduced. [[docs/boot-test.md#L1-L5]]

The plan flags the candidate log’s timestamp discrepancy for provenance review and treats the release’s timing change as a risk to investigate—not an established root cause. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L7]]

Added **five pending preparation todos** covering plan review, target/setup verification, firmware preparation, capture records, and provenance review. No tests, flashing, captures, or plugin programs were executed.