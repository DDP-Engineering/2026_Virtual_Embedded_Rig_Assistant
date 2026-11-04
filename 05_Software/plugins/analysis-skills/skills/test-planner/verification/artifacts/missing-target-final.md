Saved **`test-plan-blocked-unknown-target.md`** with one conditional, observation-only case. **Readiness: blocked.** No target was assumed and no hardware was operated. [[artifact:test-plan-blocked-unknown-target.md]]

I inspected `WORKBENCH.md`, the run/setup notes, the available criterion document, release notes and the failure capture:
- Target identity and operator setup are unrecorded. [[docs/runs.md#L1-L3]] [[docs/setup.md#L1-L3]]
- No acceptance criterion or applicable release information is available. [[docs/boot-test.md#L1-L3]] [[docs/release-notes.md#L1-L3]]
- The log contains board/revision labels, but these do not resolve the missing provenance; the workbench explicitly warns that the failure alone does not identify the target. [[logs/boot-0413.log#L1-L4]] [[WORKBENCH.md#L1-L3]]

To unblock the draft when information becomes available, provide:
1. **Board/model, revision, physical unit ID and exact firmware build**—and confirmation that this is the intended test target.
2. **Approved setup and reproduction procedure**, including the I2C peripheral/configuration and capture method.
3. **Authoritative acceptance requirements**, including any timing limit.
4. Applicable release notes and, if available, a known-good baseline with matched conditions.

Until then, the draft supplies no runnable procedure or pass/fail verdict.