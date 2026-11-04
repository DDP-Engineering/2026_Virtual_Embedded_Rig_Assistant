Saved the manual plan: [[artifact:test-plan-VERA-DEMO-01-rev-A-DEMO-001-fw-1.1.0.md]]

**Readiness: blocked pending evidence and preparation verification.**

### Evidence verification
The supplied comparison’s **“firmware-only regression” conclusion is unsupported**:
- The run manifest identifies the candidate as **revision B**, while `boot-0413.log` identifies **revision A**. No A/B equivalence is established. [[docs/runs.md#L1-L6]] [[logs/boot-0413.log#L1-L4]]
- The candidate contains an I2C initialization ERROR and no ready event. Its timestamps also cross from April 12 to April 13, requiring provenance review—not a boot-duration inference. [[logs/boot-0413.log#L1-L4]]
- The baseline contains a ready event and no ERROR in the supplied capture, consistent with the boot criterion if attribution and completeness are verified. [[logs/boot-0412.log#L1-L4]] [[docs/boot-test.md#L1-L5]]
- The release notes identify an initialization-timing change, but explicitly make no root-cause claim. [[docs/release-notes.md#L1-L5]]

### Plan contents
Two conditional manual cases:
1. **TP-01:** firmware **1.0.0 baseline control**.
2. **TP-02:** firmware **1.1.0 candidate**, on the same verified revision-A unit and unchanged `bench@1`/`boot@1` setup.

Both use the sourced criterion: **reach `i2c ready` and contain no ERROR line**. The plan includes capture requirements, stop conditions, comparison limits, and optional future plugin steps—not runnable invocations. [[docs/setup.md#L1-L5]] [[docs/boot-test.md#L1-L5]]

Added **five pending preparation todos** covering provenance, target/setup verification, firmware preparation, capture records, and readiness review.

No flashing, capture, program execution, or tests were performed.