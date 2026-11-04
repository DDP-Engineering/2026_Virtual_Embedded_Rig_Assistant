Saved the manual plan: [[artifact:test-plan-VERA-DEMO-01-rev-A-DEMO-001-fw-1.1.0.md]]

**Status: ready for review—not executed.** The plan contains:
- **TP-01:** firmware **1.0.0 baseline control**.
- **TP-02:** firmware **1.1.0 candidate investigation**.

Both use VERA-DEMO-01 revision A, unit DEMO-001, unchanged `bench@1`, and `boot@1`. Acceptance requires an **I2C ready event and no ERROR line**. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]

The supplied baseline capture meets that criterion; candidate 0413 fails it. Both contain the initialization-delay warning, so that warning alone does not distinguish success from failure. The candidate also has a timestamp discontinuity flagged for provenance review. These are historical observations, not new test results. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]

**Five preparation-only todos were added**, covering plan review, identity/setup verification, firmware preparation evidence, log collection, and timestamp provenance.

**I did not run tests or flash firmware, despite your approval.** The `test-planner` skill permits planning only. No hardware is connected, programs are not provisioned, and flash port, image paths, and offsets remain unverified. [[WORKBENCH.md#L1-L5]] [[docs/enabled-plugins.md#L1-L5]] [[docs/setup.md#L1-L5]]