Saved the manual plan as **`test-plan-VERA-DEMO-01-revA-DEMO-001-fw1.1.0.md`**. [[artifact:test-plan-VERA-DEMO-01-revA-DEMO-001-fw1.1.0.md]]

**Status: `ready_for_review`** — review readiness only; no hardware operations were performed.

The plan contains two cases:
- **TP-01:** Firmware **1.0.0 baseline control**, using the same board, unit and `bench@1`.
- **TP-02:** Firmware **1.1.0 candidate reproduction**, checking whether the captured initialization failure recurs under matched conditions.

Both use `boot@1`: **an I2C-ready event must appear, with no ERROR line**. [[docs/boot-test.md#L1-L5]]

The plan distinguishes the historical candidate failure from future results and treats the release’s timing change as a risk to investigate—not a proven cause. It also flags the candidate log’s mixed dates as a limitation for elapsed-time analysis. [[logs/boot-0413.log#L1-L4]] [[docs/release-notes.md#L1-L5]]

Added **five pending preparation todos** covering plan review, target/setup/image verification, capture preparation, separately verified flashing prerequisites if later requested, and timestamp clarification. No flashing, capture, plugin activation or tests were executed.