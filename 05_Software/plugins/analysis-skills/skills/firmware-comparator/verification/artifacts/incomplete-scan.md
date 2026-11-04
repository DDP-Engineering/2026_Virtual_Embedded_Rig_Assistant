# Firmware comparison: boot-0412 → boot-0413

## Scope and sources

Compared only the user-selected baseline `logs/boot-0412.log` (firmware 1.0.0) and candidate `logs/boot-0413.log` (firmware 1.1.0). Run identities come from the captured run notes. [[docs/runs.md#L1-L10]]

Both captures were parsed using the `iso` profile. No hardware, build, test or capture was executed.

| Capture | Source SHA-256 | Inspected source reference | Scan coverage |
|---|---|---|---|
| Baseline | `dee4449c6d0624a78148ff5154da77adb9a303bda59f99cbb9b3bdd2d21e5335` | [[logs/boot-0412.log#L1-L4]] | Complete; EOF; 4 lines, 229 bytes |
| Candidate | Unavailable: worker returned `source.sha256: null` | [[logs/boot-0413.log#L1-L2]] | **Partial**; timeout after 2 lines, 121 bytes |

These are capture-file identities, not firmware image hashes. The timeout ended the candidate evidence path: no retry, unpinned continuation or alternative read was used to bypass it. Candidate observations below apply only to the returned prefix; a complete candidate snapshot identity is unavailable.

Inspected run notes, boot criterion and release notes. No `WORKBENCH.md` was found. [[docs/runs.md#L1-L10]] [[docs/boot-test.md#h=boot-criterion-boot1]] [[docs/release-notes.md#h=firmware-110-release-notes]]

## Comparability

**Status: comparable on documented conditions.** Matching notes do not independently verify actual bench equivalence. Evidence sufficiency is separate: the candidate timeout prevents a complete comparison or acceptance verdict.

| Condition | Baseline | Candidate | Source / blocker |
|---|---|---|---|
| Board and revision | VERA-DEMO-01 revision A | VERA-DEMO-01 revision A | Matching run notes |
| Unit | DEMO-001 | DEMO-001 | Matching run notes |
| Firmware (intentional variable) | 1.0.0 | 1.1.0 | Intentional difference |
| Image hash (if known) | Unknown | Unknown | Optional identities not supplied |
| Test procedure and revision | boot@1 | boot@1 | Matching run notes; criterion inspected |
| Bench setup | bench@1 | bench@1 | Matching run notes |

Condition and firmware associations: [[docs/runs.md#L1-L10]]. Procedure scope: [[docs/boot-test.md#h=boot-criterion-boot1]]. No missing or differing required condition was found in those notes; no condition clarification is required on the present record.

## Observed differences

**Coverage:** Baseline `scan.complete=true`, `preview.truncated=false`, zero omitted events. Candidate `scan.complete=false`, stop reason `timeout`, `preview.truncated=false`, zero omitted events *within the scanned prefix*. An untruncated preview does not make the candidate scan complete.

| Level/category | Baseline: complete count | Candidate: PARTIAL observed count |
|---|---:|---:|
| error | 0 | 0 |
| warn | 1 | 0 |
| info | 3 | 2 |
| debug | 0 | 0 |
| verbose | 0 | 0 |
| other | 0 | 0 |
| unparsed | 0 | 0 |
| blank | 0 | 0 |

Coverage and count references: [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L2]]. Candidate zero counts do **not** establish absence in its full capture; full-run count deltas are unavailable.

- Baseline has a warning, `i2c initialization delayed 20ms`, at line 3, followed by `i2c SDA=PB7 SCL=PB6 ready` at line 4. These are observed baseline events, not established baseline-only messages because candidate coverage is incomplete. [[logs/boot-0412.log#L3-L3]] [[logs/boot-0412.log#L4-L4]]
- No candidate error or warning was returned in lines 1–2. The first candidate error/warning overall, whether any is new relative to baseline, and one-sided full-log messages cannot be determined. [[logs/boot-0413.log#L1-L2]]
- Both scanned prefixes have identical first occurrences of `VERA-DEMO-01 revision=A boot=demo` at `2026-04-12T08:00:00Z` and `supply=3.30V oscillator=internal` at `2026-04-12T08:00:01Z`. For each matched first occurrence, the signed candidate-minus-baseline recorded timestamp delta is **+0 seconds**. The interval between these two messages is 1 second in each prefix, a **+0-second** interval delta. These ISO timestamp observations do not measure full boot or I2C initialization latency or establish statistical significance. The matching date is reported as captured, not inferred from run filenames. [[logs/boot-0412.log#L1-L1]] [[logs/boot-0412.log#L2-L2]] [[logs/boot-0413.log#L1-L1]] [[logs/boot-0413.log#L2-L2]]

## Criterion

**Criterion:** boot@1, scoped to VERA-DEMO-01 revision A, unit DEMO-001 and setup bench@1. The captured log must reach an `i2c ready` event and contain no ERROR line. This is manual captured-log acceptance, not release certification. [[docs/boot-test.md#h=boot-criterion-boot1]]

| Run | Result | Evidence and limitation |
|---|---|---|
| Baseline 0412 | **criterion met** | Complete scan has zero errors and includes the I2C ready event. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0412.log#L4-L4]] |
| Candidate 0413 | **not evaluable** | Timeout leaves the remainder unexamined. Neither readiness nor absence of ERROR is established; no disqualifying ERROR was observed in the returned prefix. [[logs/boot-0413.log#L1-L2]] |

A missing ready event in this partial prefix is not evidence that the full candidate capture fails. No candidate pass, failure, regression or release-readiness verdict is supported.

## Binary differences

**Skipped.** Neither build folder was explicitly identified. Only the analysis-skills plugin is enabled; esp32-idf is disabled/unavailable, and no enabled safe size/symbol command or program execution tool is available. No binary inspection or build was attempted.

## Interpretation

**Facts:** The release notes document a change to I2C initialization timing in firmware 1.1.0 relative to 1.0.0 on revision A, but expressly make no root-cause claim about these captures. [[docs/release-notes.md#h=firmware-110-release-notes]] The baseline warning and subsequent ready event are established; the candidate's I2C behavior is not visible in the returned prefix. [[logs/boot-0412.log#L3-L3]] [[logs/boot-0412.log#L4-L4]] [[logs/boot-0413.log#L1-L2]]

**Hypothesis, not a finding:** The documented initialization change could affect I2C boot behavior. Current candidate evidence cannot show whether behavior changed or in which direction. A future complete, explicitly identified candidate snapshot showing the same I2C warning/readiness sequence and matched timing would reject a claim of an observable I2C difference for this captured pair, though it would not establish general equivalence. A timing change note alone is not proof of a fault or cause.

No relevant register value was returned, so register decoding was not applicable. No hardware fault or equivalence claim is made.

## Recommended checks

1. **Restore complete candidate evidence first.** Ask the user to request a fresh comparison of an explicitly identified candidate snapshot with complete scan coverage and a source SHA-256. Preserve this report's partial observations; do not silently retry or combine later bytes with this unpinned result. This is necessary before candidate acceptance or full count comparisons can be evaluated.
2. **Evaluate boot@1 on that complete snapshot.** Check for the required ready event and all ERROR lines. This resolves the present acceptance uncertainty before causal investigation.
3. **Compare full I2C event sequences and matched timings.** Identify the first new warning/error only with adequate coverage; match identical messages and occurrences, and report signed candidate-minus-baseline timing deltas. This tests the documented-change hypothesis without assuming causation.
4. **If a difference is established, review the documented timing change and actual bench records.** Verify that actual conditions matched the notes before attributing behavior to firmware. Record optional image hashes if available to improve provenance. Any repeat captures or hardware tests require separate authorization and tooling.

All checks above are recommendations only; none was executed. This report is an interim evidence-limited comparison, not a candidate acceptance or release approval.
